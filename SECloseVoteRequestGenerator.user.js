// ==UserScript==
// @name           Stack Exchange CV Request Generator
// @namespace      https://github.com/SO-Close-Vote-Reviewers/
// @version        1.8.7.0
// @description    ALPHA: This script generates formatted close-/delete-/reopen-/undelete-vote requests, spam/offensive flag requests, Smoke Detector reports, and approve-/reject-pls requests for suggested edits, then sends them to a specified chat room.
// @author         @TinyGiant @Makyen
// @contributor    @rene @Tunaki
// @include        /^https?://([^/.]+\.)*(stackexchange\.com|stackoverflow\.com|serverfault\.com|superuser\.com|askubuntu\.com|stackapps\.com|mathoverflow\.net)/(?:q(uestions)?\/\d+|review|tools)/
// @exclude        *://chat.stackoverflow.com/*
// @exclude        *://chat.stackexchange.com/*
// @exclude        *://chat.*.stackexchange.com/*
// @exclude        *://api.*.stackexchange.com/*
// @exclude        *://data.stackexchange.com/*
// @require        https://code.jquery.com/jquery-2.1.4.min.js
// @require        https://github.com/SO-Close-Vote-Reviewers/UserScripts/raw/master/gm4-polyfill.js
// @connect        raw.githubusercontent.com
// @connect        chat.stackoverflow.com
// @connect        chat.stackexchange.com
// @connect        chat.meta.stackexchange.com
// @grant          GM_openInTab
// @grant          GM_xmlhttpRequest
// @grant          GM_getValue
// @grant          GM_setValue
// @grant          GM_deleteValue
// @grant          GM_addValueChangeListener
// @grant          GM.openInTab
// @grant          GM.xmlHttpRequest
// @grant          GM.getValue
// @grant          GM.setValue
// @grant          GM.deleteValue
// @grant          GM.addValueChangeListener
// ==/UserScript==
/* jshint jquery:    true */
/* globals unsafeWindow, StackExchange, Markdown, toStaticHTML, tagRendererRaw, GM_getValue, GM_setValue, GM_deleteValue, GM_addValueChangeListener, GM_openInTab, GM, $, jQuery */

