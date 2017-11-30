// ==UserScript==
// @name         CV Request Archiver
// @namespace    https://github.com/SO-Close-Vote-Reviewers/
// @version      2.0.1.11.1
// @description  (ALPHA) Scans the chat transcript and checks all cv+delete+undelete+reopen+dupe requests for status, then moves the closed/deleted/undeleted/reopened ones. Possible dupe requests (and their replies) are moved after 30 minutes.
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
/* globals CHAT */
'use strict';

(function() {
    var lsPrefix = 'SOCVR-Archiver-'; //prefix to avoid clashes in localStorage
    function getStorage(key) { return localStorage[lsPrefix + key]; }
    function setStorage(key, val) { return (localStorage[lsPrefix + key] = val); }
    function setStorageJSON(key, val) { return (localStorage[lsPrefix + key] = JSON.stringify(val)); }
    function getStorageJSON(key) {
        var storageValue = getStorage(key);
        try {
            return JSON.parse(storageValue);
        } catch (e) {
            //Storage is not valid JSON
            return null;
        }
    }
    //Don't run in iframes
    if(window !== window.top) return false;
    var room = (/chat.stackoverflow.com.rooms.(\d+)/.exec(window.location.href)||[false,false])[1];
    var isSearch = false;
    if(/^\/search/.test(window.location.pathname)) {
        isSearch = true;
        room = (/^.*\broom=(\d+)\b.*$/i.exec(window.location.search)||[false,false])[1];
    }
    var isTranscript = false;
    if(/\/transcript\//.test(window.location.pathname)) {
        isTranscript = true;
        var roomNameLink = $('.room-mini .room-name a');
        if(roomNameLink.length) {
            room = (/chat.stackoverflow.com.rooms.(\d+)/.exec(roomNameLink[0].href)||[false,false])[1];
        }
    }
    if(!room) return false;

    var fkey = $('#fkey');
    //fkey is not available in search
    if(isSearch) {
        fkey = isSearch ? getStorage('fkey') : fkey;
    } else {
        if(!fkey.length) return false;
        fkey = fkey.val();
    }
    if(!fkey) return false;
    setStorage('fkey', fkey);

    var me = (/\d+/.exec($('#active-user').attr('class'))||[false])[0];
    //Get me from localStorage. (transcript doesn't contain who you are).
    me = me ? me : getStorage('me');
    if(!me) return false;
    //Save me in localStorage.
    setStorage('me', me);

    $.ajax({
        type: 'POST',
        url: '/user/info?ids=' + me + '&roomId=' + room,
        success: CVRequestArchiver
    });

    function CVRequestArchiver(info){
        if(!info.users[0].is_owner && !info.users[0].is_moderator) {
            return false;
        }

        var count = 0, total = 0, num = 0, rnum = 0, rlen = 0;
        var requests = [];
        var messagesToMove = [];
        var events = [];
        var ids = [];

        var target = 90230;
        var nodes = {};
        var avatarList = getStorageJSON('avatarList') || {};

        nodes.scope = document.querySelector('#chat-buttons');
        if(isTranscript || isSearch || !nodes.scope) {
            //Create a dummy element
            nodes.scope = document.createElement('div');
        }

        nodes.startbtn = document.createElement('button');
        nodes.startbtn.className = 'button archiver-startbtn';
        nodes.startbtn.textContent = 'archiver';
        nodes.startbtn.title = 'Open the controls for the request archiver.';
        nodes.scope.appendChild(nodes.startbtn);

        var nKButtonEntriesToScan = 2000;
        nodes.scanNkbtn = document.createElement('button');
        nodes.scanNkbtn.className = 'button archiver-scan1k';
        nodes.scanNkbtn.textContent = 'scan 2k';
        nodes.scanNkbtn.title = 'Open the controls for the request archiver and scan ' + (nKButtonEntriesToScan/1000) + 'k events.';
        nodes.scope.appendChild(nodes.scanNkbtn);

        nodes.scope.appendChild(document.createElement('br'));

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
        //Ideally the colors used for the MoveTo control hover would be adjustd in case the user has a non-stock theme installed.
        //  But, we can't get colors here because the messages may not exist in the page yet.
        nodes.style.textContent = [
            '#chat-buttons {',
            '    cursor: default;',
            '}',
            '.button {',
            '    margin: 1px !important;',
            '}',
            'button.button:disabled {',
            '    opacity: 0.8;',
            '}',
            'button.button:disabled:hover {',
            '   background: #ff7b18 !important;',
            '}',
            '.button:disabled {',
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
            '    width: 162px;',
            '}',
            '.archiver-form {',
            '    display: inline-block;',
            '}',
            '.archive-progresswrp {',
            '    margin-top: 2px;',
            '    width: 185px;',
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
            '}',
            //While it's a nice idea to have the reply parent and/or child displayed, it causes the display to jump around too much.
            //  This results in the user being unable to keep the mouse on the message of interest.
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
            '.SOCVR-Archiver-multiMove-selected {',
            '    background-color: LightSkyBlue !important;',
            '}',
            '.message.SOCVR-Archiver-multiMove-selected .SOCVR-Archiver-move-to-add-to-list {',
            '    display: none;',
            '}',
            '.message:not(.SOCVR-Archiver-multiMove-selected) .SOCVR-Archiver-move-to-remove-from-list {',
            '    display: none;',
            '}',
            //A general issue with these controlls is that they can obscure content. For instance: https://chat.stackoverflow.com/transcript/message/39961248#39961248
            //  has a link which is not clickable due to the controls obscuring it.
            //Show the meta options for your own posts (have to be able to move them).
            '#chat-body .monologue.mine:hover .messages .message:hover .meta {',
            '    background-color: #fbf2d9;',
            '    display: inline-block;',
            '}',
            //Page JS is not functional for these
            '#chat-body .monologue.mine:hover .messages .message:hover .meta .vote-count-container {',
            '    display: none;',
            '}',
        ].join('\n');
        //Put the styles in the document (nodes.scope can be invalid).
        (document.head || document.documenetElement).appendChild(nodes.style);

        nodes.startbtn.addEventListener('click', function(){
            nodes.startbtn.disabled = true;
            nodes.scanNkbtn.disabled = true;
            nodes.count.style.display = '';
            nodes.gobtn.style.display = '';
            nodes.cancel.style.display = '';
            nodes.scandate.style.display = '';
            nodes.count.focus();
        }, false);

        nodes.scanNkbtn.addEventListener('click', function(){
            nodes.startbtn.click();
            nodes.count.value = nKButtonEntriesToScan;
            nodes.gobtn.click();
        }, false);

        nodes.cancel.addEventListener('click', reset, false);

        nodes.form.addEventListener('submit', function(e){
            e.preventDefault();
            nodes.cancel.disabled = true;
            total = count = +nodes.count.value;
            nodes.count.disabled = true;
            nodes.gobtn.disabled = true;
            nodes.indicator.style.display = '';
            nodes.indicator.value = 'getting events... (0 / ' + count + ')';
            nodes.progresswrp.style.display = '';
            getEvents(count);
        }, false);

        nodes.movebtn.addEventListener('click', saveMoveInformationAndMovePosts, false);

        function reset() {
            /* jshint -W040 */ //This is called as a jQuery event handler, which explicitly sets `this`.
            if(this.disabled) return false;
            /* jshint +W040 */
            rlen = 0;
            rnum = 0;
            total = 0;
            count = 0;
            num = 0;
            requests = [];
            messagesToMove = [];
            events = [];
            ids = [];
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

        var nextBefore;

        function getEvents(count, before) {
            //Get events from Chat. Chat returns up to 500 events per call from the indicated message.
            //  These are placed in the events Array as a 2D array.
            nodes.indicator.value = 'getting events... (' + (total - count) + ' / ' + total + ')';
            nodes.progress.style.width = Math.ceil(((total - count) * 100) / total) + '%';
            if (count <= 0) {
                scanEvents(events);
                return false;
            }
            var data = {
                fkey: fkey,
                msgCount: count > 500 ? 500 : count,
                mode: 'Messages',
            };
            if (before) data.before = before;
            $.ajax({
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

                    // no more events in the transcript
                    if(!response.events[0]) {
                        scanEvents();
                        return false;
                    }

                    nodes.scandate.textContent = new Date(1000 * response.events[0].time_stamp).toISOString();

                    nextBefore = response.events[0].message_id;
                    getEvents(count - 500, response.events[0].message_id);
                },
                error: function(xhr, status, error) {
                    console.log('AJAX Error getting events', '::  xhr:', xhr, '::  status:', status, '::  error:', error);
                    console.log('target:', target, '::  fkey,:', fkey, '::  ids:', ids);
                    alert('$.ajax encountered an error getting events. See console for data.');
                },
            });
        }

        function scanEvents(){
            nodes.progress.style.width = '';
            for(var i in events) {
                for(var j in events[i]) {
                    checkEvent(events[i][j], i, events.length);
                }
            }
            nodes.progress.style.width = '';

            if(!requests.length) {
                nodes.indicator.value = 'no requests found';
                nodes.progresswrp.style.display = 'none';
                nodes.progress.style.width = '';
                nodes.cancel.disabled = false;
                return false;
            }

            nodes.indicator.value = 'chunking request array...';

            rlen = requests.length;
            requests = chunkArray(requests, 100);

            checkRequests();
        }
        /* Example request text:
            <a href="//stackoverflow.com/questions/tagged/cv-pvs"><span class="ob-post-tag" style="background-color: #E0EAF1; color: #3E6D8E; border-color: #3E6D8E; border-style: solid;">cv-pvs</span></a> <a href="//stackoverflow.com/questions/tagged/entity-framework"><span class="ob-post-tag" style="background-color: #E0EAF1; color: #3E6D8E; border-color: #3E6D8E; border-style: solid;">entity-framework</span></a> Unclear (&quot;I get error&quot;-type of question) https://stackoverflow.com/q/46022628/861716
         */
        //People can really mangle the -pls portion of the request. The RegExp has a known terminating character for the tag:
        // " for matching the href URL and ] for plain text.
        //Match if they get at least 2 characters of pls, just pl, or 1 extra character
        var please = '(?:pl(?:ease|s|z)|p.?[sz]|.l[sz]|pl.?|.pl[sz]|p.l[sz]|pl.[sz]|pl[sz].)';
        var hrefUrlTag = '(?:tagged\\/';
        var endHrefToPlainText = '"|\\[';
        var endPlainTextToEndWithQuestion = '\\]).*stackoverflow.com\\/(?:[qa][^\\/]*|posts)\\/(\\d+)';
        var questionUrlToHrefTag = 'stackoverflow.com\\/(?:[qa][^\\/]*|posts)\\/(\\d+).*(?:tagged\\/';
        var endPlainTextToEnd = '\\])';
        var endHrefPrefixToSpanText = '[^>]*><span[^>]*>';
        var endSpanTextToPlainText = '<\\/span>|\\[';

        function makeTagRegExArray(prefix, additional) {
            prefix = typeof prefix === 'string' ? prefix : '';
            additional = typeof additional === 'string' ? additional : '';
            return [
                //Tag before question
                new RegExp(hrefUrlTag + prefix + additional + endHrefToPlainText + prefix + additional + endPlainTextToEndWithQuestion, ''),
                //Tag after question
                new RegExp(questionUrlToHrefTag + prefix + additional + endHrefToPlainText + prefix + additional + endPlainTextToEnd, ''),
                //Tag before question: match tag in the <span>, not in the href (which could be encoded)
                new RegExp(hrefUrlTag + prefix + endHrefPrefixToSpanText + prefix + additional + endSpanTextToPlainText + prefix + additional + endPlainTextToEndWithQuestion, ''),
                //Tag after uestion: match tag in the <span>, not in the href (which could be encoded)
                new RegExp(questionUrlToHrefTag + prefix + endHrefPrefixToSpanText + prefix + additional + endSpanTextToPlainText + prefix + additional + endPlainTextToEnd, ''),
            ];
        }

        var cvRegexes = makeTagRegExArray('cv-', please);
        var deleteRegexes = makeTagRegExArray('del(?:ete)?(?:v)?-?(?:vote)?-', please);
        var undeleteRegexes = makeTagRegExArray('un-?del(?:ete)?(?:v)?-?(?:vote)?-', please);
        var reopenRegexes = makeTagRegExArray('re-?open-', please);
        var duplicateRegexes = makeTagRegExArray('pos?sib(?:le|el)-dup(?:e|licate)?');
        var queenRepliesRegexes = [
            /@queen (?:f|k)/
        ];
        // FireAlarm reports
        var faRegexes = [
            /(?:\/\/stackapps.com\/q\/7183">FireAlarm-Swift)/,
            /(?:\[ <a href="\/\/github.com\/SOBotics\/FireAlarm\/tree\/swift" rel="nofollow noopener noreferrer">FireAlarm-Swift<\/a> \])/
        ];
        // matches replies to FireAlarm
        var faRepliesRegexes = [
            /^@FireAlarm(?:.*)(?:.*\/tagged\/cv-pls)|(?:cv-pls)/
        ];

        var RequestType = {
            CLOSE: { regexes: cvRegexes },
            DELETE: { regexes: deleteRegexes },
            UNDELETE: { regexes: undeleteRegexes },
            REOPEN: { regexes: reopenRegexes },
            DUPLICATE: { regexes: duplicateRegexes },
            QUEEN_REPLY: { regexes: queenRepliesRegexes },
            FIREALARM: { regexes: faRegexes },
            FIREALARM_REPLY: { regexes: faRepliesRegexes },
        };

        function matchesRegex(message, regexes) {
            //Does the message match one of the RegExes in the array?
            for(var regExType in regexes) {
                if(regexes[regExType].test(message)) {
                    return true;
                }
            }
            return false;
        }

        function checkEvent(event, current, total) {
            nodes.indicator.value = 'checking events... (' + current + ' / ' + total + ')';
            nodes.progress.style.width = Math.ceil((current * 100) / total) + '%';
            var message = event.content;
            var type;
            //Don't match things in code format, as those normally are used to explain, not as intended tags indicating a request.
            //The message content should really be converted to DOM and parsed form there.
            //Note that converting to DOM changes HTML entities into the represented characters.
            var messageAsDom = $('<div></div>').append(message);
            messageAsDom.find('code').remove();
            message = messageAsDom.html();

            //Determine if it matches one of the RegExp.
            for (var i in RequestType) {
                if (matchesRegex(message, RequestType[i].regexes)) {
                    //Use the RegExp array as the indicator of the type.
                    type = RequestType[i];
                    break;
                }
            }

            if (!type) return false;

            // Handle everything except FireAlarm and Queen replies
            if ((type != RequestType.QUEEN_REPLY) && (type != RequestType.FIREALARM_REPLY)) {
                var matches = message.match(/stackoverflow.com\/(?:q[^\/]*|posts|a[^\/]*)\/(\d+)/g);
                var posts = [];
                // matches will be null if an user screws up the formatting
                if (matches !== null) {
                    for(var k in Object.keys(matches)) {
                        //This gets questions and answers in "basic" format. For answers (e.g. del-pls), we would need to also detect the other answer URL formats.
                        //  We really should do a full parse of the URL, including making a choice based on request type as to considering the question, answer, or comment
                        //  for longer formats. E.g. for a cv-pls do we assume it's the associated question when the URL is to an answer? to a comment on an answer?
                        posts.push(/stackoverflow.com\/(?:q[^\/]*|posts|a[^\/]*)\/(\d+)/.exec(matches[k])[1]);
                    }
                }
                //Add one entry in the requests list per postId found above.
                for(var l in posts) {
                    requests.push({
                        msg: event.message_id,
                        post: posts[l],
                        time: event.time_stamp,
                        type: type,
                        event: event,
                    });
                }
            } else {
                // if this is a cv-pls reply for firealarm
                if (type == RequestType.FIREALARM_REPLY ) {
                    // find its parent, aka the message it replies to
                    if (event.parent_id) {
                        for(var r=0; r < requests.length; r++) {
                            if (requests[r].msg === event.parent_id ) {
                                // and make sure both parent and this reply are the same so the check for if the post is closed will work
                                // store parent as well, we need it later
                                requests.push({ msg: event.message_id, parent:event.parent_id, post: requests[r].post, time: event.time_stamp, type: type, event: event });
                            }
                        }
                    } else {
                        // do nothing for non-sense replies to FireAlarm
                    }
                } else {
                    requests.push({ msg: event.message_id, post: -1, time: event.time_stamp, type: type, event: event });
                }
            }
        }

        function checkRequests() {
            var currentreq = requests.pop();

            var left = [rlen,rlen - (requests.length * 100)][+(rlen > 100)];

            nodes.indicator.value = 'checking requests... (' + left + ' / ' + rlen + ')';
            nodes.progress.style.width = Math.ceil((left * 100) / rlen) + '%';

            checkRequestsQueen(currentreq);
            checkRequestsFireAlarm(currentreq);
            checkRequestsOthers(currentreq);
        }

        // FireAlarm handling (those are complex message-reply patterns)
        function checkRequestsFireAlarm(currentreq) {
            for(var j in currentreq) {
                // handle FireAlarm
                if(currentreq[j].type == RequestType.FIREALARM) {
                    // we want to keep requests that have a cv-pls reply
                    var keep = false;
                    // loop over all requests again
                    for(var fa in currentreq) {
                        // if we have a reply
                        if (currentreq[fa].parent && currentreq[fa].parent === currentreq[j].msg) {
                            // keep it
                            keep = true;
                            break;
                        }
                    }
                    // if we can loose it ...
                    if (!keep) {
                        // do so if the timelimit has exceeded
                        if ((Date.now() - (currentreq[j].time * 1000)) > (1000 * 60 * 30)) {
                            messagesToMove.push(currentreq[j]);
                        } else {
                            // maybe next time
                            delete currentreq[j];
                        }
                    }
                }
            }
        }

        function checkRequestsQueen(currentreq) {
            // just move all possible-dupe and replies posted more than 30 minutes ago
            for(var j in currentreq) {
                if((currentreq[j].type == RequestType.DUPLICATE || currentreq[j].type == RequestType.QUEEN_REPLY)) {
                    if ((Date.now() - (currentreq[j].time * 1000)) > (1000 * 60 * 30)) {
                        messagesToMove.push(currentreq[j]);
                    } else {
                        delete currentreq[j];
                        // if we have deleted it
                        // we better move on
                        continue;
                    }
                }
                // handle FireAlarm
                if(currentreq[j].type == RequestType.FIREALARM) {
                    // we want to keep requests that have a cv-pls reply
                    var keep = false;
                    // loop over all requests again
                    for(var fa in currentreq) {
                        // if we have a reply
                        if (currentreq[fa].parent && currentreq[fa].parent === currentreq[j].msg) {
                            // keep it
                            keep = true;
                            break;
                        }
                    }
                    // if we can loose it ...
                    if (!keep) {
                        // do so if the timelimit has exceeded
                        if ((Date.now() - (currentreq[j].time * 1000)) > (1000 * 60 * 30)) {
                            messagesToMove.push(currentreq[j]);
                        } else {
                            // maybe next time
                            delete currentreq[j];
                        }
                    }
                }
            }
        }

        function checkRequestsOthers(currentreq) {
            var xhr = new XMLHttpRequest();

            xhr.addEventListener("load", function(){
                if(this.status !== 200) {
                    checkDone();
                    return false;
                }

                var response = JSON.parse(this.response);
                var items = response.items;

                var i, j;
                for(i in items) {
                    for(j in currentreq) {
                        if(currentreq[j].post == items[i].question_id && currentreq[j].type == RequestType.DELETE) delete currentreq[j];
                    }
                    if(!items[i].closed_date) {
                        for(j in currentreq) {
                            if(currentreq[j].type == RequestType.CLOSE && ((Date.now() - (currentreq[j].time * 1000)) > (1000 * 60 * 60 * 24 * 3))) continue;
                            if(currentreq[j].post == items[i].question_id && currentreq[j].type == RequestType.CLOSE) delete currentreq[j];
                        }
                    }
                    if(items[i].closed_date) {
                        for(j in currentreq) {
                            if(currentreq[j].type == RequestType.REOPEN && ((Date.now() - (currentreq[j].time * 1000)) > (1000 * 60 * 60 * 24 * 3))) continue;
                            if(currentreq[j].post == items[i].question_id && currentreq[j].type == RequestType.REOPEN) delete currentreq[j];
                        }
                    }
                }

                for(j in currentreq) {
                    var didApiReturnPost = false;
                    for(i in items) {
                        if(currentreq[j].post == items[i].question_id) { didApiReturnPost = true; break; }
                    }
                    currentreq[j].undeleteAndNotReturnedAsQuestion = !didApiReturnPost && currentreq[j].type == RequestType.UNDELETE;
                }

                var xhr2 = new XMLHttpRequest();
                xhr2.addEventListener("load", function(){
                    if(this.status !== 200) {
                        checkDone();
                        return false;
                    }

                    var response = JSON.parse(this.response);
                    var items = response.items;

                    var i, j;
                    for(i in items) {
                        for(j in currentreq) {
                            if(currentreq[j].post == items[i].answer_id && currentreq[j].type == RequestType.DELETE) delete currentreq[j];
                        }
                    }

                    for(j in currentreq) {
                        var didApiReturnPost = false;
                        for(i in items) {
                            if(currentreq[j].post == items[i].answer_id) { didApiReturnPost = true; break; }
                        }
                        if (!didApiReturnPost && currentreq[j].type == RequestType.UNDELETE && currentreq[j].undeleteAndNotReturnedAsQuestion) {
                            delete currentreq[j];
                        }
                    }

                    for(i in currentreq) {
                        if (currentreq[i].type != RequestType.DUPLICATE && currentreq[i].type != RequestType.QUEEN_REPLY) {
                            messagesToMove.push(currentreq[i]);
                        }
                    }
                    if(!requests.length) {
                        checkDone();
                        return false;
                    }
                    setTimeout(checkRequests, response.backoff * 1000);
                });

                var url = 'https://api.stackexchange.com/2.2/answers/' + formatPosts(currentreq) + '?' + [
                    'pagesize=100',
                    'site=stackoverflow',
                    'key=qhq7Mdy8)4lSXLCjrzQFaQ((',
                    'filter=!Wn5py8CX('
                ].join('&');

                xhr2.open("GET", url);
                xhr2.send();

            });

            var url = 'https://api.stackexchange.com/2.2/questions/' + formatPosts(currentreq) + '?' + [
                'pagesize=100',
                'site=stackoverflow',
                'key=qhq7Mdy8)4lSXLCjrzQFaQ((',
                'filter=!5RCJFFV3*1idqdx)f2XdVzdib'
            ].join('&');

            xhr.open("GET", url);
            xhr.send();
        }

        function checkDone() {
            rnum = messagesToMove.length;

            if(!rnum) {
                nodes.indicator.value = 'no requests found';
                nodes.progresswrp.style.display = 'none';
                nodes.progress.style.width = '';
                nodes.cancel.disabled = false;
                return false;
            }
            //Remove any duplicates
            //Should really look into why we're getting duplicates. It looks like it's FireAlarm messages.
            var dupCheck = {};
            messagesToMove = messagesToMove.filter(function(message) {
                if(dupCheck[message.msg]) {
                    return false;
                } //else
                dupCheck[message.msg] = true;
                return true;
            }).sort(function(a, b) {
                return a.event.time_stamp - b.event.time_stamp;
            });

            ids = chunkArray(formatMsgs(messagesToMove), 100);

            setMessagesFound();
            nodes.movebtn.style.display = '';
            nodes.cancel.disabled = false;
            nodes.progresswrp.style.display = 'none';
            nodes.progress.style.width = '';
            showToBeMoved();
        }

        function setMessagesFound() {
            nodes.indicator.value = messagesToMove.length + ' request' + ['','s'][+(messagesToMove.length > 1)] + ' found';
        }

        function saveMoveInformationAndMovePosts() {
            setStorageJSON('previousMoveTo', {
                posts: [].concat(...ids),
                targetRoomId: target,
                //It would need to be tested to see if you really can only move from a single room, or if you can move from multiple rooms at a time.
                sourceRoomId: room,
            });
            movePosts();
        }

        function movePosts() {
            //Actually move posts collected by the archiver search.
            var currentids = ids.pop();

            var left = [rnum,rnum - (ids.length * 100)][+(rnum > 100)];

            nodes.indicator.value = 'moving requests... (' + left + ' / ' + rnum + ')';
            nodes.progress.style.width = Math.ceil((left * 100) / rnum) + '%';

            $.ajax({
                type: 'POST',
                data: 'ids=' + currentids.join('%2C') + '&to=' + target + '&fkey=' + fkey,
                url: '/admin/movePosts/' + room,
                success: function(){
                    if(!ids.length) {
                        nodes.progresswrp.style.display = 'none';
                        nodes.progress.style.width = '';
                        nodes.indicator.value = 'done';
                        nodes.movebtn.style.display = 'none';
                        removeShownToBeMoved();
                        return false;
                    }

                    setTimeout(movePosts, 5000);
                },
                error: function(xhr, status, error) {
                    console.log('AJAX Error moving posts', '::  xhr:', xhr, '::  status:', status, '::  error:', error);
                    console.log('currentids:', currentids, '::  target:', target, '::  fkey,:', fkey, '::  ids:', ids);
                    alert('$.ajax encountered an error moving posts. See console for data.');
                },
            });
        }

        function formatPosts(arr) {
            var tmp = [];
            for(var i in arr) tmp.push(arr[i].post);
            return tmp.join(';');
        }

        function formatMsgs(arr) {
            var tmp = [];
            for(var i in arr) tmp.push(arr[i].msg);
            return tmp;
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

        function getMoreEvents(moreCount) {
            //Clear the requests and events, as there's no need to re-process what we've already done.
            requests = [];
            events = [];
            var currentCount = +nodes.count.value;
            total = currentCount + moreCount;
            nodes.count.value = total;
            getEvents(moreCount, nextBefore);
        }

        var shownToBeMoved;
        var priorMessagesShown = [];

        function showToBeMoved() {
            //Create and show the archive preview.
            //The structure/CSS of this needs some more work.
            removeShownToBeMoved();
            shownToBeMoved = document.createElement('div');
            var inputHeight = $('#input-area').css('height');
            var mainHeight = /px$/.test(inputHeight) ? +inputHeight.replace(/px$/,'') + 75 : 150;
            shownToBeMoved.insertAdjacentHTML('beforeend', [
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
                '            <span class="SOCVR-Archiver-scan-count">Scanned:' + nodes.count.value + '</span>',
                '        </div>',
                '        <div class="SOCVR-Archiver-button-container">',
                '            <button class="SOCVR-Archiver-button-move">Move these to the Graveyard</button>',
                '            <button class="SOCVR-Archiver-button-1kmore">scan 1k more</button>',
                '            <button class="SOCVR-Archiver-button-10kmore">scan 10k more</button>',
                '            <button class="SOCVR-Archiver-button-100kmore">scan 100k more</button>',
                '            <button class="SOCVR-Archiver-button-cancel">Cancel</button>',
                '        </div>',
                '        <div class="SOCVR-Archiver-moveMessages-container">',
                '            <div class="SOCVR-Archiver-moveMessages">',
                '            </div>',
                '        </div>',
                '    </div>',
                '</div>',
            ].join('\n'));
            //Most of the following should be converted to jQuery, given that it's available.
            var moveMessagesDiv = shownToBeMoved.getElementsByClassName('SOCVR-Archiver-moveMessages')[0];
            var moveCountDiv = shownToBeMoved.getElementsByClassName('SOCVR-Archiver-moveCount')[0];
            $('.SOCVR-Archiver-close-icon', shownToBeMoved).on('click', reset);
            shownToBeMoved.getElementsByClassName('SOCVR-Archiver-button-cancel')[0].addEventListener('click', reset, false);
            shownToBeMoved.getElementsByClassName('SOCVR-Archiver-button-move')[0].addEventListener('click', saveMoveInformationAndMovePosts, false);
            shownToBeMoved.getElementsByClassName('SOCVR-Archiver-button-1kmore')[0].addEventListener('click', getMoreEvents.bind(null, 1000), false);
            shownToBeMoved.getElementsByClassName('SOCVR-Archiver-button-10kmore')[0].addEventListener('click', getMoreEvents.bind(null, 10000), false);
            shownToBeMoved.getElementsByClassName('SOCVR-Archiver-button-100kmore')[0].addEventListener('click', getMoreEvents.bind(null, 100000), false);
            messagesToMove.forEach(function(message) {
                moveMessagesDiv.insertAdjacentHTML('beforeend', makeMonologueHtml(message.event));
            });
            function updateMessagesToMove() {
                moveCountDiv.textContent = messagesToMove.length + ' message' + (messagesToMove.length > 1 ? 's' : '') + ' to move';
            }
            moveMessagesDiv.addEventListener('click', function(event) {
                var target = event.target;
                if(!target.classList.contains('SOCVR-Archiver-close-icon')) {
                    return;
                } //else
                var messageId = target.dataset.messageId;
                messagesToMove = messagesToMove.filter(function(message) {
                    if(message.msg == messageId) {
                        return false;
                    } //else
                    return true;
                });
                updateMessagesToMove();
                setMessagesFound();
                moveMessagesDiv.getElementsByClassName('SOCVR-Archiver-monologue-for-message-' + messageId)[0].remove();
            });
            updateMessagesToMove();
            document.body.insertBefore(shownToBeMoved, document.body.firstChild);
            addMoveToInMeta();
            //Request that the unclosed request review script udate request-info for the page, inlcuding the popup.
            var shownToBeMovedMessages = $(shownToBeMoved).find('.message');
            if(shownToBeMovedMessages.length === priorMessagesShown.length) {
                window.dispatchEvent(new CustomEvent('urrs-Request-Info-update-desired', {
                    bubbles: true,
                    cancelable: true,
                }));
            } else {
                window.dispatchEvent(new CustomEvent('urrs-Request-Info-update-immediate', {
                    bubbles: true,
                    cancelable: true,
                }));
            }
            priorMessagesShown = shownToBeMovedMessages;
        }

        function removeShownToBeMoved() {
            //Remove the to-be-archived preview
            if(shownToBeMoved) {
                shownToBeMoved.remove();
            }
        }

        function makeMonologueHtml(event) {
            //Create the HTML for a monologue containing a single message.
            var userId = +event.user_id;
            var userAvatar16 = '';
            if(avatarList[userId]) {
                userAvatar16 = avatarList[userId][16];
            }
            var userName = event.user_name;
            var userReputation = '';
            var parentId = event.parent_id;
            var showParent = event.show_parent;
            var messageId = event.message_id;
            var contentHtml = event.content;
            var timestamp = event.timeStampUTC.replace(/T(\d\d:\d\d):\d\d\.\d{3}/,' $1');
            var html = [
                //From transcript
                '<div class="monologue user-' + userId + ' SOCVR-Archiver-monologue-for-message-' + messageId + '">',
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
                '        <div class="message" id="message-' + messageId + '">',
                '            <div class="timestamp">' + timestamp + '</div>',
                '            <a name="' + messageId + '" href="/transcript/' + room + '?m=' + messageId + '#' + messageId + '"><span style="display:inline-block;" class="action-link"><span class="img menu"> </span></span></a>',
                '            <div class="content">' + contentHtml,
                '            </div>',
                '            <span class="flash">',
                '            </span>',
                '        </div>',
                '    </div>',
                '    <div class="clear-both" style="height:0">&nbsp;</div> ',
                '</div>',
            ].join('\n');
            return html;
        }

        //Add deleted content to be shown on hover.

        //CHAT listener
        function listenToChat(){
            //Delay untill after the content has been added. Only 0ms is required.
            setTimeout(addMoveToInMeta, 10);
        }
        if(!isTranscript && !isSearch) {
            CHAT.addEventHandlerHook(listenToChat);
        }

        var deletedMessagesWithoutDeletedContent;
        var delayBetweenGettingDeletedContent = 500;
        var gettingDeletedContent = 0;

        function addAllDeletedContent() {
            //Go through the DOM and add the content back in for all deleted messages which don't already have it added back in.
            if(!gettingDeletedContent && (!deletedMessagesWithoutDeletedContent || !deletedMessagesWithoutDeletedContent.length)) {
                deletedMessagesWithoutDeletedContent = $('.content .deleted').parent().filter(function() {
                    return !$(this).children('.SOCVR-Archiver-deleted-content').length;
                }).closest('.message');
                if(deletedMessagesWithoutDeletedContent.length) {
                    addNextDeletedContent();
                }
            }
        }

        function addNextDeletedContent() {
            //Get the content for the next deleted message and insert it into the DOM.
            gettingDeletedContent = 1;
            if(deletedMessagesWithoutDeletedContent.length) {
                var message = deletedMessagesWithoutDeletedContent.last();
                //Remove the message we're working on.
                deletedMessagesWithoutDeletedContent.splice(deletedMessagesWithoutDeletedContent.length - 1, 1);
                var messageId = getMessageIdFromMessage(message);
                getMessageMostRecentVersionFromHistory(messageId, function(deletedContent) {
                    if(deletedContent) {
                        addDeletedContentToMessageId(messageId, deletedContent);
                    }
                    if(deletedMessagesWithoutDeletedContent.length) {
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

        function addDeletedContentToMessageId(messageId, deletedContent) {
            var newContent = $('#message-' + messageId + ' .content');
            deletedContent.removeClass('content').addClass('SOCVR-Archiver-deleted-content');
            newContent.append(deletedContent);
            //Indicate to the user that the content is available.
            newContent.find('.deleted').append('<span> &#128065;</span>');
        }

        function fechHistoryForMessage(messageId, callback) {
            $.ajax({
                type: 'GET',
                url: 'https://' + window.location.hostname + '/messages/' + messageId + '/history',
                success: callback,
                error: function(xhr, status, error) {
                    console.log('AJAX Error Getting history', '::  xhr:', xhr, '::  status:', status, '::  error:', error);
                    console.log('target:', target, '::  fkey,:', fkey, '::  ids:', ids);
                },
            });
        }

        function getMessageMostRecentVersionFromHistory(messageId, callback) {
            fechHistoryForMessage(messageId, function(data) {
                var newDoc = jQuery.parseHTML(data);
                callback($('.message .content', newDoc).first());
            });
        }

        //Manual message MoveTo

        var priorSelectionMessageIds = [];

        function TargetRoom(_roomNumber,_fullName,_shortName,_displayed) {
            this.roomNumber = _roomNumber;
            this.fullName = _fullName;
            this.shortName = _shortName;
            this.displayed = _displayed;
        }

        var targetRoomsByRoomNumber = {
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
        //The curent room is not a valid room target.
        delete targetRoomsByRoomNumber[room];

        function moveSomePostsWithConfirm(posts, targetRoomId, callback) {
            //Confirm that the user wants to move the files.
            var countPosts = 0;
            if(!Array.isArray(posts)) {
                countPosts = 1;
            } else {
                if(Array.isArray(posts[0])) {
                    //Already chunked
                    posts.forEach(function(chunk) {
                        countPosts += chunk.length;
                    });
                } else {
                    countPosts = posts.length;
                }
            }
            if(countPosts && window.confirm('Move ' + countPosts + ' message' + (countPosts === 1 ? '' : 's') + ' to ' + targetRoomsByRoomNumber[targetRoomId].fullName + '?')) {
                //Save a copy of the last information.
                setStorageJSON('previousMoveTo', {
                    posts:posts,
                    targetRoomId: targetRoomId,
                    //It would need to be tested to see if you really can only move from a single room, or if you can move from multiple rooms at a time.
                    sourceRoomId: room,
                });
                //Move the posts
                moveSomePosts(posts, targetRoomId, callback);
            } else {
                if(typeof callback === 'function') {
                    callback(false);
                }
            }
        }

        function moveSomePosts(posts, targetRoomId, callback) {
            //posts can be an String/Number of postId, Array of posts, or already chunked Array of post Arrays.
            if(!targetRoomId || +targetRoomId < 1 || !posts || (Array.isArray(posts) && posts.length === 0)) {
                //Something is wrong with the arguments.
                if(typeof callback === 'function') {
                    callback(false);
                }
                return false;
            }
            posts = Array.isArray(posts) ? posts : [posts];
            //Chunk the array, if it's not already chunked
            posts = Array.isArray(posts[0]) ? posts : chunkArray(posts, 100);
            var currentids = posts.pop();

            $.ajax({
                type: 'POST',
                data: 'ids=' + currentids.join('%2C') + '&to=' + targetRoomId + '&fkey=' + fkey,
                url: '/admin/movePosts/' + room,
                success: function(){
                    if(!posts.length) {
                        //Done with messages. Normal completion.
                        if(typeof callback === 'function') {
                            callback(true);
                        }
                        return false;
                    }
                    setTimeout(moveSomePosts, 5000, posts, targetRoomId, callback);
                },
                error: function(xhr, status, error) {
                    console.log('AJAX Error moving some posts', '::  xhr:', xhr, '::  status:', status, '::  error:', error);
                    console.log('posts:', posts, '::  targetRoomId:', targetRoomId, '::  callback:', callback);
                    console.log('currentids:', currentids, '::  targetRoomId:', targetRoomId, '::  fkey,:', fkey);
                    alert('$.ajax encountered an error moving some posts. See console for data.');
                },
            });
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
            //Add messge
            '<span class="SOCVR-Archiver-in-message-move-button SOCVR-Archiver-move-to-add-to-list" title="Add this/selected message(s) to the list." data-room-id="add">+</span>',
            //remove message
            '<span class="SOCVR-Archiver-in-message-move-button SOCVR-Archiver-move-to-remove-from-list" title="Remove this/selected message(s) from the list." data-room-id="remove">-</span>',
            //clear list
            '<span class="SOCVR-Archiver-in-message-move-button SOCVR-Archiver-move-to-clear-list" title="Clear the list." data-room-id="clear">*</span>',
            //Undo/ reselect the last moved list
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
            });
            showAllManualMoveMessages();
            addAllDeletedContent();
            getAvatars();
        }

        var manualMoveList = getLSManualMoveList();

        function getMessageIdFromMessage(message) {
            //Get the message ID from a message element or the first element in a jQuery Object.
            var el = (message instanceof jQuery) ? message[0] : message;
            if (message instanceof jQuery) {
                if(message.length) {
                    message = message[0];
                } else {
                    return '';
                }
            }
            if(message) {
                return el.id.replace(/(?:SOCVR-Archiver-)?message-/,'');
            } //else
            return '';
        }

        function moveToInMetaHandler() {
            //Handle a click on the moveTo controls
            /* jshint -W040 */ //This is called as a jQuery event handler, which explicitly sets `this`.
            var $this = $(this);
            var roomId = this.dataset.roomId;
            /* jshint +W040 */
            var message = $this.closest('.message');
            if(message.length) {
                var messageId = getMessageIdFromMessage(message);
                if (messageId) {
                    if (roomId === 'add') {
                        addToLSManualMoveList(messageId);
                        addToLSManualMoveList(priorSelectionMessageIds);
                    } else if (roomId === 'remove') {
                        removeFromLSManualMoveList(messageId);
                        removeFromLSManualMoveList(priorSelectionMessageIds);
                    } else if (roomId === 'clear') {
                        clearLSManualMoveList();
                    } else if (roomId === 'reselect') {
                        reselectLastLSMoveList();
                    } else if (+roomId) {
                        addToLSManualMoveList(messageId);
                        addToLSManualMoveList(priorSelectionMessageIds);
                        moveSomePostsWithConfirm(manualMoveList, roomId, function(moved) {
                            // Should consider here if we really want to clear the list.
                            // Not clearing it gives the user the oportunity to reverse the
                            // move by going to the other room, where the messages will
                            // already be selected.  Clearing it feels more like what people
                            // would expect.
                            if(moved) {
                                //If the move was successful, clear the list. Keep the list if it wasn't.
                                clearLSManualMoveList();
                                //Clear the list again, in case there's delays between tabs.
                                setTimeout(clearLSManualMoveList, 2000);
                            }
                        });
                    }
                }
            }
            //Clear the selection
            priorSelectionMessageIds = [];
            window.getSelection().removeAllRanges();
        }

        function getMessagesInSelection() {
            //Convert the selection to a list of messageIds
            var messageIdsObject = {};
            function addMessageIdToSet(message) {
                var messageId = getMessageIdFromMessage(message);
                if(messageId) {
                    messageIdsObject[messageId] = true;
                }
            }
            var selection =  window.getSelection();
            addMessageIdToSet($(selection.anchorNode).closest('.message'));
            addMessageIdToSet($(selection.focusNode).closest('.message'));
            $('.message').each(function() {
                if(selection.containsNode(this)) {
                    addMessageIdToSet(this);
                }
            });
            var messageIds = Object.keys(messageIdsObject);
            return messageIds;
            //return Object.keys(messageIdsObject);
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
        //Global jQuery AJAX listener: Catches user requesting older chat messages
        $(document).ajaxComplete( function() {
            setTimeout(addMoveToInMeta, 500);
        });
        //Lazy way of adding moveInMeta after messages load
        $(document).on('click','.SOCVR-Archiver-in-message-move-button', moveToInMetaHandler);
        //Add meta when room is ready
        if(!isSearch) {
            CHAT.Hub.roomReady.add(function() {
                addMoveToInMeta();
                addAllDeletedContent();
            });
        }
        addMoveToInMeta();

        //Simple update of the manual move list:
        window.addEventListener('storage', function(event) {
            if(event.key.indexOf(lsPrefix) === 0) {
                if(event.key.indexOf('manualMoveList') > -1) {
                    getLSManualMoveList();
                    showAllManualMoveMessages();
                }
            }
        });

        function getLSManualMoveList() {
            var list = getStorageJSON('manualMoveList');
            manualMoveList = list ? list : [];
            //Make sure the list is always numbers, not strings.
            manualMoveList = manualMoveList.map(function(value) {
                return +value;
            });
            return manualMoveList;
        }

        function setLSManualMoveList() {
            setStorageJSON('manualMoveList', manualMoveList);
        }

        function addToLSManualMoveList(values) {
            values = Array.isArray(values) ? values : [values];
            values.forEach(function(value) {
                value = +value;
                if(manualMoveList.indexOf(value) === -1) {
                    //No duplicates
                    manualMoveList.push(value);
                }
            });
            setLSManualMoveList(manualMoveList);
            showAllManualMoveMessages();
        }

        function removeFromLSManualMoveList(values) {
            values = Array.isArray(values) ? values : [values];
            //Convert all values to numbers.
            values = values.map(function(value) {
                return +value;
            });
            manualMoveList = manualMoveList.filter(function(compare) {
                return values.indexOf(+compare) === -1;
            });
            setLSManualMoveList(manualMoveList);
            showAllManualMoveMessages();
        }

        function reselectLastLSMoveList() {
            var priorMove = getStorageJSON('previousMoveTo');
            manualMoveList = priorMove ? priorMove.posts : [];
            manualMoveList = priorMove.posts;
            setLSManualMoveList(manualMoveList);
            showAllManualMoveMessages();
        }

        function clearLSManualMoveList() {
            manualMoveList = [];
            setLSManualMoveList(manualMoveList);
            showAllManualMoveMessages();
        }

        var mostRecentMessageListCount;
        var messageListCountAddedFirstTime = false;

        function showAllManualMoveMessages() {
            $('.message').each(function() {
                var messageId = getMessageIdFromMessage(this);
                if(manualMoveList.indexOf(+messageId) > -1) {
                    $(this).addClass('SOCVR-Archiver-multiMove-selected');
                } else {
                    $(this).removeClass('SOCVR-Archiver-multiMove-selected');
                }
            });
            var length = manualMoveList.length;
            //No need to change these, if the value didn't change.
            if(mostRecentMessageListCount !== length || !messageListCountAddedFirstTime) {
                messageListCountAddedFirstTime = true;
                var newText = '[List has ' + length + ' message' + (length === 1 ? '' : 's') + '.]';
                $('.SOCVR-Archiver-in-message-move-button').each(function() {
                    this.title = this.title.replace(/^([^\[]+)( ?\[.*)?$/,'$1 ' + newText);
                });
                mostRecentMessageListCount = length;
            }
        }

        function getAvatars() {
            //Collect the existing avatar information from localStorage and in the page.
            var listChanged =  false;
            avatarList = getStorageJSON('avatarList') || {};
            $('.signature').each(function() {
                var $this = $(this);
                var userId = +$this.closest('.monologue')[0].className.replace(/.*\buser-(\d+)\b.*/,'$1');
                if(userId) {
                    if(!avatarList[userId]) {
                        avatarList[userId] = {};
                        listChanged = true;
                    }
                    var avatar16 = $this.find('.avatar-16 img').first();
                    if(avatar16.length) {
                        var avatar16src = avatar16[0].src;
                        if(avatar16src && avatarList[userId][16] !== avatar16src) {
                            avatarList[userId][16] = avatar16src;
                            listChanged = true;
                        }
                    }
                    var avatar32 = $this.find('.avatar-32 img').first();
                    if(avatar32.length) {
                        var avatar32src = avatar32[0].src;
                        if(avatar32src && avatarList[userId][32] !== avatar32src) {
                            avatarList[userId][32] = avatar32src;
                            listChanged = true;
                        }
                    }
                }
            });
            if(listChanged) {
                setStorageJSON('avatarList', avatarList);
            }
        }
    }
})();
