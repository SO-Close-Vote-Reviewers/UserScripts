// ==UserScript==
// @name         CV Request Archiver
// @namespace    https://github.com/SO-Close-Vote-Reviewers/
// @version      2.0.1.11.8
// @description  (BETA) Scans the chat transcript and checks all cv+delete+undelete+reopen+dupe requests and SD+FireAlarm+Queen reports for status, then moves the completed or expired ones.
// @author       @TinyGiant @rene @Tunaki @Makyen
// @include      /https?:\/\/chat(\.meta)?\.stack(overflow|exchange).com\/(rooms|search|transcript)(\/|\?).*/
// @grant        none
// ==/UserScript==
/* jshint -W097 */
/* jshint jquery:    true */
/* jshint forin:     false */
/* jshint curly:     false */
/* jshint browser:   true */
/* jshint devel:     true */
/* jshint esversion: 6 */
/* jshint esnext: true */
/* globals CHAT */

(function() {
    'use strict';

    const lsPrefix = 'SOCVR-Archiver-'; //prefix to avoid clashes in localStorage
    const getStorage = (key) => localStorage[lsPrefix + key];
    const setStorage = (key, val) => (localStorage[lsPrefix + key] = val);
    const setStorageJSON = (key, val) => (localStorage[lsPrefix + key] = JSON.stringify(val));

    function getStorageJSON(key) {
        const storageValue = getStorage(key);
        try {
            return JSON.parse(storageValue);
        } catch (e) {
            //Storage is not valid JSON
            return null;
        }
    }
    //Don't run in iframes
    if (window !== window.top) {
        return false;
    }
    var room = (/chat\.stackoverflow\.com\/rooms\/(\d+)/.exec(window.location.href) || [false, false])[1];
    var isChat = !!room;
    var isSearch = false;
    if (/^\/search/.test(window.location.pathname)) {
        isSearch = true;
        room = (/^.*\broom=(\d+)\b.*$/i.exec(window.location.search) || [false, false])[1];
    }
    var isTranscript = false;
    if (/\/transcript\//.test(window.location.pathname)) {
        isTranscript = true;
        var roomNameLink = $('#sidebar-content .room-mini .room-mini-header .room-name a');
        if (roomNameLink.length) {
            room = (/^(?:https?:)?(?:\/\/chat\.stackoverflow\.com)?\/rooms\/(\d+)/.exec(roomNameLink[0].href) || [false, false])[1];
        }
    }
    if (!room) {
        return false;
    }

    var fkey = $('#fkey');
    //fkey is not available in search
    if (isSearch) {
        fkey = isSearch ? getStorage('fkey') : fkey;
    } else {
        if (!fkey.length) {
            return false;
        }
        fkey = fkey.val();
    }
    if (!fkey) {
        return false;
    }
    setStorage('fkey', fkey);

    var me = (/\d+/.exec($('#active-user').attr('class')) || [false])[0];
    //Get me from localStorage. (transcript doesn't contain who you are).
    me = me ? me : getStorage('me');
    if (!me) {
        return false;
    }
    //Save me in localStorage.
    setStorage('me', me);

    $.ajax({
        type: 'POST',
        url: '/user/info?ids=' + me + '&roomId=' + room,
        success: CVRequestArchiver,
    });

    function CVRequestArchiver(info) {
        if (!info.users[0].is_owner && !info.users[0].is_moderator) {
            return false;
        }

        let totalEventsToFetch = 0;
        let requests = [];
        let messagesToMove = [];
        let events = [];
        let eventsByNum = {};

        const defaultTargetRoom = 90230;
        const nodes = {};
        let avatarList = getStorageJSON('avatarList') || {};
        const $body = $(document.body);
        const nKButtonEntriesToScan = 3000;
        const knownUserIds = {
            fireAlarm: 6373379,
            smokeDetector: 3735529,
            queen: 6294609,
            fox9000: 3671802,
        };
        const targetRoomsByRoomNumber = {
            //SOCVR
            41570: new TargetRoom(41570, 'SOCVR', 'SOCVR', 'R'),
            //Graveyard
            90230: new TargetRoom(90230, 'SOCVR Request Graveyard', 'Graveyard', 'G'),
            //Sanitarium
            126195: new TargetRoom(126195, 'SOCVR Sanitarium', 'Sanitarium', 'S'),
            //Testing Facility
            //68414: new TargetRoom(68414, 'SOCVR Testing Facility', 'Testing', 'T'),
            //SOBotics
            //111347: new TargetRoom(111347, 'SOBotics', 'Botics', 'B'),
        };
        //The current room is not a valid room target.
        delete targetRoomsByRoomNumber[room];
        const SECONDS_IN_DAY = 24 * 60 * 60;
        const timezoneOffsetMs = (new Date()).getTimezoneOffset() * 60 * 1000;
        //The endpoint supports movePosts with up to 2048 messages.
        //  However, when the chunk size is larger than 100 it causes the chat interface to not properly
        //  delete moved messages from the chat display. Thus, the chunk size is kept at < 100 for moves of displayed messages.
        //  The size used is 100 for messages which would be  still visible in the most recent chat instance for the user,
        //  then 2048 for the rest. The minimal number of moves is performed.
        //  Some messages are not moved (those without a user_id), as they cause an API error.
        const bigChunkSize = 2048; //CHAT API movePosts maximum is 2048, higher numbers result in "Internal Server Error".
        const smallChunkSize = 100;
        const unclosedRequestReviewerButtons = $('.urrs-requests-button');

        // REQUEST TYPES

        /* Example request text:
            <a href="//stackoverflow.com/questions/tagged/cv-pls"><span class="ob-post-tag" style="background-color: #E0EAF1; color: #3E6D8E; border-color: #3E6D8E; border-style: solid;">cv-pls</span></a> <a href="//stackoverflow.com/questions/tagged/entity-framework"><span class="ob-post-tag" style="background-color: #E0EAF1; color: #3E6D8E; border-color: #3E6D8E; border-style: solid;">entity-framework</span></a> Unclear (&quot;I get error&quot;-type of question) https://stackoverflow.com/q/46022628/861716
         */
        //People can really mangle the -pls portion of the request. The RegExp has a known terminating character for the tag:
        // " for matching the href URL and ] for plain text.
        //Match if they get at least 2 characters of pls, just pl, or 1 extra character
        const please = '(?:pl(?:ease|s|z)|p.?[sz]|.l[sz]|pl.?|.pl[sz]|p.l[sz]|pl.[sz]|pl[sz].)';
        const hrefUrlTag = '(?:tagged\\/';
        const endHrefToPlainText = '"|\\[';
        const endPlainTextToEndWithQuestion = '\\]).*stackoverflow\\.com\\/(?:[qa][^\\/]*|posts)\\/(\\d+)';
        const questionUrlToHrefTag = 'stackoverflow\\.com\\/(?:[qa][^\\/]*|posts)\\/(\\d+).*(?:tagged\\/';
        const endPlainTextToEndWithQuestionOrReview = '\\]).*stackoverflow\\.com\\/(?:[qa][^\\/]*|posts|review\\/[\\w-]+)\\/(\\d+)';
        const questionOrReviewUrlToHrefTag = 'stackoverflow\\.com\\/(?:[qa][^\\/]*|posts|review\\/[\\w-]+)\\/(\\d+).*(?:tagged\\/';
        const endPlainTextToEnd = '\\])';
        const endHrefPrefixToSpanText = '[^>]*><span[^>]*>';
        const endSpanTextToPlainText = '<\\/span>|\\[';

        function makeTagRegExArray(prefix, additional, includeReviews) {
            prefix = typeof prefix === 'string' ? prefix : '';
            additional = typeof additional === 'string' ? additional : '';
            //We have multiple RegExp for each tag type. We are always checking all of them for any match. Thus, this is equivalent
            //  to using a single RegExp that is /(?:RegExp text1|RegExp text2|RegExp text3|RegExp text4)/. Testing against a single
            //  RegExp should be faster than 4.
            const regexText = '(?:' + ([
                //Tag before question
                (hrefUrlTag + prefix + additional + endHrefToPlainText + prefix + additional + (includeReviews ? endPlainTextToEndWithQuestionOrReview : endPlainTextToEndWithQuestion)),
                //Tag after question
                ((includeReviews ? questionOrReviewUrlToHrefTag : questionUrlToHrefTag) + prefix + additional + endHrefToPlainText + prefix + additional + endPlainTextToEnd),
                //Tag before question: match tag in the <span>, not in the href (which could be encoded)
                (hrefUrlTag + prefix + endHrefPrefixToSpanText + prefix + additional + endSpanTextToPlainText + prefix + additional + (includeReviews ? endPlainTextToEndWithQuestionOrReview : endPlainTextToEndWithQuestion)),
                //Tag after question: match tag in the <span>, not in the href (which could be encoded)
                ((includeReviews ? questionOrReviewUrlToHrefTag : questionUrlToHrefTag) + prefix + endHrefPrefixToSpanText + prefix + additional + endSpanTextToPlainText + prefix + additional + endPlainTextToEnd),
            ].join('|')) + ')';
            return [new RegExp(regexText, 'i')];
            //Example RegExp generated for approve/reject with considering reviews:
            //https://regex101.com/r/18x5ZH/1
            //(?:(?:tagged\/(?:app?rove?|reject)-(?:pl(?:ease|s|z)|p.?[sz]|.l[sz]|pl.?|.pl[sz]|p.l[sz]|pl.[sz]|pl[sz].)"|\[(?:app?rove?|reject)-(?:pl(?:ease|s|z)|p.?[sz]|.l[sz]|pl.?|.pl[sz]|p.l[sz]|pl.[sz]|pl[sz].)\]).*stackoverflow\.com\/(?:[qa][^\/]*|posts|review\/[\w-]+)\/(\d+)|stackoverflow\.com\/(?:[qa][^\/]*|posts|review\/[\w-]+)\/(\d+).*(?:tagged\/(?:app?rove?|reject)-(?:pl(?:ease|s|z)|p.?[sz]|.l[sz]|pl.?|.pl[sz]|p.l[sz]|pl.[sz]|pl[sz].)"|\[(?:app?rove?|reject)-(?:pl(?:ease|s|z)|p.?[sz]|.l[sz]|pl.?|.pl[sz]|p.l[sz]|pl.[sz]|pl[sz].)\])|(?:tagged\/(?:app?rove?|reject)-[^>]*><span[^>]*>(?:app?rove?|reject)-(?:pl(?:ease|s|z)|p.?[sz]|.l[sz]|pl.?|.pl[sz]|p.l[sz]|pl.[sz]|pl[sz].)<\/span>|\[(?:app?rove?|reject)-(?:pl(?:ease|s|z)|p.?[sz]|.l[sz]|pl.?|.pl[sz]|p.l[sz]|pl.[sz]|pl[sz].)\]).*stackoverflow\.com\/(?:[qa][^\/]*|posts|review\/[\w-]+)\/(\d+)|stackoverflow\.com\/(?:[qa][^\/]*|posts|review\/[\w-]+)\/(\d+).*(?:tagged\/(?:app?rove?|reject)-[^>]*><span[^>]*>(?:app?rove?|reject)-(?:pl(?:ease|s|z)|p.?[sz]|.l[sz]|pl.?|.pl[sz]|p.l[sz]|pl.[sz]|pl[sz].)<\/span>|\[(?:app?rove?|reject)-(?:pl(?:ease|s|z)|p.?[sz]|.l[sz]|pl.?|.pl[sz]|p.l[sz]|pl.[sz]|pl[sz].)\]))
        }

        function makeActualTagWithoutQuestionmarkRegExArray(prefix, additional) {
            prefix = typeof prefix === 'string' ? prefix : '';
            additional = typeof additional === 'string' ? additional : '';
            const regexText = '(?:' + ([
                //https://regex101.com/r/akgdVi/2
                '<span class="ob-post-tag"[^>]*>' + prefix + additional + '<\\/span><\\/a>\\s*(?![\\w ]*\\?)',
            ].join('|')) + ')';
            return [new RegExp(regexText, 'i')];
        }

        const cvRegexes = makeTagRegExArray('cv-', please);
        const deleteRegexes = makeTagRegExArray('d(?:el(?:ete)?)?(?:v)?-?(?:vote)?-', please);
        const undeleteRegexes = makeTagRegExArray('un-?del(?:ete)?(?:v)?-?(?:vote)?-', please);
        const reopenRegexes = makeTagRegExArray('re-?open-', please);
        const duplicateRegexes = makeTagRegExArray('pos?sib(?:le|el)-dup(?:e|licate)?');
        const flagRegexes = makeTagRegExArray('flag-', please);
        const flagAsTagRegexes = makeActualTagWithoutQuestionmarkRegExArray('flag-', please);
        const spamRegexes = makeTagRegExArray('spam');
        const spamAsTagRegexes = makeActualTagWithoutQuestionmarkRegExArray('spam');
        const offensiveRegexes = makeTagRegExArray('(?:off?en[cs]ive|rude|abb?u[cs]ive)');
        const offensiveAsTagRegexes = makeActualTagWithoutQuestionmarkRegExArray('(?:off?en[cs]ive|rude|abb?u[cs]ive)');
        const approveRejectRegexes = makeTagRegExArray('(?:app?rove?|reject)-', please, true);
        // FireAlarm reports
        const faRegexes = [
            /(?:\/\/stackapps\.com\/q\/7183\">FireAlarm-Swift)/, // eslint-disable-line no-useless-escape
            /(?:\[ <a href="\/\/github\.com\/SOBotics\/FireAlarm\/tree\/swift" rel="nofollow noopener noreferrer">FireAlarm-Swift<\/a> \])/,
        ];
        //We need to choose if we want more SD commands to be archived.
        //We probably don't want to archive: (?!blame|lick|wut|coffee|tea|brownie)
        //const sdBangBangCommandsRegEx = /^\s*!!\/(?!blame|lick|wut|coffee|tea|brownie)/i;
        const sdBangBangCommandsRegEx = /^\s*!!\/(?:report)/i;
        const sdFeedbacksRegEx = /^(?:@SmokeD?e?t?e?c?t?o?r?|\s*sd)(?:\s+(?:\n*(?:k|v|n|naa|fp?|tp?|spam|rude|abusive|offensive|v|vand|vandalism|notspam|true|false|ignore|delete|del|remove|gone|postgone|why))u?-?)+\s*$/i;
        const editMonitorRegEx = /bad edit/i;

        const RequestTypes = {
            DELETE: {
                name: 'Delete',
                primary: true,
                regexes: deleteRegexes,
                alwaysArchiveAfterSeconds: 7 * SECONDS_IN_DAY, //7 days
            },
            REOPEN: {
                name: 'Reopen',
                primary: true,
                regexes: reopenRegexes,
                onlyQuestions: true,
                alwaysArchiveAfterSeconds: 3 * SECONDS_IN_DAY, //3 days
            },
            CLOSE: {
                name: 'Close',
                primary: true,
                regexes: cvRegexes,
                onlyQuestions: true,
                alwaysArchiveAfterSeconds: 3 * SECONDS_IN_DAY, //3 days
            },
            UNDELETE: {
                name: 'Undelete',
                primary: true,
                regexes: undeleteRegexes,
                alwaysArchiveAfterSeconds: 7 * SECONDS_IN_DAY, //7 days
            },
            FLAG_SPAM_OFFENSIVE: {
                name: 'Flag, Spam and Offensive',
                primary: true,
                regexes: flagRegexes.concat(spamRegexes, offensiveRegexes),
                //"spam" and "offensive" are too generic. We need to require that they are actually in tags.
                andRegexes: flagAsTagRegexes.concat(spamAsTagRegexes, offensiveAsTagRegexes),
                alwaysArchiveAfterSeconds: 2 * 60 * 60, //2 hours
                underAgeTypeKey: 'DELETE',
            },
            APPROVE_REJECT: {
                name: 'Approve/Reject',
                primary: true,
                regexes: approveRejectRegexes,
                alwaysArchiveAfterSeconds: 2 * 60 * 60, //2 hours
                //This really should have a separate call the the SE API to get review information, where possible.
                underAgeTypeKey: 'DELETE',
            },
            DUPLICATE: {
                name: 'Duplicate',
                regexes: duplicateRegexes,
                alwaysArchiveAfterSeconds: 3 * SECONDS_IN_DAY, //3 days
                underAgeTypeKey: 'CLOSE',
            },
            FIREALARM: {
                name: 'FireAlarm',
                regexes: faRegexes,
                userIdMatch: knownUserIds.fireAlarm,
                alwaysArchiveAfterSeconds: 30 * 60, //30 minutes
                underAgeTypeKey: 'CLOSE',
                archiveParentWithThis: true,
            },
            QUEEN: {
                name: 'Queen',
                alwaysArchiveAfterSeconds: 30 * 60, //30 minutes
                userIdMatch: knownUserIds.queen,
                regexes: [
                    /Heat Detector/,
                ],
                underAgeTypeKey: 'DELETE',
                onlyComments: true,
            },
            EDITMONITOR: {
                name: 'Edit Monitor reports',
                userIdMatch: knownUserIds.fox9000,
                regexes: [editMonitorRegEx],
                alwaysArchiveAfterSeconds: 2 * 60 * 60, //2 hours
                //This really should have a separate call the the SE API to get review information, where possible.
                underAgeTypeKey: 'DELETE',
            },
            SMOKEDETECTOR: {
                name: 'SmokeDetector',
                userIdMatch: knownUserIds.smokeDetector,
                alwaysArchiveAfterSeconds: 4 * 60 * 60, //4 hours
                underAgeTypeKey: 'DELETE',
                textRegexes: [
                    /\[\s*SmokeDetector\s*[|\]]/,
                ],
                textMatchNoContent: true,
                additionalRequestCompleteTests: [
                    // Take advantage of AIM, if installed, to get number of FP feedbacks.
                    function(event) {
                        //Expires SD reports with >= 1 false positive feedbacks.
                        return $('#message-' + event.message_id + ' > .ai-information .ai-feedback-info-fp').first().text() >= 1;
                    },
                    //Relies on both AIM and an updated version of the Unclosed Request Review Script
                    function(event) {
                        //Expires SD reports with >= 1 tp- feedbacks that have been edited since the message was posted.
                        const message = $('#message-' + event.message_id).first();
                        //Relies on an updated version of the Unclosed Request Generator
                        const requestInfo = $('.request-info a', message).first();
                        const aimHoverTpu = $('.meta .ai-information .ai-feedback-info-tpu', message);
                        if (!requestInfo.length || !aimHoverTpu.length) {
                            return false;
                        }
                        let lastEditDate = requestInfo[0].dataset.lastEditDate;
                        lastEditDate = lastEditDate ? +lastEditDate : 0;
                        const aimHoverTpuText = aimHoverTpu.text();
                        const aimHoverTpuTitle = aimHoverTpu.attr('title');
                        if (lastEditDate > event.time_stamp && aimHoverTpuText >= 1 && /^tp-:/.test(aimHoverTpuTitle)) {
                            return true;
                        } // else
                        return false;
                    },
                    //NAA feedback is currently not considered, due to the MS API not raising NAA flags. Once FIRE does
                    //  do so through the SE API, it'd be reasonable to expire them if the current user has sent such
                    //  feedback through FIRE (implies that FIRE needs to indicate that).
                ],
            },
            SMOKEDETECTOR_NOCONTENT: {
                name: 'SmokeDetector no content',
                userIdMatch: knownUserIds.smokeDetector,
                alwaysArchiveAfterSeconds: 0.01, //Always archive
                noContent: true,
            },
            SMOKEDETECTOR_REPLYING: {
                name: 'SmokeDetector replying',
                userIdMatch: knownUserIds.smokeDetector,
                alwaysArchiveAfterSeconds: 4 * 60 * 60, //4 hours
                replyToTypeKeys: [
                    'SMOKEDETECTOR_FEEDBACK',
                    'SMOKEDETECTOR_COMMAND',
                ],
                archiveWithParent: true,
            },
            SMOKEDETECTOR_FEEDBACK: {
                name: 'SmokeDetector feedback',
                regexes: [sdFeedbacksRegEx],
                alwaysArchiveAfterSeconds: 4 * 60 * 60, //4 hours
                archiveWithParent: true,
                archiveWithPreviousFromUserId: knownUserIds.smokeDetector,
            },
            SMOKEDETECTOR_COMMAND: {
                name: 'SmokeDetector commands',
                regexes: [sdBangBangCommandsRegEx],
                alwaysArchiveAfterSeconds: 4 * 60 * 60, //4 hours
                archiveWithNextFromUserId: knownUserIds.smokeDetector,
                archiveWithChildren: true,
            },
        };
        const RequestTypeKeys = Object.keys(RequestTypes);
        //Add direct references to RequestTypes, which can't exist within the Object literal.
        RequestTypeKeys.forEach((key) => {
            if (RequestTypes[key].underAgeTypeKey) {
                RequestTypes[key].underAgeType = RequestTypes[RequestTypes[key].underAgeTypeKey];
            }
            if (RequestTypes[key].replyToTypeKeys) {
                RequestTypes[key].replyToTypes = RequestTypes[key].replyToTypeKeys.map((replyKey) => RequestTypes[replyKey]);
            }
        });
        const primaryRequestTypes = [
            //We want to find DELETE and REOPEN first.
            RequestTypes.DELETE,
            RequestTypes.REOPEN,
            RequestTypes.CLOSE,
            RequestTypes.UNDELETE,
            RequestTypes.FLAG_SPAM_OFFENSIVE,
            RequestTypes.APPROVE_REJECT,
        ].filter((type) => type);

        function populateRequestAges() {
            //Fill the alwaysArchiveAfterDateSeconds for each RequestTypes with a time in seconds from Epoch for each type's alwaysArchiveAfterSeconds.
            const now = Date.now() / 1000;
            Object.keys(RequestTypes).forEach((type) => {
                if (RequestTypes[type].alwaysArchiveAfterSeconds) {
                    RequestTypes[type].alwaysArchiveAfterDateSeconds = Math.floor(now - RequestTypes[type].alwaysArchiveAfterSeconds);
                }
            });
        }

        function removeMessagesNotFromThisRoom() {
            //Look through the messages and remove those which are not from this room's transcript;
            //  The transcript/search will have some results which are not actually in the room being
            //  searched/displayed. This is indicated by the URL for the message directing to a different room.
            var currentRoomMatches = /\bRoom=(\d+)/i.exec(window.location.search);
            var currentRoom;
            if (currentRoomMatches) {
                currentRoom = currentRoomMatches[1];
            }
            if (currentRoom) {
                $('.message .action-link').each(function() {
                    var actionSpan = $(this);
                    var linkHref = actionSpan.parent()[0].href;
                    if (linkHref.indexOf('/' + currentRoom + '?') === -1) {
                        const message = actionSpan.closest('.message');
                        const matches = linkHref.match(/\/(\d+)\?/);
                        const actualRoomNumber = matches ? matches[1] : '';
                        const roomName = (actualRoomNumber && targetRoomsByRoomNumber[actualRoomNumber]) ? targetRoomsByRoomNumber[actualRoomNumber].fullName : '';
                        message.css({'background-color': '#ec6'})[0]
                            .title = 'This message is not in this room. ' + (roomName ? 'It\'s in ' + roomName : 'See message link for where it is' + (actualRoomNumber ? '(room #' + actualRoomNumber + ')' : '')) + '.';
                    }
                });
            }
        }

        if (isSearch) {
            removeMessagesNotFromThisRoom();
        }

        //Build the buttons and UI which is in the Chat input area.
        nodes.scope = document.querySelector('#chat-buttons');
        nodes.originalScope = nodes.scope;
        if (isTranscript || isSearch || !nodes.scope) {
            //Create a dummy element
            nodes.scope = document.createElement('div');
        }

        if (unclosedRequestReviewerButtons.length > 0) {
            nodes.scope = document.createElement('span');
            unclosedRequestReviewerButtons.filter('#urrs-open-options-button').first().after(nodes.scope);
        }

        nodes.startbtn = document.createElement('button');
        nodes.startbtn.className = 'button archiver-startbtn cvra-archiver-button';
        nodes.startbtn.textContent = 'archiver';
        nodes.startbtn.title = 'Open the controls for the request archiver.';
        nodes.scope.appendChild(nodes.startbtn);

        nodes.scanNkbtn = document.createElement('button');
        nodes.scanNkbtn.className = 'button archiver-scanNk';
        nodes.scanNkbtn.textContent = 'scan ' + (nKButtonEntriesToScan / 1000) + 'k';
        nodes.scanNkbtn.title = 'Open the controls for the request archiver and scan ' + (nKButtonEntriesToScan / 1000) + 'k events.';
        nodes.scope.appendChild(nodes.scanNkbtn);

        if (unclosedRequestReviewerButtons.length > 0) {
            nodes.scope = nodes.originalScope;
            //nodes.scope.appendChild(document.createElement('br'));
        }

        nodes.form = document.createElement('form');
        nodes.form.className = 'archiver-form';
        nodes.scope.appendChild(nodes.form);

        nodes.count = document.createElement('input');
        nodes.count.className = 'button archiver-count';
        nodes.count.placeholder = '#';
        nodes.count.type = 'text';
        nodes.count.style.display = 'none';
        nodes.count.title = 'The number of "events" (messages) to scan for completed requests.';
        nodes.form.appendChild(nodes.count);

        nodes.gobtn = document.createElement('button');
        nodes.gobtn.className = 'button archiver-gobtn';
        nodes.gobtn.textContent = 'scan';
        nodes.gobtn.style.display = 'none';
        nodes.gobtn.title = 'Scan the events in this room for matching messages.';
        nodes.form.appendChild(nodes.gobtn);

        nodes.scope.appendChild(document.createTextNode(' '));

        nodes.cancel = document.createElement('button');
        nodes.cancel.className = 'button archiver-cancel';
        nodes.cancel.textContent = 'cancel';
        nodes.cancel.style.display = 'none';
        nodes.scope.appendChild(nodes.cancel);

        nodes.scandate = document.createElement('span');
        nodes.scandate.textContent = '';
        nodes.scandate.style.display = 'none';
        nodes.scope.appendChild(nodes.scandate);

        nodes.scope.appendChild(document.createElement('br'));

        nodes.indicator = document.createElement('input');
        nodes.indicator.className = 'button archiver-indicator';
        nodes.indicator.type = 'text';
        nodes.indicator.readOnly = true;
        nodes.indicator.style.display = 'none';
        nodes.scope.appendChild(nodes.indicator);

        nodes.scope.appendChild(document.createTextNode(' '));

        nodes.movebtn = document.createElement('button');
        nodes.movebtn.className = 'button archiver-movebtn';
        nodes.movebtn.textContent = 'move';
        nodes.movebtn.style.display = 'none';
        nodes.scope.appendChild(nodes.movebtn);

        nodes.progresswrp = document.createElement('div');
        nodes.progresswrp.className = 'archive-progresswrp';
        nodes.progresswrp.style.display = 'none';
        nodes.scope.appendChild(nodes.progresswrp);

        nodes.progress = document.createElement('div');
        nodes.progress.className = 'archive-progress';
        nodes.progresswrp.appendChild(nodes.progress);

        nodes.style = document.createElement('style');
        nodes.style.type = 'text/css';
        //Ideally, the colors used for the MoveTo control hover would be adjusted in case the user has a non-stock theme installed.
        //  But, we can't get colors here because the messages may not exist in the page yet.
        nodes.style.textContent = [
            '#chat-buttons {',
            '    cursor: default;',
            '}',
            '#input-area .button {',
            '    margin: 1px !important;',
            '}',
            '#input-area button.button:disabled {',
            '    opacity: 0.8;',
            '}',
            '#input-area button.button:disabled:hover {',
            '   background: #ff7b18 !important;',
            '}',
            '#input-area .button:disabled {',
            '    cursor: default !important;',
            '}',
            '.archiver-count {',
            '    width: 78px;',
            '    border: 0px !important;',
            '    box-sizing: border-box;',
            '    margin-right: 0px !important;',
            '    border-top-right-radius: 0px;',
            '    border-bottom-right-radius: 0px;',
            '}',
            '.archiver-gobtn {',
            '    margin-left: 0px !important;',
            '    border-top-left-radius: 0px;',
            '    border-bottom-left-radius: 0px;',
            '}',
            '.archiver-count,',
            '.archiver-count:hover,',
            '.archiver-count:focus {',
            '    background: #eee;',
            '    outline: none;',
            '    color: #111;',
            '}',
            '.archiver-count:hover:not(:disabled),',
            '.archiver-count:focus:not(:disabled),',
            '.archiver-indicator:not(:disabled),',
            '.archiver-indicator:hover:not(:disabled),',
            '.archiver-indicator:focus:not(:disabled) {',
            '    color: #000;',
            '    outline: none;',
            '    background: #fff;',
            '    cursor: default;',
            '}',
            '.archiver-indicator {',
            '    border: 0px;',
            '    width: 230px;',
            '}',
            '.archiver-form {',
            '    display: inline-block;',
            '}',
            '.archive-progresswrp {',
            '    margin-top: 2px;',
            '    width: 253px;',
            '    background: #eee;',
            '    height: 5px;',
            '}',
            '.archive-progress {',
            '    width: 0%;',
            '    background: #ff7b18;',
            '    height: 100%;',
            '}',
            '.SOCVR-Archiver-deleted-content {',
            '    display: none;',
            '    position: absolute;',
            '    background-color: white;',
            //'    top: 100%;', //Just below the (deleted). This does not look good with the post as the last in the transcript.
            '    top: 77%;', //With meta-menu just obscuring the border.
            /*//Vertically centered: Ends up obscured by the meta-menu.
            '    top: 50%;',
            '    transform: translateY(-50%);',
            '    -webkit-transform: translateY(-50%);',
            '    -ms-transform: translateY(-50%);',
            //*/
            '    border: 2px solid;',
            '    box-shadow: 0px 0px 20px;',
            '    z-index: 2;',
            '}',
            //While it's a nice idea to have the reply parent and/or child displayed, it can get confusing as messages can
            //  display on top of each other. This can result in being unable to read a deleted post.
            //'.message.reply-parent .SOCVR-Archiver-deleted-content,',
            //'.message.reply-child .SOCVR-Archiver-deleted-content,',
            //'.message.reply-parent .content .deleted ~ .SOCVR-Archiver-deleted-content,',
            //'.message.reply-child .content .deleted ~ .SOCVR-Archiver-deleted-content,',
            '.message:hover .SOCVR-Archiver-deleted-content,',
            '.content .deleted:hover ~ .SOCVR-Archiver-deleted-content,',
            '.content .deleted ~ .SOCVR-Archiver-deleted-content:hover {',
            '    display: block;',
            '}',
            'div.message .meta {',
            //A clearer indicator of separation between controls and message text.
            '    border-left: 1px solid;',
            '}',
            '.SOCVR-Archiver-hide-message-meta-menu div.message:hover .meta {',
            '    display: none !important;',
            '}',
            '.SOCVR-Archiver-in-message-move-button:first-of-type {',
            '    margin-left: 5px;',
            '}',
            '.SOCVR-Archiver-in-message-move-button {',
            '    cursor: pointer;',
            '    font-size: 11px;',
            '    margin-right: 5px;',
            '}',
            //Should adjust this based on the colors used (in case the user has a theme applied).
            '.SOCVR-Archiver-in-message-move-button:hover {',
            '    color: white;',
            '    background-color: black;',
            '}',
            '.message.reply-child.SOCVR-Archiver-multiMove-selected,',
            '.message.reply-parent.SOCVR-Archiver-multiMove-selected {',
            '    background-color: lightBlue !important;',
            '}',
            '.message.selected.SOCVR-Archiver-multiMove-selected {',
            '    background-color: #c8d8e4 !important;',
            '}',
            '.SOCVR-Archiver-multiMove-selected {',
            '    background-color: LightSkyBlue !important;',
            '}',
            '.message.SOCVR-Archiver-multiMove-selected .SOCVR-Archiver-move-to-add-to-list {',
            '    display: none;',
            '}',
            '.message:not(.SOCVR-Archiver-multiMove-selected) .SOCVR-Archiver-move-to-remove-from-list {',
            '    display: none;',
            '}',
            //A general issue with these controls is that they can obscure content. For instance: https://chat.stackoverflow.com/transcript/message/39961248#39961248
            //  has a link which is not clickable due to the controls obscuring it.
            //  Now: Press & hold Caps-Lock to not show the meta controls.
            //Show the meta options for your own posts (have to be able to move them).
            '#chat-body .monologue.mine:hover .messages .message:hover .meta {',
            '    background-color: #fbf2d9;',
            '    display: inline-block;',
            '}',
            //Page JavaScript is not functional for these
            '#chat-body .monologue.mine:hover .messages .message:hover .meta .vote-count-container {',
            '    display: none;',
            '}',
        ].join('\n');
        //Put the styles in the document (nodes.scope can be invalid).
        (document.head || document.documenetElement).appendChild(nodes.style);

        nodes.startbtn.addEventListener('click', function() {
            //Click the "archiver" button.
            nodes.startbtn.disabled = true;
            nodes.scanNkbtn.disabled = true;
            nodes.count.style.display = '';
            nodes.gobtn.style.display = '';
            nodes.cancel.style.display = '';
            nodes.scandate.style.display = '';
            nodes.count.focus();
        }, false);

        nodes.scanNkbtn.addEventListener('click', function() {
            //Click the "Scan Nk" button.
            nodes.startbtn.click();
            nodes.count.value = nKButtonEntriesToScan;
            nodes.gobtn.click();
        }, false);

        nodes.cancel.addEventListener('click', resetIfThisNotDisabled, false);

        nodes.form.addEventListener('submit', function(e) {
            //User entered a number of events to scan.
            e.preventDefault();
            nodes.cancel.disabled = true;
            const count = +nodes.count.value;
            totalEventsToFetch = count;
            nodes.count.disabled = true;
            nodes.gobtn.disabled = true;
            nodes.indicator.style.display = '';
            nodes.indicator.value = 'getting events... (0 / ' + count + ')';
            nodes.progresswrp.style.display = '';
            getEvents(count);
        }, false);

        nodes.movebtn.addEventListener('click', saveMoveInformationAndMovePosts, false);

        function resetIfThisNotDisabled() {
            /* jshint -W040 */ //This is called as a jQuery event handler, which explicitly sets `this`.
            if (this.disabled) {
                return false;
            }
            /* jshint +W040 */
            reset();
        }

        function reset() {
            totalEventsToFetch = 0;
            requests = [];
            messagesToMove = [];
            eventsByNum = {};
            events = [];
            nodes.count.style.display = 'none';
            nodes.count.value = '';
            nodes.count.disabled = false;
            nodes.gobtn.style.display = 'none';
            nodes.gobtn.disabled = false;
            nodes.scanNkbtn.disabled = false;
            nodes.cancel.style.display = 'none';
            nodes.scandate.style.display = 'none';
            nodes.scandate.textContent = '';
            nodes.indicator.style.display = 'none';
            nodes.indicator.textContent = '';
            nodes.movebtn.style.display = 'none';
            nodes.startbtn.disabled = false;
            nodes.progresswrp.style.display = 'none';
            nodes.progress.style.width = '';
            removeShownToBeMoved();
        }

        function isEventByIdValid(eventId) {
            //Check if an event in the eventsByNum is valid (i.e. that we've actually fetched the event).
            return eventsByNum[eventId] && !!eventsByNum[eventId].message_id;
        }

        function addEventsToByNumber(eventsToAdd) {
            //Add some events to eventsByNum. Track parents and children.
            //  Add entries for parents and children for which we don't already have event data.
            eventsToAdd.forEach(function(event) {
                if (event.message_id && typeof event.user_id === 'undefined') {
                    //Remember that we can't move this message. (Moving events with no user_id results in an API error.)
                    addToLSnoUserIdList(event.message_id);
                }
                var parentId = event.parent_id;
                var children;
                //If there is a parent_id, then add the current message to the list of children for the parent.
                if (parentId) {
                    if (event.show_parent) {
                        //It's an actual :##### reply
                        if (typeof eventsByNum[parentId] !== 'object') {
                            eventsByNum[parentId] = {};
                        }
                        if (!Array.isArray(eventsByNum[parentId].children)) {
                            eventsByNum[parentId].children = [];
                        }
                        eventsByNum[parentId].children.push(event.message_id);
                    } else {
                        //In this case, the system has assumed that it's a reply, because the user @username'd someone.
                        //  The user did not click on "reply".
                        //  This is not something we consider a reply.
                        //console.log('Found event with parent_id, but not show_parent: event:', event);
                        //The gap between the message IDs can be a rough guide as to how associated they are.
                        //console.log('Found event with parent_id, but not show_parent: Gap:', event.message_id - parentId);
                    }
                }
                if (typeof eventsByNum[event.message_id] === 'object') {
                    //Remember any existing children
                    children = eventsByNum[event.message_id].children;
                }
                eventsByNum[event.message_id] = event;
                if (children) {
                    //If there were existing children re-add them to the event.
                    eventsByNum[event.message_id].children = children;
                }
            });
        }

        function Request(_event, _postId, _isComment) {
            //A request class. Used to indicate that an event should be moved, or that we need data.
            this.msg = _event.message_id;
            if (_postId) {
                this.post = _postId;
            }
            if (_isComment) {
                this.isComment = _isComment;
            }
            this.time = _event.time_stamp;
            this.type = _event.type;
            this.onlyQuestions = (_event.type && _event.type.onlyQuestions) || (Array.isArray(_event.underAgeTypes) && _event.underAgeTypes.some((underAgeType) => underAgeType.onlyQuestions));
            this.onlyComments = (_event.type && _event.type.onlyComments) || (Array.isArray(_event.underAgeTypes) && _event.underAgeTypes.some((underAgeType) => underAgeType.onlyComments));
            this.event = _event;
        }

        var nextBefore;

        function getEvents(count, before, promised, needParentList) {
            //Get events from Chat. Chat returns up to 500 events per call going backward from the indicated "before" message.
            //  These are directly placed in the events Array as a 2D array.
            // @promised is the tail of a Promise which contains the processing tasks.
            // @needParentList is the events which were not completely processed due to missing parents.
            return new Promise((resolve, reject) => {
                setProgress('getting events\u2009', totalEventsToFetch - count, totalEventsToFetch);
                promised = promised ? promised : Promise.resolve();
                needParentList = Array.isArray(needParentList) ? needParentList : [];
                if (count <= 0) {
                    //Done getting all requested events.
                    // Re-type those that need to have a parent found.
                    resolve(promised.then(() => delay(0, scanStageEventChunk, needParentList, assignEventBaseTypeAndContentWithoutCode, [], 'typing-needParentList', 0, needParentList.length)).then(() => delay(0, scanEvents)));
                    return false;
                }
                var data = {
                    fkey: fkey,
                    msgCount: count > 500 ? 500 : count,
                    mode: 'Messages',
                };
                if (before) {
                    data.before = before;
                }
                const ajaxOptions = {
                    type: 'POST',
                    url: '/chats/' + room + '/events',
                    data: data,
                    success: function(response) {
                        var respEvents = response.events;
                        if (respEvents.length) {
                            respEvents.forEach(function(event) {
                                event.timeStampUTC = (new Date(event.time_stamp * 1000)).toJSON();
                            });
                        }
                        events.push(response.events);
                        //Adding 'reply-request' to this doesn't appear to help make the process significantly faster.
                        promised = promised
                            .then(() => delay(0, addEventsToByNumber, response.events, '', '', 'By Id'))
                            .then(() => delay(0, scanStageEventChunk, response.events, assignEventBaseTypeAndContentWithoutCode, needParentList, 'typing............', totalEventsToFetch - count, totalEventsToFetch));

                        if (!response.events[0]) {
                            // No more events in the transcript
                            // Re-type those that need to have a parent found.
                            resolve(promised.then(() => delay(0, scanStageEventChunk, needParentList, assignEventBaseTypeAndContentWithoutCode, [], 'typing-needParentList', 0, needParentList.length)).then(() => delay(0, scanEvents)));
                            return false;
                        }

                        nodes.scandate.textContent = new Date(1000 * response.events[0].time_stamp).toISOString();

                        nextBefore = response.events[0].message_id;
                        resolve(getEvents(count - 500, response.events[0].message_id, promised, needParentList));
                    },
                    error: function(xhr, status, error) {
                        console.error('AJAX Error getting events:',
                            '\n::  xhr:', xhr,
                            '\n::  status:', status,
                            '\n::  error:', error,
                            '\n::  ajaxOptions:', ajaxOptions,
                            '\n::  count:', count,
                            '\n::  before:', before
                        );
                        if (confirm('$.ajax encountered an error getting events. See console for data.' + (error && error.length < 100 ? ' error: ' + error : '') +
                                '\n\ncount:' + count + '::  before:' + before + '\n\nRetry fetching these?')) {
                            //Allow the user to retry.
                            resolve(getEvents(count, before, promised, needParentList));
                        } else {
                            reject(new Error('AJAX Error getting events: ' + error));
                        }
                    },
                };
                $.ajax(ajaxOptions);
            });
        }

        function delay(time, delayedFunction) {
            //Return a Promise which is resolved after the specified delay and any specified function is called.
            //  Any additional arguments are passed to the delayedFunction and the return value from that function
            //  is what this Promise resolves as. This can chain an additional Promise.
            var mainArgs = arguments; //Needed due to a bug in a browser, I don't remember which one. See the GM4 polyfill merged PRs.
            return new Promise((resolve) => {
                setTimeout(() => {
                    if (typeof delayedFunction === 'function') {
                        //Using .slice(), or other Array methods, on arguments prevents optimization.
                        var args = [];
                        for (var index = 2; index < mainArgs.length; index++) {
                            args.push(mainArgs[index]);
                        }
                        resolve(delayedFunction.apply(null, args));
                    } else {
                        resolve();
                    }
                }, (time ? time : 0));
            });
        }

        function setProgress(text, current, total) {
            //Set the progress indicator.
            nodes.indicator.value = text + '... (' + current + ' / ' + total + ')';
            nodes.progress.style.width = Math.ceil((current * 100) / total) + '%';
        }

        function scanStageEventChunk(chunk, action, needParentList, text, progress, total) {
            //Scans a chunk of events using the function (action) provided.
            setProgress(text, progress, total);
            chunk.forEach((event, eventIndex) => {
                action(event, eventIndex, chunk, needParentList);
            });
        }

        function getTotalLengthOfChunks(chunks) {
            //Count the total length of the arrays in a 2D array.
            return chunks.reduce((total, chunk) => total + chunk.length, 0);
        }

        function scanEvents() {
            //All events the user has told us to scan have been fetched.
            //  events is an array of event arrays.
            //  eventsByNum[] contains all events, with parent and children information.
            events.reverse(); //Always process events oldest to youngest.
            populateRequestAges();
            nodes.progress.style.width = '';
            //Check each event and produce an array of requests which include all messages about which we need further information, or might be archiving.
            const totalEvents = getTotalLengthOfChunks(events);
            const stages = [
                //['typing', assignEventBaseTypeAndContentWithoutCode], //This is now done in parallel with fetching data.
                ['reply-request', markReplyRequestEvent],
                ['checking', checkEvent],
            ];
            let mainPromise = Promise.resolve();
            for (const [text, action] of stages) {
                let progress = 0;
                const needParentList = [];
                for (const chunk of events) {
                    mainPromise = mainPromise.then(delay.bind(null, 0, scanStageEventChunk, chunk, action, needParentList, text, progress, totalEvents)); //Allow the tab's UI to remain active/update.
                    progress += chunk.length;
                }
                mainPromise = mainPromise.then(() => new Promise((resolve) => {
                    setProgress(text, totalEvents, totalEvents);
                    resolve();
                }));
            }
            //needParentList is just dropped. It could be used to fetch parent events from the Graveyard and/or the Sanitarium.
            //  Alternately, we could just fetch events in those two rooms back to some point prior to where the main ones ended.
            mainPromise = mainPromise.then(() => {
                //All messages have been scanned. A list of posts for which we need data from the SE API has been created.
                //  We need the data in order to determine the post's current status and see if the request is fulfilled.
                nodes.progress.style.width = '';

                if (!requests.length) {
                    //There are no events for which we need to get information from the SE API.
                    if (messagesToMove.length) {
                        //No messages were found which should be moved.
                        return checkDone();
                    }
                    //There are messages which should be moved.
                    nodes.indicator.value = 'no ' + (messagesToMove.length > 0 ? 'additional ' : '') + 'messages found';
                    nodes.progresswrp.style.display = 'none';
                    nodes.progress.style.width = '';
                    nodes.cancel.disabled = false;
                    setShowToBeMovedScanCount();
                    return false;
                }

                nodes.indicator.value = 'chunking request array...';
                requests = chunkArray(requests, 100);
                return checkRequests();
            });
            return mainPromise;
        }

        function matchesRegex(text, regexes) {
            //Does the text match one of the RegExp in the provided array of RegExp.
            for (var regExType in regexes) {
                if (regexes[regExType].test(text)) {
                    return true;
                }
            }
            return false;
        }

        function addMessagesToAlsoArchive(event, messages) {
            //Add a list of messages to the event's list of messages to also archive when the event is archived.
            messages = Array.isArray(messages) ? messages : [messages];
            if (!Array.isArray(event.alsoArchive)) {
                event.alsoArchive = [];
            }
            Array.prototype.push.apply(event.alsoArchive, messages);
        }

        function doesEventMatchType(event, type, needParentList) {
            if (type.userIdMatch && type.userIdMatch !== event.user_id) {
                return false;
            } //else
            if (type.regexes && !matchesRegex(event.contentNoCode, type.regexes)) {
                //Use the RegExp array as one indicator of the type.
                return false;
            } //else
            if (type.andRegexes && !matchesRegex(event.contentNoCode, type.andRegexes)) {
                //Another RegExp array which must match.
                return false;
            } //else
            if (type.textRegexes && !matchesRegex(event.contentNoCodeText, type.textRegexes)) {
                //Existing text regexes didn't match.
                return false;
            } //else
            if (type.noContent && event.content) {
                //No content
                return false;
            } //else
            if (type.replyToTypes) {
                if (!event.show_parent || !event.parent_id) {
                    //Not a reply
                    return false;
                } //else
                //We should be checking, and a parent exists
                if (!isEventByIdValid(event.parent_id)) {
                    if (Array.isArray(needParentList)) {
                        //Add the event to those for which we need the parent.
                        needParentList.push(event);
                    }
                    return false;
                } //else
                //We have a valid record for the parent event.
                if (!type.replyToTypes.some((replyType) => eventsByNum[event.parent_id].type === replyType)) { // eslint-disable-line no-loop-func
                    //The parent's type doesn't matches any in the list.
                    return false;
                } //else
                //Passed type.replyToTypes
            }
            //All existing tests passed.
            return true;
        }

        function assignEventBaseTypeAndContentWithoutCode(event, eventIndex, currentEvents, needParentList) {
            //First pass identifying request types. The type is added to the event Object, along with a version of the message without code
            //  in both HTML text, and just text content.
            var message = event.content;
            //Don't match things in code format, as those normally are used to explain, not as intended tags indicating a request.
            //The message content should really be converted to DOM and parsed form there.
            //Note that converting to DOM changes HTML entities into the represented characters.
            var messageAsDom = $('<div></div>').append(message);
            messageAsDom.find('code').remove();
            message = messageAsDom.html();

            //Prevent matches of meta.stackoverflow.com
            message = message.replace(/(?:meta|chat)\.stackoverflow\.com\/?\/?/, '');
            //Determine if it matches one of the RegExp.
            event.contentNoCode = message;
            event.contentNoCodeText = messageAsDom.text();
            event.type = null;

            RequestTypeKeys.some((typeKey) => {
                const type = RequestTypes[typeKey];
                if (doesEventMatchType(event, type, needParentList)) {
                    event.type = type;
                    return true;
                }
                return false;
            });
        }

        function markReplyRequestEvent(event, eventIndex, currentEvents, needParentList) {
            //Find replies which indicate the person replying is changing the parent message into a request.
            //  This is the case when the parent isn't a request of that type (or a competing request), but the
            //  combination of the non-code contents of the two messages makes for a request. For example, this
            //  could be that someone (e.g. FireAlarm) posts the URL for a question, while someone else replies to that
            //  message with a cv-pls tag. The opposite ordering (cv-pls then URL) is also possible, but the reply must have a tag in it.
            //If there is a '?' in the current event, then it's assumed to be a question, and not a reply indicating that it's a request.
            //event.show_parent indicates it's an actual reply, not just something that's been assumed to be a reply.
            if (!event.type && event.show_parent && event.contentNoCode && !/\?/.test(event.contentNoCodeText) && /"ob-post-tag"/.test(event.contentNoCode)) {
                //This event is a reply, there is non-code content which contained '"ob-post-tag"' (indicating a tag),
                //  and there's no "?" in the content (which is assumed to mean that it's a question, not an actual request.
                //  We really should be looking for actual tags, but that test should be sufficient.
                if (!isEventByIdValid(event.parent_id) || typeof eventsByNum[event.parent_id].type === 'undefined') {
                    //The parent we have isn't valid. Thus, we can't do anything about this.
                    needParentList.push(event);
                    return;
                } // else
                //We have the parent. We want to know if this message, combined with the message to which it's replying, makes a valid primary request.
                //We don't handle replies which change the direction a request is going (e.g. a reopen-pls reply to a close-pls);
                const parentEvent = eventsByNum[event.parent_id];
                if (parentEvent.type === RequestTypes.DELETE || parentEvent.type === RequestTypes.REOPEN) {
                    //The parent is already a primary request which doesn't have more stringent requirements.
                    return;
                }
                //Change the parentEvent's type, if the parent + the current match a request type, but the parent doesn't match on it's own.
                const combinedEvent = Object.assign({}, parentEvent);
                combinedEvent.content += ' ' + event.content;
                combinedEvent.contentNoCode += ' ' + event.contentNoCode;
                combinedEvent.contentNoCodeText += ' ' + event.contentNoCodeText;
                combinedEvent.type = null;
                const replyType = primaryRequestTypes.find((testType) => (doesEventMatchType(combinedEvent, testType) && !doesEventMatchType(parentEvent, testType)));
                if (replyType) {
                    if (!parentEvent.type || ((parentEvent.type !== replyType || (parentEvent.type === replyType && parentEvent.originalType !== replyType)) &&
                            (((replyType === RequestTypes.REOPEN || replyType === RequestTypes.UNDELETE) && parentEvent.type !== RequestTypes.CLOSE) ||
                                ((replyType === RequestTypes.CLOSE || replyType === RequestTypes.DELETE) && parentEvent.type !== RequestTypes.UNDELETE)))) {
                        //The reply type doesn't change the direction of an already existing type.
                        if (typeof parentEvent.originalType === 'undefined') {
                            //Save the original type, if it hasn't already been saved.
                            event.originalType = event.type;
                        }
                        parentEvent.type = replyType;
                        addMessagesToAlsoArchive(parentEvent, event.message_id);
                    }
                }
            }
        }

        function addEventToMessagesToMove(event) {
            //Directly add an event to the list of messages to move. The messagesToMove array actually contains request Objects.
            if (messagesToMove.every((moveItem) => event.message_id !== moveItem.msg)) {
                //Don't add duplicates.
                messagesToMove.push(new Request(event));
            }
        }

        function checkEvent(event, eventIndex, currentEvents, needParentList) {
            //Check an event to see if it directly qualifies to be archived, or if it needs further information about the post in order to determine it's disposition.
            var type = event.type;
            if (!type) {
                return false;
            }

            //Direct replies archived with the parent
            if (type.archiveWithParent && event.show_parent && event.parent_id) {
                if (!isEventByIdValid(event.parent_id) || typeof eventsByNum[event.parent_id].type === 'undefined') {
                    //The parent we have isn't valid. Thus, we can't do anything about this.
                    needParentList.push(event);
                    return;
                } // else
                //Direct reply
                addMessagesToAlsoArchive(eventsByNum[event.parent_id], event.message_id);
            }

            //Direct replies archive the parent with this one.
            if (type.archiveParentWithThis && event.show_parent && event.parent_id) {
                if (!isEventByIdValid(event.parent_id) || typeof eventsByNum[event.parent_id].type === 'undefined') {
                    //The parent we have isn't valid. Thus, we can't do anything about this.
                    needParentList.push(event);
                    return;
                } // else
                //Direct reply
                addMessagesToAlsoArchive(event, event.parent_id);
            }

            //Archive with previous from an ID
            if (type.archiveWithPreviousFromUserId) {
                //It's feedback like 'sd k', so search within the current batch to find the SD message to which it applies.
                //XXX This does not handle complex SD feedback (e.g. sd 2k). It just assumes the feedback applies to the first found.
                //XXX It doesn't test for SD messages which have already been moved.
                for (let feedbackToIndex = eventIndex - 1; feedbackToIndex >= 0; feedbackToIndex--) {
                    const testEvent = currentEvents[feedbackToIndex];
                    if (testEvent.user_id === type.archiveWithPreviousFromUserId) {
                        addMessagesToAlsoArchive(testEvent, event.message_id);
                        break;
                    }
                }
            }

            //Archive with next from an ID
            if (type.archiveWithNextFromUserId) {
                for (let feedbackToIndex = eventIndex + 1; feedbackToIndex < currentEvents.length; feedbackToIndex++) {
                    const testEvent = currentEvents[feedbackToIndex];
                    if (testEvent.user_id === type.archiveWithNextFromUserId) {
                        addMessagesToAlsoArchive(testEvent, event.message_id);
                        break;
                    }
                }
            }

            //Archive with children
            if (type.archiveWithChildren) {
                if (Array.isArray(event.children)) {
                    event.children.forEach((childId) => {
                        addMessagesToAlsoArchive(eventsByNum[childId], event.message_id);
                    });
                }
            }

            //Archive children with this
            if (type.archiveChildrenWithThis) {
                if (Array.isArray(event.children)) {
                    event.children.forEach((childId) => {
                        addMessagesToAlsoArchive(event, childId);
                    });
                }
            }

            //Handle expired events.
            if (type.alwaysArchiveAfterDateSeconds && event.time_stamp < type.alwaysArchiveAfterDateSeconds) {
                addEventToMessagesToMove(event);
                //Replies are already handled.
                //Don't need to do anything else with this event.
                return true;
            }

            //Additional type specific tests
            if (type.additionalRequestCompleteTests && type.additionalRequestCompleteTests.some((test) => test(event))) {
                addEventToMessagesToMove(event);
                return true;
            }

            //Handle young events which need the event type changed.
            if (type.alwaysArchiveAfterDateSeconds && event.time_stamp > type.alwaysArchiveAfterDateSeconds && type.underAgeType) {
                //Remember the prior types.
                if (!Array.isArray(event.underAgeTypes)) {
                    event.underAgeTypes = [];
                }
                event.underAgeTypes.push(type);
                type = event.type = type.underAgeType;
                //Re-check with the new type. No attempt is made to make sure that there isn't a loop.
                checkEvent(event, eventIndex, currentEvents, needParentList);
                return true;
            }

            //At this point, everything should have been reduced to a primary type or already be added directly to the move list.
            if (primaryRequestTypes.indexOf(type) === -1) {
                return false;
            }

            event.onlyQuestions = (event.type && event.type.onlyQuestions) || (Array.isArray(event.underAgeTypes) && event.underAgeTypes.some((underAgeType) => underAgeType.onlyQuestions));
            event.onlyComments = (event.type && event.type.onlyComments) || (Array.isArray(event.underAgeTypes) && event.underAgeTypes.some((underAgeType) => underAgeType.onlyComments));

            // Handle non-expired primary requests, which require getting question/answer data.
            //  We really should do a full parse of the URL, including making a choice based on request type as to considering the question, answer, or comment
            //  for longer formats.
            var matches = event.contentNoCode.match(/stackoverflow\.com\/(?:q[^\/]*|posts|a[^\/]*)\/(\d+)/g); // eslint-disable-line no-useless-escape
            //For a cv-pls we assume it's the associated question when the URL is to an answer or to a comment.
            if (!event.onlyQuestions) {
                //The above will preferentially obtain questions over some answer URL formats: e.g.
                //    https://stackoverflow.com/questions/7654321/foo-my-baz/1234567#1234567
                //  That's good for cv-pls/reopen-pls, but for other types of requests we should be considering the answer instead, if the URL is the alternate answer URL.
                const answerMatches = event.contentNoCode.match(/(?:^|[\s"'])(?:(?:https?:)?(?:(?:\/\/)?(?:www\.|\/\/)?stackoverflow\.com\/))(?:q[^\/]*|posts)[^\s#]*#(\d+)(?:$|[\s"'])/g); // eslint-disable-line no-useless-escape
                if (answerMatches) {
                    //Convert each one into a short answer URL so a single RegExp can be used below.
                    matches = answerMatches.map((match) => match.replace(/(?:^|[\s"'])(?:(?:https?:)?(?:(?:\/\/)?(?:www\.|\/\/)?stackoverflow\.com\/))(?:q[^\/]*|posts)[^\s#]*#(\d+)(?:$|[\s"'])/, 'stackoverflow.com/a/$1')); // eslint-disable-line no-useless-escape
                }
            }
            const isComment = event.onlyComments;
            if (matches !== null && isComment) {
                //There are URLs, but this type, or a type from which this was changed due to being too young is only comments
                const commentMatches = event.contentNoCode.match(/(?:^|[\s"'])(?:(?:https?:)?(?:(?:\/\/)?(?:www\.|\/\/)?stackoverflow\.com\/))(?:q[^\/]*|posts|a)[^\s#]*#comment(\d+)(?:$|[\s"'_])/g); // eslint-disable-line no-useless-escape
                if (commentMatches) {
                    //Convert each one into a short answer URL so a single RegExp can be used below.
                    matches = commentMatches.map((match) => match.replace(/(?:^|[\s"'])(?:(?:https?:)?(?:(?:\/\/)?(?:www\.|\/\/)?stackoverflow\.com\/))(?:q[^\/]*|posts|a)[^\s#]*#comment(\d+)(?:$|[\s"'_])/, 'stackoverflow.com/a/$1')); // eslint-disable-line no-useless-escape
                } else {
                    matches = null;
                }
            }
            var posts = {};
            // matches will be null if an user screws up the formatting
            if (matches !== null) {
                for (const match of matches) {
                    posts[/stackoverflow\.com\/(?:q[^\/]*|posts|a[^\/]*)\/(\d+)/.exec(match)[1]] = true; // eslint-disable-line no-useless-escape
                }
            }
            //Add one entry in the requests list per postId found above.
            Object.keys(posts).forEach((postId) => {
                requests.push(new Request(event, postId, isComment));
            });
        }

        function checkRequests(totalRequests, questionBackoff, answerBackoff, commentBackoff) {
            //Each call to this checks one block of requests. It is looped through by being called at the end of the
            //  asynchronous operations in checkRequestsOthers.
            var remaining = getTotalLengthOfChunks(requests);
            totalRequests = typeof totalRequests !== 'number' ? remaining : totalRequests;
            var currentRequests = requests.pop();
            setProgress('checking requests', remaining, totalRequests);
            //All request types have been reduced to their primary type equivalent (cv, delv, reopen, undelete).
            //  Any reply that extends when the FireAlarm/Queen is valid has already been rolled up into the event being treated as a cv-pls.
            return checkRequestsOthers(currentRequests, totalRequests, questionBackoff, answerBackoff, commentBackoff);
        }

        function checkRequestsOthers(currentRequests, totalRequests, questionBackoff, answerBackoff, commentBackoff) {
            //The SE API is queried for each identified post, first as a question, then as an answer.
            //This could be more efficient. There is no need to request answer information when the data was returned as a question.
            //Further, it would be better to request everything as an answer first. This will give question information, which could be substituted
            //  into CLOSE/REOPEN requests which are inaccurately pointing at answers.
            //XXX This assumes that there is only one post per request. If the state of any associated post is such that the request
            //      is considered complete, then the request is listed for archiving. This should be updated to account for the possibility
            //      of having multiple posts in a request (which would also require accounting for things like a cv-pls dup with the dup-target
            //      in the request). Currently that situation is handled by the dup-question being closed qualifying the question for archiving.
            questionBackoff = questionBackoff ? questionBackoff : 0;
            answerBackoff = answerBackoff ? answerBackoff : 0;
            commentBackoff = commentBackoff ? commentBackoff : 0;

            function makeSEApiUrl(requestsForUrl, type) {
                var filters = {
                    comments: '!9Z(-x)zjA',
                    answers: '!.UDo6l2k)5RjcU7O',
                    questions: '!5RCJFFV3*1idqdx)f2XdVzdib',
                };
                var filter = filters[type];
                if (typeof filter !== 'string') {
                    throw new Error('makeSEApiUrl: not a valid type:' + type);
                } //else
                return 'https://api.stackexchange.com/2.2/' + type + '/' + formatPosts(requestsForUrl) + '?' + [
                    'pagesize=100',
                    'site=stackoverflow',
                    'key=qhq7Mdy8)4lSXLCjrzQFaQ((',
                    'filter=' + filter,
                ].join('&');
            }

            function handleDeleteAndUndeleteWithValidData(items, requestsToHandle, itemIdPropKey) {
                //Look through the items received from the SE API and handle requests for DELETE and UNDELETE.
                const indexesToDelete = {};
                for (const item of items) {
                    requestsToHandle.forEach((currentRequest, requestIndex) => {
                        if (currentRequest.post == item[itemIdPropKey]) { // eslint-disable-line eqeqeq
                            if (item.locked_date) {
                                //The post is locked. We can't do anything. The request is thus "complete".
                                addEventToMessagesToMove(currentRequest.event);
                                indexesToDelete[requestIndex] = true;
                                return true;
                            } // else
                            if (currentRequest.type === RequestTypes.DELETE) {
                                //Have data, so not deleted. Remove matching del-pls, as they are not fulfilled.
                                indexesToDelete[requestIndex] = true;
                                return true;
                            } // else
                            if (currentRequest.type === RequestTypes.UNDELETE) {
                                //Add matching undel-pls to move list, as they are fulfilled.
                                addEventToMessagesToMove(currentRequest.event);
                                //No need to request the data again as an answer.
                                indexesToDelete[requestIndex] = true;
                                return true;
                            } // else
                        }
                    });
                }
                //Remove the handled requests, from the end of the array to the front (sort in reverse numerical order).
                Object.keys(indexesToDelete).sort((a, b) => b - a).forEach((index) => requestsToHandle.splice(index, 1));
            }

            function checkXhrStatus(responseData, textStatus, jqXHR) {
                return new Promise((resolve, reject) => {
                    //Reject if the status isn't 200.
                    if (jqXHR.status === 200) {
                        resolve(responseData);
                    } else {
                        reject(new Error(jqXHR));
                    }
                });
            }

            function handleQuestionResponse(responseData) {
                return new Promise((resolve) => {
                    //Deal with the SE API response for questions.
                    questionBackoff = responseData.backoff;
                    var items = responseData.items;
                    handleDeleteAndUndeleteWithValidData(items, currentRequests, 'question_id');
                    //Check for data returned for CLOSE and REOPEN
                    for (const item of items) {
                        currentRequests = currentRequests.filter((currentRequest) => {
                            if (currentRequest.post == item.question_id) { // eslint-disable-line eqeqeq
                                //Remove all matching open cv-pls, as they are not fulfilled.
                                if (item.closed_date) {
                                    //Item is closed.
                                    if (currentRequest.type === RequestTypes.CLOSE) {
                                        //CLOSE request is handled.
                                        addEventToMessagesToMove(currentRequest.event);
                                        return false;
                                    }
                                    if (currentRequest.type === RequestTypes.REOPEN) {
                                        //REOPEN request is not handled, but we no longer need to consider it.
                                        return false;
                                    }
                                } else {
                                    //Item is open.
                                    if (currentRequest.type === RequestTypes.REOPEN) {
                                        //REOPEN request is handled.
                                        addEventToMessagesToMove(currentRequest.event);
                                        return false;
                                    }
                                    if (currentRequest.type === RequestTypes.CLOSE) {
                                        //CLOSE request is not handled, but we no longer need to consider it.
                                        return false;
                                    }
                                }
                            }
                            return true;
                        });
                    }
                    resolve();
                });
            }

            function convertOnlyQuestionRequestsToQuestion(items, requestsToCheck, idProperty, questionIdProperty) {
                items.forEach((item) => {
                    requestsToCheck.forEach((request) => {
                        if (item[idProperty] == request.post && request.onlyQuestions) { // eslint-disable-line eqeqeq
                            //This is a request which is only about questions, but this post was identified as an answer.
                            //  Change the postId for the request to the question_id for this answer.
                            request.post = item[questionIdProperty];
                        }
                    });
                });
            }

            function handleAnswerResponse(responseData) {
                return new Promise((resolve) => {
                    //Deal with the SE API response for answers.
                    var answerItems = responseData.items;
                    answerBackoff = responseData.backoff;
                    handleDeleteAndUndeleteWithValidData(answerItems, currentRequests, 'answer_id');
                    //All requests which were about answers have been handled.
                    convertOnlyQuestionRequestsToQuestion(answerItems, currentRequests, 'answer_id', 'question_id');
                    resolve();
                });
            }

            function handleCommentResponse(responseData) {
                return new Promise((resolve) => {
                    var commentItems = responseData.items;
                    commentBackoff = responseData.backoff;
                    handleDeleteAndUndeleteWithValidData(commentItems, currentRequests, 'comment_id');
                    convertOnlyQuestionRequestsToQuestion(commentItems, currentRequests, 'comment_id', 'post_id');
                    resolve();
                });
            }

            function sendAjaxIfRequests(requestsToSend, endpoint) {
                //If there are requests, then send the $.ajax. If there aren't, then send an empty items.
                if (Array.isArray(requestsToSend) && requestsToSend.length) {
                    return $.ajax(makeSEApiUrl(requestsToSend, endpoint)).then(checkXhrStatus);
                } // else
                return Promise.resolve({items: []});
            }

            function getOnlyCommentRequests(requestsToFilter) {
                return requestsToFilter.filter((request) => request.isComment);
            }

            function getNonCommentRequests(requestsToFilter) {
                return requestsToFilter.filter((request) => !request.isComment);
            }

            //There should be a limit set here on the number which can be requested at a time. The SE API
            //  will consider 30 requests/s/IP "very abusive". However, it should take significantly longer
            //  for the round trip than the average 67ms which would be needed to launch 30 requests in 1s.
            //Send the request for comments, then answers, then questions (converting to questions at each earlier stage, when needed).
            return delay(commentBackoff * 1000)
                .then(() => sendAjaxIfRequests(getOnlyCommentRequests(currentRequests), 'comments'))
                .then(handleCommentResponse)
                //Send the request for answers
                .then(() => delay(answerBackoff * 1000))
                .then(() => sendAjaxIfRequests(getNonCommentRequests(currentRequests), 'answers'))
                .then(handleAnswerResponse)
                //Send the request for questions
                .then(() => delay(questionBackoff * 1000))
                .then(() => sendAjaxIfRequests(getNonCommentRequests(currentRequests), 'questions'))
                .then(handleQuestionResponse)
                .then(() => {
                    for (const request of currentRequests) {
                        if (request.type !== RequestTypes.UNDELETE) {
                            addEventToMessagesToMove(request.event);
                        }
                    }
                    if (!requests.length) {
                        return checkDone();
                        //return false;
                    }
                    return checkRequests(totalRequests, questionBackoff, answerBackoff, commentBackoff);
                }).catch((error) => {
                    console.error(error);
                    checkDone();
                });
        }

        function checkDone() {
            //Add any messages associated (i.e. that should be archived at the same time) with those to be archived.
            //  Non-duplicate messages are pushed onto the end of the array, and we process them. This results in
            //  recursively adding any associated with any new additions.
            return new Promise((resolve) => {
                for (let moveIndex = 0; moveIndex < messagesToMove.length; moveIndex++) {
                    const moveRequest = messagesToMove[moveIndex];
                    if (moveRequest.event.alsoArchive) {
                        moveRequest.event.alsoArchive.forEach((messageId) => { // eslint-disable-line no-loop-func
                            if (isEventByIdValid(messageId)) {
                                addEventToMessagesToMove(eventsByNum[messageId]);
                            }
                        });
                    }
                }

                if (!messagesToMove.length) {
                    nodes.indicator.value = 'no ' + (messagesToMove.length > 0 ? 'additional ' : '') + 'messages found';
                    nodes.progresswrp.style.display = 'none';
                    nodes.progress.style.width = '';
                    nodes.cancel.disabled = false;
                    setShowToBeMovedScanCount();
                    resolve();
                    return false;
                } // else
                //Remove any duplicates
                //Should really look into why we're getting duplicates. It looks like it's FireAlarm messages.
                var dupCheck = {};
                messagesToMove = messagesToMove.filter(function(message) {
                    if (dupCheck[message.msg]) {
                        return false;
                    } //else
                    dupCheck[message.msg] = true;
                    return true;
                }).sort((a, b) => a.event.message_id - b.event.message_id);
                setMessagesFound();
                nodes.movebtn.style.display = '';
                nodes.cancel.disabled = false;
                nodes.progresswrp.style.display = 'none';
                nodes.progress.style.width = '';
                showToBeMoved();
                resolve();
            });
        }

        function setMessagesFound() {
            //Set the indicator to the number of messages which were found.
            nodes.indicator.value = messagesToMove.length + ' request' + ['', 's'][+(messagesToMove.length > 1)] + ' found';
        }

        function saveMoveInformationAndMovePosts() {
            //Prior to moving posts, save the list of posts so we can undo a move by assigning those messages to the manual move list, if the user clicks 'U'.
            var ids = convertRequestsListToMessageIds(messagesToMove);
            setStorageJSON('previousMoveTo', {
                posts: ids,
                targetRoomId: defaultTargetRoom,
                //It would need to be tested to see if you really can only move from a single room, or if you can move from multiple rooms at a time.
                sourceRoomId: room,
            });
            //Use the global variables to call moveSomePosts();
            moveSomePosts(ids, defaultTargetRoom, () => {
                //All done
                nodes.progresswrp.style.display = 'none';
                nodes.progress.style.width = '';
                nodes.indicator.value = 'done';
                nodes.movebtn.style.display = 'none';
                removeShownToBeMoved();
                //Clear kept data
                reset();
            });
        }

        function formatPosts(postList) {
            //Format posts in a list of requests so they can be passed to the SE API.
            return postList.map((request) => request.post).join(';');
        }

        function convertRequestsListToMessageIds(messageList) {
            //Change the list of requests to just message Ids.
            return messageList.map((message) => message.msg);
        }

        function chunkArray(array, chunkSize) {
            //Chop a single array into an array of arrays. Each new array contains chunkSize number of
            //  elements, except the last one.
            var chunkedArray = [];
            var startIndex = 0;
            while (array.length > startIndex) {
                chunkedArray.push(array.slice(startIndex, startIndex + chunkSize));
                startIndex += chunkSize;
            }
            return chunkedArray;
        }

        var shownToBeMoved;
        var priorMessagesShown = [];
        var manualMoveList = getLSManualMoveList();
        var noUserIdList = getLSnoUserIdList();
        var scanCountSpan;

        function fillMoveListFromPopupTo100(priorManualMoveListLength) {
            if (manualMoveList.length < 100) {
                if(shownToBeMoved) {
                    addToLSManualMoveList($('.message:not(.SOCVR-Archiver-multiMove-selected)', shownToBeMoved).slice(manualMoveList.length - 100).map(function() {
                        return getMessageIdFromMessage(this);
                    }).get());
                }
            }
            const manualMoveListLengthPriorToGetMore = manualMoveList.length;
            if (priorManualMoveListLength === manualMoveListLengthPriorToGetMore) {
                //We've fetched more events, but found no new events to archive.
                setStorage('fillFromMessage-tentative', nextBefore);
                setStorage('fillFromMessage-tentative-check', Math.min.apply(null, manualMoveList));
            } else {
                if (!priorManualMoveListLength) {
                    setStorage('fillFromMessage-tentative', +getStorage('fillFromMessage'));
                }
                //Remember the youngest.
                setStorage('fillFromMessage-tentative-check', Math.min.apply(null, manualMoveList));
            }
            if (manualMoveListLengthPriorToGetMore < 100) {
                //XXX Need to handle getting to the end of the total events.
                //XXX Should track the last event added, so we can come back to it to short-circuit any large amount of scanning. However, this then means
                //      we need some way to clear that record when things break.
                var maxNextBefore = +getStorage('fillFromMessage');
                maxNextBefore = maxNextBefore > 0 ? maxNextBefore + 500 : 0;
                return getMoreEvents(5000, Math.min(nextBefore, maxNextBefore) || nextBefore).then(() => fillMoveListFromPopupTo100(priorManualMoveListLength ? priorManualMoveListLength : manualMoveListLengthPriorToGetMore));
            }
            return Promise.resolve();
        }

        function getMoreEvents(moreCount, newNextBefore) {
            //Clear the requests and events, as there's no need to re-process what we've already done.
            requests = [];
            const originalEvents = events;
            events = [];
            var currentCount = +nodes.count.value;
            totalEventsToFetch = currentCount + moreCount;
            nodes.count.value = totalEventsToFetch;
            return getEvents(moreCount, typeof newNextBefore === 'number' ? newNextBefore : nextBefore).then((result) => {
                //Add the events we just fetched to the overall list
                events = originalEvents.concat(events);
                return result;
            });
        }

        function setShowToBeMovedScanCount() {
            if (scanCountSpan && scanCountSpan.length) {
                scanCountSpan.text(nodes.count.value);
            }
        }

        function showToBeMoved() {
            //Create and show the archive preview.
            function moveMoveListAndResetOnSuccess(roomTarget, event) {
                moveMoveList(roomTarget, function(success) {
                    if (success) {
                        reset();
                    } else {
                        //XXX Should notify user of failure in some way.
                    }
                    event.target.blur();
                });
            }
            //The structure/CSS of this needs some more work.
            removeShownToBeMoved();
            shownToBeMoved = document.createElement('div');
            var inputHeight = $('#input-area').css('height');
            var mainHeight = /px$/.test(inputHeight) ? +inputHeight.replace(/px$/, '') + 75 : 150;
            $(shownToBeMoved).append([
                /* eslint-disable indent */
                '<div id="SOCVR-archiver-messagesToMove-container">',
                '    <style>',
                '        #SOCVR-archiver-messagesToMove-container {',
                '            display: block;',
                '            position: fixed;',
                '            top: 25px;',
                '            left: 50px;',
                '            background-color: #fff;',
                '            width: calc(100% - 100px);',
                '            height: calc(100% - ' + mainHeight + 'px);',
                '            z-index: 10000;',
                '            border: 2px solid;',
                '            box-shadow: 0px 0px 20px;',
                '            resize: both;',
                '            padding: 5px;',
                '        }',
                '        .SOCVR-Archiver-moveCount-container > span {',
                '            margin: 15px;',
                '        }',
                '        .SOCVR-Archiver-button-container {',
                '            text-align: center;',
                '        }',
                '        #SOCVR-archiver-messagesToMove-container .SOCVR-Archiver-button-scanMore-container button,',
                '        #SOCVR-archiver-messagesToMove-container .SOCVR-Archiver-button-moveList-container button {',
                '            margin: 0px;',
                '        }',
                '        #SOCVR-archiver-messagesToMove-container .SOCVR-Archiver-button-scanMore-container,',
                '        #SOCVR-archiver-messagesToMove-container .SOCVR-Archiver-button-moveList-container {',
                '            margin-right: 10px;',
                '        }',
                '        #SOCVR-archiver-messagesToMove-container .SOCVR-Archiver-button-scanMore-container,',
                '        #SOCVR-archiver-messagesToMove-container .SOCVR-Archiver-button-moveList-container {',
                '            margin-left: 20px;',
                '        }',
                '        #SOCVR-archiver-messagesToMove-container .SOCVR-Archiver-button-cancel {',
                '            margin-left: 40px;',
                '        }',
                '        #SOCVR-archiver-messagesToMove-container button {',
                '            margin: 10px;',
                '        }',
                '        #SOCVR-archiver-messagesToMove-container .monologue {',
                '            position: relative;',
                '        }',
                '        #SOCVR-archiver-messagesToMove-container h1 {',
                '            text-align: center;',
                '        }',
                '        .SOCVR-Archiver-moveCount-container {',
                '            text-align: center;',
                '        }',
                '        .SOCVR-Archiver-moveCount {',
                '            font-weight: bold;',
                '            font-size: 120%;',
                '        }',
                '        .SOCVR-Archiver-latestDate {',
                '            font-size: 120%;',
                '        }',
                '        .SOCVR-Archiver-moveMessages-container {',
                '            height: calc(100% - 65px);',
                '            width: 100%;',
                '        }',
                '        .SOCVR-Archiver-moveMessages-inner {',
                '            height: 100%;',
                '        }',
                '        .SOCVR-Archiver-moveMessages {',
                '            margin: 0 auto;',
                '            display: block;',
                '            overflow-y: auto;',
                '            padding: 5px 60px 0px 0px;',
                '            height: 90%;',
                '        }',
                // Close icon CSS is from the answer to "Pure css close button - Stack Overflow"
                // at https://stackoverflow.com/a/20139794, copyright 2013 by Craig Wayne,
                // licensed under CC BY-SA 3.0 (https://creativecommons.org/licenses/by-sa/3.0/).
                // Some modifications have been made.
                '        .SOCVR-Archiver-close-icon {',
                '            display:block;',
                '            box-sizing:border-box;',
                '            width:20px;',
                '            height:20px;',
                '            border-width:3px;',
                '            border-style: solid;',
                '            border-color:#dd0000;',
                '            border-radius:100%;',
                '            background: -webkit-linear-gradient(-45deg, transparent 0%, transparent 46%, white 46%,  white 56%,transparent 56%, transparent 100%), -webkit-linear-gradient(45deg, transparent 0%, transparent 46%, white 46%,  white 56%,transparent 56%, transparent 100%);',
                '            background-color:#dd0000;',
                '            box-shadow:0px 0px 1px 1px rgba(0,0,0,0.5);',
                '            cursor: pointer;',
                '            position: absolute;',
                '            top: 0px;',
                '            right: 6px;',
                '            z-index: 1000;',
                '        }',
                '        .SOCVR-Archiver-close-icon:hover {',
                '            border-color: #ff0000;',
                '            background-color: #ff0000;',
                '        }',
                '        #SOCVR-archiver-messagesToMove-container > .SOCVR-Archiver-close-icon {',
                '            top: -10px;',
                '            right: -10px;',
                '        }',
                '    </style>',
                '    <div class="SOCVR-Archiver-close-icon" title="Cancel"></div>',
                '    <div class="SOCVR-Archiver-moveMessages-inner">',
                '        <div>',
                '            <h1>Move messages to SOCVR Request Graveyard</h1>',
                '        </div>',
                '        <div class="SOCVR-Archiver-moveCount-container">',
                '            <span class="SOCVR-Archiver-moveCount"></span>',
                '            <span class="SOCVR-Archiver-latestDate">',
                '                Going back to: ' + nodes.scandate.textContent,
                '            </span>',
                '            <span class="SOCVR-Archiver-scan-count-container">Scanned: ',
                '                <span class="SOCVR-Archiver-scan-count">' + nodes.count.value + '</span>',
                '            </span>',
                '        </div>',
                '        <div class="SOCVR-Archiver-button-container">',
                '            <button class="SOCVR-Archiver-button-move" title="Move all of the messages listed in this popup to the Graveyard">Move these to the Graveyard</button>',
                '            <span class="SOCVR-Archiver-button-scanMore-container">',
                '                <span>Scan more:</span>',
                '                <button class="SOCVR-Archiver-button-1kmore" title="Scan 1,000 more">1k</button>',
                '                <button class="SOCVR-Archiver-button-10kmore" title="Scan 10,000 more">10k</button>',
                '                <button class="SOCVR-Archiver-button-100kmore" title="Scan 100,000 more">100k</button>',
                '            </span>',
                '            <span class="SOCVR-Archiver-button-moveList-container">',
                '                <span>Manual Move List:</span>',
                '                <button class="SOCVR-Archiver-button-set-as-move-list" title="Set the Manual Move List to these messages.">Set</button>',
                '                <button class="SOCVR-Archiver-button-add-to-move-list" title="Add these messages to the Manual Move List.">Add</button>',
                '                <button class="SOCVR-Archiver-button-remove-from-move-list" title="Remove these messages from the Manual Move List.">Remove</button>',
                //'                <button class="SOCVR-Archiver-button-fill-move-list" title="Fill the Manual Move List to 100.">Fill</button>',
                '                <button class="SOCVR-Archiver-button-grave-move-list" title="Move all messages on the Manual Move List to the Graveyard.">Grave</button>',
                '                <button class="SOCVR-Archiver-button-san-move-list" title="Move all messages on the Manual Move List to the Sanitarium.">San</button>',
                '            </span>',
                '            <button class="SOCVR-Archiver-button-cancel">Cancel</button>',
                '        </div>',
                '        <div class="SOCVR-Archiver-moveMessages-container">',
                '            <div class="SOCVR-Archiver-moveMessages">',
                '            </div>',
                '        </div>',
                '    </div>',
                '</div>',
                /* eslint-enable indent */
            ].join('\n'));
            var moveMessagesDiv = $('.SOCVR-Archiver-moveMessages', shownToBeMoved).first();
            var moveCountDiv = $('.SOCVR-Archiver-moveCount', shownToBeMoved).first();
            scanCountSpan = $('.SOCVR-Archiver-scan-count', shownToBeMoved).first();
            //Build the HTML for all the messages and add them to the DOM.
            var messagesHtml = '';
            messagesToMove.sort((a, b) => a.event.message_id - b.event.message_id).forEach(function(message) {
                messagesHtml += makeMonologueHtml(message.event);
            });
            moveMessagesDiv[0].insertAdjacentHTML('beforeend', messagesHtml);
            //Events
            $('#SOCVR-archiver-messagesToMove-container > .SOCVR-Archiver-close-icon', shownToBeMoved).on('click', resetIfThisNotDisabled);
            $('.SOCVR-Archiver-button-cancel', shownToBeMoved).first().on('click', resetIfThisNotDisabled);
            $('.SOCVR-Archiver-button-move', shownToBeMoved).first().on('click', saveMoveInformationAndMovePosts);
            $('.SOCVR-Archiver-button-1kmore', shownToBeMoved).first().on('click', getMoreEvents.bind(null, 1000));
            $('.SOCVR-Archiver-button-10kmore', shownToBeMoved).first().on('click', getMoreEvents.bind(null, 10000));
            $('.SOCVR-Archiver-button-100kmore', shownToBeMoved).first().on('click', getMoreEvents.bind(null, 100000));
            $('.SOCVR-Archiver-button-add-to-move-list', shownToBeMoved).first().on('click', function() {
                //Add those messages displayed in the popup to the manual move list.
                addToLSManualMoveList(convertRequestsListToMessageIds(messagesToMove));
                this.blur();
            });
            $('.SOCVR-Archiver-button-set-as-move-list', shownToBeMoved).first().on('click', function() {
                //Set the manual move list to those messages displayed in the popup.
                clearLSManualMoveList();
                addToLSManualMoveList(convertRequestsListToMessageIds(messagesToMove));
                this.blur();
            });
            $('.SOCVR-Archiver-button-remove-from-move-list', shownToBeMoved).first().on('click', function() {
                //Remove those messages displayed in the popup from the manual move list.
                removeFromLSManualMoveList(convertRequestsListToMessageIds(messagesToMove));
                this.blur();
            });
            $('.SOCVR-Archiver-button-fill-move-list', shownToBeMoved).first().on('click', function() {
                //Remove those messages displayed in the popup from the manual move list.
                fillMoveListFromPopupTo100();
                //If fillMoveListFromPopupTo100() doesn't complete immediately, then the popup is destroyed and recreated, which means that blurring doesn't matter.
                this.blur();
            });
            $('.SOCVR-Archiver-button-grave-move-list', shownToBeMoved).first().on('click', moveMoveListAndResetOnSuccess.bind(null, 90230)); //Graveyard
            $('.SOCVR-Archiver-button-san-move-list', shownToBeMoved).first().on('click', moveMoveListAndResetOnSuccess.bind(null, 126195)); //Sanitarium
            function updateMessagesToMove() {
                //Update the number of messages to move in the popup.
                moveCountDiv.text(messagesToMove.length + ' message' + (messagesToMove.length > 1 ? 's' : '') + ' to move');
            }
            moveMessagesDiv.on('click', function(event) {
                //A click somewhere in the messages div.
                var target = $(event.target);
                if (target.hasClass('SOCVR-Archiver-close-icon')) {
                    //Click is on a close/delete icon, so remove the message.
                    event.preventDefault();
                    event.stopPropagation();
                    const messageId = target.data('messageId');
                    messagesToMove = messagesToMove.filter(function(message) {
                        if (message.msg == messageId) { // eslint-disable-line eqeqeq
                            return false;
                        } //else
                        return true;
                    });
                    updateMessagesToMove();
                    setMessagesFound();
                    $('.SOCVR-Archiver-monologue-for-message-' + messageId, moveMessagesDiv).first().remove();
                } else if (target.hasClass('newreply')) {
                    //Let the user reply to a message displayed in the popup.
                    event.preventDefault();
                    event.stopPropagation();
                    const message = target.closest('.message');
                    const messageId = getMessageIdFromMessage(message);
                    const input = $('#input');
                    const oldInputVal = input.val();
                    if (oldInputVal) {
                        input.val(oldInputVal.replace(/^(?::\d+ ?)?/, ':' + messageId + ' '));
                    } else {
                        input.val(':' + messageId + ' ');
                    }
                }
            });
            updateMessagesToMove();
            $(document.body).prepend(shownToBeMoved);
            addMoveToInMeta();
            var replyNode = $('.monologue:not(.mine) .message .newreply').first().clone(true);
            moveMessagesDiv.find('.message .meta').filter(function() {
                return !$(this).children('.newreply').length;
            }).each(function() {
                $(this).append(replyNode.clone(false));
            });
            //Request that the unclosed request review script update request-info for the page, including the popup.
            var shownToBeMovedMessages = $(shownToBeMoved).find('.message');
            var eventToSend = (shownToBeMovedMessages.length === priorMessagesShown.length) ? 'urrs-Request-Info-update-desired' : 'urrs-Request-Info-update-immediate';
            //Send the event, but after we're done processing & the display updates.
            setTimeout(() => {
                window.dispatchEvent(new CustomEvent(eventToSend, {
                    bubbles: true,
                    cancelable: true,
                }));
            }, 0);
            priorMessagesShown = shownToBeMovedMessages;
            //Every once in a while the first .tiny-signature in the popup ends up with display:none;
            //This is a hack to try to eliminate the problem. The issue has not been reliably duplicated, so it's unclear if this will actually solve the issue.
            //It'd be better to find out what's causing the problem, but it looks like it's something in SE's code
            //  adding the style (probably a .hide() ) for some reason.
            //Temporarily do this again.  This should give enough time to notice that the problem exists and wasn't corrected by the first run one.
            //  Even with doing this at 50 and 5000, the problem still prevented the tiny-signature from showing.
            [50, 1000, 5000, 10000].forEach((time) => {
                setTimeout(() => {
                    if (moveMessagesDiv) {
                        $('.tiny-signature', moveMessagesDiv).removeAttr('style');
                    }
                }, time);
            });
        }

        function removeShownToBeMoved() {
            //Remove the to-be-archived preview
            if (shownToBeMoved) {
                shownToBeMoved.remove();
                //Remove references to the popup so it can be garbage collected.
                shownToBeMoved = null;
                scanCountSpan = null;
            }
        }

        function makeMonologueHtml(event) {
            //Create the HTML for a monologue containing a single message.
            var userId = event.user_id ? +event.user_id : '';
            var userAvatar16 = '';
            if (userId && avatarList[userId]) {
                userAvatar16 = avatarList[userId][16];
            }
            var userName = event.user_name;
            var messageId = event.message_id;
            var contentHtml = event.content ? event.content : '<span class="deleted">(removed)</span>';
            //Get a timestamp in the local time that's in the same format as .toJSON().
            var timestamp = (new Date((event.time_stamp * 1000) - timezoneOffsetMs)).toJSON().replace(/T(\d\d:\d\d):\d\d\.\d{3}Z/, ' $1');
            var html = [
                //From transcript
                /* beautify preserve:start *//* eslint-disable indent */
                '<div class="monologue user-' + userId + (userId == me ? ' mine' : '') + ' SOCVR-Archiver-monologue-for-message-' + messageId + '">', // eslint-disable-line eqeqeq
                '    <div class="SOCVR-Archiver-close-icon" data-message-id="' + messageId + '" title="Don\'t move"></div>',
                '    <div class="signature">',
                '        <div class="tiny-signature">',
                            (userAvatar16 ? '' +
                                '        <div class="avatar avatar-16">' +
                                '            <img src="' + userAvatar16 + '" alt="' + userName + '" width="16" height="16">' +
                                '        </div>' +
                                '' : ''),
                '            <div class="username"><a href="/users/' + userId + '/' + userName + '" title="' + userName + '">' + userName + '</a></div>',
                '        </div>',
                '    </div>',
                '    <div class="messages">',
                '        <div class="message" id="SOCVR-Archiver-message-' + messageId + '">',
                '            <div class="timestamp">' + timestamp + '</div>',
                '            <a name="' + messageId + '" href="/transcript/' + room + '?m=' + messageId + '#' + messageId + '"><span style="display:inline-block;" class="action-link"><span class="img"> </span></span></a>',
                             (event.show_parent ? '<a class="reply-info" title="This is a reply to an earlier message" href="/transcript/message/' + event.parent_id + '#' + event.parent_id + '"></a>' : ''),
                '            <div class="content">' + contentHtml,
                '            </div>',
                '            <span class="flash">',
                '            </span>',
                '        </div>',
                '    </div>',
                '    <div class="clear-both" style="height:0">&nbsp;</div> ',
                '</div>',
                /* eslint-enable indent *//* beautify preserve:end */
            ].join('\n');
            return html;
        }

        //CHAT listener

        var chatListenerAddMetaTimeout = 0;

        function doOncePerChatEventGroup() {
            //Things that we do to when the Chat changes to keep the page updated.
            addMoveToInMeta();
            recordOldestMessageInChat();
        }

        function listenToChat(chatInfo) {
            //Called when an event happens in chat. For add/delete this is called prior to the message being added or deleted.
            //Delay until after the content has been added. Only 0ms is required.
            clearTimeout(chatListenerAddMetaTimeout);
            chatListenerAddMetaTimeout = setTimeout(doOncePerChatEventGroup, 50);
            if (chatInfo.event_type === 19) {
                //A message was moved out. We want to remove it from the moveList.
                //This tracks messages which other people move. The user's own moves should be handled elsewhere.
                //  This depends on having a tab open to chat.
                var movedMessageId = chatInfo.message_id;
                removeFromLSManualMoveList(movedMessageId);
            }
        }
        if (!isTranscript && !isSearch) {
            CHAT.addEventHandlerHook(listenToChat);
        }

        //Add deleted content to be shown on hover.
        var deletedMessagesWithoutDeletedContent;
        var delayBetweenGettingDeletedContent = 500;
        var gettingDeletedContent = 0;

        function addAllDeletedContent() {
            //Go through the DOM and add the content back in for all deleted messages which don't already have it added back in.
            if (!gettingDeletedContent && (!deletedMessagesWithoutDeletedContent || !deletedMessagesWithoutDeletedContent.length)) {
                deletedMessagesWithoutDeletedContent = $('.content .deleted').parent().filter(function() {
                    return !$(this).children('.SOCVR-Archiver-deleted-content').length;
                }).closest('.message');
                if (deletedMessagesWithoutDeletedContent.length) {
                    addNextDeletedContent();
                }
            }
        }

        function addNextDeletedContent() {
            //Get the content for the next deleted message and insert it into the DOM.
            gettingDeletedContent = 1;
            if (deletedMessagesWithoutDeletedContent.length) {
                var message = deletedMessagesWithoutDeletedContent.last();
                //Remove the message we're working on.
                deletedMessagesWithoutDeletedContent.splice(deletedMessagesWithoutDeletedContent.length - 1, 1);
                var messageId = getMessageIdFromMessage(message);
                getMessageMostRecentVersionFromHistory(messageId, function(deletedContent) {
                    if (deletedContent) {
                        addDeletedContentToMessageId(message, deletedContent);
                    }
                    if (deletedMessagesWithoutDeletedContent.length) {
                        gettingDeletedContent = setTimeout(addNextDeletedContent, delayBetweenGettingDeletedContent);
                    } else {
                        gettingDeletedContent = 0;
                        setTimeout(addAllDeletedContent, delayBetweenGettingDeletedContent);
                    }
                });
            } else {
                gettingDeletedContent = 0;
                setTimeout(addAllDeletedContent, delayBetweenGettingDeletedContent);
            }
        }

        function addDeletedContentToMessageId(message, deletedContent) {
            //Actually add the deleted content to the message
            const newContent = $('.content', message);
            if(!newContent.find('SOCVR-Archiver-deleted-content').length) {
                //Be sure to not double-add, as this can be called asynchronously after the prior check for the existence of the deleted content.
                deletedContent.removeClass('content').addClass('SOCVR-Archiver-deleted-content');
                newContent.append(deletedContent);
                //Indicate to the user that the content is available.
                newContent.find('.deleted').append('<span> &#128065;</span>');
            }
        }

        function fechHistoryForMessage(messageId, callback) {
            //Get the history page for a message.
            $.ajax({
                type: 'GET',
                url: 'https://' + window.location.hostname + '/messages/' + messageId + '/history',
                success: callback,
                error: function(xhr, status, error) {
                    console.error('AJAX Error Getting history', '\n::  xhr:', xhr, '\n::  status:', status, '\n::  error:', error, '\n::  room:', room, '\n::  fkey,:', fkey, '\n::  messageId:', messageId);
                },
            });
        }

        function getMessageMostRecentVersionFromHistory(messageId, callback) {
            //Get the last version of a message prior to it being deleted.
            fechHistoryForMessage(messageId, function(data) {
                var newDoc = jQuery.parseHTML(data);
                callback($('.message .content', newDoc).first());
            });
        }

        //Manual message MoveTo

        var priorSelectionMessageIds = [];

        function TargetRoom(_roomNumber, _fullName, _shortName, _displayed) {
            //A class for target rooms.
            this.roomNumber = _roomNumber;
            this.fullName = _fullName;
            this.shortName = _shortName;
            this.displayed = _displayed;
        }

        function moveSomePostsWithConfirm(posts, targetRoomId, callback) {
            //Confirm that the user wants to move the files.
            var countPosts = 0;
            if (!Array.isArray(posts)) {
                countPosts = 1;
            } else {
                if (Array.isArray(posts[0])) {
                    //Already chunked
                    posts.forEach(function(chunk) {
                        countPosts += chunk.length;
                    });
                } else {
                    countPosts = posts.length;
                }
            }
            if (countPosts && window.confirm('Move ' + countPosts + ' message' + (countPosts === 1 ? '' : 's') + ' to ' + targetRoomsByRoomNumber[targetRoomId].fullName + '?')) {
                //Save a copy of the last information.
                setStorageJSON('previousMoveTo', {
                    posts: posts,
                    targetRoomId: targetRoomId,
                    //It would need to be tested to see if you really can only move from a single room, or if you can move from multiple rooms at a time.
                    sourceRoomId: room,
                });
                //Move the posts
                moveSomePosts(posts, targetRoomId, callback);
            } else {
                if (typeof callback === 'function') {
                    callback(false);
                }
            }
        }

        var moveSomePostsTotal = 0;

        function moveSomePosts(posts, targetRoomId, callback, postsWithoutUserId) {
            //Actually move some posts by sending a POST to the chat API.
            //posts can be an String/Number of postId, Array of posts, or already chunked Array of post Arrays.

            function doneMovingMessages() {
                //Tasks after the messages have been moved.
                setProgress('moving messages', moveSomePostsTotal, moveSomePostsTotal);
                moveSomePostsTotal = 0;
                //Done with messages. Normal completion.
                if (Array.isArray(postsWithoutUserId) && postsWithoutUserId.length) {
                    alert('The following messages don\'t have an identified "user_id". Trying to move them will result in an API error. Any other messages which were to be moved were moved. See the console for additional information.\n\n' + postsWithoutUserId.join(', '));
                }
                if (typeof callback === 'function') {
                    callback(true);
                }
            }
            if (!targetRoomId || +targetRoomId < 1 || !posts || (Array.isArray(posts) && posts.length === 0)) {
                //Something is wrong with the arguments.
                if (typeof callback === 'function') {
                    callback(false);
                }
                return false;
            }
            posts = Array.isArray(posts) ? posts : [posts];
            if (!Array.isArray(posts[0])) {
                //Chunk the array, if it's not already chunked
                //This works around a bug in Chat which causes user's chat room displays not to update if the move is larger than 100 messages and includes
                //  messages which are displayed in chat (i.e. that aren't old).
                recordOldestMessageInChat(); //If we're on a chat page, make sure we have the oldest.
                const oldestChatMessageId = getStorage('oldestChatMessageId-' + room);
                const postsNotInChat = [];
                postsWithoutUserId = [];
                //Separate out those displayed in chat and those not & those without a user_id, which cause errors when we try to move them.
                const postsInChat = posts.filter((post) => {
                    //Message ID's are in numeric order. If we find one that's > then the ID of the oldest on the
                    //  chat for the room, then it's visible.
                    if ((isEventByIdValid(post) && !eventsByNum[post].user_id) || noUserIdList.indexOf(post) > -1) {
                        postsWithoutUserId.push(post);
                        return false;
                    }
                    if (+post > +oldestChatMessageId) {
                        return true;
                    }
                    postsNotInChat.push(post);
                    return false;
                });
                if (postsWithoutUserId.length) {
                    console.log('The following messages do not have an identified "user_id". Trying to move them would result in an API error. postsWithoutUserId:', postsWithoutUserId);
                }
                const inChatChunked = chunkArray(postsInChat, smallChunkSize);
                const lastInChatChunked = inChatChunked[inChatChunked.length - 1]; //This will be undefined if there were no messages in postsInChat;
                const lastInChatChunkedLength = lastInChatChunked ? inChatChunked[inChatChunked.length - 1].length : 0;
                if (lastInChatChunked && ((lastInChatChunkedLength + postsNotInChat.length) <= smallChunkSize)) {
                    //The messages not displayed in chat will fit in the last request for displayed. Thus, there's no need for a separate chunk.
                    inChatChunked[inChatChunked.length - 1] = lastInChatChunked.concat(postsNotInChat);
                    posts = inChatChunked.concat(chunkArray(postsWithoutUserId, bigChunkSize));
                } else {
                    posts = inChatChunked.concat(chunkArray(postsNotInChat, bigChunkSize));
                }
            }
            var remaining = getTotalLengthOfChunks(posts);
            moveSomePostsTotal = Math.max(moveSomePostsTotal, remaining);

            var messagesBeingMoved = posts.shift();
            if (!messagesBeingMoved) {
                //If every message that's supposed to be moved is a no-userId messages, then messagesBeingMoved may be invalid.
                doneMovingMessages();
                return;
            } //else
            setProgress('moving messages', messagesBeingMoved.length + moveSomePostsTotal - remaining, moveSomePostsTotal);

            var ajaxInfo = {
                type: 'POST',
                data: {
                    ids: messagesBeingMoved.join(','),
                    to: targetRoomId + '',
                    fkey: fkey,
                },
                url: '/admin/movePosts/' + room,
                success: function() {
                    if (!posts.length) {
                        doneMovingMessages();
                        return false;
                    } //else
                    //More messages to move. Only issue one move every 5s.
                    setTimeout(moveSomePosts, 5000, posts, targetRoomId, callback, postsWithoutUserId);
                },
                error: function(xhr, status, error) {
                    console.error(
                        'AJAX Error moving some posts',
                        '\n::  xhr:', xhr,
                        '\n::  status:', status,
                        '\n::  error:', error,
                        '\n::  targetRoomId:', targetRoomId,
                        '\n::  fkey,:', fkey,
                        '\n::  messagesBeingMoved.length:', messagesBeingMoved.length,
                        '\n::  messagesBeingMoved:', messagesBeingMoved,
                        '\n::  formatted messagesBeingMoved:', messagesBeingMoved.join(','),
                        '\n::  posts:', posts,
                        '\n::  callback:', callback,
                        '\n::  ajaxInfo:', ajaxInfo
                    );
                    alert('$.ajax encountered an error moving some posts. See console for details.' + (error && error.length < 100 ? ' error: ' + error : ''));
                },
            };
            $.ajax(ajaxInfo);
        }

        function makeMetaRoomTargetsHtml() {
            //Create the HTML for the in-question moveTo controls
            var html = '';
            Object.keys(targetRoomsByRoomNumber).forEach(function(key) {
                var targetRoom = targetRoomsByRoomNumber[key];
                html += '<span class="SOCVR-Archiver-in-message-move-button SOCVR-Archiver-move-to-' +
                    targetRoom.shortName + '" title="Move this/selected message(s) (and any already in the list) to ' +
                    targetRoom.fullName + '." data-room-id="' +
                    targetRoom.roomNumber + '">' +
                    targetRoom.displayed + '</span>';
            });
            return html;
        }

        var addedMetaHtml = [
            makeMetaRoomTargetsHtml(),
            //Add message
            '<span class="SOCVR-Archiver-in-message-move-button SOCVR-Archiver-move-to-add-to-list" title="Add this/selected message(s) to the list." data-room-id="add">+</span>',
            //remove message
            '<span class="SOCVR-Archiver-in-message-move-button SOCVR-Archiver-move-to-remove-from-list" title="Remove this/selected message(s) from the list." data-room-id="remove">-</span>',
            //clear list
            '<span class="SOCVR-Archiver-in-message-move-button SOCVR-Archiver-move-to-clear-list" title="Clear the list." data-room-id="clear">*</span>',
            //Undo/re-select the last moved list
            '<span class="SOCVR-Archiver-in-message-move-button SOCVR-Archiver-move-to-reselect" title="Re-select the messages which were last moved. This can be used to undo the last move by reselecting them (this control); going to the room they have been moved to; find one that\'s selected; then, manually moving them back by clicking on the control you want them moved to." data-room-id="reselect">U</span>',
        ].join('');

        function addMoveToInMeta() {
            //Brute force add movement to all messages meta
            var messages = $('.monologue .message');
            var messagesWithoutMeta = messages.filter(function() {
                return !$(this).children('.meta').length;
            });
            //Add meta to any messages which don't have it.
            messagesWithoutMeta.children('.request-info,.flash:not(.request-info ~ .flash)').before('<span class="meta"></span>');
            var messagesWithoutAddedMeta = messages.find('.meta').filter(function() {
                return !$(this).children('.SOCVR-Archiver-in-message-move-button').length;
            });
            messagesWithoutAddedMeta.each(function() {
                //Put the moveTo controls to the left of the normal controls. This leaves the normal controls where they usually are
                //  and places the reply-to control far away from lesser used controls.
                $(this).prepend(addedMetaHtml);
                //Add the moveList length to this message.
                addManualMoveListLength(null, this);
            });
            showAllManualMoveMessages(true);
            addAllDeletedContent();
            getAvatars();
        }

        function getMessageIdFromMessage(message) {
            //Get the message ID from a message element or the first element in a jQuery Object.
            var el = (message instanceof jQuery) ? message[0] : message;
            if (message instanceof jQuery) {
                if (message.length) {
                    message = message[0];
                } else {
                    return '';
                }
            }
            if (message) {
                return el.id.replace(/(?:SOCVR-Archiver-)?message-/, '');
            } //else
            return '';
        }

        function moveMoveList(roomId, callback) {
            //Set things up and actually move the messages on the manual move list.
            moveSomePostsWithConfirm(manualMoveList, roomId, function(moved) {
                // Should consider here if we really want to clear the list.
                // Not clearing it gives the user the opportunity to reverse the
                // move by going to the other room, where the messages will
                // already be selected.  Clearing it feels more like what people
                // would expect.
                if (moved) {
                    //The move was successful
                    const tentative = +getStorage('fillFromMessage-tentative');
                    const tentativeCheck = +getStorage('fillFromMessage-tentative-check');
                    if (manualMoveList.indexOf(tentativeCheck) !== -1) {
                        //This will be imperfect, but it should cover the case where the user hasn't adjusted which message is the the youngest
                        //  contained in the manual move list. Should really check the entirety of the list instead of just the youngest.
                        //XXX Given that this is imperfect, there needs to be some way to reset the number.
                        setStorage('fillFromMessage', tentative);
                    }
                    //Only get one chance to set fillFromMessage
                    setStorage('fillFromMessage-tentative', -1);
                    //Clear the list. Keep the list if it wasn't.
                    clearLSManualMoveList();
                    //Clear the list again, in case there's delays between tabs.
                    setTimeout(clearLSManualMoveList, 2000);
                }
                if (typeof callback === 'function') {
                    callback(moved);
                }
            });
        }

        function moveToInMetaHandler() {
            //Handle a click on the moveTo controls
            /* jshint -W040 */ //This is called as a jQuery event handler, which explicitly sets `this`.
            var $this = $(this);
            var roomId = this.dataset.roomId;
            /* jshint +W040 */
            var message = $this.closest('.message');
            if (message.length) {
                var messageId = getMessageIdFromMessage(message);
                if (messageId) {
                    if (roomId === 'add') {
                        addToLSManualMoveList(messageId);
                        addMessageToNoUserListIfMonologueIsNoUser(message);
                        addToLSManualMoveList(priorSelectionMessageIds);
                    } else if (roomId === 'remove') {
                        removeFromLSManualMoveList(messageId);
                        addMessageToNoUserListIfMonologueIsNoUser(message);
                        removeFromLSManualMoveList(priorSelectionMessageIds);
                    } else if (roomId === 'clear') {
                        clearLSManualMoveList();
                    } else if (roomId === 'reselect') {
                        reselectLastLSMoveList();
                    } else if (+roomId) {
                        addToLSManualMoveList(messageId);
                        addMessageToNoUserListIfMonologueIsNoUser(message);
                        addToLSManualMoveList(priorSelectionMessageIds);
                        moveMoveList(roomId);
                    }
                }
            }
            //Clear the selection
            priorSelectionMessageIds = [];
            window.getSelection().removeAllRanges();
        }

        /* Unused
        function addMessageIdToNoUserListIfMonologueIsNoUser(messageId) {
            var message = $('#message-' + messageId);
            if (message.length) {
                addMessageToNoUserListIfMonologueIsNoUser(message);
            }
        }
        */

        function addMessageToNoUserListIfMonologueIsNoUser(message) {
            //This would be better if we generated a list of messages to add all at once, but it should be very rare. Thus, one at a time shouldn't have much impact.
            if (message.first().closest('.monologue').hasClass('user-')) {
                var messageId = getMessageIdFromMessage(message);
                if (messageId) {
                    addToLSnoUserIdList(messageId);
                }
            }
        }

        function getMessagesInSelection() {
            //Convert the selection to a list of messageIds
            var messageIdsObject = {};

            function addMessageIdToSetAndCheckForNoUserId(message) {
                var messageId = getMessageIdFromMessage(message);
                if (messageId) {
                    messageIdsObject[messageId] = true;
                }
            }
            var selection = window.getSelection();
            var selectionText = selection.toString();
            if (typeof selectionText === 'string' && selectionText.length) {
                //We don't want to use a selection the user can't see.
                //If we did, there are cases where the anchorNode and focusNode can be set from prior clicks.
                addMessageIdToSetAndCheckForNoUserId($(selection.anchorNode).closest('.message'));
                addMessageIdToSetAndCheckForNoUserId($(selection.focusNode).closest('.message'));
                //AIM (Charcoal HQ script) messes up just testing for the .message being part of the selection.
                //  With AIM running we need to check more than just the .message, which is several times as many elements to check.
                $('.message,.message *').each(function() {
                    if (selection.containsNode(this, false)) {
                        addMessageIdToSetAndCheckForNoUserId($(this).closest('.message'));
                    }
                });
            }
            return Object.keys(messageIdsObject);
        }

        $(document).on('mousedown', '.SOCVR-Archiver-in-message-move-button', function() {
            //Clicking on the control sets the selection to the current control. Thus, we need
            //  to get the selection on mousedown and save it. We have to convert to messageIds here
            //  because just saving the selection Object doesn't work (at least on FF56).
            priorSelectionMessageIds = getMessagesInSelection();
        });

        //Add to meta when the page announces it's ready. (This is supposed to work, but doesn't actually help).
        window.addEventListener('message', addMoveToInMeta, true);
        //Accept notifications specific to this script that the page has changed.
        window.addEventListener('SOCVR-Archiver-Messages-Changed', addMoveToInMeta, true);
        var ajaxCompleteTimer;
        //Global jQuery AJAX listener: Catches user requesting older chat messages
        $(document).ajaxComplete(function(event, jqXHR, ajaxSettings) {
            if (!/(?:messages\/\d+\/history)/i.test(ajaxSettings.url)) {
                clearTimeout(ajaxCompleteTimer);
                ajaxCompleteTimer = setTimeout(addMoveToInMeta, 500);
            }
        });
        //Lazy way of adding moveInMeta after messages load
        $(document).on('click', '.SOCVR-Archiver-in-message-move-button', moveToInMetaHandler);
        //Add meta when room is ready
        if (!isSearch) {
            CHAT.Hub.roomReady.add(function() {
                addMoveToInMeta();
                addAllDeletedContent();
            });
        }
        addMoveToInMeta();

        //Keep various values stored in localStorage consistent with what's stored there.
        window.addEventListener('storage', function(event) {
            if (event.key.indexOf(lsPrefix) === 0) {
                if (event.key.indexOf('manualMoveList') > -1) {
                    getLSManualMoveList();
                    showAllManualMoveMessages();
                } else if (event.key.indexOf('noUserIdList') > -1) {
                    getLSnoUserIdList();
                }
            }
        });

        function recordOldestMessageInChat() {
            //Keep track of the oldest message displayed in chat.
            if (isChat) {
                //This is a chat page. We want to know if any manual move messages are visible in the chat.
                var firstChatMessage = document.querySelector('#chat .message');
                if (firstChatMessage) {
                    const firstId = getMessageIdFromMessage(firstChatMessage);
                    if (firstId) {
                        setStorage('oldestChatMessageId-' + room, firstId);
                    }
                }
            }
        }

        function getLSManualMoveList() {
            //Get the manual move list from localStorage.
            var list = getStorageJSON('manualMoveList');
            manualMoveList = list ? list : [];
            //Make sure the list is always numbers, not strings.
            manualMoveList = manualMoveList.map(function(value) {
                return +value;
            });
            return manualMoveList;
        }

        function setLSManualMoveList() {
            //Set the manual move list from localStorage.
            setStorageJSON('manualMoveList', manualMoveList);
        }

        function addToLSManualMoveList(values) {
            //Add a message number to the manual move list, making sure it doesn't duplicate any already existing in the list.
            //This assumes the list stored in memory is primary. i.e. a change that's occurred in localStorage, but which has not been
            //  read in yet will be overwritten.
            if (addNonDuplicateValuesToList(manualMoveList, values)) {
                setLSManualMoveList(manualMoveList);
                showAllManualMoveMessages();
            }
        }

        function removeFromLSManualMoveList(values) {
            //Remove all copies of a message number from the manual move list.
            //This assumes the list stored in memory is primary. i.e. a change that's occurred in localStorage, but which has not been
            //  read in yet will be overwritten.
            if (filterValuesFromList(manualMoveList, values)) {
                setLSManualMoveList(manualMoveList);
                showAllManualMoveMessages();
            }
        }

        function clearLSManualMoveList() {
            //Clear the manual move list
            manualMoveList = [];
            setLSManualMoveList(manualMoveList);
            //Clear the no-user list, as we only need to remember the ones which are also on the manualMoveList.
            //  This prevents it from growing without bound and any error which results in the list containing
            //  messages inaccurately to be cleared with clearing the manualMoveList.
            clearLSnoUserIdList();
            showAllManualMoveMessages();
        }

        function reselectLastLSMoveList() {
            //Restore the manual move list from the previous move. Used to implement "undo".
            var priorMove = getStorageJSON('previousMoveTo');
            manualMoveList = priorMove ? priorMove.posts : [];
            manualMoveList = priorMove.posts;
            setLSManualMoveList(manualMoveList);
            showAllManualMoveMessages();
        }

        var mostRecentMessageListCount;
        var messageListCountAddedFirstTime = false;

        function addManualMoveListLength(selector, element) {
            //Add/change all the tooltips showing the manual move list length.
            selector = selector ? selector : '.SOCVR-Archiver-in-message-move-button, .SOCVR-Archiver-button-moveList-container button';
            element = element ? element : document;
            var length = manualMoveList.length;
            var newText = '[List has ' + length + ' message' + (length === 1 ? '' : 's') + '.]';
            $(selector, element).each(function() {
                this.title = this.title.replace(/^((?:.(?!\[))+)(?:\s*\[.*)?$/, '$1 ' + newText);
            });
        }

        function showAllManualMoveMessages(forceLengthUpdate) {
            //Make sure any visible messages have, or don't have, the class indicating they are on the manual move list.
            $('.message').each(function() {
                var messageId = getMessageIdFromMessage(this);
                if (manualMoveList.indexOf(+messageId) > -1) {
                    $(this).addClass('SOCVR-Archiver-multiMove-selected');
                } else {
                    $(this).removeClass('SOCVR-Archiver-multiMove-selected');
                }
            });
            //No need to change these, if the value didn't change.
            var length = manualMoveList.length;
            if (forceLengthUpdate || mostRecentMessageListCount !== length || !messageListCountAddedFirstTime) {
                messageListCountAddedFirstTime = true;
                addManualMoveListLength();
                mostRecentMessageListCount = length;
            }
            recordOldestMessageInChat();
        }

        function addNonDuplicateValuesToList(list, values) {
            //Generic add non-duplicates to an Array..
            const type = typeof values;
            const isArray = Array.isArray(values);
            if (type !== 'string' && type !== 'number' && !isArray) {
                return;
            }
            values = isArray ? values : [values];
            let didChange = false;
            values.forEach(function(value) {
                value = +value;
                if (list.indexOf(value) === -1) {
                    //Not a duplicate
                    list.push(value);
                    didChange = true;
                }
            });
            return didChange;
        }

        function filterValuesFromList(list, values) {
            //Removes, in-place, a list of values from an Array.
            const type = typeof values;
            const isArray = Array.isArray(values);
            if (type !== 'string' && type !== 'number' && !isArray) {
                return;
            }
            values = isArray ? values : [values];
            let didChange = false;
            //Modify list in-place & remove all duplicates.
            values.forEach(function(value) {
                //Convert value to number.
                value = +value;
                for (let index = list.length - 1; index >= 0; index--) {
                    if (value === +list[index]) {
                        list.splice(index, 1);
                        didChange = true;
                    }
                }
            });
            return didChange;
        }

        //noUserIdList: Stores a list of messages which are known to not have a user_id, and thus can't be moved w/o causing an error.
        function getLSnoUserIdList() {
            //Get the noUserIDList from localStorage.
            var list = getStorageJSON('noUserIdList');
            noUserIdList = list ? list : [];
            //Make sure the list is always numbers, not strings.
            noUserIdList = noUserIdList.map(function(value) {
                return +value;
            });
            return noUserIdList;
        }

        function setLSnoUserIdList() {
            //Store the noUserIDList in localStorage.
            setStorageJSON('noUserIdList', noUserIdList);
        }

        function addToLSnoUserIdList(values) {
            //Add a message to the noUserIDList, without adding duplicates.
            //This assumes the list stored in memory is primary. i.e. a change that's occurred in localStorage, but which has not been
            //  read in yet will be overwritten.
            if (addNonDuplicateValuesToList(noUserIdList, values)) {
                setLSnoUserIdList(noUserIdList);
            }
        }

        /* Unused
        function removeFromLSnoUserIdList(values) {
            //This assumes the list stored in memory is primary. i.e. a change that's occurred in localStorage, but which has not been
            //  read in yet will be overwritten.
            if (filterValuesFromList(noUserIdList, values)) {
                setLSnoUserIdList(noUserIdList);
            }
        }
        */

        function clearLSnoUserIdList() {
            //Clear the noUserIDList.
            noUserIdList = [];
            setLSnoUserIdList(noUserIdList);
        }

        function getAvatars() {
            //Collect the existing avatar information from localStorage and in the page.
            var listChanged = false;
            avatarList = getStorageJSON('avatarList') || {};
            $('.signature').each(function() {
                var $this = $(this);
                var userId = +$this.closest('.monologue')[0].className.replace(/.*\buser-(\d+)\b.*/, '$1');
                if (userId) {
                    if (!avatarList[userId]) {
                        avatarList[userId] = {};
                        listChanged = true;
                    }
                    var avatar16 = $this.find('.avatar-16 img').first();
                    if (avatar16.length) {
                        var avatar16src = avatar16[0].src;
                        if (avatar16src && avatarList[userId][16] !== avatar16src) {
                            avatarList[userId][16] = avatar16src;
                            listChanged = true;
                        }
                    }
                    var avatar32 = $this.find('.avatar-32 img').first();
                    if (avatar32.length) {
                        var avatar32src = avatar32[0].src;
                        if (avatar32src && avatarList[userId][32] !== avatar32src) {
                            avatarList[userId][32] = avatar32src;
                            listChanged = true;
                        }
                    }
                }
            });
            if (listChanged) {
                setStorageJSON('avatarList', avatarList);
            }
        }

        $(window).on('keydown', function(event) {
            //Don't show the meta-move UI when the Caps-Lock key is pressed.
            if (event.key === 'CapsLock') {
                $body.addClass('SOCVR-Archiver-hide-message-meta-menu');
            }
        });

        $(window).on('keyup', function(event) {
            //The Caps-Lock key is released, let the meta-move UI show.
            if (event.key === 'CapsLock') {
                $body.removeClass('SOCVR-Archiver-hide-message-meta-menu');
            }
        });
    }
})();