(function() {
    'use strict';

    //The RoomList is the list of chat rooms to which to send requests. It's effectively a class, but a one-off.
    const RoomList = {};
    var CVRGUI;
    const socvrModeratedSites = ['stackoverflow.com'];
    const delayedRequestStorage = 'delayedRequests';
    const rememberedRequestStorage = 'rememberedRequests';
    let rememberedRequests;
    //Only those request states with matching times which are not automatically filled by the constructor.
    const requestInfoStateWithMatchingTime = ['posted', 'delayed', 'closeVoted', 'deleteVoted'];
    const delayableRequestTypes = ['revisit'];
    const delayableRequestRegex = / \(in (?:(\d+(?:\.\d+)?)|N) days?\)/;
    const scriptInstanceIdentifier = Math.random().toString(); //Not perfectly unique, but should be close.
    const canListenGMStorage = typeof GM_addValueChangeListener === 'function'; //Not available: Greasemonkey
    const isQuestionPage = window.location.pathname.indexOf('/questions/') === 0;
    const questionActivityWarningAge = 1000 * 60 * 60 * 24 * 30; //30 days
    let openedAsDelayedRequestNoticeId = [];
    const requestTypesWithNoReason = ['!!/reportuser', '!!/addblu-', '!!/rmblu-', '!!/addwlu-', '!!/rmwlu-', 'spam'];
    const requestTypesWithOptionalReason = ['!!/report', '!!/report-force', '!!/scan', '!!/scan-force', 'spam', 'offensive', 'reflag NAA', 'reflag VLQ'];
    const knownRooms = {
        SOCVR: {
            urlDetectionRegExp: /chat\.stackoverflow\.com\/rooms\/41570(?:$|\/)/,
            room: {
                host: 'https://chat.stackoverflow.com',
                url: 'https://chat.stackoverflow.com/rooms/41570/', // SOCVR
                id: '41570',
                name: 'SO Close Vote Reviewers',
            },
        },
        charcoal: {
            urlDetectionRegExp: /chat\.stackexchange\.com\/rooms\/11540(?:$|\/)/,
            room: {
                host: 'https://chat.stackexchange.com',
                url: 'https://chat.stackexchange.com/rooms/11540/', // charcoal-hq
                id: '11540',
                name: 'Charcoal HQ',
            },
        },
        tavern: {
            urlDetectionRegExp: /chat\.meta\.stackexchange\.com\/rooms\/89(?:$|\/)/,
            room: {
                host: 'https://chat.meta.stackexchange.com',
                url: 'https://chat.meta.stackexchange.com/rooms/89/', // Tavern on the Meta
                id: '89',
                name: 'Tavern on the Meta',
            },
        },
        CRCQR: {
            urlDetectionRegExp: /chat\.stackexchange\.com\/rooms\/85306(?:$|\/)/,
            room: {
                host: 'https://chat.stackexchange.com',
                url: 'https://chat.stackexchange.com/rooms/85306/', // SE Code Review Close Questions room
                id: '85306',
                name: 'SE Code Review Close Questions room',
            },
        },
        CRUDE: {
            urlDetectionRegExp: /chat\.stackexchange\.com\/rooms\/2165(?:$|\/)/,
            useMetaTag: false, //default
            useSiteTag: true, //default
            room: {
                host: 'https://chat.stackexchange.com',
                url: 'https://chat.stackexchange.com/rooms/2165/', // SE Code Review Close Questions room
                id: '2165',
                name: 'CRUDE',
            },
        },
        seNetwork: {
            urlDetectionRegExp: /chat\.stackexchange\.com\/rooms\/11254(?:$|\/)/,
            room: {
                host: 'https://chat.stackexchange.com',
                url: 'https://chat.stackexchange.com/rooms/11254/', // The Stack Exchange Network
                id: '11254',
                name: 'The Stack Exchange Network',
            },
        },
    };

    //Options
    function CheckboxOption(_defaultValue, _text, _tooltip) {
        //Constructor for a checkbox option
        this.defaultValue = _defaultValue;
        this.text = _text;
        this.tooltip = _tooltip;
    }

    function ButtonOption(_buttonAction, _dynamicText, _text, _tooltip) {
        //Constructor for a button option
        this.buttonAction = _buttonAction;
        this.dynamicText = _dynamicText;
        this.text = _text;
        this.tooltip = _tooltip;
    }

    function NumberOption(_defaultValue, _min, _max, _style, _textPre, _textPost, _tooltip) {
        //Constructor for a number option
        this.defaultValue = _defaultValue;
        this.min = _min;
        this.max = _max;
        this.style = _style;
        this.textPre = _textPre;
        this.textPost = _textPost;
        this.tooltip = _tooltip;
    }

    //Object describing the options displayed in the GUI.
    /* beautify preserve:start */
    var knownOptions = {
        checkboxes: {
            onlySocvrModeratedSites:           new CheckboxOption(false, 'Don\'t show this GUI on non-SOCVR moderated sites.', 'SOCVR moderates only ' + socvrModeratedSites.join(',') + '. Checking this prevents the cv-pls/del-pls GUI from being added on sites which SOCVR does not moderate.'),
            onlyKnownSites:                    new CheckboxOption(false, 'Don\'t show this GUI on sites not pre-configured in this script.', 'Known sites are those moderated by SOCVR: ' + socvrModeratedSites.join(',') + '; Code Review; Mathematics; and Meta Stackexchange. Checking this prevents the cv-pls/del-pls GUI from being added on other sites.'),
            onlyCharcoalSDSpamOnUnknownSites:  new CheckboxOption(true, 'On sites not specifically configured in this script, use Charcoal HQ as default & show only SD Reports/spam report options.', 'On sites not specifically configured in this script, use Charcoal HQ as the default room and show only SD Reports, spam and offensive as report options. This will not replace the room currently defined on any site. Basically, for any site you have visited prior to setting this option, the site will have already been defined (used to be SOCVR, then changed to &quot;The Stack Exchange Network&quot;). On those sites, you will need to manually change the room.'),
            alwaysCharcoal:                    new CheckboxOption(false, 'Always send SD commands to Charcoal HQ.', 'Regardless of the current room selection, always send SD commands to Charcoal HQ and show the SD command options on all sites.'),
            canReportSmokeDetectorSOCVR:       new CheckboxOption(false, 'SOCVR: Show request types for Smoke Detector.', 'When the target Room is SOCVR, show request type options for reporting to Smoke Detector (SD) that the question is spam/offensive, or that all the user\'s posts are spam/offensive. Using SD in SOCVR requires that you are approved to do so in SOCVR. If you\'re not yet approved, sending such reports will just have SD respond saying that you\'re not approved.'),
            canReportSmokeDetectorOther:       new CheckboxOption(false, 'non SOCVR/non Charcoal HQ rooms: Show request types for Smoke Detector.', 'For target rooms other than SOCVR, show request type options for reporting to Smoke Detector (SD) that the question is spam/offensive and other SD commands. Using SD requires that you are approved to do so in that Room. If you\'re not yet approved, sending such reports will just have SD respond saying that you\'re not approved.'),
            alwaysAddNato:                     new CheckboxOption(true, 'Add " (NATO)" to requests from NATO.', 'When submitting a request from New Answers To Old questions (NATO, part of the 10k tools), add &quot; (NATO)&quot; to the request reason to help people see why you\'re submitting a request about an old question.'),
            automaticlyPostDelayedRequests:    new CheckboxOption(false, 'Automatically post delayed requests.', 'For delayed requests (e.g. &quot;del-pls (in 2 days)&quot;), don\'t open a page to allow you to manually post the request; just automatically post the request.\r\nNOTE: You are responsible for all requests you post. This includes things like posting duplicate requests. Thus, it\'s much better to manually verify that the request is valid (e.g. the question has not been reopened).'),
        },
        buttons: {
            deleteDelayedRequests:             new ButtonOption(deleteDelayedRequests, getNumberDelayedRequestsAsAddedText, 'Discard delayed requests', 'Delete all requests which you have requested be delayed (i.e. &quot;del-pls (in 2 days)&quot;).'),
        },
        numbers: {
            daysRememberRequests:              new NumberOption(30, 0, 365, 'width: 5em', 'Days to remember requests', '', 'Number of days to remember the requests you have made. This is used to inform you if you try to make the same request again (you still can, you just have to confirm you want to post a duplicate). It\'s also used to better remember the reason you wrote (e.g. if you reload the page). Set to 0 if you don\'t want this information stored.'),
        },
    };
    /* beautify preserve:end */

    function QuickSubstitutions(_substitutions) {
        this.substitutions = _substitutions;
    }
    QuickSubstitutions.prototype.get = function(r) {
        //Substitute space separated words in the input text which
        // match the properties above with the property's value.
        var a = r.split(' ');
        a.forEach(function(v, i) {
            a[i] = this.substitutions.hasOwnProperty(v) && v !== 'get' ? this.substitutions[v] : v;
        }, this);
        return a.join(' ');
    };

    function SiteConfig(_name, _siteRegExp, _offTopicCloseReasons, _quickSubstitutions, _offTopicScrapeMatch, _defaultRoomKey) {
        this.name = _name;
        this.siteRegExp = _siteRegExp;
        this.offTopicCloseReasons = _offTopicCloseReasons;
        this.quickSubstitutions = new QuickSubstitutions(_quickSubstitutions);
        this.offTopicScrapeMatch = _offTopicScrapeMatch;
        this.defaultRoomKey = _defaultRoomKey;
        this.defaultRoom = JSON.parse(JSON.stringify(knownRooms[_defaultRoomKey].room));
    }

    //The quick substitutions are changed in the text a user types for their request reason.
    //  They are usually a single character, but can be more. As a single character, they need
    //  to stay away from anything the user is going to type as a single character. In particular,
    //  that means they need to not be "a".
    const defaultQuickSubstitutions = {
        't': 'Too Broad',
        'u': 'Unclear',
        'p': 'Primarily Opinion Based',
        'o': 'Opinion Based',
        'd': 'Duplicate',
    };
    const defaultOffTopicCloseReasons = {
        1: 'Blatantly off-topic', //In close-flag dialog, but not the close-vote dialog on most sites, but is in the CV dialog on some sites.
        2: 'Belongs on another site',
        3: 'custom',
    };
    const defaultOffTopicCloseReasonsWithoutOtherSite = Object.assign({}, defaultOffTopicCloseReasons);
    delete defaultOffTopicCloseReasonsWithoutOtherSite[2];
    var configsForSites = [];
    //The keys used for the close reasons below should match the "value" attribute in the <input> used for
    //  that close reason in the off-topic pane of the close-vote-/flag-dialog.
    //Stack Overflow
    configsForSites.push(new SiteConfig('Stack Overflow', /^stackoverflow.com$/, Object.assign({
        4: 'General Computing',
        7: 'Server / Networking',
        11: 'Typo or Cannot Reproduce',
        13: 'No MCVE',
        16: 'Request for Off-Site Resource',
    }, defaultOffTopicCloseReasons), Object.assign({
        'm': 'No MCVE',
        'r': 'Typo or Cannot Reproduce',
        'g': 'General Computing',
        's': 'Super User',
        'f': 'Server Fault',
        'l': 'Request for Off-Site Resource',
        'F': '(FireAlarm)',
        'N': '(NATO)',
        'S': '(SD report)',
        'c': '(not enough code to duplicate)',
        'b': '(no specific expected behavior)',
        'e': '(no specific problem or error)',
    }, defaultQuickSubstitutions), {
        'reproduced': 'r',
        'general': 'g',
        'recommend': 'l',
        'server': 'f',
        'working': 'm',
    }, 'SOCVR'));
    //Meta Stack Exchange
    configsForSites.push(new SiteConfig('Meta Stack Exchange', /^meta.stackexchange.com$/, Object.assign({
        5: 'Does not seek input or discussion',
        6: 'Cannot be reproduced',
        8: 'Not about Stack Exchange Network software',
        11: 'Specific to a single site',
        //This site does not have a 2: 'Belongs on another site'
    }, defaultOffTopicCloseReasonsWithoutOtherSite), Object.assign({
        'i': 'Does not seek input or discussion',
        'r': 'Cannot be reproduced',
        'n': 'Not about Stack Exchange Network software',
        's': 'Specific to a single site',
    }, defaultQuickSubstitutions), {
        'reproduced': 'r', //Needs verification.
        'only': 's',
        'input': 'i',
    }, 'tavern'));
    //Code Review Stack Exchange
    configsForSites.push(new SiteConfig('Code Review Stack Exchange', /^codereview.stackexchange.com$/, Object.assign({
        20: 'Lacks concrete context',
        23: 'Code not implemented or not working as intended',
        25: 'Authorship of code',
    }, defaultOffTopicCloseReasons), Object.assign({
        'c': 'Lacks concrete context',
        'i': 'Code not implemented or not working as intended',
        's': 'Authorship of code',
    }, defaultQuickSubstitutions), {
        //The default method of using what's bold or italics works reasonably for this site.
    }, 'CRCQR'));
    //Mathematics Stack Exchange
    configsForSites.push(new SiteConfig('Mathematics Stack Exchange', /^math.stackexchange.com$/, Object.assign({
        6: 'Not about mathematics',
        8: 'Seeking personal advice',
        9: 'Missing context or other details',
    }, defaultOffTopicCloseReasons), Object.assign({
        'b': 'Blatantly off-topic',
        'n': 'Not about mathematics',
        'c': 'Missing context or other details',
        's': 'Seeking personal advice',
    }, defaultQuickSubstitutions), {
        //All of the off-topic reasons need to be specified, because the "Not about mathematics" reason contains no bold or italic text.
        //  As a result, we match against '', which will match anything.
        'context': 'c',
        'advice': 's',
        '': 'n', //The closed text for this reason contains no bold or italic characters.
    }, 'CRUDE'));

    //Default site configuration
    var currentSiteConfig = new SiteConfig('Default', /./, defaultOffTopicCloseReasons, defaultQuickSubstitutions, {}, 'seNetwork');

    //If we are not trying to be compatible with IE, then could use .find here.
    var isKnownSite = configsForSites.some((siteConfig) => {
        if (siteConfig.siteRegExp.test(window.location.hostname)) {
            currentSiteConfig = siteConfig;
            return true;
        } // else
        return false;
    });

    const reasons = currentSiteConfig.quickSubstitutions;
    const offTopicCloseReasons = currentSiteConfig.offTopicCloseReasons;

    //Set some global variables
    var isSocvrSite = socvrModeratedSites.indexOf(window.location.hostname) > -1;
    const isSocvrRoomUrlRegEx = knownRooms.SOCVR.urlDetectionRegExp;
    var isNato = window.location.pathname.indexOf('tools/new-answers-old-questions') > -1;
    var isSuggestedEditReviewPage = /^\/review\/suggested-edits(?:\/|$)/i.test(window.location.pathname);
    //Restore the options
    var configOptions = getConfigOptions();
    //If the options are set such that we don't show on non-SOCVR sites and this is not a SOCVR site, or we are only to run on known sites and this one isn't known, then stop processing.
    if ((configOptions.checkboxes.onlySocvrModeratedSites && !isSocvrSite) || (configOptions.checkboxes.onlyKnownSites && !isKnownSite)) {
        return;
    }
    var onlySdSpamOffensive;

    function setGlobalVariablesByConfigOptions() {
        onlySdSpamOffensive = configOptions.checkboxes.onlyCharcoalSDSpamOnUnknownSites && !isSocvrSite && !isKnownSite;
        RoomList.defaultRoomUrl = currentSiteConfig.defaultRoom.url;
        if (onlySdSpamOffensive) {
            RoomList.defaultRoomUrl = knownRooms.charcoal.room.url; // charcoal-hq
        }
    }
    setGlobalVariablesByConfigOptions();
    //Get the href for the user's profile.
    var currentUserHref = $('.topbar .profile-me,.so-header .my-profile,.top-bar .my-profile').attr('href');
    var insertMarkdownReady = false;
    $(window).on('cvrg-insertMarkdownReady', function() {
        insertMarkdownReady = true;
    });

    //MathJax corrupts the text contents of titles (from a programmatic POV:  .text(),
    //  .textContent, and .innerText).  In order have requests contain the actual title text,
    //  we save a copy of the text for each title we find in the DOM, hopefully prior to
    //  MathJax changing them.  There's a race condition here where it's assumed this is run
    //  between when the title(s) exist in the DOM and before MathJax runs.  Currently, there
    //  isn't an effort to guarantee that.
    function saveCopyOfQuestionTitles() {
        $('#question-header h1 a, h1 a, .question-hyperlink, .answer-hyperlink').each(function() {
            const $this = $(this);
            if (!$this.data('origText')) {
                $this.data('origText', $this.text());
            }
        });
    }
    saveCopyOfQuestionTitles();

    //NATO: Prep page so we can place del-pls normally, and detect if NATO Enhancements is being used
    var isNatoWithoutEnhancement = false;
    if (isNato) {
        isNatoWithoutEnhancement = true;
        $('body.tools-page #mainbar > table.default-view-post-table > tbody > tr > td:last-of-type').append($('<div class="post-menu cvrgFakePostMenu">'));
        var rows = $('body.tools-page #mainbar > table.default-view-post-table > tbody > tr');
        rows.each(function() {
            var $this = $(this);
            $this.addClass('answer cvrgFakeQuestionContext');
            $this.data('answerid', $('.answer-hyperlink', $this).attr('href').replace(/^.*#(\d+)$/, '$1'));
        });
        //Observe for a change to the first TD within the first row of the page to detect the NATO Enhancements user script.
        (new MutationObserver(function(mutations, observer) {
            if (mutations.some((mutation) => (mutation.addedNodes ? mutation.target.nodeName === 'TD' : false))) {
                //Found an added node that targeted a TD. It's assumed that means NATO Enhancements
                //  is going to be reorganizing the page & we will handle it after that's done.
                //For now, back-out the changes we made to the DOM for NATO w/o Enhancements.
                isNatoWithoutEnhancement = false;
                observer.disconnect();
                $('.cvrgFakeQuestionContext').removeClass('answer cvrgFakeQuestionContext').removeData('answerid');
                $('.cvrgFakePostMenu').remove();
            }
        })).observe(rows.first().children('td')[0], {
            childList: true,
        }); //Only need to watch the first TD.
    }

    function addNatoIfIsNato(text) {
        //If the current page is NATO, then add a notation to the text that it's NATO.
        if (knownOptions.checkboxes.alwaysAddNato && isNato && !/\bnato\b/i.test(text)) {
            text += ' (NATO)';
        }
        return text;
    }

    function addNatoToValueIfIsNatoAndNotEmpty(element) {
        //Add NATO notation if it's already not there and the value isn't currently empty.
        var $el = (element instanceof jQuery) ? element : $(element);
        if ($el.val()) {
            //Only add if not empty
            $el.val(addNatoIfIsNato($el.val()));
        }
    }

    function addNoCodeToValueIfIsMcve(element) {
        //If No MCVE, and no code at all, then state that's the case.
        var $el = (element instanceof jQuery) ? element : $(element);
        var questionContext = getQuestionContext(element);
        var currentVal = $el.val();
        if (/\bmcve\b/i.test(currentVal) && !/\bno code\b/i.test(currentVal)) {
            if (!$('.question code', questionContext).length) {
                $el.val(currentVal + ': no code');
            } else if (!$('.question pre > code', questionContext).length) {
                $el.val(currentVal + ': no code block');
            }
        }
    }

    function getRequestTypeByQuestionStatus(inPost) {
        //Based on the question's current status return the text for the
        // type(s) of requests which are appropriate/default.
        var questionContext = getQuestionContext(inPost);
        var isSOCVR = isCurrentRoomSOCVR();
        if (onlySdSpamOffensive) {
            return ((isSOCVR && configOptions.checkboxes.canReportSmokeDetectorSOCVR) || (!isSOCVR && (configOptions.checkboxes.canReportSmokeDetectorOther || onlySdSpamOffensive))) ? 'sd-report' : 'spam';
        } //else
        if (isQuestionDeleted(questionContext)) {
            return 'undel-pls';
        } //else
        return isQuestionClosed(questionContext) ? 'reopen/del-pls' : 'cv-pls';
    }

    function isQuestionClosed(questionContext) {
        //True if the question is closed.
        return $('.special-status .question-status H2 B', questionContext).filter(function() {
            return /hold|closed|marked/i.test($(this).text());
        }).length > 0;
    }

    function isQuestionDeleted(questionContext) {
        //True if the question is deleted.
        return $('.question', questionContext).first().is('.deleted-answer');
    }

    function getQuestionContext(element) {
        //If there's more than one question, the context is the closest .mainbar
        //This is different in
        //  Normal pages with a single question (#mainbar)
        //  Some review queues and the reopen queue with a question closed as duplicate (.mainbar)
        //  Other review queues for answers: (.review-content)
        //    In these cases (e.g. First Posts), the answer will find .mainbar, but it does not include the question, so we look for the next match further up the DOM.
        //  MagicTag: (#mainbar-full)
        //  Inside the Close Dialog within previewing a potential duplicate question. (.show-original)
        //  10k tools (NATO with NATO Enhancements): (body.tools-page #mainbar > table > tbody > tr > td)
        //  10k tools (NATO without NATO Enhancements): (.cvrgFakeQuestionContext is added to the DOM)
        if (isSuggestedEditReviewPage) {
            return $('.suggested-edit');
        }
        var $el = (element instanceof jQuery) ? element : $(element);
        var context = $el.closest('#mainbar,.review-content,.mainbar,#mainbar-full,.show-original,.cvrgFakeQuestionContext,body.tools-page #mainbar > table.default-view-post-table > tbody > tr > td');
        if (!context.length) {
            return $(document);
        }
        if (context.is('.cvrgFakeQuestionContext') || context.find('.question').length) {
            return context;
        }
        //There was no .question in what was found, try higher up the DOM.
        return getQuestionContext(context.parent());
    }

    //Substitution rules for request reasons.
    //Construct a tooltip showing the substitutions which will be made in request reasons.
    var reasonTooltip = 'Single character substitutions:\r\n' + Object.keys(reasons.substitutions).filter(function(key) {
        return key !== 'get';
    }).sort().map(function(key) {
        return key + ' --> ' + reasons.substitutions[key];
    }).join('\r\n');

    var URL = 'https://github.com/SO-Close-Vote-Reviewers/UserScripts/raw/CVRG-Mak-new-version/SECloseVoteRequestGenerator.user.js';

    function inPageInsertMarkdownInTarget() {
        //The thing that's still needed is sanitizing, which may need to be added here from GitHub:
        if (typeof unsafeWindow !== 'undefined') {
            //Prevent this running when not in the page context.
            return;
        }
        var cacheOneEvent = null;

        function cacheEvent(e) {
            cacheOneEvent = e;
        }
        var eventToListenTo = 'cvrg-insertMarkdownInTarget';
        var $win = $(window);
        $win.on(eventToListenTo, cacheEvent);
        //We need the Markdown.Converter, which is in the 'editor', which is not auto-loaded on deleted question pages/reviews.
        StackExchange.using('editor', function() {
            var converter;
            function insertMarkdownFromEvent(e) {
                //If toStaticHTML() is not available, use only the very simple sanitization of changing all '<' to '&lt;' and '>' to '&gt;'
                //  This will result in a different look than what will actually happen when converted from Markdown, but won't execute code.
                //toStaticHTML() does not replace all HTML tags (e.g. <video>). In fact, it adds to <video> and corrupts what is displayed.
                //  Thus, we still have to do simple sanitation first.
                //This simple sanitation is insufficient, but good enough for what we're doing.
                // < and > should never appear in a tag, or link text, but this will mangle them if there are such.
                // It's not intended to be a full implementation of sanitation.
                //XXX Do we really need to substitute for ">"?
                //var sanitizedDetail = e.detail.replace(/</g, '&lt;').replace(/>/g, '&gt;');
                var sanitizedDetail = e.detail.replace(/</g, '&lt;');
                //On balance, it's probably better to also use toStaticHTML() than not to do so.
                sanitizedDetail = typeof toStaticHTML === 'function' ? toStaticHTML(sanitizedDetail) : sanitizedDetail;
                const target = $(e.target);
                target.append(converter.makeHtml(sanitizedDetail).replace(/\[(?:meta-)?tag:([^\]]+)]/g, function(match, p1) {
                    return tagRendererRaw(p1);
                }));
                //If the source doesn't have any &lt;, it would be beneficial to traverse all the <code> to change any back to <.
                if (!/(?:&lt;|&gt;|&amp;)/.test(e.detail)) {
                    //If the text already contained a "&lt;", "&gt;" or "&amp;", then don't bother trying to substitute the characters back in.
                    //  i.e. only fix the simple case.
                    target.find('code').find('*').addBack().contents().addBack().filter(function() {
                        return this.nodeType === 3;
                    }).each(function() {
                        this.textContent = this.textContent.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
                    });
                }
            }
            //Make sure the tagRenderer has been initialized.
            if (!window.tagRendererRaw && typeof window.initTagRenderer === 'function') {
                window.initTagRenderer();
            }
            /* jshint -W003 */
            converter = new Markdown.Converter({
                nonAsciiLetters: true,
                asteriskIntraWordEmphasis: StackExchange.settings.markdown.asteriskIntraWordEmphasis,
                autoNewlines: StackExchange.settings.markdown.autoNewlines,
            });
            /* jshint +W003 */
            $win.off(eventToListenTo, cacheEvent);
            $win.on(eventToListenTo, insertMarkdownFromEvent);
            //If there has been a markdown event prior to being ready, send the most recent. This is insufficient for situations where there
            //  might have been events on multiple elements, but the most likely thing is to only have the user be interacting with one, or at
            //  least the most recent interaction (event) is the most important.
            if (cacheOneEvent) {
                insertMarkdownFromEvent(cacheOneEvent);
            }
            //Broadcast that insertMarkdown is ready. This is used to .show() the preview.
            window.dispatchEvent(new CustomEvent('cvrg-insertMarkdownReady', {
                bubbles: true,
                cancelable: true,
            }));
        });
    }
    executeInPage(inPageInsertMarkdownInTarget, true, 'cvrg-insertMarkdownInTarget');

    // Message number, just a number used to start, which is not
    // guaranteed to be unique (i.e. it could have collisions with other
    // in-page/user script uses).
    //This would probably be better as just straight CSS, rather than an Object.
    var notifyInt = 4873;
    const notifyCSS = {
        saveSuccess: {
            'background-color': 'green',
        },
        sentSuccess: {
            'background-color': '#0095ff',
        },
        fail: {
            'background-color': 'red',
            'font-weight': 'bold',
        },
    };

    function removeOpenedAsDelayedRequestNotice() {
        removeListOfNotifications(openedAsDelayedRequestNoticeId);
        openedAsDelayedRequestNoticeId = [];
    }

    function removeListOfNotifications(notifications) {
        if (Array.isArray(notifications)) {
            notifications.forEach((noticeId) => {
                removeSENotice(noticeId);
            });
        }
    }

    function removeSENotice(messageId_) {
        function inPageRemoveNotice(messageId) {
            StackExchange.ready(function() {
                StackExchange.notify.close(messageId);
            });
        }
        executeInPage(inPageRemoveNotice, false, 'cvrg-inPageRemoveNotice-' + messageId_, messageId_);
    }

    function notify(message_, time_, notifyCss_) {
        //Display a SE notification for a number of milliseconds (optional).
        time_ = (typeof time_ !== 'number') ? 0 : time_;

        function inPageNotify(messageId, message, time, notifyCss) {
            //Function executed in the page context to use SE.notify to display the
            //  notification.
            if (typeof unsafeWindow !== 'undefined') {
                //Prevent this running when not in the page context.
                return;
            }
            var div = $('#notify-' + messageId);
            if (div.length) {
                //The notification already exists. Close it.
                StackExchange.notify.close(messageId);
            }
            $('#cvrq-notify-css-' + messageId).remove();
            if (typeof notifyCss === 'object' && notifyCss) {
                $(document.documentElement).append('<style id="#cvrq-notify-css-' + messageId + '" type="text/css">\n#notify-container #notify-' + messageId + ' {\n' +
                    Object.keys(notifyCss).reduce((text, key) => (text + key + ':' + notifyCss[key] + ';\n'), '') + '\n}\n</style>');
            }
            StackExchange.ready(function() {
                function waitUtilVisible() {
                    return new Promise((resolve) => {
                        function visibilityListener() {
                            if (!document.hidden) {
                                $(window).off('visibilitychange', visibilityListener);
                                resolve();
                            } // else
                        }
                        $(window).on('visibilitychange', visibilityListener);
                        visibilityListener();
                    });
                }
                //If something goes wrong, fallback to alert().
                try {
                    StackExchange.notify.show(message, messageId);
                } catch (e) {
                    console.log('Notification: ', message);
                    alert('Notification: ' + message);
                }
                if (time) {
                    waitUtilVisible().then(() => {
                        setTimeout(function() {
                            StackExchange.notify.close(messageId);
                            $('#cvrq-notify-css-' + messageId).remove();
                            $('#cvrg-inPageNotify-' + messageId).remove();
                        }, time);
                    });
                } else {
                    $('#cvrg-inPageNotify-' + messageId).remove();
                }
            });
        }
        executeInPage(inPageNotify, true, 'cvrg-inPageNotify-' + notifyInt, notifyInt++, message_, time_, notifyCss_);
        return notifyInt - 1;
    }

    function isVersionNewer(proposed, current) {
        //Determine if the proposed version is newer than the current.
        if (proposed.length > 30 || current.length > 30) {
            //Something is wrong. No valid versions are this long.
            // Versions should be around 10 characters, or so.
            // So, stick with the current version of the script by
            // returning false.
            return false;
        }

        proposed = proposed.split('.');
        current = current.split('.');

        while (proposed.length < current.length) {
            proposed.push('0');
        }
        while (current.length < proposed.length) {
            current.push('0');
        }

        for (var i = 0; i < proposed.length; i++) {
            if (parseInt(proposed[i]) > parseInt(current[i])) {
                return true;
            }
            if (parseInt(proposed[i]) < parseInt(current[i])) {
                return false;
            }
        }
        return false;
    }

    function checkUpdates(force) {
        //Check for updates to the version in SOCVR's userscript repository.
        GM.xmlHttpRequest({
            method: 'GET',
            url: 'https://raw.githubusercontent.com/SO-Close-Vote-Reviewers/UserScripts/CVRG-Mak-new-version/SECloseVoteRequestGenerator.version',
            onload: function(response) {
                var VERSION = response.responseText.trim();
                if (isVersionNewer(VERSION, GM.info.script.version)) {
                    var lastAcknowledgedVersion = getGMStorage('LastAcknowledgedVersion');
                    if (lastAcknowledgedVersion !== VERSION || force) {
                        if (confirm('A new version of ALPHA VERSION of The Close Vote Request Generator is available, would you like to install it now?')) {
                            window.location.href = URL;
                        } else {
                            setGMStorage('LastAcknowledgedVersion', VERSION);
                        }
                    }
                } else if (force) {
                    notify('No new version available');
                }
            },
        });
    }

    function sendRequest(request, callback, ignoreNonSOCVRSite) {
        //Actually post the cv-pls request to the chat room.
        if (typeof callback !== 'function') {
            callback = function() {}; // eslint-disable-line no-empty-function
        }
        RoomList.getRoom(function(room) {
            function displayRequestText(requestText, message) {
                message += '' +
                    '<br/><br/>' +
                    '<span>' +
                    '    Request text ' +
                    '    (<a href="#" class="SECVR-copy-to-clipboard" title="Click here to copy the request text to the clipboard.">copy</a>):' +
                    '</span>' +
                    '<br/>' +
                    '<textarea class="SECVR-request-text" style="width: 95%;">' +
                        requestText +
                    '</textarea>' +
                    '<br/>' +
                    '';
                var notificationId = notify(message);
                // Select the notification for Ctrl + C copy.
                var requestTextInput = $('textarea.SECVR-request-text').last();
                requestTextInput.select();
                // Bind a click handler on the "copy" anchor to copy the text manually.
                var copyButton = $('a.SECVR-copy-to-clipboard');
                copyButton.closest('[id^="notify-"]').filter(function() {
                    //Make sure we're putting it on the notification, not the notify-container
                    return /notify-\d+/.test(this.id);
                }).last().on('click', function(event) {
                    //Prevent the cv-pls GUI from closing for clicks within the notification.
                    event.stopPropagation();
                    event.preventDefault();
                });
                copyButton.last().on('click', function(event) {
                    event.stopPropagation();
                    event.preventDefault();
                    requestTextInput.select();
                    var success = document.execCommand('copy');
                    if (!success) {
                        alert('Failed to copy the request text! Please copy it manually.');
                        //Restore the selection and focus. (not normally needed, but doesn't hurt)
                        requestTextInput.select();
                        requestTextInput.focus();
                        //The GUI is left open here because we don't have a way to determine if the user is actually
                        //  done with the request.
                        callback(false);
                    } else {
                        //Copy succeeded.
                        removeSENotice(notificationId);
                        CVRGUI.hideMenus();
                        callback(true);
                    }
                });
            }

            function handleError(message, error) {
                var seeConsole = '<br/>See the console for more details.';
                console.error(message, error);
                displayRequestText(request, message + seeConsole);
            }

            //This needs to test using isSocvrRoomUrlRegEx rather than isCurrentRoomSOCVR(), as room.url *might* not be the "current room".
            if (!ignoreNonSOCVRSite && isSocvrRoomUrlRegEx.test(room.url) && !isSocvrSite) {
                //Don't send the request to SOCVR if this is not a site SOCVR moderates
                notify('Request not posted. SOCVR only moderates: ' + socvrModeratedSites.join(','), 0, notifyCSS.fail);
                callback(false);
                return;
            }
            if (configOptions.checkboxes.alwaysCharcoal && request.indexOf('!!/') === 0) {
                room = JSON.parse(JSON.stringify(knownRooms.charcoal.room));
            }
            GM.xmlHttpRequest({
                method: 'GET',
                url: room.url,
                onload: function(response) {
                    var matches = response.responseText.match(/hidden" value="([\dabcdef]{32})/);
                    var fkey = matches ? matches[1] : '';
                    if (!fkey) {
                        handleError('responseText did not contain fkey. Is the room URL valid?', response);
                        return false;
                    } // else
                    GM.xmlHttpRequest({
                        method: 'POST',
                        url: room.host + '/chats/' + room.id + '/messages/new',
                        headers: {
                            'Content-Type': 'application/x-www-form-urlencoded',
                        },
                        data: 'text=' + encodeURIComponent(request) + '&fkey=' + fkey,
                        onload: function(newMessageResponse) {
                            if (newMessageResponse.status !== 200) {
                                var responseText = newMessageResponse.responseText;
                                var shownResponseText = responseText.length < 100 ? ' ' + responseText : '';
                                handleError('Failed sending chat request message.' + shownResponseText, newMessageResponse);
                            } else {
                                notify('Request sent.', 3000, notifyCSS.sentSuccess);
                                removeOpenedAsDelayedRequestNotice();
                                CVRGUI.hideMenus();
                                callback(true);
                            }
                        },
                        onerror: function(error) {
                            handleError('Got an error when sending chat request message.', error);
                        },
                    });
                },
                onerror: function(response) {
                    handleError('Failed to retrieve fkey from chat. (Error Code: ' + response.status + ')', response);
                },
            });
        });
    }

    //Add methods and properties to the RoomList.
    RoomList.rooms = {};
    RoomList.defaultRoomUrl = currentSiteConfig.defaultRoom.url;
    setGlobalVariablesByConfigOptions();
    RoomList.save = function() {
        //Save the RoomList
        setGMStorage('rooms', JSON.stringify(this.rooms));
        console.log('Room list saved: ', getGMStorage('rooms'));
    };
    RoomList.each = function(callback) {
        //Execute the callback with each room.
        for (var i in this.rooms) {
            if (this.rooms.hasOwnProperty(i)) {
                callback(this.rooms[i], i);
            }
        }
        return this;
    };
    RoomList.search = function(key, value) {
        //Return the last matching room, searching by key/value pair.
        var success;
        this.each(function(room) {
            if (room[key] === value) {
                success = room;
            }
        });
        return success;
    };
    RoomList.count = function() {
        return Object.keys(this.rooms).length;
    };
    //Specific searches by key
    /* eslint-disable brace-style */ /* eslint-disable no-multi-spaces */
    /* beautify preserve:start */
    RoomList.name  = function(name)  { return this.search('name',  name);  };
    RoomList.index = function(index) { return this.search('index', index); };
    RoomList.id    = function(id)    { return this.search('id',    id);    };
    RoomList.url   = function(url)   { return this.search('url',   RoomList.useHttpsForStackExchangeAndTrim(url));};
    /* beautify preserve:end */
    /* eslint-enable brace-style */ /* eslint-disable no-multi-spaces */
    RoomList.insert = function(room) {
        //Add a chat room to the RoomList.
        if (!RoomList.url(room.url)) {
            this.rooms[room.url] = room;
            this.save();
        }
        return this.rooms[room.url];
    };
    RoomList.getRoom = function(callback, url) {
        //Get the chat room Object from the URL, with the current room as the default.
        //  If the URL does not match an Object already in the RoomList, the data is fetched from
        //  SE. URLs are also checked to verify that they match what we know what to handle (chat.(meta.)?(SO|SE).
        url = url ? url : getCurrentRoom();
        url = RoomList.useHttpsForStackExchangeAndTrim(url);
        var m = /(https?:\/\/chat\.(meta\.)?stack(overflow|exchange)\.com)\/rooms\/(.*)\/.*/.exec(url);
        if (m) {
            var room = RoomList.url(url);
            if (room) {
                if (typeof callback === 'function') {
                    callback(room);
                }
                return false;
            }
            //The URL does not match a room in the RoomList, fetch the data.
            GM.xmlHttpRequest({
                method: 'GET',
                url: url,
                onload: function(response) {
                    var name = /.*<title>(.*) \|.*/.exec(response.response);
                    if (!name) {
                        notify('Failed finding room name. Is it a valid room?', 0, notifyCSS.fail);
                        if (typeof callback === 'function') {
                            callback(false);
                        }
                    } else {
                        //Always insert the new room
                        var newRoom = RoomList.insert({
                            host: m[1],
                            url: url,
                            id: m[4],
                            name: name[1],
                        });
                        if (typeof callback === 'function') {
                            callback(newRoom);
                        }
                    }
                },
                onerror: function() {
                    if (url === currentSiteConfig.defaultRoom.url) {
                        //Problems communicating to the default room
                        //Should only get here if the user has network issues or SO has issues when first running the
                        //  script or when the user is re-adding the default after removing it.
                        const defaultInfo = knownRooms[currentSiteConfig.defaultRoomKey];
                        console.log('Unable to communicate with ' + defaultInfo.room.host.replace(/https?\/\//, '') + ' about ' + defaultInfo.room.name + ' to get initial room information. Adding default ' + defaultInfo.room.name + ' information.');
                        var newRoom = RoomList.insert(defaultInfo.room);
                        if (typeof callback === 'function') {
                            callback(newRoom);
                        }
                    } else {
                        notify('Failed retrieving room name. Is it a valid room?', 0, notifyCSS.fail);
                        if (typeof callback === 'function') {
                            callback(false);
                        }
                    }
                },
            });
        } else {
            //URL was not a valid chat room on SO/SE.
            console.log('Invalid URL: ', url);
            notify('The chat room URL you supplied is invalid: ' + url, 0, notifyCSS.fail);
            if (typeof callback === 'function') {
                callback(false);
            }
        }
    };
    RoomList.setRoom = function(url, callback) {
        //Set the current room. Fetches the room info if it doesn't exist in the RoomList
        url = RoomList.useHttpsForStackExchangeAndTrim(url);
        RoomList.getRoom(function(room) {
            if (room && getCurrentRoom() !== room.url) {
                setCurrentRoom(room.url);
            }
            if (typeof callback === 'function') {
                callback(room);
            }
        }, url);
    };
    RoomList.init = function() {
        //Initialize the Roomlist from storage.
        var rooms = getGMStorage('rooms');
        if (!rooms && !isStorageTransitionedA('rooms')) {
            //If GMStorage is completely invalid, and we haven't transitioned the localStorage, use localStorage.
            RoomList.changeToHttpsForStackExchange();
            rooms = getStorage('rooms');
            setGMStorage('rooms', rooms);
            markStorageTransitionedA('rooms');
        }
        if (!rooms) {
            RoomList.getRoom(RoomList.checkForNeededConsistency);
        } else {
            try {
                rooms = RoomList.changeStringToHttpsForStackExchangeAndNormalize(rooms);
                RoomList.rooms = JSON.parse(rooms);
                RoomList.checkForNeededConsistency();
            } catch (e) {
                //The rooms list storage is not valid JSON.
                RoomList.rooms = {};
                RoomList.getRoom(RoomList.checkForNeededConsistency);
            }
        }
        //GMStorage based room list is now loaded.
        if (!isStorageTransitionedA('rooms')) {
            //We have not yet transitioned localStorage rooms to GMStorage
            RoomList.changeToHttpsForStackExchange();
            RoomList.addRoomsObject(JSON.parse(getStorage('rooms')));
            markStorageTransitionedA('rooms');
        }
        RoomList.addKnownRoomsToRoomsList();
    };
    RoomList.addKnownRoomsToRoomsList = function() {
        const missingRooms = Object.keys(knownRooms).filter((key) => !RoomList.url(knownRooms[key].room.url));
        //XXX Should store that user changed the list and filter out any rooms which we have already added once (i.e. we've auto-added it, but the user deleted it).
        //  Doing so would permit the user to delete such rooms from their list, if they want to remove them. This would be beneficial
        //  for those who primarily use this script for specific rooms (e.g. just SOCVR, CRUDE, tavern, etc.).
        missingRooms.forEach((addRoomKey) => {
            //Only Rooms which are not already in the list. Add them to the RoomList.
            RoomList.insert(knownRooms[addRoomKey].room);
        });
    };
    RoomList.addRoomsObject = function(roomsObject) {
        //Add any rooms in the roomsObject that are not in RoomList.rooms to RoomList.rooms.
        Object.keys(roomsObject).filter(function(roomKey) {
            return !RoomList.url(roomsObject[roomKey].url);
        }).forEach(function(addRoomKey) {
            //Only Rooms which are not already in the list. Add them to the RoomList.
            RoomList.insert(roomsObject[addRoomKey]);
        });
    };
    RoomList.checkForNeededConsistency = function() {
        //Check for required consistency (enough so the UI will display & user can select a different room).
        //  This does not do a full consistency check of each room.
        function ifFalseUseDefaultRoom(dontSetDefault) {
            if (!dontSetDefault) {
                setCurrentRoom(RoomList.defaultRoomUrl);
                RoomList.getRoom();
            }
        }
        if (typeof RoomList.rooms !== 'object') {
            //Storage is corrupted, but was valid JSON
            RoomList.rooms = {};
            RoomList.getRoom(ifFalseUseDefaultRoom);
        } else {
            //Prune any invalid rooms from the list of rooms
            //  Currently the only check is that the room is an Object.
            RoomList.each(function(room, key) {
                if (typeof room !== 'object') {
                    delete RoomList.rooms[key];
                }
            });
            var keys = Object.keys(RoomList.rooms);
            if (!keys.length) {
                //No valid rooms. Try the current room URL, use default if fail.
                RoomList.getRoom(ifFalseUseDefaultRoom);
            } else {
                RoomList.getRoom(function(result) {
                    if (!result) {
                        //The current room is invalid. Try the default.
                        if (RoomList.url(RoomList.defaultRoomUrl)) {
                            setCurrentRoom(RoomList.defaultRoomUrl);
                        } else {
                            //Looks like the user deleted the default. Assume they knew what they were doing & use the first room found.
                            setCurrentRoom(keys[0]);
                        }
                    }
                });
            }
        }
    };
    RoomList.useHttpsForStackExchangeAndTrim = function(url) {
        //Change a SE/SO URL to HTTPS instead of HTTP.
        return /(https?:\/\/chat\.(meta\.)?stack(overflow|exchange)\.com)/.test(url) ? url.replace(/http:/ig, 'https:').replace(/(https:\/\/chat\.(?:meta\.)?stack(?:exchange|overflow)\.com\/rooms\/\d+)\b.*$/ig, '$1/') : url;
    };
    RoomList.changeStringToHttpsForStackExchangeAndNormalize = function(input) {
        // The RegExp is probably overly restrictive, as the rooms should never already contain non-stackexchange/stackoverflow URLs, as such are considered invalid.
        return input.replace(/http:\/\/chat\.(meta\.)?stack(exchange|overflow)\.com/ig, 'https://chat.$1stack$2.com').replace(/(https:\/\/chat\.(?:meta\.)?stack(?:exchange|overflow)\.com\/rooms\/\d+)\b[^"]*/ig, '$1/');
    };
    RoomList.changeToHttpsForStackExchange = function() {
        //Just change the JSON (pass it through parse/stringify to remove any duplicates & verify it's a valid format):
        // This function specifically uses getStorage/setStorage not GMStorage, as the enforcement of using HTTPS happened prior to moving to GMStorage.  Thus, we don't
        //   need to change GMStorage in bulk.
        try {
            setStorage('rooms', JSON.stringify(JSON.parse(RoomList.changeStringToHttpsForStackExchangeAndNormalize(getStorage('rooms')))));
        } catch (e) {
            //No storage or Invalid JSON in 'rooms'
            setStorage('rooms', JSON.stringify({}));
        }
        var roomStorage = getCurrentRoom();
        roomStorage = roomStorage ? roomStorage : '';
        setCurrentRoom(RoomList.useHttpsForStackExchangeAndTrim(roomStorage));
    };

    //Wrap storage access so that we avoid collisions with other scripts
    /* eslint-disable brace-style */
    /* beautify preserve:start */
    var prefix = 'SECloseVoteRequestGenerator_'; //prefix to avoid clashes in localStorage
    function getStorage(key) { return localStorage[prefix + key]; }
    function setStorage(key, val) { return (localStorage[prefix + key] = val); }
    function setStorageJSON(key, val) { return (localStorage[prefix + key] = JSON.stringify(val)); }
    //function removeStorage(key) { localStorage.removeItem(prefix + key); } //Not currently used
    function markStorageTransitionedA(key) { return setStorage('transitioned_A_' + key, true); }
    //function unmarkStorageTransitionedA(key) { return removeStorage('transitioned_A_' + key); } //Not currently used
    function isStorageTransitionedA(key) { return !!getStorage('transitioned_A_' + key); }
    function getGMStorage(key) { return GM_getValue(key); }
    function setGMStorage(key, val) { return GM_setValue(key, val); }
    function setGMStorageJSON(key, val) { return GM_setValue(key, JSON.stringify(val)); }
    /* beautify preserve:end */
    /* eslint-enable brace-style */

    function getStorageJSON(key) {
        //This is an async function because it's used interchangeably with getGMStorageJSON().
        //  Both need to return the same thing.
        var storageValue = getStorage(key);
        try {
            return JSON.parse(storageValue);
        } catch (e) {
            //Storage is not valid JSON
            return {};
        }
    }

    function getGMStorageJSON(key) {
        var storageValue = GM_getValue(key);
        try {
            return JSON.parse(storageValue);
        } catch (e) {
            //Storage is not valid JSON
            return {};
        }
    }

    function atomicObjectUpdate(storageKey, operation, data, localGm) {
        //Update an Object stored in either local or GM storage.
        //This is done by reading the value, modifying it and immediately storing it. It's
        //  done this way because the value may be accessed from multiple tabs. This should minimize, but not
        //  eliminate, race conditions. There is no method available to actually eliminate race conditions here.
        //Available operations:
        //  "assign"  add/change values (data must be an Object with key/value pairs).
        //  "delete"  delete a key. data can be string, Array or Object.
        //  function  First parameter is the storage Object. Return value is an Object: {
        //              changed: Boolean indicating if the data has changed.
        //              result: the Object to store.
        //            } If 'changed' is false, the data is not stored back.
        //data can be:
        //  String (unavailable for "assign")
        //  Array  (unavailable for "assign")
        //  Object
        //  function (Called with the storage Object. Return value is used as data.)
        var getValue = localGm === 'local' ? getStorageJSON : getGMStorageJSON;
        var setValue = localGm === 'local' ? setStorageJSON : setGMStorageJSON;
        var obj = getValue(storageKey);
        var changed = false;
        if (typeof operation === 'function') {
            var results = operation(obj);
            changed = results.changed;
            obj = results.result;
        } else {
            if (typeof data === 'function') {
                //Fetch the data to use.
                data = data(obj);
            }
            if (operation === 'assign') {
                if (typeof data !== 'object' || Array.isArray(data) || data === null) {
                    throw new Error('Atomic storage operation: data is invalid:' + data);
                }
                if (Object.keys(data).length > 0) {
                    //Only change if there's something being changed.
                    changed = true;
                    Object.assign(obj, data);
                }
            } else {
                //Loop through the keys to perform the operation on each value.
                data = typeof data === 'string' ? [data] : data;
                var keys = Array.isArray(data) ? data : Object.keys(data);
                if (keys.length > 0) {
                    changed = true;
                }
                keys.forEach(function(prop) {
                    if (operation === 'delete') {
                        delete obj[prop];
                    } else if (operation === 'assign') {
                        obj[prop] = data[prop];
                    }
                });
            }
        }
        if (changed) {
            //Only store the value back if it changed. Not doing so when it hasn't changed prevents
            //  cross-tab updating for no reason.
            setValue(storageKey, obj);
        }
        return obj;
    }

    function transitionToGMStorage(key) {
        //If there's not already something in GM storage, move the value from localStorage to GM storage.
        var gmStore = getGMStorage(key);
        var store = getStorage(key);
        if (typeof gmStore === 'undefined' && typeof store !== 'undefined' && !isStorageTransitionedA(key)) {
            setGMStorage(key, store);
        }
        markStorageTransitionedA(key);
        //In order to be backwards compatible, values are not actually removed from localStorage.
        //  A few versions from now, these values should be removed, along with the "mark transitioned" value.
        //removeStorage(key);
    }
    //Transition to using GM storage for LastAcknowledgedVersion:
    transitionToGMStorage('LastAcknowledgedVersion');

    //Make access to the current room easier
    /* eslint-disable brace-style */
    /* beautify preserve:start */
    var urlBase = 'https://' + window.location.hostname;
    function getCurrentRoom() { return getStorage(urlBase + 'room'); }
    function setCurrentRoom(url) { return setStorage(urlBase + 'room', url); }
    function markCurrentRoomTransitionedA() { return markStorageTransitionedA(urlBase + 'room'); }
    //function unmarkCurrentRoomTransitionedA(){return unmarkStorageTransitionedA(urlBase + 'room');} //Not currently used
    function isCurrentRoomTransitionedA() { return isStorageTransitionedA(urlBase + 'room'); }
    function isCurrentRoomSOCVR() { return isSocvrRoomUrlRegEx.test(getCurrentRoom()); }
    /* beautify preserve:end */
    /* eslint-enable brace-style */
    function getCurrentKnownRoomKey() {
        //Only return the first match.
        return Object.keys(knownRooms).find((key) => knownRooms[key].urlDetectionRegExp.test(getCurrentRoom()));
    }

    //Set the default room, if there is none.
    if (!getCurrentRoom()) {
        //If there's no current room, use the default.
        setCurrentRoom(RoomList.defaultRoomUrl);
    }
    setCurrentRoom(RoomList.useHttpsForStackExchangeAndTrim(getCurrentRoom()));
    //Switch once to the new default room on non-SOCVR sites (Charcoal HQ)
    if (onlySdSpamOffensive && !isCurrentRoomTransitionedA()) {
        //We have never transitioned this site's room. We only do this once per site.
        //This should probably be reset if the user disables & enables the Charcoal HQ option.
        //  i.e. when the user does that, we should again be changing away from SOCVR.
        markCurrentRoomTransitionedA();
        if (/https?:\/\/chat\.stackoverflow\.com\/rooms\/41570\b/.test(getCurrentRoom())) {
            //If we've already done it once, then it's assumed that the user has chosen to change
            //  the room back to SOCVR, even though that's not valid.
            setCurrentRoom(RoomList.defaultRoomUrl);
        }
    }

    //Initialize the RoomList
    RoomList.init();

    //Check for updates after everything else.
    setTimeout(checkUpdates, 0);

    //Add the CSS needed for the CV Request GUI.
    $(document.documentElement).append($('' +
        '<style id="cvrg-styles">' +
        '    .post-menu > span > a {' +
        '        padding:0 3px 2px 3px;' +
        '        color:#888;' +
        '    }' +
        '    .post-menu > span > a:hover {' +
        '        color:#444;' +
        '        text-decoration:none;' +
        '    } ' +
        '    .subheader.tools-rev span.cvrgui {' +
        '        top:12px;' +
        '        margin-left: 10px;' +
        '    } ' +
        '    .cvrgui {' +
        '        display:inline-block;' +
        '    } ' +
        '    .cvrgui * {' +
        '        box-sizing: border-box;' +
        '    } ' +
        '    .cv-list {' +
        '        display: none;' +
        '        margin:0;' +
        '        z-index:1002;' +
        '        position:absolute;' +
        '        white-space:nowrap;' +
        '        border:1px solid #ccc;' +
        '        border-radius:3px;' +
        '        background:#FFF;' +
        '        box-shadow:0px 5px 10px -5px rgb(0,0,0,0.5);' +
        '        left:15vw;' +
        '        width:70vw;' +
        '        max-width:700px;' +
        '    }' +
        '    .cv-list.cvrg-isDelayedRequest {' +
        '        border: 3px solid #20d020;' +
        '        top: calc(100% - 2px);' +
        '        left: -2px;' +
        '    }' +
        '    .cv-list dd, .cv-list dl {' +
        '        margin: 0;' +
        '        padding: 0;' +
        '    }' +
        '    .cv-list dl dd {' +
        '        padding: 0px;' +
        '        margin: 0;' +
        '        width: 100%;' +
        '        display: table;' +
        '    }' +
        '    .cv-list dl label, .cv-list dl form {' +
        '        display: table-cell;' +
        '    }' +
        '    .cv-list dl button {' +
        '        margin: 2.5px 0;' +
        '    }' +
        '    .cv-list dl label {' +
        '        width: 100%;' +
        '        padding: 0px;' +
        '    }' +
        '    .cv-list dd > div {' +
        '        padding: 0px 15px;' +
        '        padding-bottom: 15px;' +
        '    }' +
        '    .cv-list dd > div > form {' +
        '        white-space: nowrap;' +
        '    }' +
        '    .cv-list dd > div > form > input {' +
        '        display: inline-block;' +
        '        vertical-align: middle;' +
        '    }' +
        '    .cv-list dd > div > form > input[type="text"] {' +
        '        width: 300px;' +
        '        margin-right: 5px;' +
        '    }' +
        '    .cv-list hr {' +
        '        margin:0 15px;' +
        '        border: 0px;' +
        '        border-bottom: 1px solid #ccc;' +
        '    }' +
        '    .cv-list dd > a {' +
        '        display: block;' +
        '        padding: 10px 15px;' +
        '    }' +
        '    .cv-list label {' +
        '        display: inline-block;' +
        '        padding: 10px 15px;' +
        '    }' +
        '    .cv-list label:last-child {' +
        '        padding-left: 0;' +
        '    }' +
        '    .cv-list label.cvrgRequestType {' +
        '        display: block;' +
        '        padding: 5px 0px;' +
        '    }' +
        '    .cv-list div.cvrgOptionSubItem  {' +
        '        margin-left: 15px;' +
        '        padding: 5px 0px 5px 0px;' +
        '    }' +
        '    .cv-list .cvrgOptionSubItem > label {' +
        '        white-space: normal;' +
        '        padding-left: 1.5em;' +
        '        text-indent: -1.5em;' +
        '    }' +
        '    .cvrgOptionsList  {' +
        '        width: 350px;' +
        '    }' +
        '    .cvrgReasonRow {' +
        '        display: flex;' +
        '        width: 100%;' +
        '    }' +
        '    .cvrgReasonRow input[type="text"] {' +
        '        flex: auto;' +
        '        margin-right: 2vw;' +
        '    }' +
        '    .cvrgReasonRow input[type="submit"] {' +
        '        flex: initial;' +
        '    }' +
        '    .cv-list .cvrgRequestPreview * {' +
        '        display: inline;' +
        '        vertical-align: initial;' +
        '    }' +
        '    .cvrgRequestPreview, .cvrgRequestPreviewValidation {' +
        '        overflow-wrap: break-word;' +
        '        white-space:normal;' +
        '    }' +
        '    .cvrgRequestPreviewAndValidation {' +
        '        margin-top: 1em;' +
        '    }' +
        '    .cvrgRequestPreview {' +
        '        margin-top: .5em;' +
        '    }' +
        '    .cvrgRequestPreview {' +
        '        padding-left: 1em;' +
        '    }' +
        '    .cv-list .cvrgRequestPreview a.post-tag {' +
        '        display: inline-block;' +
        '    }' +
        '    .cv-list .cvrgRequestPreviewValidation {' +
        '        color: red;' +
        '        margin-top: 1em;' +
        '    }' +
        '    .cvrgRequestPreviewValidation {' +
        '        margin-top: 1em;' +
        '    }' +
        '    .cvrgRequestPreviewValidationInvalid {' +
        '        color: #8F5444;' +
        '    }' +
        '    .cvrgRequestPreviewValidationCritical {' +
        '        color: red;' +
        '    }' +
        '    .cvrgItemMainDiv form input[type=number] {' +
        '        width: 4.5em;' +
        '        margin-left: 2em;' +
        '        margin-right: .3em;' +
        '    }' +
        '    .cvrgItemMainDiv form input[type=number].cvrgDelayLengthNumber {' +
        '        margin-left: 1em;' +
        '    }' +
        '    .cvrgItemMainDiv form input[type=number].cvrgDelayLengthNumber:first-of-type {' +
        '        margin-left: 0em;' +
        '    }' +
        '    .cvrgItemMainDiv form input[type=number].cvrgDelayLengthDays {' +
        '        width: 5em;' +
        '    }' +
        '    .cvrgDelayLengthEndTimeSpan,' +
        '    .cvrgDelayLengthSpan {' +
        '        display: block;' +
        '        margin-top: .3em;' +
        '    }' +
        '    .cvrgDelayLengthEndTime {' +
        '        font-weight: bold;' +
        '    }' +
        '    .cvrgDelayLengthSpan {' +
        '        padding-left: 1em;' +
        '    }' +
        '    .cv-list input[type="submit"][value="Save"]:not([disabled]) {' +
        '        background-color: #20d020;' +
        '        color: #fff;' +
        '        border-color: #0c7;' +
        '        box-shadow: inset 0px 1px 0px #66ef66;' +
        '    } ' +
        '    .cv-list input[type="submit"][value="Save"]:hover {' +
        '        background-color: #4A4;' +
        '        border-color: #20d020;' +
        '        box-shadow: inset 0px 1px 0px #30d030;' +
        '    } ' +
        '</style>' +
        ''));

    //Constructors for the CV Request GUI.
    //  Each item in the GUI has a constructor which is called by the GUI constructor.

    //Send GUI Item
    function GuiItemSend(_gui, _guiType) {
        //The "Send request" portion of the dialog.
        this.gui = _gui;
        this.guiType = _guiType;
        this.item = $('' +
            '<dd>' +
            '    <a href="javascript:void(0)">Send request</a>' +
            '    <div class="cvrgItemMainDiv" style="display:none">' +
            '        <form>' +
            '            <div class="cvrgReasonRow">' +
            '                <input type="text" placeholder="Request reason" spellcheck="true" title="' + reasonTooltip + '" required/>' +
            '                <input type="submit" value="Send"/>' +
            '            </div>' +
            '            <label class="cvrgRequestType">' +
            '                Request Type: ' +
            '                <select name="requestType">' +
            '                    <option value="cv-pls" title="Close vote request">cv-pls</option>' + //Used only as the default. Replaced in populateSelectOptions
            '                </select>' +
            '            </label>' +
            '            <span class="cvrgDelayLengthSpan" style="display:none;">' +
            '                <input class="cvrgDelayLengthNumber cvrgDelayLengthDays" type="number" title="Number of days from now that you want to revisit this post." min="0" max="999" value="0">' +
            '                    Days' +
            '                </input>' +
            '                <input class="cvrgDelayLengthNumber cvrgDelayLengthHours" type="number" title="Number of hours from now that you want to revisit this post." min="0" max="23" value="0">' +
            '                    Hours' +
            '                </input>' +
            '                <input class="cvrgDelayLengthNumber cvrgDelayLengthMinutes" type="number" title="Number of minutes from now that you want to revisit this post." min="0" max="59" value="0">' +
            '                    Minutes' +
            '                </input>' +
            '            </span>' +
            '            <span class="cvrgDelayLengthEndTimeSpan" style="display:none;" title="A tab will automatically be opened with this post the first time you visit a page on which this userscript loads after this date/time.">' +
            '                Revisit after: ' +
            '                <span class="cvrgDelayLengthEndTime">' +
            '                </span>' +
            '            </span>' +
            '        </form>' +
            '        <div class="cvrgRequestPreviewAndValidation">' +
            '            <div class="cvrgRequestPreviewContainer">' +
            '                <span class="cvrgRequestPreviewHeadingSpan" style="display: none;" title="The preview does not currently render some chat formatting (e.g. [security.se] does not show as a link)."">Request Preview:</span>' +
            '                <div class="cvrgRequestPreview">' +
            '                </div>' +
            '            </div>' +
            '            <div class="cvrgRequestPreviewValidation">' +
            '                <div class="cvrgRequestPreviewValidationInvalid" style="display: none;" title="If this is not a revisit, then these problems will result in you having to confirm that you want to send the request.">' +
            '                </div>' +
            '                <div class="cvrgRequestPreviewValidationCritical" style="display: none;" title="These issues will need to be resolved prior to the script sending the request for you.">' +
            '                </div>' +
            '            </div>' +
            '        </div>' +
            '    </div>' +
            '    <hr>' +
            '</dd>' +
            '');
        var item = this.item;
        this.requestReasonInput = $('input[type="text"]', item);
        var requestTypeInput = this.requestTypeInput = $('select[name="requestType"]', item);
        requestTypeInput.val('cv-pls');
        var sendButton = this.sendButton = item.find('input[type="submit"]');
        this.populateSelectOptions();
        this.setRequestTypeByGuiButton();
        this.userChangedRequestType = false;
        this.requestPreviewAndValidation = item.find('.cvrgRequestPreviewAndValidation');
        this.requestPreview = item.find('.cvrgRequestPreview');
        this.requestPreviewHeadingSpan = item.find('.cvrgRequestPreviewHeadingSpan');
        this.requestPreviewValidation = item.find('.cvrgRequestPreviewValidation');
        this.requestPreviewValidationInvalid = item.find('.cvrgRequestPreviewValidationInvalid');
        this.requestPreviewValidationCritical = item.find('.cvrgRequestPreviewValidationCritical');
        var thisGuiItem = this; // eslint-disable-line consistent-this
        this.delayLengthSpan = item.find('.cvrgDelayLengthSpan');
        this.delayLengthEndTimeSpan = item.find('.cvrgDelayLengthEndTimeSpan');
        this.delayLengthEndTime = item.find('.cvrgDelayLengthEndTime');
        this.delayLengthDays = item.find('.cvrgDelayLengthDays');
        this.delayLengthHours = item.find('.cvrgDelayLengthHours');
        this.delayLengthMinutes = item.find('.cvrgDelayLengthMinutes');
        this.requestTypeInput.on('change', function() {
            //The type of request has changed.
            thisGuiItem.userChangedRequestType = true;
            thisGuiItem.adjustDisplayToRequestReason();
        });
        $('.cvrgDelayLengthNumber', this.item).on('change keyup click paste', this.updateDelayUntilTime.bind(this));
        this.reasonEdited = false;
        this.boundHandleReasonInput = this.handleReasonInput.bind(this);
        //User input for the request reason
        this.requestReasonInput.on('keyup paste input', this.debounceReasonInput.bind(this));
        $('form', this.item).on('submit', function(e) {
            //Submit the Request
            function htmlReasonArrayToText(array) {
                const textarea = document.createElement('textarea');
                textarea.innerHTML = array.join('\r\n\r\n').replace(/<br\/?>/g, '\r\n').replace(/<\/?(?:[abi]|code|span|div)\b[^>]*>/g, '');
                return textarea.value;
            }
            e.preventDefault();
            sendButton[0].disabled = true;
            var requestAndValidate = thisGuiItem.generateRequestAndValidate();
            var request = requestAndValidate.request;
            var invalidRequestReasons = requestAndValidate.invalidRequestReasons;
            var criticalRequestReasons = requestAndValidate.criticalRequestReasons;
            if (requestTypeInput.val().indexOf('revisit') === -1) {
                //Revisits are not validated.
                if (criticalRequestReasons.length) {
                    //Requests with critical issues will not be sent. However, revisits will be saved.
                    window.alert('This ' + requestTypeInput.val() + ' will not be sent because: \r\n\r\n' + htmlReasonArrayToText(criticalRequestReasons));
                    //XXX A red notify would be good here.
                    sendButton[0].disabled = false;
                    return false;
                } // else
                if (invalidRequestReasons.length) {
                    //The request is invalid and it's not a revisit. Ask the user if they are sure they want to send it.
                    if (!window.confirm('This ' + requestTypeInput.val() + ' may have issues because: \r\n\r\n' + htmlReasonArrayToText(invalidRequestReasons) + '\r\n\r\nAre you sure you want to ' + (delayableRequestRegex.test(requestTypeInput.val()) ? 'save' : 'send') + ' this request?')) {
                        sendButton[0].disabled = false;
                        return false;
                    }
                }
            }
            var actualRequestType = requestTypeInput.val();
            if (!actualRequestType) {
                notify('Request type not valid.', 3000, notifyCSS.fail);
                return;
            }
            if (delayableRequestRegex.test(actualRequestType)) {
                //This is a delayed request
                const delayInfo = thisGuiItem.getRequestDelayLength();
                const delayDays = delayInfo.delayDays;
                const delayText = delayInfo.delayText;
                //const delayMs = delayInfo.delayMs;
                if (typeof delayDays !== 'number') {
                    notify('Delayed request delay is not a number.', 3000, notifyCSS.fail);
                    return;
                }
                var requestType = thisGuiItem.getBaseRequestType();
                var itemId = _gui[_guiType + 'Id'];
                var requestId = thisGuiItem.generateRequestKey();
                var delayedRequest = new DelayedRequest(_guiType, itemId, requestType, request, delayDays);
                ifNotLockedGetLockOnGMStorageAndDo(delayedRequestStorage, function() {
                    //Got lock
                    atomicObjectUpdate(delayedRequestStorage, 'assign', {
                        [requestId]: delayedRequest,
                    });
                    releaseGMStorageLockIfOwner(delayedRequestStorage);
                    notify('Request saved. Will revisit in ' + delayText + '.', 3000, notifyCSS.saveSuccess);
                    removeOpenedAsDelayedRequestNotice();
                    removeListOfNotifications(thisGuiItem.notSavedNotifyList);
                    CVRGUI.hideMenus();
                    //Storing the actionTime here also is a bit of a hack, but allows us to tell the user when it's delayed
                    //  until without needing to retrieve the delayed requests, or keep an updated copy of them.
                    thisGuiItem.saveRequestInfo('delayed', 'quick', {delayedUntil: delayedRequest.actionTime});
                }, function() {
                    //Failed to get lock
                    const notSavedNotifyId = notify('Request NOT saved. Another tab was busy with the data structure. Please try again. Keep this tab open for > 1 minute and try again then.', 0, notifyCSS.fail);
                    if (!Array.isArray(thisGuiItem.notSavedNotifyList)) {
                        thisGuiItem.notSavedNotifyList = [];
                    }
                    thisGuiItem.notSavedNotifyList.push(notSavedNotifyId);
                    thisGuiItem.saveRequestInfo('triedToDelay', 'quick');
                });
            } else {
                sendRequest(request, function(success) {
                    if (success) {
                        thisGuiItem.saveRequestInfo('posted', 'quick');
                    } else {
                        thisGuiItem.saveRequestInfo('triedToPost', 'quick');
                    }
                });
            }
        });
        var requestForm = $('form', item);
        this.submit = function() {
            requestForm.submit();
        };
        //Provide direct access to some elements/methods from the main GUI
        _gui.requestReasonInput = this.requestReasonInput;
        _gui.requestTypeInput = this.requestTypeInput;
        _gui.submitRequest = this.submit;
        _gui.saveRequestInfo = this.saveRequestInfo.bind(this);
        //Check to see if a request for this post is pending.
        delayableRequestTypes.some(function(type) {
            //Only do the first one, if found
            var rememberedRequest = this.getRememberedRequest(type);
            if (rememberedRequest && rememberedRequest.state === 'pending') {
                setTimeout(function() {
                    //Open the GUI and set the request type.
                    _gui.showMenu();
                    _gui.openItem('send');
                    setTimeout(function() {
                        requestTypeInput.val(thisGuiItem.getFirstOptionValueOfType(type));
                        thisGuiItem.userChangedRequestType = true; //Prevent the request type from being changed away if GUI is closed and reopened.
                        thisGuiItem.adjustDisplayToRequestReason();
                        thisGuiItem.updateRequestInfo({
                            state: 'created',
                            delayedTime: '',
                        }, 'quick');
                        thisGuiItem.updatePreview();
                        openedAsDelayedRequestNoticeId.push(notify('This tab was opened for you to review sending a delayed ' + type + '.'));
                    }, 50);
                }, 100);
                return true;
            }
            return false;
        }, this);
    }
    Object.assign(GuiItemSend.prototype, {
        onopen: function() {
            // Display the "Send request" portion of the dialog.
            //Set the default type of request
            this.questionContext = getQuestionContext(this.gui.wrapper);
            this.populateSelectOptions();
            this.setRequestTypeByGuiButton();
            //If we don't have a remembered close vote reason, then get the reason from the close vote tooltip.
            var reasonInput = this.requestReasonInput;
            var rememberedReason = this.getRememberedRequest();
            if (reasonInput.val() === '') {
                if (rememberedReason && rememberedReason.reason) {
                    //Use any remembered reason as primary.
                    reasonInput.val(rememberedReason.reason);
                } else {
                    var closeQuestionLink = $('.close-question-link', this.questionContext).first();
                    if (closeQuestionLink.length) {
                        var closeVoteReason = /^You voted to close as '([^.]+)'\..*$/.exec(closeQuestionLink.first().attr('title') || '');
                        closeVoteReason = (closeVoteReason === null) ? '' : closeVoteReason[1];
                        //normalize the reasons
                        if (closeVoteReason === 'off-topic') {
                            //"off-topic" is an incomplete close vote reason.
                            // If that's all we know, leave the request reason blank to encourage the
                            // user to enter a more specific reason.
                            reasonInput.attr('placeholder', 'Request reason (you voted "off-topic:???")');
                            closeVoteReason = '';
                        }
                        if (closeVoteReason) {
                            const origCloseVoteReason = closeVoteReason;
                            closeVoteReason = reasons.substitutions[closeVoteReason[0]];
                            //If that fails...
                            closeVoteReason = closeVoteReason ? closeVoteReason : origCloseVoteReason.replace(/\b(\w)/g, (text) => text.toUpperCase());
                        }
                        reasonInput.val(closeVoteReason);
                    }
                }
            }
            addNoCodeToValueIfIsMcve(reasonInput);
            addNatoToValueIfIsNatoAndNotEmpty(reasonInput);
            //Clear some variables which we store because they only need to be calculated once, once the GUI is open.
            this.updateRequestInfoIfChanged('lock');
            lazyUpdateRememberedRequests();
            this.post = null;
            this.postUser = null;
            this.currentUserInQuestion = null;
            this.questionTitleText = null;
            this.postLinkHref = null;
            this.titleMarkdown = null;
            this.userLink = null;
            this.userMarkdown = null;
            this.postTime = null;
            this.closedTimeMs = null;
            this.isQuestionLocked = null;
            this.isQuestionBounty = null;
            this.questionRoombaInfo = null;
            this.questionRoombaDays = null;
            this.questionActiveTime = null;
            this.tag = null;
            //Complete setup
            if (!insertMarkdownReady) {
                //If the insertMarkdown is not ready, be sure that we update the preview once it's ready.
                $(window).on('cvrg-insertMarkdownReady', this.updatePreview.bind(this));
            }
            this.adjustDisplayToRequestReason();
            this.sendButton[0].disabled = false;
            this.currentRequestType = this.requestTypeInput.val();
        },
        onclose: function() {
            //When the Item is closed:
            if (this.reasonEdited && this.requestTypeInput.val()) {
                this.updateRequestInfoIfChanged('quick');
            }
            $(window).off('cvrg-insertMarkdownReady');
        },
        adjustDisplayToRequestReason: function() {
            //Adjust the display and store the old request reason when the request type is changed.
            var newRequestType = this.requestTypeInput.val();
            var newRememberedReason = this.getRememberedRequest();
            var oldRememberedReason = this.getRememberedRequest(this.currentRequestType);
            var cvplsRememberedReason = this.getRememberedRequest('cv-pls');
            var reason = this.requestReasonInput.val();
            var didChangeReason = false;
            if (reason) {
                if (this.reasonEdited && (!oldRememberedReason || oldRememberedReason.reason !== reason)) {
                    //Either no old reason, or the old reason doesn't exist.
                    //Cheat an update
                    this.requestTypeInput.val(this.currentRequestType);
                    this.updateRequestInfoReason('quick');
                    this.requestTypeInput.val(newRequestType);
                    didChangeReason = true;
                }
                if (newRememberedReason && newRememberedReason.reason) {
                    //Substitute in the remembered reason for this request type.
                    this.requestReasonInput.val(newRememberedReason.reason);
                }
            } else {
                //No reason currently
                if (newRememberedReason && newRememberedReason.reason) {
                    //There is one that's remembered
                    this.requestReasonInput.val(newRememberedReason.reason);
                } else {
                    if (newRequestType === 'del-pls' && cvplsRememberedReason && cvplsRememberedReason.reason) {
                        //There is a remembered cv-pls reason.
                        //  We use the remembered cv-pls reason because the normal transition is from cv-pls
                        //  to del-pls. The cv-pls should be copied over, at least in that case.
                        //  It's unclear if we want to restrict it to *only* that case.
                        this.requestReasonInput.val(cvplsRememberedReason.reason);
                        didChangeReason = true;
                    }
                }
            }
            let tmpRequestReason = this.requestReasonInput.val();
            //Add '(No Roomba: ...'
            if (this.guiType === 'question' && newRequestType === 'del-pls' && isQuestionClosed(this.questionContext) &&
                    (didChangeReason || !tmpRequestReason || (cvplsRememberedReason && tmpRequestReason === cvplsRememberedReason.reason)) && !/roomba/i.test(tmpRequestReason)) {
                let startParan = ' (';
                let endParan = ')';
                if (!tmpRequestReason) {
                    const questionStatusH2 = $('.question-status h2', this.questionContext);
                    if (questionStatusH2.length) {
                        let closedAsText = questionStatusH2.text().match(/\bas (.*?)(?: what you're asking)? by\b/)[1];
                        if (closedAsText.indexOf('off-topic') > -1) {
                            const questionStatusOffTopicReasonText = $('.question-status .close-as-off-topic-status-list li', this.questionContext).map(function() {
                                let reasonText = $('b, i', this).toArray().map((el) => el.textContent).join(' ').replace(/:/g, '');
                                //Convert to predetermined text, if applicable.
                                Object.keys(currentSiteConfig.offTopicScrapeMatch).some((key) => {
                                    if (reasonText.indexOf(key) > -1) {
                                        reasonText = reasons.get(currentSiteConfig.offTopicScrapeMatch[key]);
                                        return true;
                                    }
                                    return false;
                                });
                                return reasonText;
                            }).toArray().join(' / ');
                            closedAsText = questionStatusOffTopicReasonText ? questionStatusOffTopicReasonText : closedAsText;
                        }
                        if (closedAsText) {
                            tmpRequestReason = closedAsText;
                        }
                    }
                    if (!tmpRequestReason) {
                        startParan = '';
                        endParan = '';
                    }
                }
                const hasAccepted = !!$('.js-accepted-answer-indicator:not(.d-none):not(dno)', this.questionContext).length;
                const questionScore = +$('.question .js-vote-count', this.questionContext).text().trim();
                const numberPositiveScoreAnswers = $('.answer:not(.deleted-answer) .js-vote-count', this.questionContext).map(function() {
                    const votes = +this.textContent.trim();
                    if (votes < 1) {
                        return null;
                    }
                    return votes;
                }).length;
                const closeQuestionLink = $('.close-question-link', this.questionContext);
                const reopenVotes = closeQuestionLink.text().indexOf('reopen') > -1 ? +closeQuestionLink.find('.existing-flag-count').text() : 0;
                const roombaForecast = $('body.question-page #roombaField #roombaTableShort > tbody > tr > td:first-of-type b').text();
                const noRoomba = /\bNo\b/.test(roombaForecast || '');
                if (questionScore > 0 || hasAccepted || numberPositiveScoreAnswers || reopenVotes || (isQuestionPage && noRoomba)) {
                    let separation = '';
                    const additionalNoRoombaInfo = [
                        [questionScore > 0, ''], //Not showing anything due to people potentially taking it as a reason to down-vote.
                        [hasAccepted, 'accepted answer'],
                        [numberPositiveScoreAnswers, ''], //Not showing anything due to people potentially taking it as a reason to down-vote.
                        [reopenVotes, 'reopen vote'],
                    ].reduce((sum, [testValue, text]) => {
                        //If testValue is > 1, then we also use that to indicate the text should have an 's' appended.
                        if (testValue) {
                            const plural = testValue > 1 ? 's' : ''; //testValue will never be 0 here, but will be Boolean in some cases.
                            sum += (text ? `${separation}${text}${plural}` : '');
                            separation = sum ? '; ' : '';
                            return sum;
                        } //else
                        return sum;
                    }, '');
                    this.requestReasonInput.val(tmpRequestReason + `${startParan}No Roomba${(additionalNoRoombaInfo  ? ': ' : '')}${additionalNoRoombaInfo}${endParan}`);
                    tmpRequestReason += `${startParan}No Roomba${(additionalNoRoombaInfo  ? ': ' : '')}${additionalNoRoombaInfo}${endParan}`;
                }
                this.requestReasonInput.val(tmpRequestReason);
            }
            this.updateDelayUntilTime();
            this.currentRequestType = newRequestType;
            this.setInputAttributesByRequestType();
            this.reasonEdited = false;
            this.updatePreview();
        },
        setRequestTypeByGuiButton: function() {
            //Set the request type based on the text displayed in the button the user clicked to open the GUI.
            var requestType = this.gui.button.text();
            if (requestType === 'reopen/del-pls') {
                if ($('.question .js-vote-up-btn.fc-theme-primary', this.questionContext).length) {
                    //User has voted-up the question, so this is likely a reopen-pls.
                    requestType = 'reopen-pls';
                } else {
                    //Unfortunately, the most common type of request for closed questions.
                    requestType = 'del-pls';
                }
            }
            if (requestType === 'sd-report') {
                requestType = '!!/report';
            }
            if (requestType === 'review-pls') {
                requestType = 'review-pls';
            }
            if (!this.userChangedRequestType) {
                this.requestTypeInput.val(requestType);
            }
        },
        updateDelayUntilTime: function() {
            const delayInfo = this.getRequestDelayLength();
            if (delayInfo) {
                const delayUntilDate = new Date(delayInfo.delayUntil);
                this.delayLengthEndTime.text(`${delayUntilDate.toLocaleString()} (${delayUntilDate.toLocaleString(void (0), {weekday: 'long'})})`);
            }
        },
        getRequestDelayLength: function() {
            var actualRequestType = this.requestTypeInput.val();
            if (delayableRequestRegex.test(actualRequestType)) {
                var delayDays = +(actualRequestType.match(delayableRequestRegex) || ['', ''])[1];
                var delayMs = delayDays * 24 * 60 * 60 * 1000;
                var delayText = delayDays + ' days';
                var days = delayDays;
                var hours = 0;
                var minutes = 0;
                if (actualRequestType === 'revisit (in N days)') {
                    days = +this.delayLengthDays.val();
                    hours = +this.delayLengthHours.val();
                    minutes = +this.delayLengthMinutes.val();
                    delayMs = ((((days * 24) + hours) * 60) + minutes) * 60 * 1000;
                    delayDays = delayMs / (24 * 60 * 60 * 1000);
                    delayText = ((days ? (days + ' day' + (days !== 1 ? 's' : '') + ' ') : '') + (hours ? (hours + ' hour' + (hours !== 1 ? 's ' : ' ')) : '') + (minutes ? (minutes + ' minute' + (minutes !== 1 ? 's' : '')) : '')).replace(/ +/g, ' ').trim();
                }
                if (typeof delayDays !== 'number') {
                    notify('Delayed request delay is not a number.', 3000, notifyCSS.fail);
                    return null;
                }
                const delayUntil = Date.now() + delayMs;
                return {
                    delayMs,
                    delayDays,
                    delayUntil,
                    delayText,
                    days,
                    hours,
                    minutes,
                };
            }
            return null;
        },
        getFirstOptionValueOfType: function(type) {
            return this.item.find('select[name="requestType"] option[value*=' + type + ']').first().val();
        },
        populateSelectOptions: function() {
            //Add the request type options which are appropriate for the current state.
            var requestType = this.requestTypeInput.val();
            var isGuiAnswer = this.guiType === 'answer';
            var isGuiQuestion = this.guiType === 'question';
            var isGuiReviewSE = this.guiType === 'reviewSE';
            var isSOCVR = isCurrentRoomSOCVR();
            //XXX This should really be turned into a data structure driven constructor.
            /* eslint-disable no-nested-ternary */ //disable the check until this is re-written
            this.item.find('select[name="requestType"]').first().html(// eslint-disable-line function-paren-newline
                (onlySdSpamOffensive ? '' : isGuiQuestion ? '<option value="cv-pls" title="Close vote request">cv-pls</option>' : '') +
                (onlySdSpamOffensive ? '' : (isGuiQuestion || isGuiAnswer) ? '<option value="del-pls" title="Delete vote request">del-pls</option>' : '') +
                (onlySdSpamOffensive ? '' : isGuiQuestion ? '<option value="reopen-pls" title="Reopen vote request">reopen-pls</option>' : '') +
                (onlySdSpamOffensive ? '' : (isGuiQuestion || isGuiAnswer) ? '<option value="undel-pls" title="Undelete vote request">undel-pls</option>' : '') +
                (onlySdSpamOffensive ? '' : isGuiReviewSE ? '<option value="review-pls" title="Review this review queue task.">review-pls</option>' : '') +
                //Revisits are permitted on all posts, but not reviews. Need to test to see if it works on answers.
                ((isGuiQuestion || isGuiAnswer) ? '<option value="revisit (in 2 days)" title="Revisit the post 2 days from now. Use this for questions which do not currently qualify for delete votes, as any question can be delete-voted by 10k+ users after being closed for 2 days. Revisits are only checked for when you load a page where this script is active">revisit (in 2 days)</option>' : '') +
                ((isGuiQuestion || isGuiAnswer) ? '<option value="revisit (in 11 days)" title="Revisit the post 11 days from now. Example: verify a question is deleted by the Roomba. For instance, if a question has an answer which might be accepted (preventing it from being Roomba\'d), then you can check that it was actually deleted.">revisit (in 11 days)</option>' : '') +
                ((isGuiQuestion || isGuiAnswer) ? '<option value="revisit (in N days)" title="Revisit the post N days from now.">revisit (in N days)</option>' : '') +
                (onlySdSpamOffensive ? '' : isGuiAnswer ? '<option value="reflag NAA" title="">reflag NAA</option>' : '') +
                (onlySdSpamOffensive ? '' : (isGuiQuestion || isGuiAnswer) ? '<option value="reflag VLQ" title="">reflag VLQ</option>' : '') +
                (!isGuiReviewSE ? '<option value="spam" title="Spam flag request">spam</option>' : '') +
                (!isGuiReviewSE ? '<option value="offensive" title="Rude/offensive flag request">offensive</option>' : '') +
                ((((isSOCVR && (configOptions.checkboxes.canReportSmokeDetectorSOCVR || configOptions.checkboxes.alwaysCharcoal)) || (!isSOCVR && !isKnownSite && configOptions.checkboxes.canReportSmokeDetectorOther) || onlySdSpamOffensive || configOptions.checkboxes.alwaysCharcoal) && (this.guiType === 'answer' || this.guiType === 'question')) ? '' +
                    '<option value="!!/report" title="Report this post to SmokeDetector">!!/report</option>' +
                    '<option value="!!/report-force" title="Report this post to SmokeDetector">!!/report-force</option>' +
                    '<option value="!!/scan" title="Have SmokeDetector scan this post">!!/scan</option>' +
                    '<option value="!!/scan-force" title="Report this post to SmokeDetector">!!/scan-force</option>' +
                    '<option value="!!/addblu-" title="Have SmokeDetector add the user to the blacklist.">!!/addblu-</option>' +
                    '<option value="!!/rmblu-" title="Have SmokeDetector remove the user from the blacklist.">!!/rmblu-</option>' +
                    '<option value="!!/addwlu-" title="Have SmokeDetector add the user to the whitelist.">!!/addwlu-</option>' +
                    '<option value="!!/rmwlu-" title="Have SmokeDetector remove the user from the whitelist.">!!/rmwlu-</option>' +
                    //SOCVR does not permit reporting of users. See room meeting: https://socvr.org/room-info/room-meetings/2016-08 and https://chat.stackoverflow.com/transcript/message/32060005#32060005
                    ((isSOCVR && !configOptions.checkboxes.alwaysCharcoal) ? '' : '<option value="!!/reportuser" title="Report this post\'s author to SmokeDetector (all their posts are spam).">!!/reportuser</option>') +
                    '' : ''));
            /* eslint-enable no-nested-ternary */
            //Restore the request type, which would have been cleared by reconstructing the <option> elements.
            this.requestTypeInput.val(requestType);
        },
        debounceReasonInput: function() {
            //We listen for multiple events, which all could fire for the same user action. However, we should
            //  only actually do processing once per user action. It's also OK for us to lag a slight amount
            //  behind user action (i.e. we don't need to process *every* action, just the last in a sequence
            //  of actions).
            clearTimeout(this.reasonInputTimeout);
            this.reasonInputTimeout = setTimeout(this.boundHandleReasonInput, 100);
        },
        handleReasonInput: function() {
            //An event occurred indicating the request reason changed.
            this.reasonEdited = true;
            this.updatePreview();
        },
        generateRequestKey: function(requestType) {
            //Generate the key under which the request is stored. The key looks like:
            //  stackoverflow.com-cv-pls-question-123456
            //  or
            //  stackoverflow.com-del-pls-answer-123456
            requestType = requestType ? requestType : this.getBaseRequestType();
            var itemId = this.gui[this.guiType + 'Id'];
            return location.hostname + '-' + requestType + '-' + this.guiType + '-' + itemId;
        },
        getRememberedRequest: function(requestType) {
            //If a remembered request exists, get the data.
            return rememberedRequests[this.generateRequestKey(requestType)];
        },
        getBaseRequestType: function() {
            // This is used to make it such that we don't actually store separate requests
            // for types which differ from other types only in that they are delayed.
            // e.g. a 'del-pls' uses the same storage key as a 'del-pls (in n days)'.
            // Testing:
            var toReturn;
            try {
                toReturn = this.requestTypeInput.val();
                toReturn = toReturn ? toReturn : 'cv-pls';
                toReturn = toReturn.replace(delayableRequestRegex, '');
            } catch (e) {
                toReturn = 'cv-pls';
                console.trace();
                console.error('Got invalid data for requestTypeInput.val()');
                console.error(e);
            }
            toReturn = toReturn.replace(delayableRequestRegex, '');
            return toReturn;
            //*/ end testing. Uncomment next line when removing testing code.
            //return this.requestTypeInput.val().replace(delayableRequestRegex, '');
        },
        updateRequestInfoReason: function(quick, data) {
            //Update the reason for the request, and perhaps additional data.
            var updated = {
                reason: this.requestReasonInput.val(),
            };
            if (data) {
                Object.assign(updated, data);
            }
            this.updateRequestInfo(updated, quick);
        },
        updateRequestInfoIfChanged: function(quick, data) {
            //If the request reason has changed, then update the stored reason.
            var rememberedReason = this.getRememberedRequest();
            if (data || ((!rememberedReason || rememberedReason.reason !== this.requestReasonInput.val()) && (this.reasonEdited || this.requestReasonInput.val()))) {
                this.updateRequestInfoReason(quick, data);
            }
        },
        updateRequestInfo: function(data, quick) {
            //Update the data stored for a request.
            var rememberedReason = this.getRememberedRequest();
            if (!rememberedReason) {
                rememberedReason = new RequestInfo(this.guiType, this.gui[this.guiType + 'Id'], this.getBaseRequestType(), this.requestReasonInput.val(), 'created');
            }
            var requestKey = this.generateRequestKey();
            Object.assign(rememberedReason, data);
            var now = Date.now();
            rememberedReason.updatedTime = now;
            var state = rememberedReason.state;
            if (requestInfoStateWithMatchingTime.indexOf(state) > -1) {
                rememberedReason[state + 'Time'] = now;
            }
            var toStore = {
                [requestKey]: rememberedReason,
            };
            if (configOptions.numbers.daysRememberRequests) {
                quickLockOrRetryGMStorageAtomicUpdate(quick, rememberedRequestStorage, 'assign', toStore);
            }
            Object.assign(rememberedRequests, toStore);
        },
        saveRequestInfo: function(state, quick, extra) {
            //Save information for the current request.
            var requestData = new RequestInfo(this.guiType, this.gui[this.guiType + 'Id'], this.getBaseRequestType(), this.requestReasonInput.val(), state);
            if (requestInfoStateWithMatchingTime.indexOf(state) > -1) {
                requestData[state + 'Time'] = Date.now();
            }
            if (typeof extra === 'object' && extra !== null) {
                Object.assign(requestData, extra);
            }
            var requestKey = this.generateRequestKey();
            var toStore = {
                [requestKey]: requestData,
            };
            if (configOptions.numbers.daysRememberRequests) {
                quickLockOrRetryGMStorageAtomicUpdate(quick, rememberedRequestStorage, 'assign', toStore);
            }
            Object.assign(rememberedRequests, toStore);
        },
        updatePreview: function() {
            function arrayToUnorderedListAndToggleVisibility(element, toPluralizePreText, preText, array) {
                const htmlText = toPluralizePreText + (array.length === 1 ? '' : 's') + preText + `<ul><li>${(array.join('</li><li>'))}</li></ul>`;
                element.html(htmlText).toggle(!!array.length);
            }
            //Remove everything from the preview div.
            this.requestPreview[0].textContent = '';
            var requestAndValidate = this.generateRequestAndValidate();
            var request = requestAndValidate.request;
            var invalidRequestReasons = (requestAndValidate.invalidRequestReasons || []);
            var criticalRequestReasons = (requestAndValidate.criticalRequestReasons || []);
            this.requestPreview[0].dispatchEvent(new CustomEvent('cvrg-insertMarkdownInTarget', {
                bubbles: true,
                cancelable: true,
                detail: request,
            }));
            var preview = this.requestPreview.find('*');
            if (preview.length) {
                this.requestPreview.show();
                this.requestPreviewHeadingSpan.show();
            } else {
                this.requestPreview.hide();
                this.requestPreviewHeadingSpan.hide();
            }
            if (invalidRequestReasons.length || criticalRequestReasons.length) {
                arrayToUnorderedListAndToggleVisibility(this.requestPreviewValidationInvalid, 'Warning', ' / Information:', invalidRequestReasons);
                arrayToUnorderedListAndToggleVisibility(this.requestPreviewValidationCritical, 'Error', ':', criticalRequestReasons);
                this.requestPreviewValidation.show();
            } else {
                this.requestPreviewValidation.hide();
            }
            if ((this.requestTypeInput.val() || '').indexOf('revisit') > -1) {
                //It's a revisit, so it's never considered a critical problem.
                this.requestPreviewValidation.toggle(!!invalidRequestReasons.length);
                this.requestPreviewValidationCritical.html('').hide();
            }
        },
        generateRequestAndValidate: function() {
            //Generate the markdown for the request and validate the request.
            var reason = this.requestReasonInput.val();
            var actualRequestType = this.requestTypeInput.val();
            var requestType = this.getBaseRequestType();
            var isDelayedRequest = delayableRequestRegex.test(actualRequestType);
            var isDelayedRequestAndNotAutoSend = isDelayedRequest && configOptions.checkboxes.automaticlyPostDelayedRequests;
            var invalidRequestReasons = [];
            var criticalRequestReasons = [];
            var reasonRequired = false;
            const rememberedReason = this.getRememberedRequest();
            if (rememberedReason) {
                let timeKey = '';
                if (rememberedReason.postedTime) {
                    timeKey = 'postedTime';
                    const requestDate = new Date(rememberedReason[timeKey]);
                    invalidRequestReasons.push(`You posted a ${rememberedReason.requestType} on ${requestDate.toLocaleString()} (${requestDate.toLocaleString(void (0), {weekday: 'long'})})`);
                } else if (rememberedReason.delayedTime && rememberedReason.delayedUntil > Date.now()) {
                    timeKey = 'delayedTime';
                    const untilDate = new Date(rememberedReason.delayedUntil);
                    const until = `${untilDate.toLocaleString()} (${untilDate.toLocaleString(void (0), {weekday: 'long'})})`;
                    const requestDate = new Date(rememberedReason[timeKey]);
                    invalidRequestReasons.push(`Scheduled ${rememberedReason.requestType}: <b>${until}</b>.</br>Last modified on ${requestDate.toLocaleString()} (${requestDate.toLocaleString(void (0), {weekday: 'long'})})`);
                }
            }
            if (!this.requestTypeInput.find('option').length) {
                //There are no request types available.
                criticalRequestReasons.push('The options you\'ve selected result in no request types.');
                return {
                    request: '',
                    invalidRequestReasons,
                    criticalRequestReasons,
                };
            }
            if (requestTypesWithNoReason.indexOf(requestType) === -1 && requestTypesWithOptionalReason.indexOf(requestType) === -1 && !delayableRequestRegex.test(actualRequestType)) {
                reasonRequired = true;
                if (!reason.trim() || !requestType) {
                    criticalRequestReasons.push('This request requires a reason.');
                    return {
                        request: '',
                        invalidRequestReasons,
                        criticalRequestReasons,
                    };
                }
            }
            const isSOCVR = isCurrentRoomSOCVR();
            var isGuiReviewSE = this.guiType === 'reviewSE';
            //Perform single character substitutions.
            reason = reasons.get(reason);
            reason = addNatoIfIsNato(reason);
            //Questions and Answers
            var questionContext = this.questionContext;
            if (!questionContext) {
                this.questionContext = questionContext = getQuestionContext(this.gui.wrapper);
            }
            var post = this.post;
            if (!post) {
                this.post = post = isGuiReviewSE ? questionContext : this.item.closest('.' + this.guiType);
            }
            //The #popup-close-question is earlier in the DOM than the signature if we are wanting
            //  the question for which the close dialog is open (i.e. when the send cv-pls checkbox is checked).
            var postUser = this.postUser;
            if (!postUser) {
                postUser = this.item.closest('.grid').children('.post-signature:last-of-type');
                if (isNatoWithoutEnhancement) {
                    postUser = this.item.closest('td').find('.user-info');
                }
                if (isGuiReviewSE) {
                    postUser = this.item.closest('#content').find('.user-info-actions .post-signature:last-of-type');
                }
                this.postUser = postUser;
            }
            if (!this.currentUserInQuestion) {
                //We don't want to consider any questions/answers which are not in the same question context.
                //this.currentUserInQuestion = $('td.post-signature:last-of-type .user-details a[href="' + currentUserHref + '"]', questionContext).filter(function() {
                //XXX SE Changed HTML prior o 2018-03-03 Need to test
                //May, or may not need .grid--cell
                this.currentUserInQuestion = $('.grid--cell.post-signature:last-of-type .user-details a[href="' + currentUserHref + '"]', questionContext).filter(function() {
                    return getQuestionContext(this)[0] === questionContext[0];
                });
                //Does not differentiate between answers which are deleted as a result of the question being deleted
                //  and individually deleted (i.e. answers which would be active if a undel-pls was complete on the question).
                this.currentUserInQuestionNotDeletedAnswers = this.currentUserInQuestion.filter(function() {
                    return $(this).closest('.answer.deleted-answer').length === 0;
                });
            }
            //Get question title.
            //Works for review pages and within the Close Dialog question preview
            var questionTitleText = this.questionTitleText;
            var questionTitle = this.questionTitle;
            if (!questionTitleText || !questionTitle) {
                if (questionContext.is('#mainbar')) {
                    //The main question:
                    questionTitle = $('#question-header h1 a').first();
                } else {
                    //Everything else has the question title within the .question context
                    // Most other places: .question-hyperlink
                    // NATO (has no classes on the title or DOM leading to it): h1 a
                    questionTitle = $('.question-hyperlink,h1 a', questionContext).first();
                }
                if (isNatoWithoutEnhancement) {
                    questionTitle = $('.answer-hyperlink', questionContext).first();
                }
                if (isGuiReviewSE) {
                    questionTitle = $('.question-hyperlink,.answer-hyperlink', questionContext).first();
                }
                this.questionTitle = questionTitle;
                questionTitleText = questionTitle.text();
                if (questionTitle.find('.MathJax').length) {
                    //MathJax messes up the question title, so use one that's been saved, if available.
                    const titleInData = questionTitle.data('origText');
                    if (titleInData) {
                        questionTitleText = titleInData;
                    }
                }
                if (window.location.pathname === '/review/custom' || window.location.pathname === '/review/MagicTagReview') {
                    //Magic Tag
                    questionTitleText = questionTitleText.replace(/\s*-\s*(?:open|closed)\s*-\s*\d+\s*-\s*\d+\s*$/, '');
                }
                //Remove on hold, closed, duplicate
                questionTitleText = questionTitleText.replace(/ \[(?:on hold|closed|duplicate)\]$/i, '');
                this.questionTitleText = questionTitleText;
            }
            //Get the link for the post
            var postLinkHref = this.postLinkHref;
            if (!postLinkHref) {
                if (isGuiReviewSE) {
                    postLinkHref = questionTitle.attr('href');
                    if (postLinkHref.indexOf('#') === -1) {
                        postLinkHref = postLinkHref.replace(/(\/\d+)\/[^/]*/, '$1');
                    } else {
                        postLinkHref = '/a/' + postLinkHref.match(/#(\d+)$/)[1];
                    }
                } else {
                    postLinkHref = $('.js-share-link', post).attr('href');
                    if (!postLinkHref) {
                        var postId = post.data(this.guiType + 'id');
                        postLinkHref = '/' + this.guiType[0] + '/' + postId;
                    }
                    //Remove the user ID portion of the share link, so duplicate posts count as ":visited" to the browser.
                    postLinkHref = postLinkHref.replace(/(\/\d+)\/\d+$/, '$1');
                }
                //Add domain and scheme
                if (postLinkHref.indexOf('/') === 0) {
                    postLinkHref = urlBase + postLinkHref;
                }
                this.postLinkHref = postLinkHref;
            }
            //Generate markdown for the title
            var titleMarkdown = this.titleMarkdown;
            if (!titleMarkdown) {
                //Question title can be RTL... need to insert a LTR Override marker to have proper direction (it still won't look quite correct, but it'll be better).
                this.titleMarkdown = titleMarkdown = ((this.guiType === 'answer' || (isGuiReviewSE && questionTitle.is('.answer-hyperlink'))) ? 'Answer to: ' : '') + createMarkdownLinkWithText(questionTitleText, postLinkHref);
            }
            //Get the user name for the author of the post a link to their profile
            var userLink = this.userLink;
            var userMarkdown = this.userMarkdown;
            if (!userLink || !userMarkdown) {
                var userDetails = postUser.find('.user-details');
                var userName = '';
                if (postUser.length && !userDetails.length && /by\san\sanonymous\suser/.test(postUser.text())) {
                    //Anonymous user
                    userName = 'an anonymous user';
                } else {
                    userName = userDetails.children('*:not(.d-none):not(.-flair)').text().trim().match(/[^\n]+/);
                    userName = userName ? userName[0].trim() : '';
                    //The username can be RTL... need to insert a LTR Override marker to have proper direction (it still won't look quite correct, but it'll be better).
                    //  This is done when creating the Markdown for any link.
                }
                this.userLink = userLink = postUser.find('a');
                const userLinkHref = userLink.first().attr('href');
                if (!userLink.length || (userName === 'community wiki' && /posts\/\d+\/revisions/.test(userLinkHref))) {
                    this.userMarkdown = userMarkdown = userName;
                } else {
                    this.userMarkdown = userMarkdown = createMarkdownLinkWithText(userName, urlBase + userLinkHref);
                }
            }
            //Time the answer/question was posted
            var postTime = this.postTime;
            if (!postTime) {
                var userTime = postUser.find('.relativetime');
                this.postTime = postTime = userTime.length ? ' ' + userTime.attr('title') : '';
            }
            //Time the question was active, if a question page.
            var questionActiveTime = this.questionActiveTime;
            if (!questionActiveTime && questionActiveTime !== false) {
                if (isQuestionPage) {
                    //If the question has never had "activity" then the last active time is the time the post was made.
                    //  Unless the only activity is deleted answers.
                    const deletedAnswers =  $('.answer.deleted-answer', questionContext);
                    const mostRecentDeletedAnswerTime = deletedAnswers.find('.post-signature:last-of-type .relativetime').toArray()
                        .reduce((maxTime, timeEl) => (timeEl.title ? Math.max((new Date(timeEl.title.trim().replace(/ /, 'T'))).valueOf(), maxTime) : maxTime), 0);
                    let activityLink = $('#sidebar #qinfo .lastactivity-link');
                    if (activityLink.length === 0) {
                        //For question activity link under the question title.
                        const underTitleQuestionStatus = $('#question-header ~ div.grid').first();
                        if (underTitleQuestionStatus.length > 0) {
                            activityLink = underTitleQuestionStatus.children('.grid--cell').filter(function() {
                                return $(this).text().trim().startsWith('Active');
                            }).find('a');
                        }
                    }
                    const activityTimeText = (activityLink.length ? activityLink.attr('title') : postTime).trim().replace(/ /, 'T');
                    const activityTime = activityTimeText ? (new Date(activityTimeText)).valueOf() : 0;
                    const activeTime = Math.max(mostRecentDeletedAnswerTime, activityTime);
                    this.questionActiveTime = questionActiveTime = activeTime ? activeTime : false;
                } else {
                    this.questionActiveTime = questionActiveTime = false;
                }
            }
            //Request Validation: Check to see if this request is obviously invalid.
            //  Conflated in the request validation is determining if the request requires 20k+ reputation.
            //Determine if this needs to be tagged as a 20k+ request.
            var isTag20k = false;
            var closedTimeMs = this.closedTimeMs;
            var isQuestionLocked = this.isQuestionLocked;
            if (closedTimeMs === null || isQuestionLocked === null) {
                closedTimeMs = 0;
                isQuestionLocked = false;
                $('.special-status .question-status H2 B', questionContext).each(function() {
                    var $this = $(this);
                    if (/hold|closed|marked/i.test($this.text())) {
                        closedTimeMs = Date.parse($this.parent().parent().find('span.relativetime').attr('title').replace(' ', 'T'));
                    }
                    if (/locked/i.test($this.text())) {
                        isQuestionLocked = true;
                    }
                });
                this.closedTimeMs = closedTimeMs;
                this.isQuestionLocked = isQuestionLocked;
            }
            var isQuestionBounty = this.isQuestionBounty;
            if (isQuestionBounty === null) {
                isQuestionBounty = $('.question-status.bounty', questionContext).length > 0;
                this.isQuestionBounty = isQuestionBounty;
            }
            var questionRoombaInfo = this.questionRoombaInfo;
            var questionRoombaDays = this.questionRoombaDays;
            if (questionRoombaInfo === null || questionRoombaDays === null) {
                questionRoombaInfo = $('body.question-page #roombaTableShort td:first-of-type, body.question-page #roombaField > b').text();
                this.questionRoombaInfo = questionRoombaInfo;
                questionRoombaDays = parseInt(questionRoombaInfo.replace(/^\D*(\d*)\D*$/, '$1'), 10);
                this.questionRoombaDays = questionRoombaDays;
            }
            if (isQuestionLocked) {
                criticalRequestReasons.push('The question is locked.');
            } else {
                if (requestType === 'del-pls' || requestType === 'undel-pls') {
                    var isDeleteUndelete = true;
                    if (requestType === 'undel-pls') {
                        //Undelete
                        if (!post.is('.deleted-answer')) {
                            //Is not deleted
                            criticalRequestReasons.push('The ' + this.guiType + ' is not deleted.');
                        } else {
                            //Is deleted
                            if (this.guiType === 'answer') {
                                isTag20k = true;
                            }
                        }
                    } else {
                        //Delete requests
                        if (post.is('.deleted-answer')) {
                            //Is already deleted
                            criticalRequestReasons.push('The ' + this.guiType + ' is already deleted.');
                        } else {
                            var postScore = +$('.js-vote-count', post).first().text();
                            if (this.guiType === 'answer') {
                                isTag20k = true;
                                //On NATO without NATO Enhancements, we don't verify the answer's score. We could do a SE API call to get it, but don't do so.
                                if (!isNatoWithoutEnhancement && postScore > -1) {
                                    invalidRequestReasons.push('Answers must be at a score &lt;= -1.');
                                }
                            } else if (this.guiType === 'question') {
                                if (!isQuestionClosed(questionContext)) {
                                    if (!isDelayedRequestAndNotAutoSend) {
                                        criticalRequestReasons.push('Questions must be closed prior to deleting.');
                                    }
                                } else {
                                    var twoDaysInMs = 2 * 24 * 60 * 60 * 1000;
                                    if (!isDelayedRequest && (Date.now() - closedTimeMs) <= twoDaysInMs) {
                                        //For posts we are going to delete in 2 days, it doesn't need to pass this criteria.
                                        if (postScore > -3) {
                                            invalidRequestReasons.push('Questions must be at a score &lt;= -3 (20k+), or have been closed for &gt; 2 days.');
                                        }
                                        isTag20k = true;
                                    }
                                }
                            }
                            if (questionRoombaInfo) {
                                if (!isNaN(questionRoombaDays)) {
                                    if (questionRoombaDays < 40) {
                                        invalidRequestReasons.push('The question will Roomba in ' + questionRoombaDays + ' day' + (questionRoombaDays === 1 ? '' : 's') + '.');
                                    }
                                }
                            }
                            if (!reason.replace(/(?:\boff[\s-\/]*topic\b|\bO[-\/]?T\b)/ig, '').trim()) { // eslint-disable-line no-useless-escape
                                //Nothing but "off-topic".
                                invalidRequestReasons.push('"off-topic" by itself is not a sufficient reason. More detail is required.');
                            }
                        }
                    }
                }
                if (requestType === 'cv-pls') {
                    //No need to check for answers as cv-pls is not included in the options for answers.
                    if (this.guiType === 'question') { //This should always be true.
                        if (isQuestionBounty) {
                            criticalRequestReasons.push('The question has a bounty that has not yet been awarded.');
                        }
                        if (closedTimeMs) {
                            criticalRequestReasons.push('The question is already closed.');
                        } else if (!reason.replace(/(?:\boff[\s-\/]*topic\b|\bO[-\/]?T\b)/ig, '').trim()) { // eslint-disable-line no-useless-escape
                            //Nothing but "off-topic".
                            invalidRequestReasons.push('"off-topic" by itself is not a sufficient reason. More detail is required.');
                        }
                        if (questionActiveTime && isSOCVR) {
                            if (questionActiveTime + questionActivityWarningAge < Date.now()) {
                                invalidRequestReasons.push('<span title="Activity that\'s indicated by the &quot;active&quot; date on the question isn\'t the only way to qualify for a cv-pls.\nSome examples of other reasons include: low-traffic tags, mentioned somewhere, a rejected edit, proposed dup, etc.">The question has no recent activity. It <i>may</i> not qualify for a <code>cv-pls</code> request. Please see <a href="https://socvr.org/faq#GEfM-cv-pls-not-a-habit" target="_blank">SOCVR\'s FAQ</a>.</span>');
                            }
                        }
                    } else {
                        criticalRequestReasons.push('A cv-pls request doesn\'t match this type of post: ' + this.guiType + '.');
                    }
                }
                if (requestType === 'reopen-pls') {
                    //No need to check for answers as reopen-pls is not included in the options for answers.
                    if (this.guiType === 'question') {
                        if (!closedTimeMs) {
                            criticalRequestReasons.push('The question is already open.');
                        }
                    } else {
                        criticalRequestReasons.push('A reopen-pls request doesn\'t match this type of post: ' + this.guiType + '.');
                    }
                }
            }
            if (isSOCVR) {
                if (!isSocvrSite) {
                    criticalRequestReasons.push('SOCVR does not moderate this site. Please select a different chat room. Request will not be sent.');
                } else {
                    //Is being sent to SOCVR and a moderated site.
                    if (reasonRequired && this.currentUserInQuestionNotDeletedAnswers.length > 0) {
                        //The current user has a post in the questionContext which is not deleted.
                        if (isGuiReviewSE) {
                            criticalRequestReasons.push('This is about an edit you made (or to your post). Such requests are not permitted on SOCVR.');
                        } else {
                            criticalRequestReasons.push('SOCVR does not permit requests about posts in which you have an interest (defined as you being the author of the question, or of a non-deleted answer).');
                        }
                    }
                }
            }

            //End Validation
            //Get the primary (first) tag
            var tag = this.tag;
            if (!tag) {
                //huh, sponsored tags have images =/ and off-topic tag like C++ are URL encoded -> get the text only
                if (isGuiReviewSE) {
                    this.tag = tag = $('.post-taglist a.post-tag', questionContext).first().text();
                } else {
                    this.tag = tag = $('.question .post-taglist a.post-tag', questionContext).first().text();
                }
            }
            const currentKnownRoomKey = getCurrentKnownRoomKey();
            const useMetaTag = currentKnownRoomKey ? knownRooms[currentKnownRoomKey].useMetaTag : false;
            const useSiteTag = currentKnownRoomKey ? knownRooms[currentKnownRoomKey].useSiteTag : true;

            function createTagMarkdown(tagText) {
                let markdown = '';
                if (useSiteTag !== false) {
                    //The default is that we use the site tag, so must have useSiteTag === false to not use it.
                    markdown = '[tag:' + tagText + ']';
                }
                if (useMetaTag) {
                    markdown += (markdown ? ' ' : '') + '[meta-tag:' + tagText + ']';
                }
                return markdown;
            }
            //Scores are tracked in real-time. Thus, isTag20k could change while the GUI is open.
            const n0kTagIfNeeded = createTagMarkdown((isTag20k ? '2' : '1') + '0k+') + ' ';
            var tag20k = isDeleteUndelete ? n0kTagIfNeeded : '';
            //XXX This needs to be selectable via option. (I don't like putting in 10k+ tags, as they are implicit for all deletes)
            if (!isTag20k) {
                tag20k = '';
            }
            let questionTagMarkdown = createTagMarkdown(tag);
            var request = '';
            var useRequestType = requestType;
            if (requestType === 'offensive' || requestType === 'spam') {
                request += createTagMarkdown('flag-pls') + ' ';
                questionTagMarkdown = '';
            }
            if (requestType.indexOf('reflag') > -1) {
                useRequestType = useRequestType.replace(/reflag /, '');
                request += createTagMarkdown('reflag-pls') + ' ';
                questionTagMarkdown = '';
            }
            request += createTagMarkdown(useRequestType) + ' ' + tag20k + (isNatoWithoutEnhancement ? '' : questionTagMarkdown + ' ') + reason + ' ' + titleMarkdown + ' - ' + userMarkdown + postTime;
            //XXX This really should move into an Object that describes SD types and drives both this logic and the <options>.
            const sdQuotedReason = reason ? ' "' + reason + '"' : '';
            const sdPostCommandsWithOptionalReason = [
                '!!/report',
                '!!/report-force',
                '!!/scan',
                '!!/scan-force',
            ];
            const requestTypePlusSpace = requestType + ' ';
            if (sdPostCommandsWithOptionalReason.indexOf(requestType) > -1) {
                request = requestTypePlusSpace + postLinkHref + sdQuotedReason;
            }
            const sdUserCommands = [
                '!!/rmblu-',
                '!!/addblu-',
                '!!/rmwlu-',
                '!!/addwlu-',
                '!!/reportuser',
            ];
            if (sdUserCommands.indexOf(requestType) > -1) {
                request = requestTypePlusSpace + urlBase + userLink.attr('href');
            }
            if (isGuiReviewSE) {
                let suggestedEditUrl = window.location.href;
                if (window.location.href.indexOf('/question') > -1) {
                    suggestedEditUrl = urlBase + this.gui.wrapper.closest('.post-menu').children('a[href^="/review"]').attr('href');
                }
                request = createTagMarkdown(requestType) + ' ' + reason + ' [Suggested Edit](' + suggestedEditUrl + ') by ' + userMarkdown + ' changing: ' + titleMarkdown + (/tag (?:wiki|excerpt)/.test(titleMarkdown) ? ' ' + questionTagMarkdown : '');
            }
            if (request.length > 500) {
                criticalRequestReasons.push(`Request > 500 characters. (${request.length})`);
            }
            return {
                request,
                invalidRequestReasons,
                criticalRequestReasons,
            };
        },
        setInputAttributesByRequestType: function() {
            //Enable/disable the request reason based on if it's a required part of the request.
            const requestType = this.requestTypeInput.val();
            if (requestTypesWithNoReason.indexOf(requestType) === -1) {
                this.requestReasonInput.removeAttr('disabled');
                if (requestTypesWithOptionalReason.indexOf(requestType) > -1 || delayableRequestRegex.test(requestType)) {
                    this.requestReasonInput.removeAttr('required');
                } else {
                    this.requestReasonInput.attr('required', 'true');
                }
            } else {
                //Reasons are not permitted for many SD commands.
                this.requestReasonInput.removeAttr('required');
                this.requestReasonInput.attr('disabled', 'true');
            }
            if (delayableRequestRegex.test(requestType)) {
                this.sendButton.attr('value', 'Save');
                this.gui.list.addClass('cvrg-isDelayedRequest');
                this.requestReasonInput.attr('placeholder', 'Revisit reason');
                this.delayLengthEndTimeSpan.show();
            } else {
                this.sendButton.attr('value', 'Send');
                this.gui.list.removeClass('cvrg-isDelayedRequest');
                this.requestReasonInput.attr('placeholder', 'Request reason');
                this.delayLengthEndTimeSpan.hide();
            }
            if (requestType === 'revisit (in N days)') {
                this.delayLengthSpan.show();
            } else {
                this.delayLengthSpan.hide();
            }
        },
    });

    //Chat Room Selection Gui Item
    function GuiItemRoomSelection(_gui) {
        this.item = $('<dd></dd>');
        this.list = $('<dl class="cvrgRoomList"></dl>');
        var list = this.list;
        this.div = $('<div class="cvrgItemMainDiv" style="display:none"/>');
        var roomGui = this; // eslint-disable-line consistent-this
        this.list.on('change', function(e) {
            //Select a new room
            RoomList.setRoom(e.target.value);
            _gui.closeTarget();
        });
        this.list.on('submit', function(e) {
            //Delete a room
            e.preventDefault();
            var room = RoomList.url($('[name="target-room"]', $(e.target).parent()).val());
            if (room) {
                if (RoomList.count() === 1) {
                    notify('Cannot remove last room', 0, notifyCSS.fail);
                    return false;
                }
                if ($('[checked]', $(e.target).parent()).length) {
                    RoomList.setRoom($('input[name="target-room"]:not([value="' + room.url + '"])', list).val());
                }
                delete RoomList.rooms[room.url];
                RoomList.save();
                roomGui.removeRoom(room.url);
            }
        });
        this.div.append(this.list);
        //Input for adding a room
        this.div.append($('<form><input type="text"/><input type="submit" value="Set"></form>').on('submit', function(e) {
            //Add a room
            e.preventDefault();
            var response = $('input[type="text"]', this).val();
            if (!response) {
                return false;
            }
            var exists = RoomList.url(response);
            RoomList.setRoom(response, function(room) {
                if (!exists) {
                    roomGui.addRoom(room, true);
                }
                roomGui.setRoomListSelectorChecked('[type="radio"]', false);
                roomGui.setRoomListSelectorChecked('[value="' + room.url + '"]', true);
                _gui.closeTarget();
            });
        }));
        this.item.append($('<a href="javascript:void(0)"></a>'));
        this.item.append(this.div);
        this.item.append($('<hr>'));
        this.setDisplayedTextToRoom();
    }
    Object.assign(GuiItemRoomSelection.prototype, {
        //Methods added to the Room GUI prototype.
        addRoom: function(room, isChecked) {
            //Add a line for the specified room
            this.list.append($('' +
                '<dd class="cvrgItemRoomContainer" title="' + room.url + '">' +
                '    <label>' +
                '        <input type="radio" name="target-room" value="' + room.url + '"' + (isChecked ? ' checked' : '') + '>' + room.name +
                '    </label>' +
                '    <form>' +
                '        <button>-</button>' +
                '    </form>' +
                '</dd>' +
                ''));
        },
        addAllRooms: function() {
            //Add a listing for each room in the RoomList
            var that = this;
            RoomList.getRoom(function(currentRoom) {
                RoomList.each(function(room) {
                    that.addRoom(room, currentRoom.url === room.url);
                });
            });
        },
        setDisplayedText: function(text, title) {
            //Set the text displayed for this Item. Used to tell the user to select a room vs. indicate which room is in use.
            var link = $('a', this.item).first();
            link.text(text);
            if (typeof title !== 'undefined') {
                link.attr('title', title);
            }
        },
        removeAllRooms: function() {
            //Remove all the rooms listed in the Room GUI Item.
            this.item.find('.cvrgItemRoomContainer').remove();
        },
        removeRoom: function(url) {
            //Remove the rooms matching the URL from the list in the Room GUI Item.
            this.item.find('input[value="' + url + '"]').closest('.cvrgItemRoomContainer').remove();
        },
        onopen: function() {
            //Each time the Item is opened, regenerate the list of rooms from the RoomList.
            //Initialize the RoomList from GMStorage
            RoomList.init();
            this.removeAllRooms();
            this.addAllRooms();
            this.setDisplayedText('Set target room:', 'Select the chat room which you desire to use.');
        },
        setRoomListSelectorChecked: function(selector, value) {
            //Check/uncheck a room based on a selector.
            this.list.find(selector).prop('checked', value);
        },
        setDisplayedTextToRoom: function() {
            //Display the current room in the list
            var that = this;
            RoomList.getRoom(function(room) {
                that.setDisplayedText(room.name, 'The Chat room to which requests will be sent is: ' + room.name);
            });
        },
        onclose: function() {
            //When the Item is closed:
            this.setDisplayedTextToRoom();
        },
        onguiopen: function() {
            //When the main GUI opens, set the text displayed to the room currently in use.
            this.setDisplayedTextToRoom();
        },
    });

    //Options Gui Item
    function GuiItemOptions(_gui, _guiType) {
        this.item = $('' +
            '<dd>' +
            '    <a href="javascript:void(0)">Options</a>' +
            '    <div class="cvrgItemMainDiv" style="display:none;">' +
            '        <dl class="cvrgOptionsList">' +
            '        </dl>' +
            '    </div>' +
            '    <hr>' +
            '</dd>' +
            '');
        this.optionsList = this.item.find('.cvrgOptionsList');
        //Create a checkbox for each knownOption checkbox
        Object.keys(knownOptions.checkboxes).forEach(function(key) {
            if (key === 'automaticlyPostDelayedRequests') {
                //The ability to turn on this functionality is disabled. At one point, it was possible to have
                //  del-pls requests automatically posted after a certain time. It was felt that it was more
                //  appropriate for the post to be revisited and to have the user do so manually.
                return;
            }
            this.optionsList.append(this.createCheckboxItem(key, knownOptions.checkboxes[key]));
        }, this);
        //Create Buttons for knownOption buttons
        Object.keys(knownOptions.buttons).forEach(function(key) {
            var button = this.createButtonItem(key, knownOptions.buttons[key]);
            $('a', button).on('click', knownOptions.buttons[key].buttonAction);
            this.optionsList.append(button);
        }, this);
        //Create Number selection for knownOption numbers
        Object.keys(knownOptions.numbers).forEach(function(key) {
            this.optionsList.append(this.createNumberItem(key, knownOptions.numbers[key]));
        }, this);
        this.subItems = [];
        this.subItems.push(new GuiOptionSubItemShortcutKey(_gui, _guiType));
        this.subItems.push(new GuiOptionSubItemUpdate(_gui, _guiType));
        this.subItems.forEach(function(subItem) {
            this.optionsList.append(subItem.item);
        }, this);
        //Hide the closing <hr> for the last item in the optionsList.
        this.optionsList.find('hr').last().hide();
        _gui.configOptionsChanged = this.configOptionsChanged.bind(this);
        this.item.on('change', 'input[type=checkbox]', function() {
            var $this = $(this);
            var optionProp = $this.attr('name').replace('cvrg-optionCheckbox-', '');
            setCheckboxConfigSubOption(optionProp, $this.is(':checked'));
            setGlobalVariablesByConfigOptions();
            //When options change, it could change what the text should be for GUI buttons.
            CVRGUI.setCvpButtonToCurrentRequestType();
            //The request type options are generated each time the Send GUI is opened. Thus, we don't need to change it here.
            //If we want *all* changes to actually take effect now, then we would need to destroy all of the GUIs, recreate them and re-open the one for this post to options.
            //For the option that removes all CVR GUIs from non-SOCVR sites, this might not be what the user expects to happen immediately.
        });
        this.item.on('change', 'input[type=number]', function() {
            var $this = $(this);
            var optionProp = $this.attr('name').replace('cvrg-optionNumber-', '');
            setNumberConfigSubOption(optionProp, $this.val());
            setGlobalVariablesByConfigOptions();
        });
    }
    Object.assign(GuiItemOptions.prototype, {
        callInAllSubItems: function(method, args) {
            //Call a method on each sub Item
            this.subItems.forEach(function(subItem) {
                if (typeof subItem[method] === 'function') {
                    subItem[method].apply(subItem, args);
                }
            });
        },
        onguiclose: function() {
            this.callInAllSubItems('onguiclose');
        },
        onguiopen: function() {
            this.callInAllSubItems('onguiopen');
        },
        onclose: function() {
            this.callInAllSubItems('onclose');
        },
        onopen: function() {
            this.setCheckboxesToConfig();
            this.setNumbersToConfig();
            this.callInAllSubItems('onopen');
            var that = this;
            $('a[name^="cvrg-optionButton-"]', this.item).each(function() {
                var optionKey = this.name.replace(/cvrg-optionButton-/, '');
                this.textContent = that.createButtonItemText(optionKey);
            });
            //Don't focus the shortcutkey input. Let the user select it, if they want to change it.
            $('input[type="text"]', this.item).blur();
        },
        ondestroy: function() {
            this.callInAllSubItems('ondestroy');
        },
        setCheckboxesToConfig: function() {
            //Set all the checkboxes
            Object.keys(configOptions.checkboxes).forEach(function(key) {
                this.item.find('input[name="cvrg-optionCheckbox-' + key + '"]').prop('checked', configOptions.checkboxes[key]);
            }, this);
        },
        setNumbersToConfig: function() {
            //Set all the numbers
            Object.keys(configOptions.numbers).forEach(function(key) {
                this.item.find('input[name="cvrg-optionNumber-' + key + '"]').val(configOptions.numbers[key]);
            }, this);
        },
        createCheckboxItem: function(optionKey, checkboxItem) {
            //Create a checkbox option entry.
            return $('' +
                '<dd>' +
                '    <div class="cvrgOptionSubItem">' +
                '        <label title="' + checkboxItem.tooltip + '">' +
                '            <input type="checkbox" name="cvrg-optionCheckbox-' + optionKey + '" ' + (configOptions.checkboxes[optionKey] ? ' checked' : '') + '>' + checkboxItem.text +
                '        </label>' +
                '    </div>' +
                '    <hr>' +
                '</dd>' +
                '');
        },
        createButtonItem: function(optionKey, buttonItem) {
            //Create a action button option entry.
            return $('' +
                '<dd>' +
                '    <div class="cvrgOptionSubItem">' +
                '        <a href="javascript:void(0)" name="cvrg-optionButton-' + optionKey + '" title="' + buttonItem.tooltip + '"></a>' +
                '    </div>' +
                '    <hr>' +
                '</dd>' +
                '');
        },
        createButtonItemText: function(optionKey) {
            //Create the text for an action button.
            var buttonItem = knownOptions.buttons[optionKey];
            return buttonItem.text + (typeof buttonItem.dynamicText === 'function' ? buttonItem.dynamicText() : '');
        },
        createNumberItem: function(optionKey, numberItem) {
            //Create a number option entry.
            return $('' +
                '<dd>' +
                '    <div class="cvrgOptionSubItem">' +
                '        <div class="cvrgOptionsNumberContainer" title="' + numberItem.tooltip + '">' +
                             numberItem.textPre +
                '            <input type="number" min="' + numberItem.min + '" max="' + numberItem.max + '" name="cvrg-optionNumber-' + optionKey + '" style="' + numberItem.style + '"/>' +
                             numberItem.textPost +
                '        </div>' +
                '    </div>' +
                '    <hr>' +
                '</dd>' +
                '');
        },
        configOptionsChanged: function() {
            //The config options have changed external to this tab.
            if (this.item.is(':visible')) {
                this.setCheckboxesToConfig();
                this.setNumbersToConfig();
            }
        },
    });

    //ShortcutKey Gui Item
    function GuiOptionSubItemShortcutKey(_gui) {
        //Set shortcut key
        this.item = $('' +
            '<dd>' +
            '    <div class="cvrgOptionSubItem">' +
            '        <div>Set keyboard shortcut</div>' +
            '        <div class="cvrgOptionSubItem">' +
            '            <label>' +
            '                Ctrl-Shift-' +
            '                <input name="cvrgShortcutKey" type="text" size="1" maxlength="1"/>' +
            '                <span class="cvrgShortcutDefined">None</span>' +
            '            </label>' +
            '        </div>' +
            '    </div>' +
            '    <hr>' +
            '</dd>' +
            '');
        var shortcutKeyGui = this; // eslint-disable-line consistent-this
        $('input[type="text"]', this.item).on('keydown', function(e) {
            //Let the Tab key perform the normal input focus change w/o setting the shortcut key.
            if (e.key !== 'Tab') {
                setShortcutKey(e.which);
                shortcutKeyGui.setShortcutKeyUIToCurrent();
            }
        });
        //Methods added directly to the main GUI.
        _gui.shortcutKeyWasSet = function() {
            //Needed when watching for changes in other tabs.
            shortcutKeyGui.setShortcutKeyUIToCurrent();
        };
    }
    //Methods for the shortcut key GUI's prototype
    Object.assign(GuiOptionSubItemShortcutKey.prototype, {
        shortcutKeyDefined: function(isDefined) {
            //Show or hide the text telling the user that there isn't a shortcut key defined.
            $('.cvrgShortcutDefined', this.item).css('visibility', isDefined ? 'hidden' : 'visible');
        },
        setShortcutKeyUIToCurrent: function() {
            //Set the displayed shortcut key to what is currently stored.
            var key = getShortcutKey();
            $('input[type="text"]', this.item).val(key);
            this.shortcutKeyDefined(key);
        },
        onopen: function() {
            //Actions to perform when the shortcut key option becomes visible.
            this.setShortcutKeyUIToCurrent();
        },
    });

    //Update Gui Item
    function GuiOptionSubItemUpdate(_gui) {
        //Check for updates
        this.item = $('' +
            '<dd>' +
            '    <div class="cvrgOptionSubItem">' +
            '        <a href="javascript:void(0)">Check for updates</a>' +
            '    </div>' +
            '</dd>' +
            '<hr>' +
            '');
        this.gui = _gui;
        this.item.find('a').on('click', function(e) {
            e.preventDefault();
            _gui.hideMenu();
            checkUpdates(true);
        });
    }

    //Create a cv-pls GUI
    var guiCount = 0;

    function Gui(_guiType, _id, _reportVisible) {
        //Construct a CVR GUI
        guiCount++;
        var gui = this; // eslint-disable-line consistent-this
        this.guiType = _guiType;
        this[_guiType + 'Id'] = _id;
        this.reportVisible = _reportVisible;
        //A <span> that contains the entire GUI.
        this.wrapper = $('<span class="cvrgui" data-gui-type="' + _guiType + '" data-gui-id="' + _id + '"/>');
        //The link used as the cv-pls/del-pls/etc. button on each post
        this.button = $('<a href="javascript:void(0)" class="cv-button"></a>');
        this.wrapper.append(this.button);
        //The <dl> which contains each list item in the GUI
        this.list = $('<dl class="cv-list" data-guicount="' + guiCount + '"/>');
        this.wrapper.append(this.list);
        //Items in the cv-pls dialog
        this.items = {
            send: new GuiItemSend(this, _guiType),
            room: new GuiItemRoomSelection(this, _guiType),
            options: new GuiItemOptions(this, _guiType),
        };
        //Add all the items, in the desired order, and event listeners for each.
        ['send', 'room', 'options'].forEach(function(itemKey) {
            gui.list.append(gui.items[itemKey].item);
            $('a', gui.items[itemKey].item).first().on('click', gui.toggleItem.bind(gui, itemKey));
        });
        //Hide the closing <hr> for the last item.
        this.list.find('hr').last().hide();
        this.defaultItemKey = 'send';
        this.defaultItem = this.items[this.defaultItemKey];
        //Toggle the display of the cv-pls dialog.
        this.button.on('click', function() {
            gui.setCvpButtonToCurrentRequestType();
            //Close all 1st level menus
            $('div.cvrgItemMainDiv', gui.list).hide();
            //Call the appropriate GUI open/close function for each item.
            var onWhat = gui.list.is(':visible') ? 'onguiclose' : 'onguiopen';
            Object.keys(gui.items).forEach(function(item) {
                var toCall = gui.items[item][onWhat];
                if (typeof toCall === 'function') {
                    toCall.call(gui.items[item]);
                }
            });
            gui.list.toggle();
            if (gui.list.is(':visible')) {
                gui.reportVisible.visibleGui = gui;
            }
            gui.openDefaultItem();
        });
        this.documentClickListener = function(e) {
            //Hide the CV popup if visible & the click is not in the
            //  popup (preventing right-clicks from closing the popup when they are inside the popup).
            if (gui.list.is(':visible') && !gui.wrapper[0].contains(e.target)) {
                gui.hideMenu();
            }
        };
        $(document).on('click', this.documentClickListener);
        this.setCvpButtonToCurrentRequestType();
    }
    Object.assign(Gui.prototype, {
        //Main GUI prototype methods.
        setCvpButtonRequestType: function(requestType) {
            //Set the GUI button text & tooltip to the specified request type.
            this.button.text(requestType);
            var requestTooltip = requestType + ' request';
            if (requestType === 'reopen/del-pls') {
                requestTooltip = 'del-pls or reopen-pls request';
            }
            if (requestType === 'sd-report') {
                requestTooltip = 'Smoke Detector report';
            }
            if (requestType === 'spam') {
                requestTooltip = 'Report as spam or offensive';
            }
            if (requestType === 'review-pls') {
                requestTooltip = 'review-pls request';
            }
            this.button.attr('title', 'Send a ' + requestTooltip);
        },
        setCvpButtonToCurrentRequestType: function() {
            //Change the main GUI cv-pls link to display the request type
            // appropriate for the answer/question's current status.
            var isSOCVR = isCurrentRoomSOCVR();
            if (this.guiType === 'question') {
                this.setCvpButtonRequestType(getRequestTypeByQuestionStatus(this.wrapper));
            } else if (this.guiType === 'answer') {
                if (onlySdSpamOffensive) {
                    this.setCvpButtonRequestType(((isSOCVR && configOptions.checkboxes.canReportSmokeDetectorSOCVR) || (!isSOCVR && configOptions.checkboxes.canReportSmokeDetectorOther)) ? 'sd-report' : 'spam');
                } else {
                    this.setCvpButtonRequestType((this.wrapper.closest('.answer').is('.deleted-answer') ? 'undel' : 'del') + '-pls');
                }
            } else if (this.guiType === 'reviewSE') {
                this.setCvpButtonRequestType('review-pls');
            }
        },
        closeAllItems: function() {
            //Close all items in the GUI
            Object.keys(this.items).forEach(function(item) {
                this.closeItem(item);
            }, this);
        },
        closeTarget: function() {
            //Close the room selection
            this.closeItem('room');
        },
        closeItem: function(itemKey) {
            //Close a single item in the GUI
            var item = this.items[itemKey];
            var $item = item.item;
            $('div.cvrgItemMainDiv', $item).hide();
            if (item.onclose) {
                item.onclose(item);
            }
        },
        openItem: function(itemKey) {
            //Open an item in the GUI
            this.closeAllItems();
            var item = this.items[itemKey];
            var $item = item.item;
            $('div.cvrgItemMainDiv', $item).show();
            $('input[type="text"]', $item).focus();
            if (item.onopen) {
                item.onopen(item);
            }
        },
        toggleItem: function(item, e) {
            //Toggle an item in the GUI
            //May be called as a bound event handler, with the correct this
            if (e) {
                e.stopPropagation();
                e.target.blur();
            }
            var $divs = $('div.cvrgItemMainDiv', this.items[item].item);
            if ($divs.is(':hidden')) {
                this.openItem(item);
            } else {
                this.closeAllItems();
            }
        },
        hideMenu: function() {
            //Hide the GUI
            this.closeAllItems();
            this.list.hide();
            if (this.reportVisible.visibleGui === this) {
                this.reportVisible.visibleGui = null;
                CVRGUI.visibleGui = null;
            }
        },
        showMenu: function() {
            //Show the GUI
            this.closeAllItems();
            this.list.show();
            this.reportVisible.visibleGui = this;
        },
        isDefaultHidden: function() {
            //Is the default item currently open?
            return $('.cvrgItemMainDiv', this.defaultItem.item).is(':hidden');
        },
        openDefaultItem: function() {
            //Open the default item
            this.openItem(this.defaultItemKey);
        },
        destroy: function() {
            //Remove any references made by the GUI which exist outside of it to data within the GUI.
            //The intent is to permit the GUI to be garbage collected.
            //Let each item clean up, if needed (none currently).
            this.hideMenu();
            Object.keys(this.items).forEach(function(itemKey) {
                var item = this.items[itemKey];
                if (typeof item.ondestroy === 'function') {
                    item.ondestroy(item);
                }
            }, this);
            $(document).off('click', this.documentClickListener);
            this.wrapper.remove();
        },
    });

    //Record for all the GUIs created/added to the DOM, and methods to use on all of them.
    /* jshint -W003 */
    CVRGUI = {
        /* jshint +W003 */
        questions: [],
        answers: [],
        reviews: [],
        //A reference to the currently visible GUI.
        //  Used to tell the currently visible GUI about any value changes that occur outside of the GUI
        //  (e.g. from option changes in other tabs).
        visibleGui: null,
        callInAllGuis: function(method, args) {
            //Call a method on each GUI
            this.callInAllQuestions(method, args);
            this.callInAllAnswers(method, args);
            this.callInAllReviews(method, args);
        },
        callInAllQuestions: function(method, args) {
            //Call a method on each GUI that is placed on a question
            this.questions.forEach(function(question) {
                question[method].apply(question, args);
            });
        },
        callInAllAnswers: function(method, args) {
            //Call a method on each GUI that is placed on an answer
            this.answers.forEach(function(answer) {
                answer[method].apply(answer, args);
            });
        },
        callInAllReviews: function(method, args) {
            //Call a method on each GUI that is placed on an review
            this.reviews.forEach(function(review) {
                review[method].apply(review, args);
            });
        },
        callInVisibleGui: function(method, args) {
            //Call a method in the currently visible GUI. Used to update changes in what's displayed in the GUI
            //  which result from actions external to the GUI. For instance, changes in the shortcut key, or
            //  options that are made in a different tab while the GUI is visible in this tab.
            if (this.visibleGui) {
                this.visibleGui[method].apply(this.visibleGui, args);
            }
        },
        setCvpButtonToCurrentRequestType: function() {
            //Set the text for each GUI button to what's appropriate for the current state of
            //  the post on which it is placed. This can change dynamically.
            this.callInAllGuis('setCvpButtonToCurrentRequestType');
        },
        //Call various functions in all GUIs.
        closeTarget: function() {
            this.callInAllGuis('closeTarget');
        },
        closeAllItems: function() {
            this.callInAllGuis('closeAllItems');
        },
        hideMenus: function() {
            this.callInAllGuis('hideMenu');
        },
        shortcutKeyWasSet: function() {
            this.callInVisibleGui('shortcutKeyWasSet', arguments);
        },
        configOptionsChanged: function() {
            this.callInVisibleGui('configOptionsChanged', arguments);
        },
        cleanGuiList: function(which, selector) {
            //Remove any GUIs which don't have an associated question/answer currently in the DOM
            this[which] = this[which].filter(function(gui) {
                if (!gui.wrapper.closest(selector).length) {
                    //It's not contained in an element matching the selector.
                    gui.destroy();
                    return false;
                } //else
                return true;
            });
        },
        cleanAnswers: function() {
            //Destroy/remove any answer GUIs which are not contained in a 'body .answer'.
            this.cleanGuiList('answers', 'body .answer');
        },
        cleanQuestions: function() {
            //Destroy/remove any question GUIs which are not contained in a 'body .answer'.
            this.cleanGuiList('questions', 'body .question');
        },
        cleanReviews: function() {
            //Destroy/remove any review GUIs which are not contained in a 'body'.
            this.cleanGuiList('reviews', 'body');
        },
        getGuiForId: function(postType, id) {
            //Get the GUI associated with a post ID of post type.
            //This searches the answerId/questionId property added to the GUI when it is inserted
            //  into a question/answer.
            var found;
            var idProp = postType + 'Id';
            this[postType + 's'].some(function(post) {
                if (post[idProp] == id) { // eslint-disable-line eqeqeq
                    found = post;
                    return true;
                }
                return false;
            });
            return found;
        },
        getQuestionGuiForId: function(id) {
            //Get the GUI associated with a question.
            return this.getGuiForId('question', id);
        },
        getAnswerGuiForId: function(id) {
            //Get the GUI associated with an answer.
            return this.getGuiForId('answer', id);
        },
        getGuiForEl: function(element) {
            //Get the GUI associated with the post which contains the element.
            var $el = (element instanceof jQuery) ? element : $(element);
            var post = $el.closest('.question,.answer');
            if (!post.length) {
                return null;
            }
            var postType = post.is('.question') ? 'question' : 'answer';
            return this.getGuiForId(postType, post.data(postType + 'id'));
        },
    };

    //Adding the cv-pls request to the question
    function addCvplsToDom() {
        //Adds the cv-pls link-button(s) and dialog to the DOM, if it does not already exist in the DOM.
        function addCvplsToDomForPostType(list, postType) {
            //Add a cv-pls GUIs to any post of the specified type when one does not already exist on the .post-menu
            var origLength = list.length;
            //Putting the GUI in when the .post-menu is .preview-options messes up the page-UI interaction for
            //  editing. This should be further investigated, but just not putting it there is sufficient.
            $('.' + postType + ' .post-menu:not(.preview-options)').each(function() {
                const $this = $(this);
                if (!$this.closest('.question,.answer').is('.' + postType)) {
                    //The closest .question/.answer for this .post-menu is not the type we're looking for.
                    return;
                } //else
                if (!$('span.cvrgui', this).length) {
                    //No cvrgui on this post yet
                    const newGui = new Gui(postType, $this.closest('.' + postType).data(postType + 'id'), CVRGUI);
                    $this.append('<span class="lsep">|</span>'); //separator between each post-menu item
                    $this.append(newGui.wrapper);
                    list.push(newGui);
                }
            });
            if (origLength && origLength !== list.length) {
                //Not the first time through && at least 1 post was added.
                if (postType === 'question') {
                    CVRGUI.cleanQuestions();
                } else if (postType === 'answer') {
                    CVRGUI.cleanAnswers();
                }
            }
        }
        addCvplsToDomForPostType(CVRGUI.questions, 'question');
        addCvplsToDomForPostType(CVRGUI.answers, 'answer');
        function removeNonMatchingReviewGui(context, reviewId) {
            $('span.cvrgui', context).each(function() {
                const currentGuiId = this.dataset.guiId;
                if (!currentGuiId || currentGuiId !== reviewId) {
                    const prev = this.previousSibling;
                    //Remove the text node we add.
                    if (prev.nodeName === '#text' && prev.textContent === ' ') {
                        prev.remove();
                    }
                    //Remove the GUI.
                    this.remove();
                }
            });
        }
        if (isSuggestedEditReviewPage) {
            //Suggested Edit Review.
            const match = window.location.pathname.match(/^\/review\/suggested-edits\/(\d+)\b.*$/i);
            const reviewId = (match && match.length > 1) ? match[1] : '';
            const toolsSubHeader = $('.subheader.tools-rev');
            //Remove any exiting GUI which doesn't match the current review.
            removeNonMatchingReviewGui(toolsSubHeader, reviewId);
            if (!$('span.cvrgui', toolsSubHeader).length) {
                //No GUI yet.
                const filterSummary = $('.review-filter-summary', toolsSubHeader);
                const newGui = new Gui('reviewSE', reviewId, CVRGUI);
                filterSummary.before(' ').before(newGui.wrapper);
                CVRGUI.cleanReviews();
                CVRGUI.reviews.push(newGui);
            }
        }
        const suggestedEditPopup = $('.popup-suggested-edit');
        if (suggestedEditPopup.length) {
            const postMenu = suggestedEditPopup.closest('.post-menu');
            const reviewId = (postMenu.children('a[href^="/review"]').attr('href').match(/\/(\d+)$/) || ['', ''])[1];
            removeNonMatchingReviewGui(suggestedEditPopup, reviewId);
            let reviewPlsContainer = $('.cvrg-review-pls-container', suggestedEditPopup);
            if (!reviewPlsContainer.length) {
                suggestedEditPopup.find('.suggested-edit-container').prepend('<div class="cvrg-review-pls-container"></div>');
                reviewPlsContainer = suggestedEditPopup.children('.cvrg-review-pls-container');
            }
            if (!$('span.cvrgui', reviewPlsContainer).length) {
                //No GUI yet.
                const newGui = new Gui('reviewSE', reviewId, CVRGUI);
                //Prevent the <a> elements in the GUI from opening a new tab or navigating, except those that have something that might be a valid URL for href.
                newGui.wrapper[0].addEventListener('click', function(event) {
                    if (event.target.nodeName === 'A' && (event.target.href || '').indexOf('/') === -1) {
                        event.preventDefault();
                    }
                }, true);
                reviewPlsContainer.append(newGui.wrapper);
                CVRGUI.cleanReviews();
                CVRGUI.reviews.push(newGui);
            }
        }
        //Set all cv-pls GUIs to the appropriate type of request.
        CVRGUI.setCvpButtonToCurrentRequestType();
        saveCopyOfQuestionTitles();
    }
    //Get the remembered requests prior to generating the GUIs for the first time.
    rememberedRequests = getGMStorageJSON(rememberedRequestStorage);
    addCvplsToDom();

    //Options
    /* Not used
    function setConfigOptions(options, dontStore) {
        configOptions = options;
        if (!dontStore) {
            storeConfigOptions();
        }
    }
    */

    function storeConfigOptions(options) {
        //Save the configuration options
        options = options ? options : configOptions;
        var asJson = JSON.stringify(options);
        if (typeof GM_getValue === 'function' && typeof GM_setValue === 'function') {
            GM_setValue('configOptions', asJson);
        } else {
            //Fall back to localStorage, if User Script storage is not available.
            setStorage('configOptions', asJson);
        }
    }

    function setCheckboxConfigSubOption(checkboxKey, value, dontStore) {
        //Set some options that in subkeys in the configOptions Object.
        //Avoid computed property name for IE compatibility
        var options = {
            checkboxes: {},
        };
        options.checkboxes[checkboxKey] = value;
        setSomeConfigSubOptions(options, dontStore);
    }

    function setNumberConfigSubOption(numberKey, value, dontStore) {
        //Set some options that in subkeys in the configOptions Object.
        //Avoid computed property name for IE compatibility
        var options = {
            numbers: {},
        };
        options.numbers[numberKey] = value;
        setSomeConfigSubOptions(options, dontStore);
    }

    function setSomeConfigSubOptions(options, dontStore) {
        //Set some options that in subkeys in the configOptions Object.
        Object.keys(options).forEach(function(key) {
            Object.assign(configOptions[key], options[key]);
        });
        if (!dontStore) {
            storeConfigOptions();
        }
    }

    /* Not used
    function setSomeConfigOptions(options, dontStore) {
        //Set some options that are directly on the configOptions Object.
        Object.assign(configOptions, options);
        if (!dontStore) {
            storeConfigOptions();
        }
    }
    */

    function getDefaultConfigOptions() {
        //Get the default option values from the knownOptions Object.
        function findDefaultValues(options) {
            //Traverse an Object until the property defaultValue is found, creating an
            //  Object for each property which is descended into and for which there is a defaultValue.
            //  Once a defaultValue is found, it is used and no deeper traversal is done.
            if (typeof options.defaultValue === 'undefined') {
                if (typeof options === 'object' && options !== null) {
                    //return Object.keys(options).reduce(function(newObj, key) {
                    return Object.keys(options).reduce(function(newObj, key) {
                        //Find the defaultValue for the Object.
                        var newValue = findDefaultValues(options[key]);
                        if (newValue !== null) {
                            //Only add the key/create the Object if there is a defaultValue
                            if (newObj === null) {
                                newObj = {};
                            }
                            newObj[key] = newValue;
                        }
                        return newObj;
                    }, null);
                } // else
                //Indicate that there was no defaultValue
                return null;
            } //else (there is a defaultValue)
            return options.defaultValue;
        }
        return findDefaultValues(knownOptions);
    }

    function mergeObject(into, from, overwrite) {
        //This will merge the properties from one Object into another. It can be
        //  done either with, or without, overwriting duplicate properties.
        //The default is that duplicate properties are not overwritten.
        //Objects in "from" are copied using JSON.parse(JSON.stringify()).
        //  Thus, "from" needs to contain only plain Objects, Arrays, Numbers, Booleans, Strings.
        //  RegExp, Date, etc. will not be properly copied.
        Object.keys(from).forEach(function(key) {
            if (typeof into[key] === 'undefined') {
                into[key] = JSON.parse(JSON.stringify(from[key]));
            } else if (into[key] !== null && typeof into[key] === 'object' && from[key] !== null && typeof from[key] === 'object') {
                mergeObject(into[key], from[key], overwrite);
            } else if (overwrite) {
                into[key] = JSON.parse(JSON.stringify(from[key]));
            }
        });
    }

    function mergeDefaultConfigOptions(options) {
        //Only fill in defaults where no value exists.
        var defaults = getDefaultConfigOptions();
        mergeObject(options, defaults);
        return options;
    }

    function getConfigOptions() {
        //Get the configuration options from storage.
        var jsonOptions;
        if (typeof GM_getValue === 'function' && typeof GM_setValue === 'function') {
            jsonOptions = GM_getValue('configOptions');
        } else {
            //Fall back to localStorage, if User Script storage is not available.
            jsonOptions = getStorage('configOptions');
        }
        try {
            return mergeDefaultConfigOptions(JSON.parse(jsonOptions));
        } catch (e) {
            //JSON.parse failed, storage is corrupt or this is the first time we've used it.
            var defaults = getDefaultConfigOptions();
            storeConfigOptions(defaults);
            return defaults;
        }
    }

    var configOptionsChangeListener;

    function trackConfigOptionsChangesIfPossible() {
        //If the user script manager in which this is running allows listening for changes to
        //  user script storage, then listen for changes to the shortcut key (e.g. in another tab).
        if (!canListenGMStorage || //Not available: Greasemonkey
            configOptionsChangeListener //Already added, don't add again
        ) {
            return;
        }
        configOptionsChangeListener = GM_addValueChangeListener('configOptions', function(name, oldValue, newValue, remote) {
            //Listen for external changes.
            //Note: External changes only partially affect the GUIs, as already existing GUIs will have been configured based on
            //  some settings as they were at the time the GUI was created. If we really wanted to have external changes fully
            //  supported, then all the GUIs would need to be destroyed and recreated (or changed in-place).
            if (remote) {
                configOptions = JSON.parse(newValue);
                setGlobalVariablesByConfigOptions();
                CVRGUI.configOptionsChanged();
            }
        });
    }
    trackConfigOptionsChangesIfPossible();

    //Shortcut key
    //  The key is stored in User Script storage, which makes it shared across domains (i.e. for all uses of this script).
    function setShortcutKey(key, dontStore) {
        if (typeof key === 'undefined') {
            //Apply defaults
            key = 'A'; // for Ctrl-Shift-A
            if (typeof InstallTrigger !== 'undefined') {
                //Firefox
                // Don't use Ctrl-Shift-A hotkey in Firefox, as
                // there's already a Ctrl-Shift-A, which opens
                // about:addons, the add-on management page.
                key = 'Z'; // for Ctrl-Shift-Z
            }
        }
        if (typeof key === 'number') {
            key = String.fromCharCode(key);
        }
        key = key.toUpperCase();
        var shortcutCode = key.charCodeAt();
        if (shortcutCode < 32) {
            key = '';
        }
        if (!dontStore && key !== getShortcutKey()) {
            // Don't store if explicitly requested to not do so (e.g.
            // from the change listener, which should also fulfill the
            // criteria that it matches what's in storage, but no need
            // to get it from storage yet again;
            if (typeof GM_getValue === 'function' && typeof GM_setValue === 'function') {
                GM_setValue('shortcutKey', key);
            } else {
                //Fall back to localStorage, if User Script storage is not available.
                setStorage('shortcutKey', key);
            }
        }
        //Don't add keydown & keyup listeners multiple times.
        $(document).off('keydown keyup');
        //Show to user that the shortcut key changed
        CVRGUI.shortcutKeyWasSet();
        if (key === '') {
            //If no key defined, don't listen to keyup and keydown events.
            return;
        }
        //Watch for the shortcut key being pressed, but activate on the next keyup event after the keydown.
        var combo;
        $(document).keydown(function(e) {
            if (e.ctrlKey && e.shiftKey && e.which === shortcutCode) {
                e.preventDefault();
                combo = true;
            }
        });
        $(document).keyup(function() {
            if (combo) {
                combo = false;
                //Find the first question which has a visible CVRGUI. This is done due to the tabbed view used
                //  in the reopen review queue for questions closed-as-duplicate.
                var firstVisibleQuestion = $('.question .cvrgui:visible').first().closest('.question');
                if (!firstVisibleQuestion.length) {
                    //No question CVRGUI is visible.
                    return;
                }
                var firstVisibleQuestionGui = CVRGUI.getQuestionGuiForId(firstVisibleQuestion.data('questionid'));
                if (firstVisibleQuestionGui && firstVisibleQuestionGui.isDefaultHidden()) {
                    //If there is a question CVRGUI button visible and it's default item is not shown, open the
                    //  GUI and show the default.
                    CVRGUI.hideMenus();
                    CVRGUI.setCvpButtonToCurrentRequestType();
                    firstVisibleQuestionGui.showMenu();
                    firstVisibleQuestionGui.openDefaultItem();
                } else {
                    CVRGUI.hideMenus();
                }
            }
        });
    }

    function getShortcutKey() {
        //Get the shortcut key from storage
        if (typeof GM_getValue === 'function' && typeof GM_setValue === 'function') {
            return GM_getValue('shortcutKey');
        }// else
        //Fall back to localStorage, if User Script storage is not available.
        return getStorage('shortcutKey');
    }

    var shortcutKeyChangeListener;

    function trackShortcutKeyChangesIfPossible() {
        //If the user script manager in which this is running allows listening for changes to
        //  user script storage, then listen for changes to the shortcut key (e.g. in another tab).
        if (!canListenGMStorage || //Not available: Greasemonkey
            shortcutKeyChangeListener //Already added, don't add again
        ) {
            return;
        }
        shortcutKeyChangeListener = GM_addValueChangeListener('shortcutKey', function(name, oldValue, newValue, remote) {
            if (remote) {
                setShortcutKey(newValue, true);
            }
        });
    }
    trackShortcutKeyChangesIfPossible();

    setShortcutKey(getShortcutKey());

    //Add Send cv-pls request checkbox to close dialog & monitor for CV submit.
    var cvplsRequestedAfterVote = false; //Holds user selection until after recording of vote acknowledged.
    function closeVoteDialogIsOpen() {
        //The Close Vote Dialog is open
        var popup = $('#popup-close-question').first();
        var selected;
        var remainingVotes = $('.remaining-votes', popup);
        var cvplsReasonInput = CVRGUI.getGuiForEl(popup).requestReasonInput;

        if ($('input', remainingVotes).length) {
            return false;
        }
        //Don't add twice, if called a second time for the same popup.
        if ($('label:contains(cv-pls)', popup).length) {
            return false;
        }

        if (currentSiteConfig.name === 'Default') {
            var offTopicInputs = $('.close-as-off-topic-pane input', popup);
            offTopicInputs.each(function() {
                const value = this.value;
                const thisParent = this.parentNode;
                if (!offTopicCloseReasons[value]) {
                    offTopicCloseReasons[value] = '';
                    if (thisParent.textContent.indexOf('scope defined in the help center') > -1) {
                        offTopicCloseReasons[value] = 'Not in scope for ' + window.location.hostname.replace(/\.(com|net)$/, '');
                    }
                    offTopicCloseReasons[value] = offTopicCloseReasons[value].replace(/\s+/, ' ').trim();
                    if (!offTopicCloseReasons[value]) {
                        $('b,i', thisParent).each(function() {
                            offTopicCloseReasons[value] += ' ' + this.innerText;
                        });
                        offTopicCloseReasons[value] = offTopicCloseReasons[value].trim().replace(/:$/, '');
                    }
                    offTopicCloseReasons[value] = offTopicCloseReasons[value].replace(/\s+/, ' ').trim();
                    const parentText = thisParent.innerText;
                    if (!offTopicCloseReasons[value]) {
                        const matches = parentText.match(/"([^"]+)"/g);
                        if (matches) {
                            offTopicCloseReasons[value] = matches.join(' ');
                        }
                    }
                    offTopicCloseReasons[value] = offTopicCloseReasons[value].replace(/\s+/, ' ').trim();
                    if (!offTopicCloseReasons[value]) {
                        console.log('Found Off-topic type:', value, ', but did not deduce the reason: parentText:', parentText, '::  thisParent:', thisParent);
                        offTopicCloseReasons[value] = 'Off Topic';
                    }
                }
            });
        }

        var checkbox = $('<label><input type="checkbox" style="vertical-align:middle;margin-left: 5px;">Send cv-pls request</label>');
        remainingVotes.append(checkbox);
        $('.popup-submit').click(function() {
            //Clicking on the Vote To Close button
            var $this = $(this);
            if (checkbox.find('input').is(':checked')) {
                cvplsRequestedAfterVote = $this.closest('.question').data('questionid');
            } else {
                cvplsRequestedAfterVote = false;
            }
            //This is not redundant with detecting most of the same information from the $.ajax call. The AJAX call
            // does not contain the text from an already existing "other" reason, it only contains the ID for that reason.
            if ((selected = $('input[name="close-as-off-topic-reason"]:checked', popup)) && selected.val() === '3') {
                var parent = selected.parent().parent();
                var userCustomTextArea = $('textarea', parent);
                if (userCustomTextArea.length) {
                    //User entered a new custom reason.
                    cvplsReasonInput.val('Custom: ' + userCustomTextArea.val().replace($('[name="original_text"]', parent).val(), ''));
                } else {
                    //User selected an already existing custom reason. The actual close reason is not available in the CV AJAX.
                    cvplsReasonInput.val('Custom: ' + $('span.action-name', parent).contents().first().text().trim().replace(/^Other: /, '').replace($('[name="original_text"]', parent.parent()).val(), ''));
                }
                addNoCodeToValueIfIsMcve(cvplsReasonInput);
                //NATO
                addNatoToValueIfIsNatoAndNotEmpty(cvplsReasonInput);
                //Don't need to update the rememberedReason here. It will happen in the vote callback.
            }
        });
    }

    //Permit other user scripts to request that a cv-pls be posted for the next close vote.
    //  If it is desired, they can send a custom event with the questionId for which they want
    //  a cv-pls posted upon the next page $.ajax call which sends a close vote.
    window.addEventListener('cvrg-requestPostRequestForNextVote', function(e) {
        e.preventDefault();
        e.stopImmediatePropagation();
        cvplsRequestedAfterVote = JSON.parse(e.detail).questionId;
    }, true);

    function executeInPage(functionToRunInPage, leaveInPage, id) {
        //Execute a function in the page context.
        // Any additional arguments passed to this function are passed into the page to the
        // functionToRunInPage.
        // Such arguments must be Object, Array, functions, RegExp,
        // Date, and/or other primitives (Boolean, null, undefined,
        // Number, String, but not Symbol).  Circular references are
        // not supported. Prototypes are not copied.
        // Using () => doesn't set arguments, so can't use it to define this function.
        // This has to be done without jQuery, as jQuery creates the script
        // within this context, not the page context, which results in
        // permission denied to run the function.
        function convertToText(args) {
            //This uses the fact that the arguments are converted to text which is
            //  interpreted within a <script>. That means we can create other types of
            //  objects by recreating their normal JavaScript representation.
            //  It's actually easier to do this without JSON.stringify() for the whole
            //  Object/Array.
            var asText = '';
            var level = 0;

            function lineSeparator(adj, isntLast) {
                level += adj - ((typeof isntLast === 'undefined' || isntLast) ? 0 : 1);
                asText += (isntLast ? ',' : '') + '\n' + (new Array((level * 2) + 1)).join('');
            }

            function recurseObject(obj) {
                if (Array.isArray(obj)) {
                    asText += '[';
                    lineSeparator(1);
                    obj.forEach(function(value, index, array) {
                        recurseObject(value);
                        lineSeparator(0, index !== array.length - 1);
                    });
                    asText += ']';
                } else if (obj === null) {
                    asText += 'null';
                } else if (obj === void (0)) {
                    //undefined
                    asText += 'void(0)';
                } else if (Number.isNaN(obj)) {
                    //Special cases for Number
                    //Not a Number (NaN)
                    asText += 'Number.NaN';
                } else if (obj === 1 / 0) {
                    // +Infinity
                    asText += '1/0';
                } else if (obj === 1 / -0) {
                    // -Infinity
                    asText += '1/-0';
                } else if (obj instanceof RegExp || typeof obj === 'function') {
                    //function
                    asText += obj.toString();
                } else if (obj instanceof Date) {
                    asText += 'new Date("' + obj.toJSON() + '")';
                } else if (typeof obj === 'object') {
                    asText += '{';
                    lineSeparator(1);
                    Object.keys(obj).forEach(function(prop, index, array) {
                        asText += JSON.stringify(prop) + ': ';
                        recurseObject(obj[prop]);
                        lineSeparator(0, index !== array.length - 1);
                    });
                    asText += '}';
                } else if (['boolean', 'number', 'string'].indexOf(typeof obj) > -1) {
                    asText += JSON.stringify(obj);
                } else {
                    console.log('Didn\'t handle: typeof obj:', typeof obj, '::  obj:', obj);
                }
            }
            recurseObject(args);
            return asText;
        }
        var newScript = document.createElement('script');
        if (typeof id === 'string' && id) {
            newScript.id = id;
        }
        var args = [];
        //Using .slice(), or other Array methods, on arguments prevents optimization.
        for (var index = 3; index < arguments.length; index++) {
            args.push(arguments[index]);
        }
        newScript.textContent = '(' + functionToRunInPage.toString() + ').apply(null,' +
            convertToText(args) + ');';
        (document.head || document.documentElement).appendChild(newScript);
        if (!leaveInPage) {
            //Synchronous scripts are executed immediately and can be immediately removed.
            //Scripts with asynchronous functionality *may* need to remain in the page
            //  until complete. Exactly what's needed depends on actual usage.
            document.head.removeChild(newScript);
        }
        return newScript;
    }

    function createMarkdownLinkWithText(text, url) {
        //Create a Markdown link with URL: [foo](//example.com/bar)
        return '[' + escapeForMarkdown(text).trim() + '\u202D](' + url + ')';
    }

    function escapeForMarkdown(text) {
        //Quote characters and combinations of characters which might be interpreted as Chat Markdown formatting.
        //Looks like [\[\]`*_] show up as themselves when quoted at any time.
        //"---" does not stop working if \ quoted only at the start. Quoting in the middle of the --- shows the \.
        //Interspersing zero-width spaces works, but it does put the zero-width spaces (\u200B) in the HTML.
        //Interspersing zero-width non-breaking spaces works, but it does put the zero-width non-breaking spaces (\uFEFF) in the HTML.
        return text.replace(/([[\]*`_])/g, '\\$1').replace(/(---)/g, '-\uFEFF-\uFEFF-');
    }

    function stripMarkupLinks(markup) {
        //Strip out links in markup, leaving just the normal text.
        //This only strips custom links, not comment shortcuts.
        return markup.replace(/\[((?:[^\]]|\\\])+?)\]\(.+?\)/g, '$1'); //https://regex101.com/r/ibhmK7/2
    }

    function watchPagejQueryAjaxForCloseVoteAndComplete(listeners) {
        //Adds a listener which is called when the page uses $.ajax to send a close-vote to SE.
        //  This is done by wrapping $.ajax in the page context with a function which sends a
        //  custom event when a call matches the URL for posting a close vote.
        function inPagejQueryAjaxWatchForCloseVoteAndComplete() {
            if (typeof unsafeWindow !== 'undefined') {
                //Prevent this running when not in the page context.
                return;
            }
            /* We could do it in a more jQuery way, but that would be more work at this point and
            //   make it harder to convert to XMLHttpRequest, if desired to catch non-jQuery CV/DV from the page.
                 $(document).ajaxComplete(function(event, jqXHR, ajaxSettings) {
                 $(document).ajaxSuccess(function(event, jqXHR, ajaxSettings, data) {
            //*/
            //Override the $.ajax function so that we can know when an AJAX call completes, is successful, and get data which
            //  is sent in the close-vote POST which contains the type of vote.
            var origAjax = $.ajax;
            $.ajax = function() {
                function sendEvent(eventType, detail) {
                    window.dispatchEvent(new CustomEvent(eventType, {
                        bubbles: true,
                        cancelable: true,
                        detail: JSON.stringify(detail),
                    }));
                }

                function createWrapper(original, postEvent, detail) {
                    return function() {
                        //In order to catch details of the last CV, the CVRG event needs to be sent prior to
                        //  calling the original function, because the original function reloads the page
                        //  upon the last CV.
                        sendEvent(postEvent, detail);
                        if (typeof original === 'function') {
                            original.apply(this, arguments);
                        }
                    };
                }
                var eventDetail = {};
                var options = arguments[(typeof arguments[0] === 'object' ? 0 : 1)];
                if (typeof options === 'object') {
                    var originalComplete = options.complete;
                    eventDetail.data = Object.assign({}, options.data);
                    //Also need the URL for the question number.
                    eventDetail.url = options.url;
                    eventDetail.type = options.type;
                    //Don't send the fkey
                    delete eventDetail.data.fkey;
                    //Watch AJAX Complete
                    options.complete = createWrapper(originalComplete, 'cvrg-jQueryAJAX-Complete', eventDetail);
                    var originalSuccess = options.success;
                    if (options.type === 'POST' && /\/flags\/questions\/\d+\/close\/add/.test(options.url)) {
                        options.success = createWrapper(originalSuccess, 'cvrg-jQueryAJAX-SECloseVote-Success', eventDetail);
                        sendEvent('cvrg-jQueryAJAX-SECloseVote', eventDetail);
                    }
                    if (options.type === 'GET' && /\/posts\/\d+\/vote\/10$/.test(options.url)) {
                        options.success = createWrapper(originalSuccess, 'cvrg-jQueryAJAX-SEDeleteVote-Success', eventDetail);
                        sendEvent('cvrg-jQueryAJAX-SEDeleteVote', eventDetail);
                    }
                }
                return origAjax.apply(this, arguments);
            };
        }
        executeInPage(inPagejQueryAjaxWatchForCloseVoteAndComplete, true, 'cvrg-watchPagejQueryAJAX');
        var knownListeners = {
            complete: 'cvrg-jQueryAJAX-Complete',
            closeVote: 'cvrg-jQueryAJAX-SECloseVote',
            closeVoteSuccess: 'cvrg-jQueryAJAX-SECloseVote-Success',
            deleteVote: 'cvrg-jQueryAJAX-SEDeleteVote',
            deleteVoteSuccess: 'cvrg-jQueryAJAX-SEDeleteVote-Success',
        };
        if (listeners && typeof listeners === 'object') {
            Object.keys(knownListeners).forEach((key) => {
                var listener = listeners[key];
                if (typeof listener === 'function') {
                    //Listen for the custom event sent upon a close-vote.
                    window.addEventListener(knownListeners[key], function(e) {
                        listener(JSON.parse(e.detail));
                    });
                }
            });
        }
    }

    watchPagejQueryAjaxForCloseVoteAndComplete({
        complete: function() {
            //Some $.ajax is complete. This can signal that the page was updated. Wait for everything to be done,
            //  then make sure the GUIs are up to date.
            setTimeout(addCvplsToDom, 50);
        },
        closeVote: function(eventDetail) {
            //Listen for close-votes posted via in-page $.ajax.
            var closeData = eventDetail.data;
            var ajaxQuestionId = eventDetail.url.replace(/^[^\d]+(\d\d+)[^\d]+$/, '$1');
            var questionGui = CVRGUI.getQuestionGuiForId(ajaxQuestionId);
            if (!questionGui) {
                console.error('Did not find cv-pls GUI for Close Vote AJAX with question ID:', ajaxQuestionId);
                return;
            } //else
            //Change the default reason for the request to match the reason used in the close-vote. This can
            //  not detect the text used when an already existing "other" (custom) close reason is used.
            var cvplsReasonInput = questionGui.requestReasonInput;
            var origReasonVal = cvplsReasonInput.val();
            cvplsReasonInput.val(closeData.closeReasonId.replace(/(?!^)([A-Z])/g, ' $1'));
            if (closeData.closeReasonId === 'OffTopic') {
                cvplsReasonInput.val(offTopicCloseReasons[closeData.closeAsOffTopicReasonId]);
            }
            if (closeData.closeAsOffTopicReasonId == 3) { // eslint-disable-line eqeqeq
                cvplsReasonInput.val('Custom: ' + closeData.offTopicOtherText.replace(closeData.originalOffTopicOtherText, '').trim());
                if (origReasonVal && (closeData.offTopicOtherCommentId || !cvplsReasonInput.val())) {
                    //If the user selected an already existing "other" reason (i.e. offTopicOtherCommentId is valid), then we
                    //  had to get the information from the close dialog, as it's not passed in the AJAX, just the ID is passed.
                    //Restore the already existing comment.
                    cvplsReasonInput.val(origReasonVal);
                }
            }
            //Strip markdown links from the close reason. This is done so that custom reasons which contain links, won't transfer those links
            //  to the cv-pls request. Request by @JohnDvorak: https://chat.stackoverflow.com/transcript/message/39568105#39568105
            cvplsReasonInput.val(stripMarkupLinks(cvplsReasonInput.val()));
            //If No MCVE and no code, then state that
            addNoCodeToValueIfIsMcve(cvplsReasonInput);
            //NATO
            addNatoToValueIfIsNatoAndNotEmpty(cvplsReasonInput);
            //Ensure we're sending a cv-pls, just in case.
            questionGui.requestTypeInput.val('cv-pls');
        },
        closeVoteSuccess: function(eventDetail) {
            //We only get here if the close-vote was successful.
            var ajaxQuestionId = eventDetail.url.replace(/^[^\d]+(\d\d+)[^\d]+$/, '$1');
            var questionGui = CVRGUI.getQuestionGuiForId(ajaxQuestionId);
            questionGui.saveRequestInfo('closeVoted', 'quick');
            if (cvplsRequestedAfterVote == ajaxQuestionId) { // eslint-disable-line eqeqeq
                //The close-vote was about the same question as the one for which we are waiting for a close-vote to send a cv-pls.
                cvplsRequestedAfterVote = false;
                //Ensure we're sending a cv-pls, just in case.
                questionGui.requestTypeInput.val('cv-pls');
                questionGui.submitRequest();
            }
        },
        deleteVoteSuccess: function(eventDetail) {
            //We only get here if a delete-vote was successful.
            var ajaxPostId = eventDetail.url.replace(/^[^\d]+(\d\d+)\/vote\/10$/, '$1');
            var postGui = CVRGUI.getGuiForId(ajaxPostId);
            if (postGui) {
                postGui.saveRequestInfo('deleteVoted', 'quick');
            } else {
                console.error('Got delete vote for a post for which there isn\'t a GUI', '::  ajaxPostId:', ajaxPostId);
            }
        },
    });

    function detectCloseVoteDialogOpen() {
        //Called when the close vote dialog should be open.
        if ($('#popup-close-question').length) {
            //If it is open, deal with it.
            closeVoteDialogIsOpen();
        }
    }

    //Watch StackExchange functions
    function isSEFunctionValid(seFunctionText) {
        //Test to see if a StackExchange method is currently valid.
        return isPageFunctionValid('StackExchange.' + seFunctionText);
    }

    function isPageFunctionValid(methodName) {
        //Given potentially nested property names, determine if the named
        //  function exists in the page and is a function.
        //NOTE: unsafeWindow properties are *only* used without invoking getters
        //If we are already in an environment where we are in the page context (e.g. Tampermonkey w/ @grant none), use window instead of unsafeWindow.
        var win = typeof unsafeWindow === 'undefined' ? window : unsafeWindow;
        //Determine if StackExchange.question.init is a function without invoking any getters in this context.
        return typeof methodName.split('.').reduce(function(sum, prop) {
            var type = typeof sum;
            if (type === 'object' || type === 'function') {
                var descriptor = Object.getOwnPropertyDescriptor(sum, prop);
                return descriptor ? descriptor.value : false;
            } //else
            return false;
        }, win) === 'function';
    }

    function watchEvents(eventTypeBase, listeners) {
        //Add listeners for the indicated events. Each event has a base name with
        //  a postfix added based on the key used to store the function reference in the
        //  listeners Object. This will normally be 'before' and 'after', but could be
        //  anything.
        if (typeof listeners !== 'object') {
            return;
        }
        Object.keys(listeners).forEach(function(prop) {
            var listener = listeners[prop];
            if (typeof listener === 'function') {
                var eventType = eventTypeBase + '-' + prop;
                window.addEventListener(eventType, listener, true);
            }
        });
    }

    function watchSEFunction(seFunction, eventPrefix, listeners) {
        //Watch for in-page execution of a StackExchange method. This is done by wrapping the function.
        //  The wrapper then sends custom events before and after execution of the function.
        if (!isSEFunctionValid(seFunction)) {
            //The function is not valid
            return;
        }

        function inPageWatchSEFunction(seMethodText, eventTypeBase) {
            if (typeof unsafeWindow !== 'undefined') {
                //Prevent this running when not in the page context.
                return;
            }
            var split = seMethodText.split('.');
            var methodName = split.pop();
            var obj = split.reduce(function(sum, prop) {
                var type = typeof sum;
                if (type === 'object' || type === 'function') {
                    return sum[prop];
                }// else
                return void 0;
            }, StackExchange);
            var origSEFuction = obj[methodName];
            if (typeof origSEFuction !== 'function') {
                //If it's not a function, then we can't deal with it here.
                return;
            }
            obj[methodName] = function() {
                window.dispatchEvent(new Event(eventTypeBase + '-before', {
                    bubbles: true,
                    cancelable: true,
                }));
                var toReturn = origSEFuction.apply(this, arguments);
                window.dispatchEvent(new Event(eventTypeBase + '-after', {
                    bubbles: true,
                    cancelable: true,
                }));
                return toReturn;
            };
        }
        var eventTypeBase = eventPrefix + seFunction;
        executeInPage(inPageWatchSEFunction, true, 'cvrg-watchSEFunction-' + seFunction, seFunction, eventTypeBase);
        watchEvents(eventTypeBase, listeners);
    }

    var seFunctionsToWatch = [
        //A list of StackExchange functions to monitor. This is used to detect when the page has been
        //  updated with new information. It is less resource intensive than using a MutationObserver
        //  to listen to all DOM change events.
        //Times to check to see if the cv-pls is in the page. This will be due to DOM changes,
        // which could be because a different question is being shown, or we're back from an edit.
        /* beautify preserve:start */
        /* eslint-disable no-multi-spaces */
        {seFunction: 'question.init',                           listeners: {after: addCvplsToDom}},
        {seFunction: 'question.initFull',                       listeners: {after: addCvplsToDom}},
        {seFunction: 'beginEditEvent.cancel',                   listeners: {after: addCvplsToDom}}, //Happens on edit cancel (then SE.using returns)
        {seFunction: 'using',                                   listeners: {after: addCvplsToDom}},
        {seFunction: 'helpers.removeSpinner',                   listeners: {after: addCvplsToDom}},
        {seFunction: 'question.getQuestionId',                  listeners: {after: addCvplsToDom}},
        {seFunction: 'question.bindSuggestedEditPopupLinks',    listeners: {after: addCvplsToDom}}, //Happens when getting a new question/answer version due to someone else editing (at least on answers)
        //Detect Close-Vote popup opening
        {seFunction: 'helpers.bindMovablePopups',               listeners: {after: detectCloseVoteDialogOpen}},
        /* beautify preserve:end */
        /* eslint-enable no-multi-spaces */
    ];

    var postSEReadyTimeout = 0;

    function listenerForSEReady(e, extraTime) {
        //Watch the SE.ready function. That function is called, sometimes, when SE makes major changes within the page.
        //  The callback for it is called when the StackExchange Object has been updated with additional functionality. Many of the
        //  functions which we desire to watch don't exist until the callback function is called. Thus, if the watcher has not
        //  already been placed, we check for the existence of the function which we desire to watch and add the watcher
        //  if the SE function exists.
        addCvplsToDom();
        var didPlace = false;
        var allPlaced = true;
        seFunctionsToWatch.forEach(function(watcher) {
            if (!watcher.placed) {
                allPlaced = false;
                if (isSEFunctionValid(watcher.seFunction)) {
                    watcher.placed = true;
                    didPlace = true;
                    watchSEFunction(watcher.seFunction, 'cvrg-SE-', watcher.listeners);
                }
            }
        });
        //In some instances, SE functions are added sometime after the SE.ready method is called (not when it calls it's callback).
        //  We thus delay 1s after it's called and try again for any functions we still need.
        //  This is repeated up to 10 times, if additional functions were placed.
        //  If the initial check indicates all functions were placed, then it's not called again
        //  after 1s.
        //Only have one timeout at a time.
        clearTimeout(postSEReadyTimeout);
        extraTime = typeof extraTime === 'number' ? extraTime : 0;
        if (!allPlaced && extraTime < 10000 && (!extraTime || didPlace)) {
            //Only keep looking if we have not looked once after a 1s delay, or we found something to place.
            extraTime += 1000;
            //Wait 1s and then try again.
            postSEReadyTimeout = setTimeout(listenerForSEReady, 1000, null, extraTime);
        }
    }
    watchSEFunction('ready', 'cvrg-SE-', {
        after: listenerForSEReady,
    });

    //Perform a check for the SE functions we're watching when the callback for SE.ifUsing is executed.
    //  Use SE.ifUsing in order not to change what's actually loaded on the page we're in.
    function inPageWatchSEUsing() {
        StackExchange.ready(function() {
            window.dispatchEvent(new CustomEvent('cvrg-SEActuallyReady', {
                bubbles: true,
                cancelable: true,
            }));
        });
        var types = [
            'adops',
            'anonymous',
            'autocomplete',
            'beginEditEvent',
            'editor',
            'eventCharts',
            'exploreQuestions',
            'externalEditor',
            'gps',
            'help',
            'inlineEditing',
            'inlineTagEditing',
            'keyboardShortcuts',
            'loggedIn',
            'mathjaxEditing',
            'mathjaxEditingBeta',
            'mobile',
            'mockups',
            'postValidation',
            'prettify',
            'pseudoModerator',
            'review',
            'revisions',
            'schematics',
            'snippets',
            'snippetsJsCodeMirror',
            'tagAutocomplete',
            'tagEditor',
            'tagSuggestions',
            'translation',
            'virtualKeyboard',
        ];
        types.forEach(function(type) {
            StackExchange.ifUsing(type, function() {
                window.dispatchEvent(new CustomEvent('cvrg-useSEifUsing', {
                    bubbles: true,
                    cancelable: true,
                    detail: type,
                }));
            });
        });
    }
    window.addEventListener('cvrg-useSEifUsing', listenerForSEReady, true);
    executeInPage(inPageWatchSEUsing, true, 'cvrg-useSEifUsing');

    //Watch for SE.ready. Various functions which we're interested in are available when SE.ready fires.
    function inPageGetSEReady() {
        StackExchange.ready(function() {
            window.dispatchEvent(new CustomEvent('cvrg-SEActuallyReady', {
                bubbles: true,
                cancelable: true,
            }));
        });
    }
    window.addEventListener('cvrg-SEActuallyReady', listenerForSEReady, true);
    executeInPage(inPageGetSEReady, true, 'cvrg-getSEReady');

    //Keep track of various lists of user actions, or user requests to happen later (e.g. del-pls (in 2 days)).

    function getObjectKeysOlderThanDays(obj, props, days) {
        //Get the keys in the Object which have a date (stored in ms from Epoch) which are older
        //  than days.
        const cutoffTime = Date.now() - (days * 24 * 60 * 60 * 1000);
        props = Array.isArray(props) ? props : [props];
        var matches = Object.keys(obj).filter(function(key) {
            var keyValue = obj[key];
            return props.every(function(prop) {
                return (typeof keyValue[prop] !== 'number' || keyValue[prop] < cutoffTime);
            });
        });
        return matches;
    }

    function ifNotLockedGetLockOnGMStorageAndDo(storageKey, callback, failCallback, delay) {
        //If we currently don't have a lock on the storageKey, then obtain a lock.
        //  Once a lock is obtained, call the callback.
        //  If we fail to get a lock call the failCallback.
        //This function is inherently asynchronous. There is always a delay between requesting a lock
        //  and executing the callback in order to give any other instance which is attempting to get a lock
        //  at exactly the same time to complete doing so. After the timeout, the last to have requested a lock
        //  is the owner.
        var lockKey = storageKey + '-Lock';
        var currentLockJSON = getGMStorage(lockKey);
        var isCurrentLockValid = true;
        var currentLock;
        try {
            currentLock = JSON.parse(currentLockJSON);
        } catch (e) {
            isCurrentLockValid = false;
        }
        if (isCurrentLockValid) {
            //Check for ways a currently existing lock might be invalid.
            if (currentLock) {
                if (!currentLock.time || currentLock.time < (Date.now() - (1 * 60 * 1000))) {
                    //A lock that was obtained more than 2 minutes ago is invalid.
                    isCurrentLockValid = false;
                }
            } else {
                isCurrentLockValid = false;
            }
        }
        if (isCurrentLockValid) {
            //Some other CVRG has a valid lock on the delayedRequest list.
            console.log('Some other instance has a lock on ' + storageKey + ': currentLock:', currentLock);
            if (typeof failCallback === 'function') {
                failCallback();
            }
            return null;
        }
        setGMStorageJSON(lockKey, {
            time: Date.now(),
            url: location.href,
            instanceId: scriptInstanceIdentifier,
        });
        //The callback has to release the lock, if desired.
        //The setTimeout is used to allow any other instances to be attempting to get the lock
        //  at the same time. Whichever one was last, will have obtained the lock.
        setTimeout(doIfLockOwner, (delay ? delay : 1000), storageKey, callback, failCallback);
    }

    function isThisInstanceOwner(lock) {
        return lock && lock.url === location.href && lock.instanceId === scriptInstanceIdentifier;
    }

    function releaseGMStorageLockIfOwner(storageKey) {
        var lockKey = storageKey + '-Lock';
        var lock = getGMStorageJSON(lockKey);
        if (isThisInstanceOwner(lock)) {
            GM_deleteValue(lockKey);
        }
    }

    function doIfLockOwner(storageKey, callback, failCallback) {
        var lockKey = storageKey + '-Lock';
        var lock = getGMStorageJSON(lockKey);
        if (isThisInstanceOwner(lock)) {
            callback();
            return true;
        }
        if (typeof failCallback === 'function') {
            failCallback();
        }
        return false;
    }

    //retry really needs to be a queue per storage key. As it is, operations could occur out of order.
    function retryUntilGetGMLock(storageKey, callback, delayBetweenTries, delayForLock) {
        function failCallback() {
            //Try again later
            setTimeout(retryUntilGetGMLock, (delayBetweenTries ? delayBetweenTries : 2000), storageKey, callback, delayBetweenTries);
        }
        ifNotLockedGetLockOnGMStorageAndDo(storageKey, callback, failCallback, delayForLock);
    }

    function quickLockOrRetryGMStorageAtomicUpdate(quick, storageKey, operation, data, callback, failCallback, delayForLock, localGm) {
        if (quick === 'quick') {
            //Just store. Ignore trying to get a lock. Used when the page might be reloaded.
            atomicObjectUpdate(storageKey, operation, data, localGm);
        } else if (quick === 'lock') {
            ifNotLockedGetLockOnGMStorageAndDo(storageKey, function() {
                atomicObjectUpdate(storageKey, operation, data, localGm);
                if (typeof callback === 'function') {
                    callback();
                }
            }, failCallback, delayForLock);
        } else if (quick === 'retry') {
            //retry really needs to be a queue per storage key. As it is, operations could occur out of order.
            retryUntilGetGMLock(storageKey, function() {
                atomicObjectUpdate(storageKey, operation, data, localGm);
                if (typeof callback === 'function') {
                    callback();
                }
            });
        } else {
            console.error('quickLockOrRetryGMStorageAtomicUpdate: quick not understood:', quick);
            console.trace();
        }
    }

    //Delayed requests
    function DelayedRequest(_postType, _postId, _requestType, _request, _days) {
        //Constructor for a delayed request (revisit)
        var now = Date.now();
        this.requestedTime = now;
        this.actionTime = now + (_days * 24 * 60 * 60 * 1000);
        this.request = _request;
        this.requestType = _requestType;
        this.postType = _postType;
        this.postId = _postId;
        this.room = getCurrentRoom();
        this.site = window.location.hostname;
    }

    //XXX Information about delayed requests is also partially stored in remembered requests, so this should scan through
    //      those and delete the ones which have information about delayed requests.
    function deleteDelayedRequests(event) {
        //Clear the delayed requests, per user action
        GM_deleteValue(delayedRequestStorage);
        GM_deleteValue(delayedRequestStorage + '-Lock');
        if (event) {
            event.preventDefault();
            event.target.textContent = knownOptions.buttons.deleteDelayedRequests.text + knownOptions.buttons.deleteDelayedRequests.dynamicText();
        }
    }

    function getNumberDelayedRequestsAsAddedText() {
        return ' (' + getNumberDelayedRequests() + ')';
    }

    function getNumberDelayedRequests() {
        return Object.keys(getGMStorageJSON(delayedRequestStorage)).length;
    }

    function checkDelayedRequestsAndProcess() {
        //Check to see if any delayed requests need action.
        //  This *must* be run only after getting a lock on the delayedRequestStorage in order to prevent
        //  having multiple tabs which are opened at the same time sending duplicate requests.
        var originalRoom = getCurrentRoom();
        var later = getGMStorageJSON(delayedRequestStorage);
        //Get an Array of delayed requests where the .actionTime is prior to now.
        var actionable = getObjectKeysOlderThanDays(later, 'actionTime', 0);
        var actioned = [];

        function processActionable(itemKey, hasRoom, success) {
            if (itemKey) {
                var item = later[itemKey];
                actioned.push(itemKey);
                var itemInfo = item.postType + ': ' + item.postId;
                if (success) {
                    if (configOptions.numbers.daysRememberRequests) {
                        //Update the remembered state of the request from 'delayed' to 'posted' or 'pending'
                        quickLockOrRetryGMStorageAtomicUpdate('quick', rememberedRequestStorage, function(obj) {
                            var toUpdate = obj[itemKey];
                            //We should not get here without a record, but account for the possibility.
                            toUpdate = toUpdate ? toUpdate : {};
                            Object.assign(toUpdate, (configOptions.checkboxes.automaticlyPostDelayedRequests ? {
                                state: 'posted',
                                postedTime: Date.now(),
                            } : {
                                state: 'pending',
                            }));
                            var toStore = {
                                [itemKey]: toUpdate,
                            };
                            Object.assign(obj, toStore);
                            Object.assign(rememberedRequests, toStore);
                            return {
                                changed: true,
                                result: obj,
                            };
                        });
                        if (!configOptions.checkboxes.automaticlyPostDelayedRequests) {
                            //Now that the state has been changed, we can open the tab with the question/answer to deal with:
                            GM.openInTab('https://' + item.site + '/' + item.postType[0] + '/' + item.postId, true);
                        }
                    }
                    if (configOptions.checkboxes.automaticlyPostDelayedRequests) {
                        notify('As requested, a delayed ' + item.requestType + ' has been posted for ' + itemInfo + '.');
                    } else {
                        notify('A tab is being opened for you to review a post due to a delayed ' + item.requestType + ' request: ' + itemInfo, 5000);
                    }
                } else {
                    if (configOptions.checkboxes.automaticlyPostDelayedRequests) {
                        notify('Failed to send a delayed ' + item.requestType + '. Will retry next time you load a SE page. ' + itemInfo, 0, notifyCSS.fail);
                    }
                }
                if (configOptions.checkboxes.automaticlyPostDelayedRequests && !hasRoom) {
                    //The RoomList no longer contained the room to which the request was sent, so delete it.
                    delete RoomList.rooms[item.room];
                    RoomList.save();
                }
            }
            if (actioned.length >= actionable.length) {
                //We're done with all actionable items
                if (actionable.length > 0) {
                    atomicObjectUpdate(delayedRequestStorage, 'delete', actioned);
                    setCurrentRoom(originalRoom);
                }
                releaseGMStorageLockIfOwner(delayedRequestStorage);
            } else {
                var nextItemKey = actionable[actioned.length];
                if (configOptions.checkboxes.automaticlyPostDelayedRequests) {
                    hasRoom = RoomList.url(later[nextItemKey].room);
                    setCurrentRoom(later[nextItemKey].room);
                    //Send the current request. Once complete, iterate over the next item.
                    sendRequest(later[nextItemKey].request, processActionable.bind(null, nextItemKey, hasRoom), true);
                } else {
                    setTimeout(processActionable, 0, nextItemKey, hasRoom, true);
                }
            }
        }
        processActionable();
    }

    //Try to get a lock on the delayed request list, if so, process it for any to send.
    //Do nothing if unable to get a lock. That case should be that another tab is processing.
    ifNotLockedGetLockOnGMStorageAndDo(delayedRequestStorage, checkDelayedRequestsAndProcess);

    //Remembered requests
    function RequestInfo(_postType, _postId, _requestType, _reason, _state) {
        //Constructor for a request record
        var now = Date.now();
        this.createdTime = now;
        this.updatedTime = now;
        this.reason = _reason;
        this.requestType = _requestType;
        this.postType = _postType;
        this.postId = _postId;
        /* .state reflects the last thing the user did. Used states are:
            'created' = request has been created (used when user just enters some data).
            'posted' = request has been posted
            'delayed' = User has requested that the request be processed some time later (delayedTime)
            'closeVoted' = User voted to close (closeVotedTime)
            'deleteVoted' = User voted to delete (deleteVotedTime)
            'pending' = A delayed request is in the process of being shown to the user.
            'triedToPost' = Attempted to post a request, but it failed.
            'triedToDelay' = Attempted to register a delayed request, but it failed.
            ...
        */
        this.state = _state;
        this.site = window.location.hostname;
        /* Additional properties which are initially undefined:
            postedTime
            delayedTime
            closeVotedTime
            deleteVotedTime
        */
    }

    //XX Should not prune revisit requests which have not passed, or been deleted.
    function pruneRememberedRequests() {
        //Actually prune the requests list. Non-critical. If we don't get a lock, we'll just get it next time.
        ifNotLockedGetLockOnGMStorageAndDo(rememberedRequestStorage, function() {
            atomicObjectUpdate(rememberedRequestStorage, 'delete', function(requests) {
                //Get a list of all remembered requests which have not been changed in user set # days.
                var toDelete = getObjectKeysOlderThanDays(requests, ['createdTime', 'updatedTime', 'delayedTime', 'postedTime'], configOptions.numbers.daysRememberRequests);
                return toDelete;
                //return getObjectKeysOlderThanDays(requests, ['createdTime', 'updatedTime', 'delayedTime', 'postedTime'], configOptions.numbers.daysRememberRequests);
            });
            releaseGMStorageLockIfOwner(rememberedRequestStorage);
            rememberedRequests = getGMStorageJSON(rememberedRequestStorage);
        });
    }
    pruneRememberedRequests();

    function lazyUpdateRememberedRequests() {
        setTimeout(function() {
            rememberedRequests = getGMStorageJSON(rememberedRequestStorage);
        }, 0);
    }

    var rememberedRequestsChangeListener;

    function trackRememberedRequestsChangesIfPossible() {
        //If the user script manager in which this is running allows listening for changes to
        //  user script storage, then listen for changes to the shortcut key (e.g. in another tab).
        if (!canListenGMStorage || //Not available: Greasemonkey
            rememberedRequestsChangeListener //Already added, don't add again
        ) {
            return;
        }
        rememberedRequestsChangeListener = GM_addValueChangeListener(rememberedRequestStorage, function(name, oldValue, newValue, remote) {
            //Listen for external changes.
            if (remote) {
                rememberedRequests = JSON.parse(newValue);
            }
        });
    }
    trackRememberedRequestsChangesIfPossible();

    //Maintain the correct top-bar margin-top when a notification is added.
    //  This is a fix for SE not setting the margin-top correctly.
    function keepTopbarMarginAtNotifyConainer() {
        const notifyContainer = $('#notify-container');
        const topBar = $('.top-bar').first();
        const container = $(document.body);
        const $window = $(window);
        let prevNotifyContainerDisplay;
        let prevNotifyContainerHeight;
        let prevIsScrolled;
        let prevTopbarMarginTop;
        let prevContainerMarginTop;
        let topbarNotifierTimer;

        function handleScrollEvent() {
            //We only care if the state of the page being scrolled has changed.
            const isScrolled = !!window.scrollY;
            if (prevIsScrolled !== isScrolled) {
                adjustTopbarMarginToNotifyContainer();
            }
        }

        function adjustTopbarMarginToNotifyContainer(dontSetTimer, delayedBy) {
            //The observer is called for your own changes, so need to stop observing prior to making a change.
            const isScrolled = !!window.scrollY;
            const notifyContainerDisplay = notifyContainer.css('display');
            const notifyContainerHeight = notifyContainer.children().toArray().reduce((sum, el) => (sum + el.getBoundingClientRect().height), 0);
            const topbarMarginTop = topBar.css('margin-top');
            const containerMarginTop = container.css('margin-top');
            const containerMarginTopStyle = ((container.attr('style') || '').match(/margin-top:\s*([^;]+);/) || ['', ''])[1];
            if (containerMarginTopStyle !== '2.5em' &&
                prevIsScrolled === isScrolled &&
                prevNotifyContainerDisplay === notifyContainerDisplay &&
                prevNotifyContainerHeight === notifyContainerHeight &&
                prevTopbarMarginTop === topbarMarginTop &&
                prevContainerMarginTop === containerMarginTop
            ) {
                //Do no more. We've already set this state.
                return;
            }
            prevIsScrolled = isScrolled;
            prevNotifyContainerDisplay = notifyContainerDisplay;
            prevNotifyContainerHeight = notifyContainerHeight;
            prevTopbarMarginTop = topbarMarginTop;
            prevContainerMarginTop = containerMarginTop;
            //Don't get re-called by our own changes
            stopObservingTopbarStyle();
            if (notifyContainerDisplay === 'none' || notifyContainerHeight === 0) {
                $window.off('scroll', handleScrollEvent);
                topBar.css('margin-top', '');
                container.css('margin-top', '');
            } else {
                topBar.css('margin-top', notifyContainerHeight + 'px');
                if (isScrolled) {
                    //SE already applies a margin-top to the body when a notification is created.
                    container.css('margin-top', '');
                } else {
                    //This shifts the entire page down. That's reasonable in order not to cover the question title when
                    //  the page has not been scrolled down. However, once the user has scrolled, then it's better not
                    //  to be moving the page around on the user.
                    container.css('margin-top', notifyContainerHeight + 'px');
                }
                $window.on('scroll', handleScrollEvent);
            }
            startObservingTopbarStyle();
            if (dontSetTimer !== true) {
                console.log('clearing topbarNotifierTimer:', topbarNotifierTimer);
                //Set a few timers to re-adjust the margin. Something keeps reseting it.
                clearTimeout(topbarNotifierTimer);
                topbarNotifierTimer = setTimeout(adjustTopbarMarginToNotifyContainer, 50, true, 50);
            }
        }

        const topbarStyleObserver = new MutationObserver(adjustTopbarMarginToNotifyContainer);

        function startObservingTopbarStyle() {
            topbarStyleObserver.observe(topBar[0], {
                attributes: true,
                attributeFilter: [
                    'style',
                ],
            });
        }

        function stopObservingTopbarStyle() {
            topbarStyleObserver.disconnect();
        }

        adjustTopbarMarginToNotifyContainer();
        startObservingTopbarStyle();
    }
    keepTopbarMarginAtNotifyConainer();
})();
