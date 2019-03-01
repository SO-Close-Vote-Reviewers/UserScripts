// ==UserScript==
// @name         CRUDE: Unclosed Request Review Script
// @namespace    http://github.com/Tiny-Giant
// @version      2.1.0
// @description  CRUDE (Hack/Pre-alpha): Adds buttons to the chat buttons controls; clicking on the button takes you to the recent unclosed close vote request, or delete request query, then it scans the results and displays them along with additional information.
// @author       @TinyGiant @rene @mogsdad @Makyen
// @include      /^https?://chat\.stackexchange\.com/rooms/(?:2165|88696)(?:\b.*$|$)/
// @include      /^https?://chat\.stackexchange\.com/search.*[?&]room=(?:2165|88696)(?:\b.*$|$)/
// @include      /^https?://chat\.stackexchange\.com/transcript/(?:2165|88696)(?:\b.*$|$)/
// @include      /^https?://chat\.stackexchange\.com/transcript/.*$/
// @include      /^https?://chat\.stackexchange\.com/users/.*$/
// @require      https://github.com/SO-Close-Vote-Reviewers/UserScripts/raw/master/gm4-polyfill.js
// @grant        GM_openInTab
// @grant        GM.openInTab
// ==/UserScript==
/* jshint -W097 */
/* jshint -W107 */
/* jshint esnext:true */
/* globals CHAT */

(function() {
    'use strict';

    if (window !== window.top) {
        //If this is running in an iframe, then we do nothing.
        return;
    }
    if (window.location.pathname.indexOf('/transcript/message') > -1) {
        //This is a transcript without an indicator in the URL that it is a room for which we should be active.
        if (document.title.indexOf('CRUDE') === -1 &&
            document.title.indexOf('CRUDE Archive') === -1
        ) {
            //The script should not be active on this page.
            return;
        }
    }

    const NUMBER_UI_GROUPS = 8;
    const LSPREFIX = 'unclosedRequestReview-';
    const MAX_DAYS_TO_REMEMBER_VISITED_LINKS = 7;
    const MAX_BACKOFF_TIMER_SECONDS = 120;
    const MESSAGE_THROTTLE_PROCESSING_ACTIVE = -9999;
    const MESSAGE_PROCESSING_DELAY_FOR_MESSAGE_VALID = 1000;
    const MESSAGE_PROCESSING_DELAYED_ATTEMPTS = 5;
    const MESSAGE_PROCESSING_ASSUMED_MAXIMUM_PROCESSING_SECONDS = 10;
    const DEFAULT_MINIMUM_UPDATE_DELAY = 5; // (seconds)
    const DEFAULT_AUTO_UPDATE_RATE = 5; // (minutes)
    const MESSAGE_PROCESSING_REQUEST_TYPES = ['questions', 'answers', 'posts'];
    const UI_CONFIG_DEL_PAGES = 'uiConfigDel';
    const UI_CONFIG_CV_PAGES = 'uiConfigCv';
    const UI_CONFIG_REOPEN_PAGES = 'uiConfigReopen';
    const months3charLowerCase = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
    const weekdays3charLowerCase = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
    /* The following code for detecting browsers is from my answer at:
     *   http://stackoverflow.com/a/41820692/3773011
     *   which is based on code from:
     *   http://stackoverflow.com/a/9851769/3773011
     */
    //Opera 8.0+ (tested on Opera 42.0)
    const isOpera = (!!window.opr && !!window.opr.addons) || !!window.opera || navigator.userAgent.indexOf(' OPR/') >= 0;
    //Firefox 1.0+ (tested on Firefox 45 - 53)
    const isFirefox = typeof InstallTrigger !== 'undefined';
    //Internet Explorer 6-11
    //   Untested on IE (of course). Here because it shows some logic for isEdge.
    const isIE = /*@cc_on!@*/false || !!document.documentMode;
    //Edge 20+ (tested on Edge 38.14393.0.0)
    const isEdge = !isIE && !!window.StyleMedia;
    //The other browsers are trying to be more like Chrome, so picking
    //  capabilities which are in Chrome, but not in others, is a moving
    //  target.  Just default to Chrome if none of the others is detected.
    const isChrome = !isOpera && !isFirefox && !isIE && !isEdge;
    // Blink engine detection (tested on Chrome 55.0.2883.87 and Opera 42.0)
    const isBlink = (isChrome || isOpera) && !!window.CSS; // eslint-disable-line no-unused-vars

    //Various objects to hold functions and current state.
    const funcs = {
        visited: {},
        config: {},
        backoff: {},
        ui: {},
        mmo: {},
        mp: {},
        orSearch: {},
    };
    //Current state information
    const config = {
        ui: {},
        nonUi: {},
        backoff: {},
    };
    //Global backoff timer, which is synced between tabs.
    const backoffTimer = {
        timer: 0,
        isPrimary: false,
        timeActivated: 0,
        milliseconds: 0,
    };
    //State for message processing
    const messageProcessing = {
        throttle: 0,
        throttleTimeActivated: 0,
        isRequested: false,
        interval: 0,
        mostRecentRequestInfoTime: 0,
    };
    //State information for adding OR functionality to searches.
    const orSearch = {
        framesToProces: 0,
        maxPages: 0,
    };

    //Update RegExp from list here: https://github.com/AWegnerGitHub/SE_Zephyr_VoteRequest_bot
    const pleaseRegExText = '(?:pl(?:ease|s|z)|p.?[sz]|.?l[sz]|pl.?|.pl[sz]|p.l[sz]|pl.[sz]|pl[sz].)';
    const requestTagRegExStandAlonePermittedTags = '(?:spam|off?en[cs]ive|abb?u[cs]ive|(?:re)?-?flag(?:-?(?:naa|spam|off?en[cs]ive|rude|abb?u[cs]ive))|(?:(?:naa|spam|off?en[cs]ive|rude|abb?u[cs]ive)-?(?:re)?-?flag))'; //spam is an actual SO tag, so we're going to need to deal with that.
    const requestTagRequirePleaseRegExText = '(?:cv|(?:un-?)?(?:del(?:v)?|dv|delete)|rov?|re-?open|app?rove?|reject|rv|review|(?:re)?-?flag|nuke?|spam|off?en[cs]ive|naa|abbu[cs]ive)';
    const requestTagRequirePleaseOrStandAloneRegExText = '(?:' + requestTagRequirePleaseRegExText + '|' + requestTagRegExStandAlonePermittedTags + ')';
    const requestTagRequirePleasePleaseFirstRegExText = '(?:' + pleaseRegExText + '[-.]?' + requestTagRequirePleaseOrStandAloneRegExText + ')';
    const requestTagRequirePleasePleaseLastRegExText = '(?:' + requestTagRequirePleaseOrStandAloneRegExText + '[-.]?' + pleaseRegExText + ')';
    const requestTagRegExText = '\\b(?:' + requestTagRegExStandAlonePermittedTags + '|' + requestTagRequirePleasePleaseFirstRegExText + '|' + requestTagRequirePleasePleaseLastRegExText + ')\\b';
    //Current, now older, result: https://regex101.com/r/dPtRnS/3
    /*Need to update with (?:re\W?)? for flags
    \b(?:(?:spam|off?ensive|abb?usive|flag(?:-?(?:naa|spam|off?ensive|rude|abb?usive))|(?:(?:naa|spam|off?ensive|rude|abb?usive)-?flag))|(?:(?:pl(?:ease|s|z)|p.?[sz]|.?l[sz]|pl.?|.pl[sz]|p.l[sz]|pl.[sz]|pl[sz].)-(?:(?:cv|(?:un)?(?:del(?:v)?|dv|delete)|rov?|reopen|app?rove?|reject|rv|review|flag|nuke?|spam|off?ensive|naa|abbusive)|(?:spam|off?ensive|abb?usive|flag(?:-?(?:naa|spam|off?ensive|rude|abb?usive))|(?:(?:naa|spam|off?ensive|rude|abb?usive)-?flag))))|(?:(?:(?:cv|(?:un)?(?:del(?:v)?|dv|delete)|rov?|reopen|app?rove?|reject|rv|review|flag|nuke?|spam|off?ensive|naa|abbusive)|(?:spam|off?ensive|abb?usive|flag(?:-?(?:naa|spam|off?ensive|rude|abb?usive))|(?:(?:naa|spam|off?ensive|rude|abb?usive)-?flag)))-(?:pl(?:ease|s|z)|p.?[sz]|.?l[sz]|pl.?|.pl[sz]|p.l[sz]|pl.[sz]|pl[sz].)))\b
    */
    //Used to look in text to see if there are any messages which contain the action tag as text.
    //Only a limited set of action types are recognized in text format.
    const getActionTagInTextRegEx = /(?:\[(?:tag\W?)?(?:cv|(?:un-?)?del(?:ete|v)?|re-?open)-[^\]]*\])/;
    //Detect the type of request based on tag text content.
    const tagsInTextContentRegExes  = {
        delete: /\b(?:delv?|dv|delete)(?:pls)?\b/i,
        undelete: /\b(?:un?-?delv?|un?-?dv|un?-?delete)(?:pls)?\b/i,
        close: /\b(?:cv)(?:pls)?\b/i,
        reopen: /\b(?:re-?open)(?:pls)?\b/i,
        spam: /\bspam\b/i,
        offensive: /\b(?:off?en[cs]ive|rude|abb?u[cs]ive)\b/i,
        flag: /\b(?:re)?-?flag-?(?:pl(?:ease|s|z)|p.?[sz]|.?l[sz]|pl.?|.pl[sz]|p.l[sz]|pl.[sz]|pl[sz].)?\b/i,
        reject: /\b(?:reject|review)(?:pls)?\b/i,
        //20k+ tags
        tag20k: /^(?:20k\+?(?:-only)?)$/i,
        tagN0k: /^(?:\d0k\+?(?:-only)?)$/i,
        request: new RegExp(requestTagRegExText, 'i'),
    };
    //The extra escapes in RegExp are due to bugs in the syntax highlighter in an editor. They are only there because it helps make the syntax highlighting not be messed up.
    const getQuestionIdFromURLRegEx = /(?:^|[\s"])(?:(?:https?:)?(?:(?:\/\/)?(?:www\.|\/\/)?math\.stackexchange\.com\/))(?:q[^\/]*|posts)\/+(\d+)/g; // eslint-disable-line no-useless-escape
    //https://regex101.com/r/QzH8Jf/2
    const getSOQuestionIdFfromURLButNotIfAnswerRegEx = /(?:^|[\s"(])(?:(?:https?:)?(?:(?:\/\/)?(?:www\.|\/\/)?math\.stackexchange\.com\/))(?:q[^\/]*)\/+(\d+)(?:(?:\/[^#\s]*)#?)?(?:$|[\s")])/g; // eslint-disable-line no-useless-escape
    //XXX Temp continue to use above variable name until other uses resolved.
    const getSOQuestionIdFfromURLNotPostsNotAnswerRegEx = getSOQuestionIdFfromURLButNotIfAnswerRegEx;
    //https://regex101.com/r/w2wQoC/1/
    //https://regex101.com/r/SMVJv6/3/
    const getSOAnswerIdFfromURLRegExes = [
        /(?:^|[\s"(])(?:(?:https?:)?(?:(?:\/\/)?(?:www\.|\/\/)?math\.stackexchange\.com\/))(?:a[^\/]*)\/+(\d+)(?:\s*|\/[^/#]*\/?\d*\s*)(?:$|[\s")])/g, // eslint-disable-line no-useless-escape
        /(?:^|[\s"'(])(?:(?:https?:)?(?:(?:\/\/)?(?:www\.|\/\/)?math\.stackexchange\.com\/))(?:q[^\/]*|posts)[^\s#]*#(\d+)(?:$|[\s"')])/g, // eslint-disable-line no-useless-escape
    ];
    const getSOPostIdFfromURLButNotIfAnswerRegEx = /(?:^|[\s"(])(?:(?:https?:)?(?:(?:\/\/)?(?:www\.|\/\/)?math\.stackexchange\.com\/))(?:posts)\/+(\d+)(?:\s*|\/[^\/#]*\/?\d*\s*)(?:\s|$|[\s")])/g; // eslint-disable-line no-useless-escape
    const getSOQuestionOrAnswerIdFfromURLRegExes = [getSOQuestionIdFfromURLNotPostsNotAnswerRegEx].concat(getSOAnswerIdFfromURLRegExes);
    //Some constants which it helps to have some functions in order to determine
    const isChat = window.location.pathname.indexOf('/rooms/') === 0;
    const isSearch = window.location.pathname === '/search';
    const isTranscript = window.location.pathname.indexOf('/transcript') === 0;
    const isUserPage = window.location.pathname.indexOf('/users') === 0;
    var uiConfigStorage;


    //Functions needed on both the chat page and the search page

    //Utility functions
    funcs.executeInPage = function(functionToRunInPage, leaveInPage, id) { // + any additional JSON-ifiable arguments for functionToRunInPage
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
    };

    funcs.removeAllRequestInfo = () => {
        //Remove old request-info in preparation for replacing them.
        [].slice.call(document.querySelectorAll('.request-info')).forEach((request) => {
            request.remove();
        });
    };

    funcs.getElementEffectiveWidth = (element) => {
        //Get the "width" to which the "width" style needs to be set to match the size of the specified element, assuming the
        //  margin and padding are the same as on the specified element. Used to match the button spacing to the "maximum"
        //  defined by the sizing buttons.
        const computedWidth = element.getBoundingClientRect().width;
        const style = window.getComputedStyle(element);
        const paddingLeft = parseInt(style.getPropertyValue('padding-left'));
        const paddingRight = parseInt(style.getPropertyValue('padding-right'));
        const marginLeft = parseInt(style.getPropertyValue('margin-left'));
        const marginRight = parseInt(style.getPropertyValue('margin-right'));
        return (computedWidth - paddingLeft - paddingRight - marginLeft - marginRight);
    };

    funcs.executeIfIsFunction = (doFunction) => {
        //Only execute a function if it exists; no frills; does not bother to account for potential arguments
        if (typeof doFunction === 'function') {
            return doFunction();
        }
    };

    funcs.ifNotNonNullObjectUseDefault = (obj, defaultValue) => {
        //Use the supplied default if the first argument is not a non-null Object.
        if (typeof obj !== 'object' || obj === null) {
            return defaultValue;
        }
        return obj;
    };

    funcs.getFirstRegExListMatchInText = (text, regexes) => {
        //Make the match only work on host-relative-links, protocol-relative and fully-qualified links to stackoverflow.com only.
        //  The goal is to pick up plain text that is ' /q/875121087' and stackoverflow.com links, but not links to questions
        //  on other sites.
        //  If nothing is found null is returned.
        if (!Array.isArray(regexes)) {
            regexes = [regexes];
        }
        return regexes.reduce((accum, regex) => {
            if (accum) {
                //Already found
                return accum;
            }
            regex.lastIndex = 0;
            const match = regex.exec(text);
            return match ? match[1] : match;
        }, null);
    };

    funcs.getAllRegExListMatchesInText = (text, regexes) => {
        //Make the match only work on host-relative-links, protocol-relative and fully-qualified links to stackoverflow.com only.
        //  The goal is to pick up plain text that is ' /q/875121087' and stackoverflow.com links, but not links to questions
        //  on other sites.
        //  If nothing is found null is returned.
        //  Relies on the RegExps having the /g flag.
        if (!Array.isArray(regexes)) {
            regexes = [regexes];
        }
        return regexes.reduce((accum, regex) => {
            regex.lastIndex = 0;
            const matches = text.match(regex);
            if (matches) {
                if (!Array.isArray(accum)) {
                    accum = [];
                }
                return accum.concat(matches);
            }
            return accum;
        }, null);
    };

    funcs.getPostIdFromURL = (url) => {
        //In a URL, find the postId, be it an answer, a question, or just stated as a post.
        //Test for answers first
        var postId = funcs.getFirstRegExListMatchInText(url, getSOAnswerIdFfromURLRegExes);
        if (postId) {
            return postId;
        }
        //Only questions
        postId = funcs.getFirstRegExListMatchInText(url, getSOQuestionIdFfromURLNotPostsNotAnswerRegEx);
        if (postId) {
            return postId;
        }
        //Posts
        postId = funcs.getFirstRegExListMatchInText(url, getSOPostIdFfromURLButNotIfAnswerRegEx);
        if (postId) {
            return postId;
        }
        return null;
    };

    funcs.getAllQAPIdsFromLinksInElement = (element) => { // eslint-disable-line arrow-body-style
        //Get all the Question, Answer, or Post links contained in an element.
        return funcs.getQuestionAnswerOrPostIdsOrInfoFromLinksInElement(element, 'any', false);
    };

    funcs.getQuestionAnswerOrPostIdsOrInfoFromLinksInElement = (element, what, returnInfo) => {
        //Get a list of one unique question, answer IDs which are pointed to by the href of <A> links within an element.
        //  The RegExp currently restricts this to stackoverflow only.
        //  If what includes a 'd', then only URLs which point directly to questions (i.e. not #answer number or #comment)
        //  will be returned.
        what = what.toLowerCase();
        let regexes;
        if (what.indexOf('q') > -1) {
            regexes = getQuestionIdFromURLRegEx;
            if (what.indexOf('d') > -1) {
                regexes = getSOQuestionIdFfromURLNotPostsNotAnswerRegEx;
            }
        } else if (what.indexOf('a') > -1) {
            if (what.indexOf('any') > -1) {
                //If we are looking for any, use the regexes for answers, questions w/o answer, and posts.
                regexes = [].concat(getSOAnswerIdFfromURLRegExes, getQuestionIdFromURLRegEx, getSOPostIdFfromURLButNotIfAnswerRegEx);
            } else {
                regexes = getSOAnswerIdFfromURLRegExes;
            }
        } else if (what.indexOf('p') > -1) {
            regexes = getSOPostIdFfromURLButNotIfAnswerRegEx;
        } else {
            return [];
        }
        if (!Array.isArray(regexes)) {
            regexes = [regexes];
        }

        if (!element || element.nodeName === '#text') {
            //Return an empty array, as there are no valid question IDs in a null element, and no links in text
            return [];
        }

        //Scan the links in the element and return an array of those that are to the appropriate type of question/answer/post.
        return [].slice.call(element.querySelectorAll('a')).filter((link) => { // eslint-disable-line arrow-body-style
            //Keep the link if it is to a URL that produces the desired ID type (matches the regexes).
            return regexes.some((tryRegex) => {
                tryRegex.lastIndex = 0;
                return tryRegex.test(link.href);
            });
        }).map((link) => {
            //Have List of links which match. Convert them to the data desired: either an ID, or an Object with some of the link's attributes.
            if (returnInfo) {
                return {
                    link: link,
                    text: link.textContent,
                    url: link.href,
                    postId: funcs.getFirstRegExListMatchInText(link.href, regexes),
                };
            } // else
            return funcs.getFirstRegExListMatchInText(link.href, regexes);
        }).filter((id, index, array) => {
            //Remove duplicates
            //This is only a reasonable way to remove duplicates in short arrays, which this is.
            if (returnInfo) {
                //Filter the Objects that are for duplicate postId's.
                for (let testIndex = 0; testIndex < index; testIndex++) {
                    if (+id.postId === +array[testIndex].postId) {
                        return false;
                    }
                }
                return true;
            } // else
            return array.indexOf(id) === index;
        });
    };

    funcs.sortMessageRequestInfoEntries = (message) => {
        //For request info entries that have more than one link, make the order of those entries
        //  match the order of the links in the content of the associated .message.
        const requestInfo = funcs.getRequestInfoFromMessage(message);
        if (!requestInfo) {
            //Can't do anything without request-info
            return;
        }
        const requestInfoLinks = [].slice.call(funcs.getRequestInfoLinksFromMessage(message));
        if (requestInfoLinks.length < 2) {
            //No need to sort a single item
            return;
        }
        const content = funcs.getContentFromMessage(message);
        if (!content) {
            return;
        }
        //Get the list of question IDs that are in links in the content.
        const postsInContent = funcs.getAllQAPIdsFromLinksInElement(content);
        requestInfoLinks.sort((a, b) => {
            const aIndex = postsInContent.indexOf(a.dataset.postId);
            const bIndex = postsInContent.indexOf(b.dataset.postId);
            return aIndex - bIndex;
        });
        //Apply the sort to the request-info links
        requestInfoLinks.forEach((link) => {
            requestInfo.appendChild(link);
        });
    };

    //Should consider if the criteria for following a back-reference should be expanded. Should a back-reference
    //  be followed if there is a link in the reply, just not one that is to a question, post, answer. And etc.?
    //  For now, the back-reference is not followed if there is a link in the referring message, as that is safer.
    funcs.getQuestionAnswerOrPostInfoListFromReplyToIfIsRequestAndNoLinks = (message, what) => {
        const content = funcs.getContentFromMessage(message);
        if (content && funcs.getFirstRequestTagInElement(content) && !funcs.removeTagLinks(content.cloneNode(true)).querySelector('a')) {
            //There's no link in the content (e.g. the request is not contain a link to a question, that happens to also be a reply).
            return funcs.getQuestionAnswerOrPostInfoListFromReplyTo(message, what);
        } //else
        return [];
    };

    funcs.getQuestionAnswerOrPostInfoListFromReplyTo = (message, what) => {
        //Obtain the info from a post to which this message is a reply, if it is in the transcript.
        const replyInfo = message.querySelector('.reply-info');
        if (replyInfo) {
            //It is a reply to something.
            const refMessageId = replyInfo.href.replace(/^[^#]*#/, '');
            if (refMessageId) {
                const refMessage = document.getElementById('message-' + refMessageId);
                if (refMessage) {
                    //The referenced comment is currently on the page
                    const info = funcs.getQuestionAnswerOrPostIdsOrInfoFromLinksInElement(funcs.getContentFromMessage(refMessage), what, true);
                    return info;
                }
            }
        }
        //Is invalid in some way. Return an empty array.
        return [];
    };

    funcs.setDatasetIfNotUndefined = (element, dataProp, value) => {
        if (!element || typeof value === 'undefined') {
            return;
        }
        element.dataset[dataProp] = value;
    };

    //Calculate some values used to adjust what the script does, but which depend on the utility functions.
    const currentRoom = (() => {
        if (isSearch) {
            return funcs.getFirstRegExListMatchInText(window.location.search, /\bRoom=(\d+)/i);
        } // else
        if (isChat) {
            return funcs.getFirstRegExListMatchInText(window.location.pathname, /\/(\d+)\b/i);
        } //else
        //Transcript (there is not always a room defined).
        return funcs.getFirstRegExListMatchInText(document.querySelector('.room-mini .room-name a'), /chat\.stack(?:overflow|exchange)\.com\/rooms\/(\d+)/);
    })();
    const urlReviewType = funcs.getFirstRegExListMatchInText(window.location.search, /\brequestReviewType=(\w+)/i);
    const urlReviewShow = funcs.getFirstRegExListMatchInText(window.location.search, /\brequestReviewShow=(\w+)/i);
    const urlSearchString = funcs.getFirstRegExListMatchInText(window.location.search, /\bq=([^?&#]+)/i);
    const urlSearchOrs = typeof urlSearchString === 'string' ? urlSearchString.split(/\+(?:or|\||(?:%7c){1,2})\+/ig) : null;
    //Allow the URL to specify showing closed and deleted posts.
    const isForceShowClosed = /closed?/i.test(urlReviewShow);
    const isForceShowOpen = /open/i.test(urlReviewShow);
    const isForceShowDeleted = /deleted?/i.test(urlReviewShow);
    const isForceShowLinks = /links?/i.test(urlReviewShow);
    const isForceShowReplies = /repl(?:y|ies)/i.test(urlReviewShow);
    //Allow the URL to specify that it is a cv- search, del- search, or not using the cv-/del- UI.
    const isSearchCv = isSearch && ((/(?:tagged%2F|^)cv(?:\b|$)/.test(urlSearchString) || /(?:cv|close)/i.test(urlReviewType)) && !/none/i.test(urlReviewType));
    const isSearchDel = isSearch && ((/(?:tagged%2F|^)(?:del(?:ete|v)?|dv)(?:\b|$)/.test(urlSearchString) || /del/i.test(urlReviewType)) && !/none/i.test(urlReviewType));
    const isSearchReopen = isSearch && ((/(?:tagged%2F|^)(?:re-?open)(?:\b|$)/.test(urlSearchString) || /del/i.test(urlReviewType)) && !/none/i.test(urlReviewType));
    const isSearchReviewUIActive = isSearchCv || isSearchDel || isSearchReopen;
    //Adjust the page links to have the same reviewRequest options
    if (urlReviewShow || urlReviewType) {
        [].slice.call(document.querySelectorAll('a .page-numbers')).forEach((linkSpan) => {
            const link = linkSpan.parentNode;
            if (link && link.nodeName === 'A') {
                if (urlReviewShow) {
                    link.href += '&requestReviewShow=' + urlReviewShow;
                }
                if (urlReviewType) {
                    link.href += '&requestReviewType=' + urlReviewType;
                }
            }
        });
    }


    //Visited: Watch for user clicks on links to posts

    //Use Ctrl-right-click to open the CV-review queue for the tag clicked on.

    var ignoreWindowClicks = false;
    funcs.windowCtrlClickListener = (event) => {
        //Clicks with Alt/Ctrl/Shift do not travel the DOM (at least not in Firefox).
        if (ignoreWindowClicks) {
            return;
        } //else
        ignoreWindowClicks = true;
        setTimeout(function() {
            //Ignore window clicks for 100ms, to prevent the user from double clicking to cause two votes to be attempted,
            //  as that just causes a notification to be shown.
            ignoreWindowClicks = false;
        }, 100);
        const target = event.target;
        if (target.classList.contains('urrs-receiveAllClicks')) {
            const detail = {};
            [
                // These are of primary interest
                'ctrlKey',
                'shiftKey',
                'altKey',
                'metaKey',
                'button',
                // The rest aren't of that much interest
                'screenX',
                'screenY',
                'clientX',
                'clientY',
                'buttons',
                'relatedTarget',
                'region',
                'layerX',
                'layerY',
                'movementX',
                'movementY',
                'offsetX',
                'offsetY',
                'detail',
                'composed',
                'mozInputSource',
                'mozPresure',
            ].forEach((prop) => {
                detail[prop] = event[prop];
            });
            const newEvent = new CustomEvent('urrs-allClicks', {
                detail: detail,
                bubbles: true,
                cancelable: true,
            });
            target.dispatchEvent(newEvent);
        } else if (config.nonUi.clickTagTagToOpenCVQ && event.isTrusted && Object.keys(config.nonUi.clickTagTagToOpenCVQButtonInfo).every((key) => event[key] === config.nonUi.clickTagTagToOpenCVQButtonInfo[key])) {
            //A real user Ctrl-click on button 2
            if (target.classList.contains('ob-post-tag')) {
                const tagName = target.textContent;
                //Force this to SO. Other sites don't have chat in a separate domain, so would need to find the domain for
                //  the room.
                GM.openInTab('https://math.stackexchange.com/review/close/?filter-tags=' + encodeURIComponent(tagName), false);
                //These don't prevent Firefox from displaying the context menu.
                event.preventDefault();
                event.stopPropagation();
            }
        }
    };
    //Now done by monitoring mousedown and mouseup, and click and auxclick in order to get around a Chrome "feature" which results in click events not
    //  being fired for any button other than button 1. Chrome recently implemented that non-button 1 clicks are an "auxclick".


    //Remembering visited questions.
    if (typeof funcs.visited !== 'object') {
        funcs.visited = {};
    }

    //Work-around for Chrome not firing a 'click' event for buttons other than #1.
    var mostRecentMouseDownEvent;
    funcs.visited.listenForLinkMouseDown = (event) => {
        // Remember which element the mouse is on when the button is pressed.
        mostRecentMouseDownEvent = event;
    };

    funcs.visited.listenForLinkMouseUp = (event) => {
        //If a mouseup occurs, consider it a click, if the target is the same as the last mousedown.
        //  This will have issues with detecting clicks when the user presses multiple buttons at the same time.
        if (mostRecentMouseDownEvent.target === event.target && mostRecentMouseDownEvent.button === event.button) {
            //Delay so the 'click' event can fire. If not, we may make the message display:none prior to the
            //  click taking effect.
            funcs.visited.listenForClicks(event);
        }
    };

    var mostRecentClick = null;

    funcs.visited.listenForClicks = (event) => {
        //Clicks are sometimes detected through mousedown/mouseup pairs, click events, or auxclick events.
        //  But, we want to fire our listeners only once per user action. In addition, we want to have the
        //  same effect of preventing the default action, on associated events (i.e. click), if our action called preventDefault().
        if (mostRecentClick) {
            //There has been a prior event, which may be the same user action.
            const mustMatch = [
                'target',
                'button',
                'screenX',
                'screenY',
                'clientX',
                'clientY',
                'buttons',
                'ctrlKey',
                'shiftKey',
                'altKey',
                'metaKey',
            ];
            if (mustMatch.every((key) => mostRecentClick[key] === event[key]) && (event.timeStamp - mostRecentClick.timeStamp) < 50) {
                //Same action
                if (mostRecentClick.defaultPrevented) {
                    event.preventDefault();
                }
                return;
            } //else
        }
        //It's a new user action
        funcs.windowCtrlClickListener(event);
        if (!event.defaultPrevented) {
            funcs.visited.listenForLinkClicks(event);
        }
        if (event.target.classList.contains('action-link') || (event.target.parentNode && event.target.parentNode.classList && event.target.parentNode.classList.contains('action-link'))) {
            funcs.ui.listenForActionLinkClicks(event);
        }
        mostRecentClick = event;
    };
    window.addEventListener('click', funcs.visited.listenForClicks, false);
    window.addEventListener('auxclick', funcs.visited.listenForClicks, false);

    funcs.ui.listenForActionLinkClicks = (event) => {
        const target = event.target;
        const message = funcs.getContainingMessage(target);
        if (!message || !message.classList.contains('urrsRequestComplete')) {
            return;
        }
        setTimeout(() => {
            const popup = message.querySelector('.message > .popup');
            if (popup) {
                message.classList.add('urrsRequestComplete-temp-disable');
                const popupObserver = new MutationObserver(function(mutations, observer) {
                    if (mutations.some((mutation) => (mutation.removedNodes && [].slice.call(mutation.removedNodes).some((node) => node.classList.contains('popup'))))) {
                        observer.disconnect();
                        message.classList.remove('urrsRequestComplete-temp-disable');
                    }
                });
                popupObserver.observe(message, {
                    childList: true,
                });
            }
        }, 100);
    };

    funcs.visited.listenForLinkClicks = (event) => {
        //Intended as main listener for clicks on links. Because Chrome doesn't fire click events for buttons other than the main one
        //  this is called when the listeners to mousedown and mouseup determine that a click should have fired.
        if (!config.nonUi.trackVisitedLinks) {
            return;
        }
        var affectedLink = funcs.visited.findYoungestAnchor(event.target);
        if (!affectedLink) {
            return;
        }
        funcs.visited.addPostFromURLToVisitedAndUpdateShown(affectedLink.href, event.target);
    };

    funcs.visited.addPostsFromAnchorListToVisitedAndUpdateShown = (links) => {
        // Add the posts associated with a list of links to the
        // visited list and update the UI, if so configured on the
        // search page (i.e.  hide the messages if not showing
        // visited).
        const ids = [];
        const filtered = links.filter((link) => {
            const postId = funcs.getPostIdFromURL(link.href);
            if (postId === null || isNaN(+postId)) {
                //Not a question link.
                return false;
            }
            ids.push(postId);
            return true;
        });
        //Add all the valid Ids to the visited list
        funcs.config.addPostIdsToVisitedAndRetainMostRecentList(ids);
        funcs.visited.invalidateElementsMessageVisitedAndUpdateUi(filtered);
    };

    funcs.visited.addPostFromURLToVisitedAndUpdateShown = (url, element) => {
        // If a URL is a post, add the post to the visited list, cause
        // the element's message to be reevaluated wrt. visited and
        // hide the message if in the search page, and so specified by the UI.
        const postId = funcs.getPostIdFromURL(url);
        if (postId === null || isNaN(+postId)) {
            //Not a question link.
            return;
        }
        //This may be running in multiple tabs. Make sure to sync up to the most recently saved config prior to adding
        //  new questions. If this is not done, then changes in other tabs get lost. While there could be a inter-tab race
        //  condition here, this running is based on user input, which shouldn't be faster than the code.
        //Add the question to the visited list.
        funcs.config.addPostIdsToVisitedAndRetainMostRecentList(postId);
        funcs.visited.invalidateElementsMessageVisitedAndUpdateUi(element);
    };

    funcs.visited.invalidateElementsMessageVisitedAndUpdateUi = (elements) => {
        //For a single element, or list of elements, clear the visited status and update the UI, if on the search page.
        if (!Array.isArray(elements)) {
            elements = [elements];
        }
        let didUpate = false;
        elements.forEach((element) => {
            //Cause the message to be re-tested wrt. having been visited.
            if (element) {
                const message = funcs.getContainingMessage(element);
                if (message) {
                    const visited = message.dataset.visited;
                    if (visited) {
                        message.dataset.visited = '';
                    }
                    didUpate = true;
                }
            }
        });
        if (didUpate) {
            //Only need to show/hide messages here, not sort, and only on search page.
            funcs.executeIfIsFunction(funcs.ui.showHideMessagesPerUI);
        }
    };

    funcs.visited.findYoungestAnchor = (element) => {
        //Find the closest ancestor, including the element itself which is an anchor.
        while (element && element.nodeName !== 'A') {
            element = element.parentNode;
        }
        return element;
    };

    funcs.visited.findYoungestInteractiveElement = (element) => {
        //Find the closest ancestor, including the element itself which is interactive.
        //This would be a bit faster if the Array did not have to be created each time the function is entered.
        const interactiveNodeNames = ['A', 'BUTTON', 'INPUT', 'MAP', 'OBJECT', 'TEXTAREA', 'VIDEO'];
        while (element && interactiveNodeNames.indexOf(element.nodeName) === -1) {
            element = element.parentNode;
        }
        return element;
    };

    funcs.visited.beginRememberingPostVisits = () => {
        //Start listening to click events so we can record when the user clicks on a link.
        //Let all other event handlers deal with or cancel the event.
        //We only want to record the click if the default isn't prevented. Thus, we need to
        //  get it last.
        window.addEventListener('mousedown', funcs.visited.listenForLinkMouseDown, false);
        window.addEventListener('mouseup', funcs.visited.listenForLinkMouseUp, false);
    };

    //Functions for the backoff timer (functional across instances)
    if (typeof funcs.backoff !== 'object') {
        funcs.backoff = {};
    }

    //XXX The backoff timer needs to be obeyed across different instances of the same script (i.e. across tabs).
    //XXX Backoff timer is not fully tested.
    funcs.backoff.done = () => {
        if (backoffTimer.isPrimary) {
            funcs.backoff.clearAndInConfig();
        } else {
            funcs.backoff.clear();
        }
        //Update on the chat page.
        funcs.executeIfIsFunction(funcs.mp.processAllIfTimeElapsedAndScheduled);
        //XXX Need to do something for the search page.
    };

    funcs.backoff.clearAndInConfig = () => {
        //Clear the currently active backoff timer, and store in the config that it is cleared.
        //  This is only done by the instance which considers itself to be primary.
        funcs.backoff.clear();
        //Record that the timer has been cleared.
        config.backoff.active = false;
        config.backoff.timeActivated = 0;
        config.backoff.milliseconds = 0;
        funcs.config.saveBackoff();
    };

    funcs.backoff.clear = () => {
        //Clear the currently active backoff timer
        clearTimeout(backoffTimer.timer);
        backoffTimer.timer = 0;
        backoffTimer.isPrimary = false;
        backoffTimer.timeActivated = 0;
        backoffTimer.milliseconds = 0;
    };

    funcs.backoff.setAndStoreInConfig = (seconds) => {
        //Set the backoff timer, and store in the config that it is set.
        //  This is only done by the instance which considers itself to be primary. Doing so is effectively defined as being primary.
        funcs.backoff.set(seconds);
        //Record that the timer has been set.
        backoffTimer.isPrimary = true;
        config.backoff.active = true;
        config.backoff.timeActivated = backoffTimer.timeActivated;
        config.backoff.milliseconds = backoffTimer.milliseconds;
        funcs.config.saveBackoff();
    };

    funcs.backoff.set = (seconds) => {
        //Set the backoff timer.
        //Clear it first so multiple timers are not running.
        funcs.backoff.clear();
        backoffTimer.timer = setTimeout(funcs.backoff.done, seconds * 1000);
        backoffTimer.isPrimary = false;
        backoffTimer.timeActivated = Date.now();
        backoffTimer.milliseconds = seconds * 1000;
    };

    //Functions for remembering the configuration.
    if (typeof funcs.config !== 'object') {
        funcs.config = {};
    }

    funcs.config.localStorageChangeListener = (event) => {
        //Listen to changes to localStorage. Only call handlers for those storage locations which are being listened to.
        const handlers = {
            [LSPREFIX + 'nonUiConfig']: funcs.config.handleNonUiConfigChange,
            [LSPREFIX + 'backoff']: funcs.config.handleBackoffTimerChange,
        };
        if (handlers.hasOwnProperty(event.key)) {
            const handler = handlers[event.key];
            const key = event.key.replace(LSPREFIX, '');
            //Mimic how the handler would be called by GM_addValueChangeListener().
            //localStorage only notifies for remote events, never for changes in the current tab.
            handler(key, event.oldValue, event.newValue, true);
        }
    };

    funcs.config.listenForConfigChangesIfPossible = () => {
        //If the platform permits listening for config changes, then do so.
        //Determining if it was possible to listen for changes was only needed when using GM storage,
        //  as listening for changes wasn't available in Firefox/GM3 (GM4?). This was switched to using
        //  localStorage. All browsers can listen for localStorage changes.
        window.addEventListener('storage', funcs.config.localStorageChangeListener);
    };

    funcs.config.handleBackoffTimerChange = (name, oldValueJSON, newValueJSON, remote) => {
        //Receive an event that the backoff timer changed.
        if (remote && name === 'backoff') {
            funcs.config.restoreBackoffAndCheckIfNeedBackoff();
        }
    };

    funcs.config.handleNonUiConfigChange = (name, oldValue, newValue, remote) => {
        //Receive notification that there was a change in the configuration in another tab.
        if (remote && name === 'nonUiConfig') {
            //Reading it is redundant vs. the newValue, but there is already a function to do everything needed.
            funcs.config.restoreNonUi(config.nonUi);
            funcs.addRequestStylesToDOM();
            //Only need to show/hide messages here, and only on search page.
            funcs.executeIfIsFunction(funcs.ui.showHideMessagesPerUI);
            //Update the options dialog
            funcs.executeIfIsFunction(funcs.ui.setGeneralOptionsDialogCheckboxesToConfig);
        }
    };

    funcs.config.getStoredNonUiConfigUpdateUiOrOptionsIfNeeded = () => {
        //Handle Visited Questions (should probably be storing visited questions in their own storage location).
        //XXX This needs to handle a change to the watched/not watched selection.
        //The nonUi config is _always_ saved if it is changed in the script, and never changed except
        //  due to user interaction. Thus, we can accept that the stored version is primary.
        funcs.config.getStoredVisitedPostsIntoConfigAndUpdateShownMessagesifNeeded();
        //Deal with the properties other than visited questions.
        var oldNonUiConfig = config.nonUi;
        config.nonUi = {};
        funcs.config.setNonUiDefaults();
        funcs.config.restoreNonUi();
        //delete the visited Posts, as that is not being compared.
        delete oldNonUiConfig.visitedPosts;
        if (Object.keys(oldNonUiConfig).some((key) => oldNonUiConfig[key] !== config.nonUi[key])) {
            //At least one of the config values does not match what is in the current config.
            //  Update the options UI with the stored values.
            funcs.executeIfIsFunction(funcs.ui.setGeneralOptionsDialogCheckboxesToConfig);
            funcs.executeIfIsFunction(funcs.ui.setVisitedButtonEnabledDisabledByConfig);
            funcs.config.clearVisitedPostsInConfigIfSetNoTracking();
        }
    };

    funcs.config.getStoredVisitedPostsIntoConfigAndUpdateShownMessagesifNeeded = () => {
        //Get the most recent version of the stored
        funcs.config.pruneVisitedPosts();
        const origVisitedPosts = config.nonUi.visitedPosts;
        funcs.config.getStoredVisitedPostsIntoConfig();
        if (origVisitedPosts.length !== config.nonUi.visitedPosts.length) {
            //While this is not an entry by entry comparison, comparing just the
            //  length of both lists, which were both just pruned, should result in detecting
            //  any changes which were made in another tab (with possible millisecond differences in what was pruned).
            //Update the currently displayed questions.
            funcs.executeIfIsFunction(funcs.ui.showHideMessagesPerUI);
        }
    };

    funcs.config.getStoredVisitedPostsIntoConfig = () => {
        //This relies on the stored visited questions list to have always been updated when
        //  that list is updated locally, which is how it is done.
        config.nonUi.visitedPosts = funcs.config.getStoredVisitedPosts();
    };

    funcs.config.getStoredVisitedPosts = () => {
        //Read in the stored version of the visited questions list without disturbing the other data
        //  stored in that location.
        var tmpConfig = {};
        funcs.config.setNonUiDefaults(tmpConfig);
        funcs.config.restoreNonUi(tmpConfig);
        return tmpConfig.visitedPosts;
    };

    funcs.config.addPostIdsToVisitedAndRetainMostRecentList = (idIds) => {
        //Add a post IDs to the most recently saved version of the list of visitedPosts list.
        //  The overall config.nonUi may have been updated in another tab. (possibly updated in another tab)
        //  This just syncs the visited questions, it does not change the other values in storage to match
        //  any changes in the local config.nonUi.
        var tmpConfig = {};
        funcs.config.setNonUiDefaults(tmpConfig);
        funcs.config.restoreNonUi(tmpConfig);
        if (!Array.isArray(idIds)) {
            idIds = [idIds];
        }
        //Add all ids to the visited list.
        const now = Date.now();
        idIds.forEach((id) => {
            tmpConfig.visitedPosts[id] = now;
        });
        funcs.config.saveNonUi(tmpConfig);
        //Keep the most current version without updating GUI info
        config.nonUi.visitedPosts = tmpConfig.visitedPosts;
    };

    funcs.config.clear = () => {
        //Clear all configuration information.
        funcs.config.clearUi();
        funcs.config.clearNonUi();
        funcs.config.clearBackoff();
    };

    funcs.config.clearItem = (itemName) => {
        //Clear a single item from storage
        localStorage.removeItem(LSPREFIX + itemName);
    };

    funcs.config.clearUi = () => {
        //Delete all UI configuration information for the UI.
        ['close', 'delete'].forEach((whichType) => {
            for (let group = 1; group <= NUMBER_UI_GROUPS; group++) {
                funcs.config.clearItem(funcs.config.getUILocationId(group, whichType));
            }
            funcs.config.setWhichUIGroupIsMostRecentlySelected(1, whichType);
        });
    };

    funcs.config.clearNonUi = () => {
        //Delete all configuration information that is not the UI (i.e. visited questions).
        funcs.config.clearItem('nonUiConfig');
    };

    funcs.config.clearBackoff = () => {
        //Delete all configuration information that is not the UI (i.e. visited questions).
        funcs.config.clearItem('backoff');
    };

    funcs.config.saveNonUi = (obj) => {
        //Store the non-UI configuration. This is a bit of a misnomer, as the list
        //  of visited questions is stored here.
        //XXX The list of visited questions should change to being per-site, just for possible
        //  use in the future.
        obj = funcs.ifNotNonNullObjectUseDefault(obj, config.nonUi);
        //Prune any questions that are too old.
        funcs.config.pruneVisitedPosts(obj.visitedPosts);
        funcs.config.setValue('nonUiConfig', obj);
    };

    funcs.config.saveUi = (obj) => {
        //Store the configuration of the UI.
        obj = funcs.ifNotNonNullObjectUseDefault(obj, config.ui);
        funcs.config.setValue(uiConfigStorage, obj);
    };

    funcs.config.saveBackoff = (obj) => {
        //Store the configuration of the backoff timer.
        obj = funcs.ifNotNonNullObjectUseDefault(obj, config.backoff);
        funcs.config.setValue('backoff', obj);
    };

    funcs.config.saveUiAndGetSavedNonUi = (obj) => {
        //Save the UI config, while also restoring the non-UI config (visited questions). This is,
        // effectively,  polling for changes that might have happened in other tabs.
        obj = funcs.ifNotNonNullObjectUseDefault(obj, config);
        funcs.config.saveUi(obj.ui);
        funcs.config.restoreNonUi(obj.nonUi);
    };

    funcs.config.setValue = (name, value) => {
        //Save a value to a named location
        try {
            localStorage[LSPREFIX + name] = JSON.stringify(value);
        } catch (e) {
            console.error(e);
        }
    };

    funcs.config.clearVisitedPostsInConfigIfSetNoTracking = () => {
        //If the option in the config is set to indicate that the visited questions should not be
        //  tracked, prune the questions (which will remove all from the list), and update the
        //  displayed questions..
        if (!config.nonUi.trackVisitedLinks) {
            //If set to not remember visited links, prune all the questions.
            funcs.config.pruneVisitedPosts();
            //Need to show the questions, if any were hidden.
            funcs.ui.showHideMessagesPerUI();
        }
    };

    funcs.config.pruneVisitedPosts = (list) => {
        //Remove questions from the list of those "visited" if they were visited more than
        //  7 days ago. This is intended to keep that list from infinitely growing.
        //  This length of time was chosen because cv-pls requests are kept for a maximum of
        //  3 days. 7 is 2* + 1
        if (typeof list === 'undefined') {
            list = config.nonUi.visitedPosts;
        }
        const cutoffTime = Date.now() - (MAX_DAYS_TO_REMEMBER_VISITED_LINKS * 24 * 60 * 60 * 1000);
        var isRemoved = false;
        for (const id in list) {
            //Remove the questionId from the list if the user has selected not to remember visited
            //  questions, or if the last time it was visited was too long ago.
            if (list.hasOwnProperty(id)) {
                if (!config.nonUi.trackVisitedLinks || list[id] < cutoffTime) {
                    delete list[id];
                    isRemoved = true;
                }
            }
        }
        return isRemoved;
    };

    funcs.config.restore = (obj) => {
        //Restore the complete config from saved values
        obj = funcs.ifNotNonNullObjectUseDefault(obj, config);
        funcs.config.restoreUi(obj.ui);
        funcs.config.restoreNonUi(obj.nonUi);
        funcs.config.restoreBackoffAndCheckIfNeedBackoff(obj.backoff);
    };

    funcs.config.sanityCheckBackoffTimerConfig = (obj) => {
        //Check if the information in the backoff timer config is reasonably sane. If not,
        //  then reset it. It is checked to see if more than the defined-for-this-script
        //  maximum seconds have passed since when the backoff timer was set. Also checked is
        //  that the backoff timer was not activated more than 1 second into the future.
        obj = funcs.ifNotNonNullObjectUseDefault(obj, config.backoff);
        const now = Date.now();
        const remainingTime = (obj.timeActivated > (now + 1000)) ? -1 : (obj.timeActivated + obj.milliseconds) - now;
        if (obj.active && (remainingTime > MAX_BACKOFF_TIMER_SECONDS * 1000 || remainingTime < 0)) {
            //The backoff timer appears to be invalid
            funcs.config.setBackoffDefaults(obj);
            funcs.config.saveBackoff(obj);
        }
    };

    funcs.config.restoreBackoffAndCheckIfNeedBackoff = (obj) => {
        //Read the backoff information from the stored config and determine if the backoff timer needs to
        //  be started.
        obj = funcs.ifNotNonNullObjectUseDefault(obj, config.backoff);
        funcs.config.restoreBackoff(obj);
        const now = Date.now();
        const remainingTimeConfig = (obj.timeActivated + obj.milliseconds) - now;
        const remainingTimeTimer = backoffTimer.timeActivated + backoffTimer.milliseconds - now;
        if (backoffTimer.timer !== 0 && backoffTimer.isPrimary && remainingTimeTimer > remainingTimeConfig) {
            //A backoff timer is already currently active in this script.
            //This instance received a backoff timer response and has set the backoff timer
            //The timer for this instance will expire after the one in the config.
            //Overwrite the config information:
            obj.timeActivated = backoffTimer.timeActivated;
            obj.milliseconds = backoffTimer.milliseconds;
            funcs.config.saveBackoff();
        } else if (obj.active && (backoffTimer.timer === 0 || remainingTimeTimer < remainingTimeConfig)) {
            //The backoff timer should be active, if it is not, start it
            //There is no current timer for this instance, or
            //the timer for this instance will expire before the one in the config.
            funcs.backoff.clear();
            funcs.backoff.set(remainingTimeConfig / 1000);
            //Make the record of active timer match the config.
            backoffTimer.timeActivated = obj.timeActivated;
            backoffTimer.milliseconds = obj.milliseconds;
        } else {
            //The timer for this instance was set for the same time as he one in the config.
            //Or this is not the primary and it is set to expire after the one in the config (should not happen).
            //Or the config indicates the backoff timer is inactive.
            //Do nothing.
        }
    };

    funcs.config.restoreBackoff = (obj) => {
        //Read the backoff config from storage, and sanity check it.
        obj = funcs.ifNotNonNullObjectUseDefault(obj, config.backoff);
        funcs.config.getValue('backoff', obj);
        funcs.config.sanityCheckBackoffTimerConfig(obj);
    };

    funcs.config.getWhichUITypeLocationId = (whichType) => {
        //Return the text used to identify the UI type storage location.
        if (typeof whichType === 'undefined') {
            whichType = 'close';
            if (isSearchDel) {
                whichType = 'delete';
            } else if (isSearchReopen) {
                whichType = 'reopen';
            }
        }
        let typeText = UI_CONFIG_CV_PAGES;
        if (/delete/i.test(whichType)) {
            typeText = UI_CONFIG_DEL_PAGES;
        } else if (/reopen/i.test(whichType)) {
            typeText = UI_CONFIG_REOPEN_PAGES;
        }
        return typeText;
    };

    funcs.config.getWhichUIGroupIsMostRecentLocationId = (whichType) => { // eslint-disable-line arrow-body-style
        //Get the text to identify the storage location holding the number of the most recently selected group.
        return funcs.config.getWhichUITypeLocationId(whichType) + '-recentGroup';
    };

    funcs.config.setWhichUIGroupIsMostRecentlySelected = (group, whichType) => {
        //Set the stored value of the most recently selected group.
        funcs.config.setValue(funcs.config.getWhichUIGroupIsMostRecentLocationId(whichType), {group: group});
    };

    funcs.config.getWhichUIGroupIsMostRecentlySelected = (whichType) => {
        //Return the number of the group which was most recently selected for this type.
        const recentId = funcs.config.getWhichUIGroupIsMostRecentLocationId(whichType);
        const groupObj = {};
        funcs.config.getValue(recentId, groupObj);
        return groupObj.group ? groupObj.group : 1;
    };

    funcs.config.setGlobalUILocationIdToMostRecent = (whichType) => {
        //Set the value holding the ID used for the current UI config to the most recent for this type.
        //  By default the type is chosen by the search in the page, or defaults to "close".
        funcs.config.setGlobalUILocationId(funcs.config.getWhichUIGroupIsMostRecentlySelected(whichType), whichType);
    };

    funcs.config.getUILocationId = (group, whichType) => { // eslint-disable-line arrow-body-style
        //Get the full UI location ID for this group and type. Default whichType is 'close'.
        return funcs.config.getWhichUITypeLocationId(whichType) + '-group-' + group;
    };

    funcs.config.setGlobalUILocationId = (group, whichType) => {
        //Set the location used to store/retrieve the UI config to the location for the type and group specified.
        uiConfigStorage = funcs.config.getUILocationId(group, whichType);
    };

    funcs.config.restoreUi = (obj) => {
        //Restore the UI config from saved values
        obj = funcs.ifNotNonNullObjectUseDefault(obj, config.ui);
        funcs.config.getValue(uiConfigStorage, obj);
        //The excluded tag matches are dependent on the UI config value.
        //This is only available on the search page.
        funcs.executeIfIsFunction(funcs.ui.invalidateAllDatasetExcludedTags);
    };

    funcs.config.restoreNonUi = (obj) => {
        //Restore the non-UI config from saved values
        obj = funcs.ifNotNonNullObjectUseDefault(obj, config.nonUi);
        funcs.config.getValue('nonUiConfig', obj);
        if (funcs.config.pruneVisitedPosts(obj.visitedPosts)) {
            //Some questions were pruned. Save the config back so they are removed in storage
            //This needs to not be done here. If it is, it's possible to have multiple iterations of
            //  restore-save-restore across multiple tabs. Such loops should not go long, but it is better
            //  to avoid the possibility.
        }
        //Invalidate the stored matches to the visited questions, but only on the search page
        //XXX This is overly aggressive on invalidating the visited question dataset.
        funcs.executeIfIsFunction(funcs.ui.invalidateAllDatasetVisited);
    };

    funcs.config.getValue = (storageName, obj) => {
        //Restore a storage configuration from a named storage location.
        if (obj === null || typeof obj !== 'object') {
            throw new Error('Trying to get config into a invalid object.');
        }
        var storedConfig = {};
        try {
            let inStorage = localStorage[LSPREFIX + storageName];
            inStorage = typeof inStorage === 'undefined' ? JSON.stringify({}) : inStorage;
            storedConfig = JSON.parse(inStorage);
            Object.keys(storedConfig).forEach((key) => {
                //Restore the key if the obj[key] is currently undefined, or is the same type as the current obj.
                //  This prevents restoring stored information when the type of information has changed (e.g. in development).
                const curValue = obj[key];
                const storedValue = storedConfig[key];
                const storedValueNumber = +storedConfig[key];
                if (typeof curValue === 'undefined' || typeof curValue === typeof storedValue) {
                    obj[key] = storedValue;
                } else if (typeof curValue === 'number' && typeof storedValue === 'string' && ((storedValueNumber + '') === storedValue)) {
                    obj[key] = storedValueNumber;
                } else {
                    console.log('Not restoring config key:', key, ' current=', obj[key], ' stored:', storedConfig[key]);
                }
            });
        } catch (e) {
            console.log('Issue restoring config. Storage is invalid and parsing it as JSON likely failed. storageName:', storageName, ':: obj:', obj);
            console.error(e);
        }
    };

    funcs.config.setDefaults = (obj, showingButtons, sortingButtons) => {
        //Populate the obj Object with all default configuration information.
        //Create the config object if it does not exist.
        obj = funcs.ifNotNonNullObjectUseDefault(obj, config);
        obj.ui = funcs.ifNotNonNullObjectUseDefault(obj.ui, {});
        obj.nonUi = funcs.ifNotNonNullObjectUseDefault(obj.nonUi, {});
        obj.backoff = funcs.ifNotNonNullObjectUseDefault(obj.backoff, {});
        funcs.config.setNonUiDefaults(obj.nonUi);
        funcs.config.setBackoffDefaults(obj.backoff);
        funcs.config.setUiDefaults(obj.ui, showingButtons, sortingButtons);
    };

    funcs.config.setBackoffDefaults = (obj) => {
        //Set the default values for the backoff config Object.
        obj = funcs.ifNotNonNullObjectUseDefault(obj, config.backoff);
        obj.active = false;
        obj.timeActivated = 0;
        obj.milliseconds = 0;
    };

    funcs.config.setNonUiDefaults = (obj) => {
        //Add the default non-UI configuration information to the Object
        obj = funcs.ifNotNonNullObjectUseDefault(obj, config.nonUi);
        obj.visitedPosts = {};
        obj.addMisingTagTags = true;
        obj.add20kTag = true;
        obj.add10kTagToo = false;
        obj.clickTagTagToOpenCVQ = true;
        obj.clickTagTagToOpenCVQButtonInfo = {
            ctrlKey: false,
            shiftKey: false,
            altKey: true,
            metaKey: false,
            button: 2,
        };
        obj.chatShowPostStatus = true;
        obj.chatShowModeratorDiamond = true;
        obj.visitedLinkStyleActive = true;
        obj.visitedLinksShowUsers = false;
        obj.visitedLinksShowInSidebar = true;
        obj.visitedLinksShowInSidebarUser = true;
        obj.chatShowUpdateButton = true;
        obj.chatCompleteRequestsFade = true;
        obj.chatCompleteRequestsHide = false;
        obj.chatCompleteRequestsDoNothing = false; //This is really just a placeholder. It's value isn't actually used.
        obj.completedShowOnChat = true;
        obj.completedShowOnSearch = true;
        obj.completedShowOnTranscript = true;
        obj.completedShowOnUser = true;
        obj.chatSearchButtonsShowCV = true;
        obj.chatSearchButtonsShowDel = true;
        obj.chatSearchButtonsShowReopen = true;
        obj.chatSearchButtonsShowUndel = true;
        obj.transcriptMessagesNotInRoomHide = false;
        obj.transcriptMessagesNotInRoomMark = true;
        obj.transcriptMessagesNotInRoomDoNothing = false; //This is really just a placeholder. It's value isn't actually used.
        obj.useQuestionTitleAsLink = true;
        obj.trackVisitedLinks = true;
        obj.chatAutoUpdateRate = DEFAULT_AUTO_UPDATE_RATE; //In minutes, 0=disabled
        obj.chatMinimumUpdateDelay = DEFAULT_MINIMUM_UPDATE_DELAY; //seconds minimum between updates.
        obj.allowMultipleSortCriteria = false;
        obj.searchShowDeletedAndClosed = false;
    };

    funcs.config.setUiDefaults = (obj, showingButtons, sortingButtons) => {
        //Set config defaults for the UI while not populating anything that is dependent on
        //  being on the search page.
        obj = funcs.ifNotNonNullObjectUseDefault(obj, config.ui);
        obj.sortingButtonsSortOrder = [];
        obj.excludeTagsList = {};
        //Populate defaults for the showing buttons
        if (typeof showingButtons !== 'undefined') {
            showingButtons.order.forEach((prop) => {
                obj[prop] = showingButtons.buttons[prop].default;
            });
        }
        //Populate defaults for the sorting buttons
        if (typeof sortingButtons !== 'undefined') {
            sortingButtons.order.forEach((prop) => {
                obj[prop] = sortingButtons.buttons[prop].default;
                if (obj[prop]) {
                    obj.sortingButtonsSortOrder.push(prop);
                }
            });
        }
    };

    //Use a different UI config on the cv-pls search and the del-pls search
    funcs.config.setGlobalUILocationIdToMostRecent();

    //UI Buttons (part of UI)
    if (typeof funcs.ui !== 'object') {
        funcs.ui = {};
    }

    funcs.ui.UiButton = function(_text, _id, _default, _tooltip) {
        //Basic UI button Object.
        this.text = _text;
        this.id = _id;
        this.default = _default;
        this.tooltip = _tooltip;
    };

    funcs.ui.ShowingButton = function(_text, _id, _default, _excluding, _textRegex, _tooltip) {
        //Extend ui.UiButton for buttons used to show/hide.
        funcs.ui.UiButton.call(this, _text, _id, _default, _tooltip);
        this.excluding = _excluding;
        this.textRegex = _textRegex;
    };

    funcs.ui.SortingButton = function(_text, _id, _default, _sortType, _datasetProp, _stateOrderReversed, _tooltip) {
        //Extend ui.UiButton for buttons used to sort.
        funcs.ui.UiButton.call(this, _text, _id, _default, _tooltip);
        this.sortType = _sortType;
        this.datasetProp = _datasetProp;
        this.stateOrderReversed = typeof _stateOrderReversed === 'boolean' ? _stateOrderReversed : false;
    };

    funcs.ui.createShowingButtonsType = (type) => {
        //Create an Object representing the showing buttons for a specified type.
        let show20k = false;
        if (type === 'delete') {
            show20k = true;
        } else if (type === 'reopen') {
            show20k = false;
        }
        const buttons = {
            buttons: {
                /* beautify preserve:start *//* eslint-disable no-multi-spaces */
                //                                          button text ,      ID           default, excluding, match RegEx (match question text),                                                                tooltip text
                myRequests:     new funcs.ui.ShowingButton('my requests',   'showMyRequests', false, true,       null,                                                                                          'When selected, your requests are shown if they match one of the selected including criteria and are not excluded by "visited" or "tags".'),
                duplicates:     new funcs.ui.ShowingButton('duplicate',     'showDuplicates', true,  false,      /\bdup(?:e?s?|licates?|repost)\b/ig,                                                           'Duplicate questions.'),
                tooBroad:       new funcs.ui.ShowingButton('too broad',     'showTooBroad',   true,  false,      /\b(?:too[ -]broad|tb|broad)\b/ig,                                                             'Questions which are too broad.'),
                unclear:        new funcs.ui.ShowingButton('unclear',       'showUnclear',    true,  false,      /\b(?:unclear|uc)\b/ig,                                                                        'Unclear questions'),
                opinion:        new funcs.ui.ShowingButton('opinion',       'showOpinion',    true,  false,      /\b(?:pob?|opinion)\b/ig,                                                                      'Primarily opinion based'),
                notMath:        new funcs.ui.ShowingButton('not math',      'showNotMath',    true,  false,      /\bnot\W*(?:about\W*)math/ig,                                                                  'Not about Mathematics'),
                advice:         new funcs.ui.ShowingButton('advice',        'showAdvice',     true,  false,      /\badvice\b/ig,                                                                                'Seeking personal advice'),
                context:        new funcs.ui.ShowingButton('context',       'showContext',    true,  false,      /\bcontext\b/ig,                                                                               'Missing context or other details'),
                otherIncluding: new funcs.ui.ShowingButton('other',         'showOther',      true,  false,      null, /*Matches all messages not matched by other includes*/                                   'Questions that don\'t match any of the other criteria'),
                user20k:        new funcs.ui.ShowingButton('20k+',          'show20k',        true,  true,       null, /*Only used on Delete Search pages*/                                                     'Show messages for delete requests which can only be acted upon by users with more than 19,999 reputation.'),
                visited:        new funcs.ui.ShowingButton('visited',       'showVisited',    false, true,       null,                                                                                          'If not selected, questions you have "visited" will be excluded from those shown. "Visited" means a questions for which you clicked (any button) on a link to that question on this page or the SO Close Vote Reviewers chat room page. This can be inaccurate, because normal JavaScript does not have access to if you have _actually_ visited a page. Visits (clicks) are remembered for only 7 days. If you want a question to be considered "visited" without actually visiting the page, you can right-click on the link to open the context menu (there is no way to detect that you didn\'t use the context menu to open the link in a new tab or window).'),
                excludedTags:   new funcs.ui.ShowingButton('tags',          'showExclTags',   true,  true,       null,                                                                                          'If not selected, questions that match the tags you have selected in the Options dialog will be excluded from those shown. The Options dialog can be opened by clicking the "options (edit \'tags\' list)" button, which is above this one and a bit to the left.'),
                /* beautify preserve:end */ /* eslint-enable no-multi-spaces */
            },
            order: [
                'duplicates',
                'tooBroad',
                'notMath',
                'opinion',
                'myRequests',
                show20k ? 'user20k' : null, // Only used on delete searches
                'advice',
                'context',
                'unclear',
                'otherIncluding',
                'excludedTags',
                'visited',
            ],
            numberFirstRow: 5 + (show20k ? 1 : 0),
        };
        //Filter out from the order any buttons not used on this page.
        buttons.order = buttons.order.filter((prop) => prop);
        //Predetermine some groupings that will be desired/used elsewhere.
        buttons.orderIncluding = buttons.order.filter((prop) => !buttons.buttons[prop].excluding);
        buttons.orderExcluding = buttons.order.filter((prop) => buttons.buttons[prop].excluding);
        return buttons;
    };

    let useButtonType = 'close';
    if (isSearchDel) {
        useButtonType = 'delete';
    } else if (isSearchReopen) {
        useButtonType = 'reopen';
    }

    const showingButtonTypes = {
        close: funcs.ui.createShowingButtonsType('close'),
        delete: funcs.ui.createShowingButtonsType('delete'),
        reopen: funcs.ui.createShowingButtonsType('reopen'),
    };
    const showingButtons = showingButtonTypes[useButtonType];

    funcs.ui.createSortingButtonsType = (type) => {
        //Create the Object representing the sorting buttons for a specified type of search.
        const buttons = {
            buttons: {
                /* beautify preserve:start *//* eslint-disable no-multi-spaces */
                //                                  button text ,     ID         default, sort  , dataset property       , reverse state, tooltip text
                closeVotes:  new funcs.ui.SortingButton('cv',     'sortCloseVotes',  0, 'number', 'closeVoteCount',             false,    'Sort by close vote count.'),
                deleteVotes: new funcs.ui.SortingButton('dv',     'sortDeleteVotes', 0, 'number', 'deleteVoteCount',            false,    'Sort by delete vote count. Unfortunately, the SE API doesn\'t provide delete vote counts for answers. Thus, answers will be sorted into their own group. In addition, when a question is not closed, the number of delete votes is, of course, 0. However, it\'s convenient to have such invalid delete vote requests sorted into their own group.'),
                reopenVotes: new funcs.ui.SortingButton('rv',     'sortReopenVotes', 0, 'number', 'reopenVoteCount',            false,    'Sort by reopen vote count.'),
                views:       new funcs.ui.SortingButton('views',  'sortViews',       0, 'number', 'viewsCount',                 false,    'Sort by number of question views.'),
                reason:      new funcs.ui.SortingButton('reason', 'sortCloseReason', 0, 'number', 'reasonValue',                true,     'Sort by the show/hide request reasons.'), //Things the user considers sorted by strings are usually reverse state order.
                //The dataset property, 'timestamp', for date is repeated as a literal in findMessage() defined in listenToChat(), which is in funcs.inPageCHATListener(), because this Object isn't available in the page context.
                date:        new funcs.ui.SortingButton('date',   'sortAge',         0, 'number', 'timestamp',                  false,    'Sort by the date of the request.'),
                user:        new funcs.ui.SortingButton('user',   'sortUser',        0, 'string', 'requestUser',                true,     'Sort by the user that made the request.'), //Things the user considers sorted by strings are usually reverse state order.
                sortTag:     new funcs.ui.SortingButton('tag',    'sortTag',         0, 'string', 'primaryTag',                 true,     'Sort by the question\'s primary tag.'), //Things the user considers sorted by strings are usually reverse state order.
                /* beautify preserve:end */ /* eslint-enable no-multi-spaces */
            },
            order: [
                'reason',
                'date',
                type + 'Votes',
                'views',
                'user',
                'sortTag',
            ],
            sortingStates: ['', '↓', '↑'],
            numberFirstRow: 3,
        };
        //Create a convenient way to get the button property from the button element's ID.
        buttons.propsById = {};
        buttons.order.forEach((prop) => {
            buttons.propsById[buttons.buttons[prop].id] = prop;
        });
        return buttons;
    };

    const sortingButtonTypes = {
        close: funcs.ui.createSortingButtonsType('close'),
        delete: funcs.ui.createSortingButtonsType('delete'),
        reopen: funcs.ui.createSortingButtonsType('reopen'),
    };
    const sortingButtons = sortingButtonTypes[useButtonType];

    //Original functions

    funcs.appendInfo = (request, useShortText) => {
        //Add the request-info to the matching message, including the data provided by the SE API, if available.
        const info = request.info;
        const isAnswer = request.type === 'answer' || (info && info.answer_id);
        const isDeleted = typeof info === 'undefined';
        //Get the postId
        let postId;
        if (!isDeleted) {
            postId = isAnswer ? info.answer_id : info.question_id;
        } else {
            postId = +request.post;
        }
        if (!request.msg.parentNode) {
            //The message containing the post for which data was obtained is no longer in the DOM.
            //  This can happen on the chat page depending on the timing of determining the messages with QAP, an edit?, or the message was scrolled off the transcript
            //  and getting the data back from the SE API.
            //When this happens, try to find a message in the DOM with the same ID and that contains a QAP with with the same QAP ID.
            const inDomMessage = document.getElementById(request.msg.id);
            if (inDomMessage) {
                const content = funcs.getContentFromMessage(inDomMessage);
                if (funcs.getQuestionAnswerOrPostIdsOrInfoFromLinksInElement(content, 'any').some((inDomMessagePostId) => inDomMessagePostId == postId)) { // eslint-disable-line eqeqeq
                    //The in-DOM message contains the same post, so we can use the data which was obtained.
                    request.msg = inDomMessage;
                } else {
                    //Discard the request, as the data can not be used due to there being no matching post in the message as it now exists.
                    return;
                }
            } else {
                //Discard the request, as it can not be used due to there being no message with that ID in the DOM.
                return;
            }
        }
        let textLong = '';
        let textShort = '';
        const message = request.msg;
        const monologue = funcs.getContainingMonologue(message);
        const content = funcs.getContentFromMessage(message);
        const isReopen = !!funcs.getFirstReopenRequestTagInElement(content);
        let isEdited = false;
        let shiftTextLeft = false;
        if (!isDeleted) {
            //Answer/Question is not deleted
            //Determine if the post has been edited.
            if (info.last_edit_date && monologue) {
                //The monologue may be invalid here on the chat page, if the message/monologue was changed between when messages
                //  were processed and when the SE API returns data. That should no longer be the case, as we now discard requests
                //  which point to messages which have gotten disconnected from the DOM, and can not be recovered.
                const dateSortDatasetProp = sortingButtons.buttons.date.datasetProp;
                const timestamp = +monologue.dataset[dateSortDatasetProp];
                const timestampEarliest = +monologue.dataset.timestampEarliest;
                if ((timestamp && info.last_edit_date > timestamp / 1000) ||
                    (timestampEarliest && info.last_edit_date > timestampEarliest / 1000)
                ) {
                    isEdited = true;
                }
            }
            if (info.closed_date) {
                //Question is closed
                //Short text
                textShort = 'closed';
                if (+info.reopen_vote_count) {
                    textShort = 'cld r:(' + info.reopen_vote_count + ')';
                    shiftTextLeft = true;
                }
                //Display of delete vote count has priority over reopen votes. Only one or the other is displayed when short text is used.
                if (info.delete_vote_count && !isReopen) {
                    textShort = 'cld d:(' + info.delete_vote_count + ')';
                    shiftTextLeft = true;
                }
                //Long text
                textLong = [
                    'closed: ',
                    info.score,
                    'd:(' + info.delete_vote_count + ')',
                    'r:(' + info.reopen_vote_count + ')',
                ].join(' ');
            } else {
                const closeVoteText = 'c:(' + info.close_vote_count + ')';
                //Short text
                textShort = isAnswer ? 'An:(' + info.score + ')' : closeVoteText;
                //Long text
                if (isAnswer) {
                    textLong = [
                        'Answer: ',
                        info.score,
                        '(+' + info.up_vote_count + '/-' + info.down_vote_count + ')',
                    ].join(' ');
                } else {
                    textLong = [
                        info.score,
                        '(+' + info.up_vote_count + '/-' + info.down_vote_count + ')',
                        closeVoteText,
                        'v:(' + info.view_count + ')',
                    ].join(' ');
                }
            }
            if (info.locked_date) {
                textShort = 'locked';
                textLong = 'Locked: ' + textLong;
            }
        } else {
            //Deleted question, convert to number to match what is returned by API.
            textShort = 'deleted';
            textLong = 'deleted';
        }
        const existing = message.querySelector('.request-info');
        if (existing) {
            if ([].slice.call(existing.querySelectorAll('a')).some((requestInfoLink) => (isAnswer ? requestInfoLink.dataset.answerId == postId : requestInfoLink.dataset.questionId == postId))) { // eslint-disable-line eqeqeq
                //There is already a request-info link for this post. Don't add a new one.
                return;
            }
        }
        let link = document.createElement('a');
        if (isEdited) {
            link.title = 'The ' + (isAnswer ? 'answer' : 'question') + ' was edited after the message was posted.';
        }
        if (request.wait) {
            //We are just informing the user they need to wait.
            link = document.createElement('span');
            link.style.cursor = 'wait';
            if (typeof request.mostRecentRequestInfoTime === 'number') {
                const secondsRemaining = (Math.round(config.nonUi.chatMinimumUpdateDelay - ((Date.now() - request.mostRecentRequestInfoTime) / 1000)));
                //As long as we have calculated the remaining time, we might as well check if something is wrong, and fix it.
                if (secondsRemaining < 0) {
                    //Should never have a negative time here. If there is, then we should do what is possible to recover.
                    //  This check is in response to an observed intermittent issue, which is hopefully solved another way,
                    //  but which needs to be root-caused..
                    funcs.executeIfIsFunction(funcs.mp.sanityCheckTimers);
                    if (typeof funcs.mp.processAllUnlessHidden === 'function') {
                        //Call the next step in the process after finished here. This call is farther along in the call-chain that processes
                        //  messages on the chat page, thus it should not have the possibility of introducing an async call-loop.
                        setTimeout(funcs.mp.processAllUnlessHidden, 0);
                    }
                }
                link.title = [
                    'Question status will be provided in about ' + secondsRemaining + ' seconds from when this note was added,',
                    'which is when the minimum time between updates will have elapsed (currently ' + config.nonUi.chatMinimumUpdateDelay + ' seconds).',
                ].join(' ');
            } else {
                link.title = 'Question status will be provided as soon as the minimum time between updates has elapsed (currently a maximum delay of ' + config.nonUi.chatMinimumUpdateDelay + ' seconds).';
            }
            link.title += [
                ' You can adjust the minimum delay between question status updates in the options dialog available from the "requests" (search results) page.',
                'To immediately update the question status, you can click the "update" button at the bottom of the page, or switch to a different tab and back to this one.',
            ].join(' ');
            textShort = textLong = 'wait';
        }
        //The default question link to use
        link.href = window.location.protocol + '//math.stackexchange.com/' + (isAnswer ? 'a' : 'q') + '/' + postId;
        //Find the URL used in the link in the message and use that URL instead. This allows the user to perceive
        //  only a single link for the question instead of seeing that they followed either the link in the message,
        //  or the request-info, but not the other link.
        const messagePostLink = funcs.getFirstLinkToPostId(content, postId);
        if (messagePostLink) {
            //The link is valid and goes directly to the question, not an answer. It may have a tracking link in it.
            //Use it for the question link so that both turn a :visited color when either is visited.
            link.href = messagePostLink.href;
        }
        //Remember the answer/question/post ID, so it does not need to be parsed out of the link, repeatedly.
        link.dataset.postId = postId;
        link.dataset.questionId = postId;
        if (isAnswer) {
            if (!isDeleted) {
                link.dataset.questionId = info.question_id;
            }
            link.dataset.answerId = postId;
        }
        link.target = '_blank';

        if (isEdited) {
            textLong += ' [ed]';
        }
        link.appendChild(document.createTextNode(useShortText ? textShort : textLong));
        if (useShortText) {
            link.title = textLong + (isEdited ? '\r\n' + link.title : '');
        }
        if (isEdited && useShortText) {
            link.insertAdjacentHTML('beforeend', '<sup>E</sup>');
        }
        if (shiftTextLeft) {
            link.style.marginLeft = '-3px';
        }
        if (existing !== null) {
            //Add additional data to the existing request-info for this message.
            existing.appendChild(link);
            existing.classList.remove('urrsRequestHasOne');
            //Make sure the message has enough height to contain the request-info.
            message.style.minHeight = (existing.clientHeight + 1) + 'px';
        } else {
            //Add the first request-info for this message.
            const node = document.createElement('span');
            //The messages class appears to be used by SO chat scripts for selection. Thus, the
            //  relevant styles have been duplicated.
            node.className = 'request-info request-info-messages urrsRequestHasOne';
            //Even though the relevant styles have been duplicated in CSS, that does not cover the possibility
            // of alternate themes. So, copy the color and background color into styles for the request-info span.
            //If either reply class is on the message, then the obtained color is the reply color, which is not desired.
            const hasReplyParent = message.classList.contains('reply-parent');
            const hasReplyChild = message.classList.contains('reply-child');
            if (hasReplyParent || hasReplyChild) {
                message.classList.remove('reply-parent');
                message.classList.remove('reply-child');
            }
            const messagesNode = funcs.getContainingMonologue(content).querySelector('.messages');
            node.style.backgroundColor = funcs.getBackgroundColor(messagesNode);
            node.style.color = funcs.getTextColor(messagesNode);
            if (hasReplyParent) {
                message.classList.add('reply-parent');
            }
            if (hasReplyChild) {
                message.classList.add('reply-child');
            }
            node.appendChild(link);
            //Place the request-info prior to the .flash.
            message.insertBefore(node, message.querySelector('.flash'));
        }
        //The link is now inserted in the request info.
        //Add post data to the DOM to enable other functionality.
        //Monologues are used for sorting. While it appears the code otherwise handles the possibility of multiple messages per monologue,
        //  sorting has to assume one message is sorted per monologue (on search results pages, SE delivers each message in a separate monologue).
        //  Messages are used for show/hide determination
        //Add the post ID to the list of post IDs contained in the message (for hiding by visited).
        funcs.addToDatasetList(message, 'postIdList', postId);
        if (isDeleted) {
            link.dataset.postStatus = 'deleted';
            //Nothing else to do for deleted posts.
            return;
        } //else
        //Store various explicit properties of the question for use elsewhere in this code.
        if (isAnswer) {
            link.dataset.postStatus = 'answer';
        } else {
            link.dataset.postStatus = info.closed_date ? 'closed' : 'open';
        }
        link.dataset.questionTags = JSON.stringify(info.tags);
        funcs.setDatasetIfNotUndefined(link, 'questionTitle', info.title);
        //These next two are copied into the message's dataset elsewhere, after all request-info's are added (in case there is more than one per message).
        funcs.setDatasetIfNotUndefined(link, 'closeVotes', info.close_vote_count);
        funcs.setDatasetIfNotUndefined(link, 'reopenVotes', info.reopen_vote_count);
        funcs.setDatasetIfNotUndefined(link, 'deleteVotes', info.delete_vote_count);
        funcs.setDatasetIfNotUndefined(link, 'views', info.view_count);
        funcs.setDatasetIfNotUndefined(link, 'score', info.score);
        funcs.setDatasetIfNotUndefined(link, 'lastEditDate', info.last_edit_date);
        funcs.setDatasetIfNotUndefined(link, 'closedDate', info.closed_date);
        link.dataset.isLocked = !!info.locked_date;
        //Add the tags to the list contained in the message (used when hiding by tag). Used to add tag to messages w/o a question tag.
        funcs.addToDatasetList(message, 'tagList', info.tags);
    };

    //Format the IDs in the array as they need to be when sending the SE API call.
    funcs.formatPosts = (arr) => arr.map((item) => item.post).filter((postId) => {
        const postIdNum = +postId;
        //SE API returns an error if the postId doesn't fit into 63 bits (e.g. an int).
        return (postIdNum && postIdNum <= 2147483647 && /^\d+$/.test(postId));
    }).join(';');

    funcs.chunkArray = (array, chunkSize) => {
        //Chop a single array into an array of arrays. Each new array contains chunkSize number of
        //  elements, except the last one.
        var chunkedArray = [];
        var startIndex = 0;
        while (array.length > startIndex) {
            chunkedArray.push(array.slice(startIndex, startIndex + chunkSize));
            startIndex += chunkSize;
        }
        return chunkedArray;
    };

    funcs.checkRequests = (status, requests, allMessages) => {
        //This calls the SE API to get data for all requests (answers and questions) that have been identified.
        //  It is called in an async loop (via the XHR requests) until all chunks of the total desired
        //  requests have been processed.
        if (status === null) {
            status = {
                open: [],
                closed: [],
                deleted: [],
            };
        }
        //Get the next request set, either questions or answers.
        let currentreq;
        let isAnswers = false;
        if (requests.questions && requests.questions.length > 0) {
            currentreq = requests.questions.pop();
            isAnswers = false;
        } else if (requests.answers && requests.answers.length > 0) {
            currentreq = requests.answers.pop();
            isAnswers = true;
        }
        if (typeof currentreq === 'undefined') {
            //Do processing, even if there is nothing to process (which will delete all the messages when there are no posts).
            funcs.checkDone(status);
            return;
        }

        //Set up the SE API request.
        const xhr = new XMLHttpRequest();

        //Handle the response from the API.
        xhr.addEventListener('load', () => {
            if (xhr.status !== 200) {
                //If there is a non 200 status returned, assume no more requests should be processed. Log the response and
                //  process any data already obtained from prior SE API calls.
                console.error('Error in response to SE API call: status,', xhr.status, ':: statusText,', xhr.statusText, ':: responseText:', xhr.responseText);
                funcs.checkDone(status);
                return;
            }

            //A non-error response.
            const response = JSON.parse(xhr.responseText);
            const items = response.items;

            //Process each post for which data was received.
            for (const item of items) {
                let openOrClosed = status.open;
                if (item.closed_date) {
                    //Cause the record to be placed in the closed list instead of the open list.
                    openOrClosed = status.closed;
                }
                //Find requests which match this question_id, or answer_id for answers
                for (const j in currentreq) {
                    if (currentreq.hasOwnProperty(j)) {
                        if ((!isAnswers && currentreq[j].post == item.question_id) || (isAnswers && currentreq[j].post == item.answer_id)) { // eslint-disable-line eqeqeq
                            //Not a funcs.mp.Request, perhaps should have a new class (e.g. responseRecord).
                            openOrClosed.push({
                                msg: currentreq[j].msg,
                                type: (isAnswers ? 'answer' : 'question'),
                                post: currentreq[j].post,
                                info: item,
                            });

                            delete currentreq[j];
                            if (allMessages) {
                                //If we "continue" here, then all messages which are about this question_id will get request-info.
                                //This is done on the chat page, as we are not deleting all but the first request.
                                continue;
                            }
                            //However, if we only want to insert the request-info in the first one found, then we "break".
                            //  All additional messages with this post ID will be marked as deleted. A drawback of doing this is
                            //  the case where someone makes two duplicate requests with the same dup-target. The second request will
                            //  not contain a request-info for the dup-target, but will contain one for the question about which the
                            //  request is being made. This is no longer a problem, as we no longer delete based on unfulfilled requests,
                            //  but only if there are no requests which were fulfilled for the message.
                            break;
                        }
                    }
                }
            }

            //Add any remaining requests to the "deleted" list. This should be requests for questions and answers which
            //  did not produce any data from the API (deleted).
            for (const request of currentreq) {
                if (typeof request !== 'undefined') {
                    status.deleted.push(request);
                }
            }
            //Start the main backoff timer
            //XXX This function does not yet obey a backoff timer which existed prior to it sending out the first API call, when the backoff
            //  response was received in another tab. It does obey any backoff which it receives in response to its own requests.
            if (response.backoff > 0 && typeof funcs.backoff.setAndStoreInConfig === 'function') {
                //Start the backoff timer for whatever the API specified, but
                //  only if the function to do so exists. This implements complying with the backoff stated by the API
                //  both when it is on the last request of a set, and to inform other instances that a backoff is in effect.
                //  In the non-chat pages, this only sets the cross-instance backoff timer, as the search page does not.
                //  only requests once per user-reload of the page.
                //NOTE: Backoff is treated as requiring backing off of all requests, but it is actually only required that the backoff
                //  be honored per "method".
                //XXX  It should be implemented across tabs. The code is written, but is untested. In fact, the user is not supposed to be able to override it.
                funcs.backoff.setAndStoreInConfig(response.backoff);
            }

            //If there are no more requests to make, process all the data received from all API calls.
            if (!((requests.questions && requests.questions.length > 0) || (requests.answers && requests.answers.length > 0))) {
                //There are no more requests to process.
                //We need to account for posts which were processed as both questions and answers. When it is unknown if
                //  the ID applies to a question or answer, information is requested as both. Thus, there may be requests marked
                //  as deleted, which have actually been fulfilled by the other type of request.
                //Filter out any requests marked as deleted for which there is a valid response, or duplicate "deleted" response.
                const allValid = status.open.concat(status.closed);
                //Remove duplicate deleted requests (as a result of trying posts as both a question and answer)
                status.deleted = status.deleted
                    .filter((deletedPostRequest) => !allValid.some((valid) => deletedPostRequest.post === valid.post))
                    .filter((deletedPostRequest, index, array) => array.indexOf(deletedPostRequest) === index);
                funcs.checkDone(status);
                return;
            }

            //Make the next request of the API, complying with any backoff time required.
            setTimeout(funcs.checkRequests, response.backoff * 1000, status, requests, allMessages);
        }, false);
        xhr.addEventListener('error', (event) => {
            //Some error occurred on the request. This should catch CORS error which appear to happen *very* intermittently on the chat page, for some
            //  yet to be determined reason. I've only seen this on the chat page. There was a grouping of "CORS header 'Access-Control-Allow-Origin' missing" errors.
            //  Prior to this event handler existing, that error resulted in recovery via sanityCheckTimers.
            //  The CORS errors appear to happen only on the period of weeks, or longer. The last issue happened 2017-04-12/13 (a Wed-Thurs). Epoch time: 1492087005623
            //  With a few happening in closely together, but interspersed with valid requests and responses.
            console.error('Error event in sending to SE API: xhr.status:', xhr.status, '\n:: statusText:', xhr.statusText, '\n:: responseText:', xhr.responseText, '\n::  event:', event, '\n::  status:', status);
            funcs.generateError('Got XHR error event');
            //It is assumed that checkDone will handle the error case. On the chat page this is done by not updating when there is nothing in status.
            funcs.checkDone(status);
        });

        //Construct and send the API request.
        const url = window.location.protocol + '//api.stackexchange.com/2.2/' + (isAnswers ? 'answers' : 'questions') + '/' + funcs.formatPosts(currentreq) + '?' + [
            'pagesize=100',
            'site=math',
            'key=YvvkfBc3LOSK*mwaTPkUVQ((',
            //The filter used here could be pruned back a bit. It was expanded for functionality that was
            //  moved out of this script, then partially pruned back, then expanded a bit, without double
            //  checking that all requested information is used.
            //  It doesn't hurt to get the extra data, but it is not needed.
            //Add bounties & things for Roomba
            'filter=!m)9LJxKwexI9h92EPpSH6vR(2S7pz3L9cXWiH9ar04WP8BSWy0Mtyl7P',
        ].join('&');
        xhr.open('GET', url);
        xhr.send();
    };


    //Message processing
    if (typeof funcs.mp !== 'object') {
        funcs.mp = {};
    }

    funcs.mp.Request = function(_message, _post, _type, _wait, _mostRecentRequestInfoTime) {
        //class for a new processing request
        this.msg = _message;
        this.post = _post;
        this.type = _type;
        if (typeof _wait !== 'undefined') {
            this.wait = _wait;
        }
        if (typeof _mostRecentRequestInfoTime !== 'undefined') {
            this.mostRecentRequestInfoTime = _mostRecentRequestInfoTime;
        }
    };

    funcs.mp.getRequestsInMessagesListText = (messages, regexes) => {
        //Modified from original funcs.processMessages
        //Looks though message HTML searching for text that might indicate a QAP.
        //Parsing is rudimentary. It only understands the basic /question/id, /a/id, and /posts/id formats.
        //It does not understand the /question/id/title/answerId/#answerId
        //This is now used as a secondary pass for messages where the question/answer are not found in links.
        //If called with a single RegExp
        if (!Array.isArray(regexes)) {
            regexes = [regexes];
        }
        const newRequests = {};
        MESSAGE_PROCESSING_REQUEST_TYPES.forEach((type) => {
            newRequests[type] = [];
        });
        for (const message of messages) {
            //Get stripped, cloned content
            const contentEl = funcs.getContentFromMessage(message);
            if (!contentEl) {
                //No content.
                continue;
            }
            const contentNoTagsLinksOrCode = funcs.removeTagsLinksAndCodeFromElement(contentEl.cloneNode(true));
            //If the message has no content, continue.
            const content = contentNoTagsLinksOrCode.textContent.trim();
            if (content === '') {
                continue;
            }
            //Find things that look like they might be URLs to questions/post, but currently not answers
            //Restrict matches to only Stack Overflow
            getQuestionIdFromURLRegEx.lastIndex = 0;
            const matches = funcs.getAllRegExListMatchesInText(content, getSOQuestionOrAnswerIdFfromURLRegExes);
            //If there is not something that looks like a question/post URL, then go to next message.
            if (matches === null) {
                continue;
            }
            //For each URL (match) create a requests entry which associates the post with the message.
            const posts = [];
            //We can have duplicates here. This used to be common, due to possible HTML: <a href="questionURL">questionURL</a>,
            //  but, at this point in time, we eliminate HTML links prior to processing. However, duplicates are still possible.
            const idTypesRegexes = {
                posts: /\/(?:posts)\/(\d+)/,
                answers: /\/(?:a)\/(\d+)/,
                questions: /\/(?:q[^/]*)\/(\d+)/,
            };
            for (const key of Object.keys(matches)) {
                const idType = {};
                MESSAGE_PROCESSING_REQUEST_TYPES.forEach((type) => {
                    const idMatch = idTypesRegexes[type].exec(matches[key]);
                    if (idMatch) {
                        idType[type] = idMatch[1];
                    } else {
                        idType[type] = null;
                    }
                });
                const post = MESSAGE_PROCESSING_REQUEST_TYPES.reduce((sum, type) => (sum ? sum : idType[type]), null);
                //Don't add duplicate posts for the same question.
                if (posts.indexOf(post) === -1) {
                    posts.push(post);
                    MESSAGE_PROCESSING_REQUEST_TYPES.some((type) => {
                        if (idType[type]) {
                            const request = new funcs.mp.Request(message, post, type);
                            newRequests[type].push(request);
                            return true;
                        } // else
                        return false;
                    });
                }
            }
        }
        if (MESSAGE_PROCESSING_REQUEST_TYPES.some((type) => newRequests[type] && newRequests[type].length)) {
            return newRequests;
        }
        //Explicitly indicate nothing was found.
        return null;
    };

    funcs.mp.markAllRequestInfoOnNonRequests = (searchText) => {
        //Visually differentiate requests from just info on post URLs contained in a message.
        [].slice.call(document.querySelectorAll('.message > .request-info')).forEach((requestInfo) => {
            //I disagree with searching the text for [cv-pls], etc. within the text of the message.  It is not
            //  something that is searched for on the search pages.  Thus, people should not be given the inaccurate
            //  impression that it will be treated as a request.  Once it goes off the chat transcript, it will be
            //  forgotten.
            //This could be changed by fetching/searching events, rather than relying on the site search. Current plan
            //  is to integrate the popup from the request archiver into this to be what views requests. However, that's
            //  a considerable change.
            const contentEl = funcs.getContentFromMessage(funcs.getContainingMessage(requestInfo));
            if (!(funcs.getFirstRequestTagInElement(contentEl) || (searchText && funcs.doesElementContainRequestTagAsText(contentEl)))) {
                //The content does not contain a request tag.
                requestInfo.classList.add('urrsRequestNoRequestTag');
            }
        });
    };

    funcs.mp.markAllMessagesByRequestState = () => {
        //Have all messages and monologues which have requests which are completed include the class urrsRequestComplete.
        const fakeRequestTags = {
            close: funcs.makeTagTagElement('cv-pls'),
            reopen: funcs.makeTagTagElement('reopen-pls'),
            delete: funcs.makeTagTagElement('del-pls'),
            undelete: funcs.makeTagTagElement('undel-pls'),
        };
        const handledRequestTypes = [
            'close',
            'delete',
            'reopen',
            'undelete',
            'flag',
            'offensive',
            'spam',
            'reject',
        ];
        function resetHandledRequestTypeRegexes() {
            handledRequestTypes.forEach((type) => {
                tagsInTextContentRegExes[type].lastIndex = 0;
            });
        }
        [].slice.call(document.querySelectorAll('.message > .request-info')).forEach((requestInfo) => {
            //There is only ever one request-info per message
            //XXX This is currently not going to handle duplicate requests where the duplicate-target is also included.
            //XXX No attempt is made to detect request tags in text.
            const message = funcs.getContainingMessage(requestInfo);
            const monologue = funcs.getContainingMonologue(message);
            const contentEl = funcs.getContentFromMessage(message);
            const requestTags = funcs.getAllRequestTagsInElement(contentEl).filter((tag) => {
                //This function currently only understands a limited subset of request tags.
                const tagText = tag.textContent;
                resetHandledRequestTypeRegexes();
                return handledRequestTypes.some((type) => tagsInTextContentRegExes[type].test(tagText));
            });
            if (requestTags.length === 0) {
                if (monologue.classList.contains('user-3735529')) { // chat.stackoverflow
                    //SmokeDetector: Treat as a del-pls request
                    const sdLink = contentEl.querySelector('a');
                    if (sdLink && sdLink.textContent.indexOf('SmokeDetector') > -1) {
                        //We only want actual SmokeDetector reports, which always start with a link to SmokeDetector.
                        //  SD can have other messages which include links to deleted posts which are not reports.
                        requestTags.push(fakeRequestTags.delete);
                    }
                }
                if (/^\s*!!\/report\s/.test(contentEl.textContent)) {
                    //Someone reporting a post to SmokeDetector
                    requestTags.push(fakeRequestTags.delete);
                }
                if (monologue.classList.contains('user-6373379') || monologue.classList.contains('user-6294609')) { // chat.stackoverflow
                    //FireAlarm && Queen: Treat as a cv-pls request
                    requestTags.push(fakeRequestTags.close);
                }
                //The code for Natty is originally by Filnor (https://chat.stackoverflow.com/users/4733879/filnor)
                //  Found: https://github.com/SOBotics/Userscripts/blob/master/UnclosedRequestReview2.user.js#L1988
                // Released under an MIT license:
                //   https://chat.stackoverflow.com/transcript/message/45507145#45507145
                if (monologue.classList.contains('user-6817005')) {
                    //Natty: Treat as a del-pls request
                    const nattyLink = contentEl.querySelector('a');
                    if (nattyLink && nattyLink.textContent.indexOf('Natty') > -1) {
                        //We only want actual Natty reports, which always start with a link to Natty.
                        //  Nat can have other messages which include links to deleted posts which are not reports.
                        requestTags.push(fakeRequestTags.delete);
                    }
                }
                if (/^@Natty (?:feedback|tp|fp|ne|report)\b/i.test(contentEl.textContent)) {
                    //Natty feedback: Treat as a del-pls request
                    requestTags.push(fakeRequestTags.delete);
                }
            }
            //Consider it active if it's not a request, or if the request is active.
            var requestIsActive = requestTags.length === 0 || requestTags.some((tag) => {
                const tagText = tag.textContent;
                return [].slice.call(requestInfo.children).some((requestInfoLink) => {
                    if (requestInfoLink.nodeName !== 'A') {
                        //Child isn't a anchor
                        return false;
                    }
                    const postStatus = requestInfoLink.dataset.postStatus;
                    const postIsDeleted = postStatus === 'deleted';
                    //const postIsClosed = postStatus === 'closed';
                    const postIsOpen = postStatus === 'open';
                    const postIsLocked = requestInfoLink.dataset.isLocked === 'true';
                    resetHandledRequestTypeRegexes();
                    /* beautify preserve:start *//* eslint-disable no-multi-spaces */
                    const completedPostStateByRequestType = {
                        close:      postIsOpen,
                        delete:    !postIsDeleted,
                        reopen:    !postIsOpen,
                        undelete:   postIsDeleted,
                        flag:      !postIsDeleted,
                        offensive: !postIsDeleted,
                        spam:      !postIsDeleted,
                        reject:    !postIsDeleted,
                    };
                    /* beautify preserve:end */ /* eslint-enable no-multi-spaces */
                    return !postIsLocked && (                                                       //Post isn't locked (can't take action on locked posts)
                        Object.keys(completedPostStateByRequestType).some((type) => (tagsInTextContentRegExes[type].test(tagText) && completedPostStateByRequestType[type])));
                });
            });
            requestInfo.dataset.requestComplete = !requestIsActive;
            if (requestIsActive) {
                message.classList.remove('urrsRequestComplete');
            } else {
                message.classList.add('urrsRequestComplete');
            }
        });
        //Set complete class on monologues, if all messages are complete.
        funcs.doForAllMonologues((monologue) => {
            if (monologue.querySelector('.monologue > .messages > .message:not(.urrsRequestComplete)')) {
                monologue.classList.remove('urrsRequestComplete');
            } else {
                monologue.classList.add('urrsRequestComplete');
            }
        });
    };

    funcs.mp.makeRequestsFromAllMessagesForType = (what) => {
        //For each link of the 'what' type requested in all messages in the DOM, create request objects representing the desire to fetch data from the SE API for that post.
        const requests = [];
        what = what.toLowerCase();
        const doQuestions = what.indexOf('q') > -1;
        const doAnswers = what.indexOf('a') > -1;
        const doPosts = what.indexOf('p') > -1;
        let getWhat = '';
        let type = '';
        if (doQuestions) {
            getWhat = 'direct questions';
            type = 'question';
        } else if (doAnswers) {
            getWhat = 'answers';
            type = 'answer';
        } else if (doPosts) {
            getWhat = 'posts';
            type = 'post';
        } else {
            return requests;
        }
        [].slice.call(document.querySelectorAll('.messages > .message')).reverse().forEach((message) => {
            const content = funcs.getContentFromMessage(message);
            if (!content) {
                return;
            }
            let foundMessage = false;
            let getWhatThisTime = getWhat;
            const questionOnlyTags = funcs.getAllQuestionOnlyRequestTagsInElement(content);
            if (questionOnlyTags && questionOnlyTags.length) {
                //This is a request which can only be made of questions.
                if (doQuestions) {
                    getWhatThisTime = 'questions';
                } else if (doAnswers) {
                    //If it's this type of request, we don't want status from an answer.
                    //  If this is a URL which only points to an answer (e.g. /a/123456), then we recognize no URL, and
                    //  consider the request invalid.
                    //  Ideally, we'd do a request which fetched the question ID associated with any answer found, but,
                    //  for now, we just ignore answer URLs which don't also include the question (when the request
                    //  must be to a question).
                    return;
                }
            }
            funcs.getQuestionAnswerOrPostIdsOrInfoFromLinksInElement(content, getWhatThisTime).forEach((postId) => {
                requests.push(new funcs.mp.Request(message, postId, type));
                foundMessage = true;
            });
            //Go searching back references.
            if (!foundMessage) {
                //Found a request, but not a questionId, and no other link in the content.
                //Add the question from any requests which are replies to messages with question links.
                funcs.getQuestionAnswerOrPostInfoListFromReplyToIfIsRequestAndNoLinks(message, getWhat).forEach((refInfo) => {
                    const refPostId = refInfo.postId;
                    //Add the request
                    requests.push(new funcs.mp.Request(message, refPostId, type));
                    //Should we add a link to the question in the request?
                    if (config.nonUi.useQuestionTitleAsLink) {
                        const newSpan = document.createElement('span');
                        newSpan.title = 'This link did not exist in the original message. It has been added from the post linked in the message to which this message is a reply.';
                        newSpan.className = 'urrsAddedQuestionLink';
                        newSpan.appendChild(document.createTextNode(' '));
                        const newLink = document.createElement('a');
                        newLink.href = refInfo.url;
                        //Add a textContent used as a semaphore to indicate the text of the link is to be set after we obtain the data from the SE API call.
                        newLink.textContent = refInfo.text;
                        newLink.dataset.urrsReplacement = true;
                        newSpan.appendChild(newLink);
                        content.appendChild(newSpan);
                    }
                });
                //Currently we do nothing with the cv-pls if it is a reply and there is no data available in the current DOM. Should consider
                //  marking it for the user in some way (would need to be after data is back from the SE API), or fetching the data for the
                //  required message. Doing the latter would put all the question data behind 2 async API accesses, or the data for the
                //  affected message would not be available until the next update.
                //  Not doing anything leaves good information in the question if it has been updated with the question link, which is
                //  the default. Thus, under normal conditions the message will continue to have status until it is removed from the DOM.
                //  The primary time that this will be seen without status information is when the user first comes to the page, or reloads
                //  the page when the referenced message is not in the transcript displayed on the page.
            }
        });
        return requests;
    };

    funcs.mp.mergeRequests = (primary, secondary) => {
        //Merge two objects containing lists of each request types.
        MESSAGE_PROCESSING_REQUEST_TYPES.forEach((type) => {
            if (secondary[type] && Array.isArray(secondary[type]) && secondary[type].length > 0) {
                primary[type] = primary[type].concat(secondary[type]);
            }
        });
    };

    funcs.mp.generateRequestsForAllAppropriateMessages = (onlyQuestions) => {
        //Go through the existing messages, look for links, or just text which indicates a SO post.
        const requests = {};
        requests.questions = funcs.mp.makeRequestsFromAllMessagesForType('questions');
        if (!onlyQuestions) {
            requests.answers = funcs.mp.makeRequestsFromAllMessagesForType('answers');
        } else {
            requests.answers = [];
        }
        requests.posts = funcs.mp.makeRequestsFromAllMessagesForType('posts');
        //XXX testing
        if (typeof funcs.mp.getRequestsInMessagesListText === 'function') {
            const textRequests = funcs.mp.getRequestsInMessagesListText([].slice.call(document.querySelectorAll('.message')), getActionTagInTextRegEx);
            if (textRequests) {
                funcs.mp.mergeRequests(requests, textRequests);
            }
        }
        if (onlyQuestions && requests.answers) {
            delete requests.answers;
        }
        return requests;
    };

    funcs.mp.processAllMessageLinks = (onlyQuestions) => {
        //Actually process the messages
        // Scan all the messages in the DOM, determine which ones should have a request-info attached and send the requests off to be send tot he SE API.
        //We are unconditionally going to process all messages we find.
        messageProcessing.isRequested = false;
        //Add timestamp dataset to all posts.
        funcs.addTimestampDatasetToAllMonologues();
        if (isChat) {
            //XXX It would be better to use the CHAT API to fetch the events and get actual times for each message.
            funcs.addEarliestAndLatestTimestampDatasetToAllMonologues();
        }
        funcs.mp.processRequests(funcs.mp.generateRequestsForAllAppropriateMessages(onlyQuestions), onlyQuestions);
    };

    funcs.mp.cloneRequests = (requests) => {
        //Clone the requests object (Object with properties which are Array).
        //Not intended as a complete deep clone of an Object.
        var clone = {};
        Object.keys(requests).forEach((prop) => {
            if (Array.isArray(requests[prop])) {
                clone[prop] = [].concat(requests[prop]);
            } else if (typeof requests[prop] === 'object') {
                //This is a naive implementation of cloning an Object. To do it
                //  properly, you should preserve the Object's prototype, which might, arguably,
                //  require copying the prototype (instead of a reference), which would prevent future changes to the
                //  prototype from affecting the clone. A user of cloning might desire either way of doing it.
                clone[prop] = funcs.mp.cloneRequests(requests[prop]);
            } else {
                clone[prop] = requests[prop];
            }
        });
        return clone;
    };

    funcs.mp.processRequests = (requests, onlyQuestions) => {
        //Put the requests in the final shape they need to be in prior to sending the Object to the API processing.
        //The API only understands questions and answers. If data is asked about a post, about the only thing it will tell
        //  us is if that post is a question, or an answer. So, we request "posts" as both questions and answers and use
        //  whichever actually returns data.
        //Add post requests to both the question and answer requests.
        //XXX What we should be doing is requesting info for each Q/A as both, in case it's misidentified as a Q when really an A, or vice-versa.
        //      Even better would be to request as an answer, and get the associated question (when needed for cv-pls and reopen-pls).
        if (requests.posts) {
            requests.questions = requests.questions.concat(requests.posts);
            if (!onlyQuestions) {
                requests.answers = requests.answers.concat(requests.posts);
            }
            delete requests.posts;
        }
        //API requests are max 100 questions each. So, break the arrays into 100 post long chunks.
        ['questions', 'answers'].forEach((prop) => {
            if (requests[prop] && requests[prop].length > 0) {
                requests[prop] = funcs.chunkArray(requests[prop], 100);
            } else {
                delete requests[prop];
            }
        });
        //Process all requests, even if there are no requests.
        funcs.checkRequests(null, requests, !isSearchReviewUIActive);
    };


    //General utility functions

    funcs.generateErrorAndThrow = (errorText, throwText) => {
        //Throw an error after logging an error to the console.
        funcs.generateError(errorText);
        throw throwText;
    };

    funcs.generateError = (errorText) => {
        //Generate an error in the console.
        var error = new Error(errorText);
        console.error(error);
    };

    funcs.addStylesToDOM = (id, styles) => {
        //Add styles passed in as text to the DOM as a <style> element with the ID supplied. Verify
        //  that the styles have not previously been added.
        const style = document.createElement('style');
        style.type = 'text/css';
        style.id = id;
        const oldStyle = document.getElementById(style.id);
        if (oldStyle) {
            //Don't duplicate the styles if called again with the same ID.
            oldStyle.remove();
        }
        style.textContent = styles;
        document.head.appendChild(style);
    };

    funcs.getTextColor = (element) => { // eslint-disable-line arrow-body-style
        //Get an actual color for the text in the supplied element. Search ancestors if the "color" is not an actual color.
        return funcs.getEffectiveColorStyle(element, 'color', 'black');
    };

    funcs.getBackgroundColor = (element) => { // eslint-disable-line arrow-body-style
        //Get an actual color for the background-color in the supplied element. Search ancestors if the "color" is not an actual color.
        return funcs.getEffectiveColorStyle(element, 'background-color', 'white');
    };

    funcs.getEffectiveColorStyle = (element, colorStyle, rejectRegex, defaultValue) => { // eslint-disable-line arrow-body-style
        //Find the color used, ignoring anything other than a straight color without transparency or alpha channel.
        //  Should really do a numeric check on rgba() alpha values, but a RegExp appears
        //  sufficient for the programmatically generated values.
        return funcs.getEffectiveStyleValue(element, colorStyle, /(?:transparent|initial|inherit|currentColor|unset|rgba.*,\s*0(?:\.\d*)?\s*\))/i, defaultValue);
    };

    funcs.getEffectiveStyleValue = (element, styleText, rejectRegex, defaultValue) => {
        //Find the style used on an element. Search ancestors until a style is found that does not match the rejection RegExp.
        //  Used to get an actual value for the background-color and color, rather than something like "transparent".
        if (!element) {
            return defaultValue;
        }
        var foundStyleValue;
        do {
            foundStyleValue = window.getComputedStyle(element).getPropertyValue(styleText);
            element = element.parentNode;
            rejectRegex.lastIndex = 0; //Clear the RegExp
        } while (element && rejectRegex.test(foundStyleValue));
        //Could test for the element being null instead of re-testing the RegExp.
        rejectRegex.lastIndex = 0; //Clear the RegExp
        if (rejectRegex.test(foundStyleValue)) {
            //If no valid style was found, use the default provided.
            foundStyleValue = defaultValue;
        }
        return foundStyleValue;
    };

    funcs.getListFromDataset = (element, prop) => {
        //Get a list stored in an element's dataset in the specified property which is in JSON format.
        var list = element.dataset[prop];
        return list ? JSON.parse(list) : [];
    };

    funcs.setDatasetList = (element, prop, info) => {
        //Set a list stored in an element's dataset in the specified property. Store it in JSON format.
        if (!Array.isArray(info)) {
            info = [info];
        }
        element.dataset[prop] = JSON.stringify(info);
    };

    funcs.addToDatasetList = (element, prop, info) => {
        //Add a string, or array of strings to an array stored in an element's dataset, maintaining unique values.
        var list = funcs.getListFromDataset(element, prop);
        if (!Array.isArray(info)) {
            info = [info];
        }
        //Verify each item being added does not already exist in the list.
        info.forEach((item) => {
            if (list.indexOf(item) === -1) {
                list.push(item);
            }
        });
        element.dataset[prop] = JSON.stringify(list);
    };

    //Utility functions specific to Monologues/messages
    funcs.doForAllMonologues = (doing) => {
        //Call the supplied function for each .message in the page
        if (typeof doing !== 'function') {
            return;
        }
        [].slice.call(document.querySelectorAll('.monologue')).forEach(doing);
    };

    funcs.doForAllMessages = (doing) => {
        //Call the supplied function for each .message in the page
        if (typeof doing !== 'function') {
            return;
        }
        [].slice.call(document.querySelectorAll('.monologue .message')).forEach(doing);
    };

    funcs.doForAllMessagesWithRequestInfo = (doing) => {
        //Call the supplied function for each .message in the page
        if (typeof doing !== 'function') {
            return;
        }
        [].slice.call(document.querySelectorAll('.monologue .message')).filter((message) => {
            if (funcs.getRequestInfoFromMessage(message)) {
                return true;
            } //else
            return false;
        }).forEach(doing);
    };

    funcs.makeTagTagElementWithSpace = (tag, noLink, tooltip) => {
        //Create a tag tag for the specified tag name. Include a space prior to the tag.
        const docFrag = document.createDocumentFragment();
        docFrag.appendChild(document.createTextNode(' '));
        docFrag.appendChild(funcs.makeTagTagElement(tag, noLink, tooltip));
        return docFrag;
    };

    funcs.makeTagTagHref = (tag) => { // eslint-disable-line arrow-body-style
        //Create the URL used for a tag-tag.
        return '//math.stackexchange.com/questions/tagged/' + tag;
    };

    funcs.makeTagTagElement = (tag, noLink, tooltip) => {
        //Create a tag tag for the specified tag name.
        var tagLink;
        if (noLink) {
            tagLink = document.createElement('span');
            tagLink.className = 'ob-post-tag-no-link';
        } else {
            tagLink = document.createElement('a');
        }
        if (tooltip) {
            tagLink.title = tooltip;
        }
        tagLink.target = '_blank';
        tagLink.insertAdjacentHTML('beforeend', '<span class="ob-post-tag" style="background-color: #E0EAF1; color: #3E6D8E; border-color: #3E6D8E; border-style: solid;"></span>');
        //Link to the tag
        tagLink.href = funcs.makeTagTagHref(tag);
        //Add the tag's text
        tagLink.querySelector('.ob-post-tag').textContent = tag;
        return tagLink;
    };

    funcs.getRequestInfoLinksFromMessage = (message) => { // eslint-disable-line arrow-body-style
        //Get all links in all .request-info for the message.
        return message.parentNode.querySelectorAll('#' + message.id + ' > .request-info > a');
    };

    funcs.getContentFromMessage = (message) => {
        //Get the first (assumed only) .content for the message, which is a direct child of the message.
        if (!message) {
            return null;
        }
        var child = message.firstChild;
        while (child) {
            if (child.classList && child.classList.contains('content')) {
                return child;
            }
            child = child.nextSibling;
        }
        return null;
    };

    funcs.getRequestInfoFromMessage = (message) => { // eslint-disable-line arrow-body-style
        //Get the first (assumed only) .request-info for the message
        return message.parentNode.querySelector('#' + message.id + ' > .request-info');
    };

    funcs.getFirstRequestInfoLinkFromMessage = (message) => { // eslint-disable-line arrow-body-style
        //Get the first (assumed only) .request-info <a> for the message
        return message.parentNode.querySelector('#' + message.id + ' > .request-info > a');
    };

    funcs.doesElementContainRequestTagAsText = (element) => {
        getActionTagInTextRegEx.lastIndex = 0;
        return getActionTagInTextRegEx.test(funcs.removeTagsLinksAndCodeFromElement(element.cloneNode(true)).innerHTML);
    };

    funcs.removeTagsLinksAndCodeFromElement = (element) => {
        //Remove any tags, links, and code from an element. Used to eliminate those from text searches.
        [].slice.call(element.querySelectorAll('.ob-post-tag, a, code')).forEach((el) => {
            el.remove();
        });
        return element;
    };

    funcs.getFirstLinkToPostId = (element, questionId) => {
        //Find the first link which has an href which points to a specified post.
        //Avoid more convenient Array methods w/o good support
        const links = [].slice.call(element.querySelectorAll('a'));
        let foundLink = null;
        links.some((link) => {
            if (funcs.getPostIdFromURL(link.href) == questionId) { // eslint-disable-line eqeqeq
                //Found a match, indicate that and remember the link.
                foundLink = link;
                return true;
            }
            return false;
        });
        return foundLink;
    };

    /* eslint-disable arrow-body-style */
    funcs.getFirst20kTagInElement = (element) => {
        //Find the first actual 20k+ tag in the element.
        return funcs.getFirstMatchingOrNonMatchingTagInElement(tagsInTextContentRegExes.tag20k, element, true);
    };

    funcs.getFirstN0kTagInElement = (element) => {
        //Find the first N0k+ tag in the element.
        return funcs.getFirstMatchingOrNonMatchingTagInElement(tagsInTextContentRegExes.tagN0k, element, true);
    };

    funcs.getFirstReopenRequestTagInElement = (element) => {
        //Find the first reopen tag in the element.
        return funcs.getFirstMatchingOrNonMatchingTagInElement(tagsInTextContentRegExes.reopen, element, true);
    };

    funcs.getFirstDeleteRequestTagInElement = (element) => {
        //Find the first delete tag in the element.
        return funcs.getFirstMatchingOrNonMatchingTagInElement(tagsInTextContentRegExes.delete, element, true);
    };

    funcs.getFirstUndeleteRequestTagInElement = (element) => {
        //Find the first undelete tag in the element.
        return funcs.getFirstMatchingOrNonMatchingTagInElement(tagsInTextContentRegExes.undelete, element, true);
    };

    funcs.getFirstNonRequestTagInElement = (element) => {
        //Get the first tag tag in the content that does NOT match the action tag RegExp.
        return funcs.getFirstRequestOrNonRequestTagInElement(element, false);
    };

    funcs.getFirstRequestTagInElement = (element) => {
        //Get the first tag tag in the content that does match the action tag RegExp.
        return funcs.getFirstRequestOrNonRequestTagInElement(element, true);
    };

    funcs.getFirstRequestOrNonRequestTagInElement = (element, isActionable) => {
        //Find the first request or non-request tag in the element.
        return funcs.getFirstMatchingOrNonMatchingTagInElement(tagsInTextContentRegExes.request, element, isActionable);
    };
    /* eslint-enable arrow-body-style */

    funcs.getFirstMatchingOrNonMatchingTagInElement = (regEx, element, isMatch) => {
        //Find the first tag in the element that matches the provided RegEx. Avoid more convenient Array methods w/o good support
        let foundTag = null;
        [].slice.call(element.querySelectorAll('.ob-post-tag')).some((tagSpan) => {
            //Look through all tags (by class) for action tags
            regEx.lastIndex = 0; //Clear the RegEx
            const isTagARequest = regEx.test(tagSpan.textContent);
            if ((isMatch && isTagARequest) || (!isMatch && !isTagARequest)) {
                //Found an appropriate tag. Remember it and stop looking.
                foundTag = tagSpan;
                return true;
            }
            return false;
        });
        return foundTag ? foundTag.parentNode : null;
    };

    /* eslint-disable arrow-body-style */
    funcs.getAllQuestionOnlyRequestTagsInElement = (element) => {
        //Find all the tags in the element which are request tags that indicate only questions should be considered.
        return funcs.getAllMatchingOrNonMatchingTagsInElement([tagsInTextContentRegExes.close, tagsInTextContentRegExes.reopen], element, true);
    };

    funcs.getAll20kTagsInElement = (element) => {
        //Return all the tags which indicate that 20k reputation is required for this request.
        return funcs.getAllMatchingOrNonMatchingTagsInElement(tagsInTextContentRegExes.tag20k, element, true);
    };

    funcs.getAllN0kTagsInElement = (element) => {
        //Return all the tags which indicate that N0k reputation is required for this request.
        return funcs.getAllMatchingOrNonMatchingTagsInElement(tagsInTextContentRegExes.tagN0k, element, true);
    };

    funcs.getAllDeleteRequestTagsInElement = (element) => {
        //Return all the tags indicating a delete request.
        return funcs.getAllMatchingOrNonMatchingTagsInElement(tagsInTextContentRegExes.delete, element, true);
    };

    funcs.getAllNonRequestTagsInElement = (element) => {
        //Return all the tags which are not request tags.
        return funcs.getAllRequestOrNonRequestTagsInElement(element, false);
    };

    funcs.getAllRequestTagsInElement = (element) => {
        //Return all the tags which are request tags.
        return funcs.getAllRequestOrNonRequestTagsInElement(element, true);
    };

    funcs.getAllRequestOrNonRequestTagsInElement = (element, isActionable) => {
        //Return all the tags which are either request tags or return all those which are not request tags.
        return funcs.getAllMatchingOrNonMatchingTagsInElement(tagsInTextContentRegExes.request, element, isActionable);
    };

    funcs.getAllRequestOr20kTagsInElement = (element) => {
        //Return all the tags which are request tags or which indicate that the request requires 20k+ reputation.
        return funcs.getAllMatchingOrNonMatchingTagsInElement([tagsInTextContentRegExes.request, tagsInTextContentRegExes.tag20k], element, true);
    };

    funcs.getAllNonRequestAndNon20kTagsInElement = (element) => {
        //Return all the tags which are not request tags and do not indicate that the request requires 20k+ reputation.
        return funcs.getAllMatchingOrNonMatchingTagsInElement([tagsInTextContentRegExes.request, tagsInTextContentRegExes.tag20k], element, false);
    };

    funcs.getAllRequestOrN0kTagsInElement = (element) => {
        //Return all the tags which are request tags or which indicate that the request requires N0k+ reputation.
        return funcs.getAllMatchingOrNonMatchingTagsInElement([tagsInTextContentRegExes.request, tagsInTextContentRegExes.tagN0k], element, true);
    };

    funcs.getAllNonRequestAndNonN0kTagsInElement = (element) => {
        //Return all the tags which are not request tags and do not indicate that the request requires N0k+ reputation.
        return funcs.getAllMatchingOrNonMatchingTagsInElement([tagsInTextContentRegExes.request, tagsInTextContentRegExes.tagN0k], element, false);
    };
    /* eslint-enable arrow-body-style */

    funcs.getAllMatchingOrNonMatchingTagsInElement = (regExArray, element, isMatch) => {
        //Find all tags in the element that match the provided RegEx. Avoid more convenient Array methods w/o good support
        if (!Array.isArray(regExArray)) {
            regExArray = [regExArray];
        }
        return [].slice.call(element.querySelectorAll('.ob-post-tag')).filter((tagSpan) => {
            //Look through all tags (by class) for tags matching the regEx(es)
            const matchesRegEx = regExArray.some((regEx) => {
                regEx.lastIndex = 0; //Clear the RegEx
                return regEx.test(tagSpan.textContent);
            });
            if ((isMatch && matchesRegEx) || (!isMatch && !matchesRegEx)) {
                return true;
            }
            return false;
        }).map((tagSpan) => tagSpan.parentNode);
    };

    //Find the message element any element which it contains.
    funcs.getContainingMonologue = (element) => funcs.getContainingElementWithClass(element, 'monologue');

    //Find the message element from any element which it contains.
    funcs.getContainingMessage = (element) => funcs.getContainingElementWithClass(element, 'message');

    funcs.getContainingElementWithClass = (element, containedClass) => {
        //Find the nearest ancestor, including the current element which contains the specified class
        if (!element) {
            //We should never get here with an invalid input element.
            return null;
        }
        do {
            if (element && element.classList && element.classList.contains(containedClass)) {
                return element;
            }
            element = element.parentNode;
        } while (element);
        return null;
    };

    funcs.addEarliestAndLatestTimestampDatasetToAllMonologues = () => {
        //Add the earliest and latest at which a monologue could have been posted. This compensates
        //  for the fact that, on chat pages, not all monologues receive a timestamp.
        //The following relies on the monologues already being in earliest first date/time order. This will be the case
        //  on chat rooms and transcript pages, but not search pages.
        const dateSortDatasetProp = sortingButtons.buttons.date.datasetProp;
        function addEarliestOrLatest(monologueList, datasetProp) {
            monologueList.forEach((monologue) => {
                const currentTimestamp = monologue.dataset[dateSortDatasetProp];
                if (currentTimestamp) {
                    monologue.dataset[datasetProp] = currentTimestamp;
                }
            });
        }
        addEarliestOrLatest([].slice.call(document.querySelectorAll('.monologue')), 'timestampEarliest');
        addEarliestOrLatest([].slice.call(document.querySelectorAll('.monologue')).reverse(), 'timestampLatest');
    };

    funcs.addTimestampDatasetToAllMonologues = () => {
        //Compute the time the monologue was posted from the timestamp text and add it to the monologues dataset
        //  There are no dates in the messages, only some relative time information.
        const dateSortDatasetProp = sortingButtons.buttons.date.datasetProp;
        [].slice.call(document.querySelectorAll('.monologue')).forEach((monologue) => {
            const timestamp = funcs.getMonologueTimestampAsTimeAndAddIsoTooltip(monologue);
            if (!monologue.dataset[dateSortDatasetProp] && !monologue.dataset.timestampEarliest) {
                //Don't get the timestamp a second time.
                if (timestamp) {
                    monologue.dataset[dateSortDatasetProp] = timestamp;
                }
            }
        });
    };

    funcs.getTranscriptDate = () => {
        //Get the date for the transcript
        const bodyDate = document.body.dataset.urrsTranscriptDate;
        if (bodyDate) {
            return new Date(bodyDate);
        }
        const infoDiv = document.getElementById('info');
        const weekdaySpan = infoDiv.querySelector('.icon .calendar .weekday');
        const weekdayParsed = /(\w{3})\s*(?:'(\d{2}))?/.exec(weekdaySpan.textContent);
        const monthText = weekdayParsed[1].toLowerCase();
        const monthIndex = months3charLowerCase.indexOf(monthText);
        const year = weekdayParsed[2] ? +weekdayParsed[2] + 2000 : (new Date()).getUTCFullYear();
        const dayNumber = +weekdaySpan.nextSibling.textContent;
        const mainDiv = document.getElementById('main');
        const pageNumberSpan = mainDiv.querySelector('.page-numbers.current');
        const pageNumberParsed = pageNumberSpan ? /(\d{2})\s*:\s*(\d{2})\s*-/.exec(pageNumberSpan.textContent) : [0, 0, 0];
        const hour = +pageNumberParsed[1];
        const minute = +pageNumberParsed[2];
        //Days are UTC days
        const transcriptDate = new Date(Date.UTC(year, monthIndex, dayNumber, hour, minute));
        //Store the date for the page, so we don't have to parse it more than once.
        document.body.dataset.urrsTranscriptDate = transcriptDate.toJSON();
        return transcriptDate;
    };

    funcs.getMonologueTimestampAsTimeAndAddIsoTooltip = (monologue) => {
        //Convert the text provided by the chat system into an actual timestamp for the monologue, if the monologue has
        //  a timestamp.
        //In chat:
        //    Timestamps are in local time.
        //    Timestamps are in 24h time.
        //In searches and transcripts:
        //    Timestamps are in UTC.
        //    Timestamps are in 12h (am/pm) time.
        //In transcripts:
        //    Timestamps are relative to the UTC day displayed.
        //In searches:
        //    Timestamps are relative to the current day.
        const timestampDiv = monologue.querySelector('.timestamp');
        if (!timestampDiv) {
            //There is no timestamp on this message.
            return null;
        }
        const timeText = timestampDiv.textContent.trim();
        if (!timeText) {
            return null;
        }
        const splitText = /(?:([a-z]+)\s+)?(?:(\d+)\s+)?(?:'(\d+)\s+)?(\d+):(\d+)(?:\s+([ap]m))?/i.exec(timeText);
        if (splitText === null) {
            //Something is wrong with the RegExp
            return null;
        }
        const relativeOrMonth = typeof splitText[1] === 'string' ? splitText[1].toLowerCase() : '';
        const day = splitText[2];
        const yearTwoChar = splitText[3];
        const hour12 = (() => {
            if (isChat) {
                return +splitText[4];
            } // else
            //hour12 is only used to calculate hour24. The AM/PM-ness is handled below
            return (splitText[4] === '12' ? 0 : +splitText[4]);
        })();
        const minute = splitText[5];
        const amPm = typeof splitText[6] === 'string' ? splitText[6].toLowerCase() : '';
        const hour24 = hour12 + (amPm === 'pm' ? 12 : 0);

        //Because the date/time can be given as a relative date time, start with the current date and set the values provided.
        const date = isTranscript ? funcs.getTranscriptDate() : new Date();
        const todayDayEitherUTCOrLocal = isChat ? date.getDay() : date.getUTCDay();
        const msPerDay = 24 * 60 * 60 * 1000;
        //Methods to use to set/get time. This is used to switch between using UTC or local time depending on if it is
        // the chat page, or not.
        const setDate = isChat ? 'setDate' : 'setUTCDate';
        const setMonth = isChat ? 'setMonth' : 'setUTCMonth';
        const setFullYear = isChat ? 'setFullYear' : 'setUTCFullYear';
        const setHours = isChat ? 'setHours' : 'setUTCHours';
        const setMinutes = isChat ? 'setMinutes' : 'setUTCMinutes';
        const setSeconds = isChat ? 'setSeconds' : 'setUTCSeconds';
        const setMilliseconds = isChat ? 'setMilliseconds' : 'setUTCMilliseconds';
        //The day must be set prior to the month, as some months may be shorter than the day in the current month.
        if (typeof day !== 'undefined') {
            date[setDate](day);
        }
        //Deal with the text which is either a relative day (e.g. yst, 'mon', 'tue', etc.), or a month (which may, or may not be relative to the current year).
        if (relativeOrMonth !== '') {
            if (relativeOrMonth === 'yst') {
                date.setTime(date.getTime() - msPerDay);
            } else {
                const weekdayIndex = weekdays3charLowerCase.indexOf(relativeOrMonth);
                if (weekdayIndex > -1) {
                    //It is a weekday relative to today.
                    var relativeDay = todayDayEitherUTCOrLocal - weekdayIndex;
                    relativeDay += relativeDay < 0 ? 7 : 0;
                    date.setTime(date.getTime() - (relativeDay * msPerDay));
                } else {
                    const monthIndex = months3charLowerCase.indexOf(relativeOrMonth);
                    if (monthIndex > -1) {
                        date[setMonth](monthIndex);
                    }
                }
            }
        }
        if (typeof yearTwoChar !== 'undefined') {
            date[setFullYear](2000 + (+yearTwoChar));
        }
        date[setHours](hour24);
        date[setMinutes](minute);
        date[setSeconds](0);
        date[setMilliseconds](0);
        timestampDiv.title = date.toISOString().replace(':00.000', '').replace('T', ' ') + '\r\n' + date.toString();
        return date.getTime();
    };

    funcs.sortMonologuesByTimestamp = (oldestFirst) => {
        //Sort the messages based the timestamp dataset on the monologue.
        //Get an array of monologues, which will be sorted, and then the sort applied to the DOM.
        const monologues = [].slice.call(document.querySelectorAll('.monologue'));
        const dateSortDatasetProp = sortingButtons.buttons.date.datasetProp;
        //Sort into original order:
        if (oldestFirst) {
            //Oldest first. This can be useful to emphasize action on older requests.
            monologues.sort((a, b) => a.dataset[dateSortDatasetProp] - b.dataset[dateSortDatasetProp]);
        } else {
            //Newest first as default display. This matches the normal display of search results.
            monologues.sort((a, b) => b.dataset[dateSortDatasetProp] - a.dataset[dateSortDatasetProp]);
        }
        //Re-order the monologues in the DOM in the order into which they were sorted.
        const content = document.querySelector('#content');
        const putBefore = document.querySelectorAll('#content>br.clear-both')[1];
        if (putBefore) {
            monologues.forEach((monologue) => {
                content.insertBefore(monologue, putBefore);
            });
        }
    };

    funcs.addNotificationToContainer = (text, tooltip) => {
        //Add a notification to the top of the page.
        funcs.removeNotificationOnContainer();
        const width = document.body.getBoundingClientRect().width;
        //The margin-left + padding-left of the #container.
        //  We could dynamically determine this, but it's unlikely to change & over-compensated for below with excess width.
        const container = document.getElementById('container');
        const marginLeft = -5 - container.getBoundingClientRect().x;
        document.getElementById('container').insertAdjacentHTML('afterbegin', `
            <div id="urrs-containerNotification" style="width:${width}px;margin-left:${marginLeft}px;background-color:orange;height:100px;z-index:10000;" title="${tooltip}">
                <div style="margin-top:34px;width:80%;height:80%;font-size:150%;color:black;padding-top: 35px;text-align: center;margin-left: auto;margin-right: auto;">${text}</div>
            </div>`);
    };

    funcs.removeNotificationOnContainer = () => {
        //Remove the notification from the top of the page.
        const notificationDiv = document.getElementById('urrs-containerNotification');
        if (notificationDiv) {
            notificationDiv.remove();
        }
    };


    //Manipulate Message content

    funcs.removeTagLinks = (element) => {
        //Remove the links from within all tags contained in the element.
        [].slice.call(element.querySelectorAll('.ob-post-tag')).forEach((tag) => {
            if (tag.parentNode.nodeName === 'A') {
                tag.parentNode.remove();
            }
        });
        return element;
    };

    //Determine if the content of the provided message contains any links which are not tags.
    funcs.doesMessageContentContainNonTagLinks = (message) => funcs.doesElementContainNonTagLinks(funcs.getContentFromMessage(message));

    funcs.doesElementContainNonTagLinks = (element) => {
        //Determine if the provided element contains any links which are not part of the HTML for a tag.
        if (!element) {
            return false;
        } //else
        const stripped = funcs.removeTagLinks(element.cloneNode(true));
        if (stripped.querySelector('a')) {
            return true;
        } // else
        return false;
    };

    funcs.adjustAllBareUrlPostinksToHaveQuestionTitle = () => {
        //Change the displayed link text in all messages for links going to questions to the title of the question.
        if (!config.nonUi.useQuestionTitleAsLink) {
            return;
        }
        funcs.doForAllMessages(funcs.adjustMessageBareUrlPostLinksToHaveQuestionTitle);
    };

    funcs.adjustMessageBareUrlPostLinksToHaveQuestionTitle = (message) => {
        //When the original link text for a question-link in a message is just the URL, change it to the title of the question.
        if (!message.querySelector('.request-info')) {
            //Can't do anything without request-info
            return;
        }
        //Loop through all <a> in the content of the supplied message.
        let numberMatchingWithLink = 0;
        const unchangedMatchingLinks = [];
        let isFirstMatching = true;
        [].slice.call(funcs.getContentFromMessage(message).querySelectorAll('a')).forEach((link) => {
            const messageHrefPostId = funcs.getPostIdFromURL(link.href);
            if (!messageHrefPostId) {
                //No message ID found. Don't do anything with this link.
                return;
            } //else
            let isUrrsRequestedReplacement = false;
            if (link.dataset.urrsReplacement) {
                isUrrsRequestedReplacement = true;
            }
            //Make sure the <a> only contains a single text node
            if (link.childNodes.length === 1 && link.firstChild.nodeName === '#text') {
                let appendToContent = false;
                if (/^\s*[cd]?(?:\d+|[a-z])\s*$/i.test(link.textContent)) {
                    appendToContent = true;
                    if (isFirstMatching) {
                        link.classList.add('urrs-first-link-matching-pattern');
                        isFirstMatching = false;
                    }
                }
                if (appendToContent || /^\s*(?:math\.stackexchange.com\/(?:q(?:uestions)?|a(?:answers)?|p(?:osts)?)(?:\/\d+(?:\/\d+)?)?(?:\/…)?|question|answer)\s*$/i.test(link.textContent)) {
                    let actualTitle = '';
                    let foundRequestLink;
                    if ([].slice.call(message.querySelectorAll('.request-info a')).some((requestLink) => {
                        if (messageHrefPostId === funcs.getPostIdFromURL(requestLink.href)) {
                            //This is a link to the same URL.
                            actualTitle = requestLink.dataset.questionTitle;
                            foundRequestLink = requestLink;
                            //Only replace if we actually have a title (e.g. not undefined from a deleted question).
                            return !!actualTitle;
                        } //else
                        return false;
                    })) {
                        //Found a valid matching title. Change the link. May contain HTML entities. Assume it is trusted.
                        //Use .innerHTML to parse any HTML entities.
                        //XXX This really should be done in a throw away textarea (security).
                        const isAnswer = foundRequestLink.dataset.answerId;
                        link.innerHTML = (appendToContent ? `<b>${link.innerHTML}:</b> ` : '') + (isAnswer ? 'Answer to: ' : '') + actualTitle;
                        if (!link.classList.contains('urrs-first-link-matching-pattern') && appendToContent) {
                            //This is not the first one changed in this message, and this is one we appended to.
                            link.insertAdjacentHTML('beforebegin', '<br/>');
                        }
                        if (!isUrrsRequestedReplacement) {
                            //Allow the title that was originally placed on the link to continue to exist.
                            if (appendToContent) {
                                link.title = 'The original text displayed for this link matched a pattern. The pattern has been made bold and the title of the question has been appended for your convenience.';
                            } else {
                                link.title = 'The original text displayed for this link was a bare partial URL. It has been changed to the title of the question for your convenience.';
                            }
                        }
                        numberMatchingWithLink++;
                    } else {
                        if (foundRequestLink && appendToContent) {
                            //There is a request-info for this, but no title, so likely that it's deleted.
                            unchangedMatchingLinks.push(link);
                            numberMatchingWithLink++;
                        }
                    }
                }
            }
        });
        if (numberMatchingWithLink > 1) {
            unchangedMatchingLinks.forEach((link) => {
                link.innerHTML = `<b>${link.innerHTML}:</b>`;
                if (!link.classList.contains('urrs-first-link-matching-pattern')) {
                    link.insertAdjacentHTML('beforebegin', '<br/>');
                }
            });
        }
    };

    const invalidRequestText = ': invalid-request';
    const invalidRequestTextRegExp = new RegExp(invalidRequestText + '.*$');
    funcs.removeInvalidRequestTextFromRequest = (requestInfo, tagSpan) => {
        if (requestInfo && tagSpan) {
            tagSpan.textContent = tagSpan.textContent.replace(invalidRequestTextRegExp, '');
            tagSpan.title = tagSpan.title.replace(invalidRequestTextRegExp, '');
            requestInfo.classList.remove('urrsRequestNoRequestTag');
        }
    };

    funcs.fixN0kTagsInDeleteRequests = () => {
        //Make all delete/undelete requests which have a >3k reputation requirement have a tag indicating that requirement.
        //  If 10k+ tags are added is a user configurable option.
        //  Also adjusts del-pls to indicate an invalid request.
        funcs.doForAllMessages((message) => {
            const requestInfo = funcs.getRequestInfoFromMessage(message);
            if (!requestInfo) {
                return;
            } //else
            const content = funcs.getContentFromMessage(message);
            const deleteRequest = funcs.getFirstDeleteRequestTagInElement(content);
            const undeleteRequest = funcs.getFirstUndeleteRequestTagInElement(content);
            const requestTag = deleteRequest || undeleteRequest;
            if (!requestTag) {
                return;
            } //else
            const tagSpan = requestTag.querySelector('.ob-post-tag');
            let is20k = false;
            let invalidReason = 'open Q';
            const requestInfoFirstLink = requestInfo.querySelector('a');
            const reqData = requestInfoFirstLink.dataset;
            const postScore = +reqData.score;
            if (deleteRequest) {
                if (reqData.postStatus === 'deleted') {
                    //Just remove any existing invalid request text for deleted posts
                    funcs.removeInvalidRequestTextFromRequest(requestInfo, tagSpan);
                    return;
                } //else
                if (reqData.postStatus === 'answer') {
                    if (postScore <= -1) {
                        is20k = true;
                    } else {
                        invalidReason = 'Answer: score > -1';
                    }
                }
                if (reqData.postStatus === 'closed' && +reqData.score <= -3) {
                    is20k = true;
                }
                if (is20k) {
                    invalidReason = '';
                }
            } else {
                //Undelete
                if (reqData.postStatus !== 'deleted') {
                    //Just remove any existing invalid request text for non-deleted posts
                    funcs.removeInvalidRequestTextFromRequest(requestInfo, tagSpan);
                    return;
                } //else
                //reqData.postStatus has no information for deleted questions
                const answerId = funcs.getFirstRegExListMatchInText(requestInfoFirstLink.href, getSOAnswerIdFfromURLRegExes);
                if (answerId) {
                    is20k = true;
                }
                invalidReason = '';
            }
            const nowSeconds = Date.now() / 1000;
            const secondsInDay = 3600 * 24;
            if (reqData.postStatus === 'closed') {
                const postClosedAgeInDays = (nowSeconds - reqData.closedDate) / secondsInDay;
                if (postClosedAgeInDays > 2) {
                    is20k = false;
                    invalidReason = '';
                } else if (!is20k) {
                    invalidReason = 'score: ' + postScore + ' > -3 (20k) || closed: ' + (Math.floor(postClosedAgeInDays * 10) / 10) + ' < 2 days (10k)';
                }
            }
            if (reqData.isLocked === 'true') {
                invalidReason = 'locked';
            }
            //If the user has selected to add N0K+ tags, then remove all current ones and add a new one.
            if (config.nonUi.add20kTag) {
                //Remove all existing 20k tags
                funcs.getAllN0kTagsInElement(content).forEach((tag) => {
                    const sib = tag.previousSibling;
                    if (sib.nodeName === '#text' && sib.textContent.trim() === '') {
                        //If we have added a N0k+ tag there is also a single space text node.
                        sib.remove();
                    }
                    tag.remove();
                });
                //Add a new n0k+ tag
                if (!invalidReason) {
                    if (is20k || config.nonUi.add10kTagToo) {
                        //Actually add the 20k+ tag, and/or 10k+, if the user has selected that option.
                        const nKValue = (is20k ? '2' : '1') + '0k+';
                        requestTag.parentNode.insertBefore(funcs.makeTagTagElementWithSpace(nKValue, true, 'This ' + nKValue + ' tag was not included in the original message posted by the user. It was added for your convenience to indicate that the post can only be delete-voted by users with more than 20k reputation.'), requestTag.nextSibling);
                        const newTag = funcs.getFirstN0kTagInElement(content);
                        const newTagSibling = newTag.nextSibling;
                        if (newTagSibling === null || newTagSibling.nodeName !== '#text') {
                            //Add a space between the tag and anything that is not text (e.g. another tag).
                            newTag.parentNode.insertBefore(document.createTextNode(' '), newTagSibling);
                        }
                    }
                }
            }
            //Mark invalid requests, and un-mark any requests previously marked as invalid, which are now valid.
            if (tagSpan) {
                funcs.removeInvalidRequestTextFromRequest(requestInfo, tagSpan);
                if (invalidReason) {
                    tagSpan.textContent += invalidRequestText;
                    tagSpan.title = tagSpan.title + invalidRequestText + ': ' + invalidReason;
                    if (funcs.getRequestInfoLinksFromMessage(message).length === 1) {
                        requestInfo.classList.add('urrsRequestNoRequestTag');
                    }
                }
            }
        });
    };

    funcs.addMissingQuestionTags = () => {
        //Add a tag tag for the question's primary tag to the messages that don't have one. Also correct an existing tag to be for the primary tag, if it's to something else.
        if (!config.nonUi.addMisingTagTags) {
            return;
        }
        funcs.doForAllMessages((message) => {
            const requestInfoLink = funcs.getFirstRequestInfoLinkFromMessage(message);
            if (!requestInfoLink || !requestInfoLink.dataset.postStatus || requestInfoLink.dataset.postStatus === 'deleted' || requestInfoLink.dataset.postStatus === 'answer') {
                //Can't do anything without request-info data, or with answers as they don't have valid tag data
                return;
            } //else
            const content = funcs.getContentFromMessage(message);
            if (!funcs.getFirstRequestTagInElement(content)) {
                //The message does not have an actionable tag
                return;
            } //else
            const tags = JSON.parse(requestInfoLink.dataset.questionTags);
            const currentTags = funcs.getAllNonRequestAndNonN0kTagsInElement(content);
            //See if any request tags are more likely to be question tags:
            var requestTags = funcs.getAllRequestOrN0kTagsInElement(content);
            requestTags = requestTags.filter((tag) => {
                if (tags.indexOf(tag.textContent) > -1) {
                    //This tag matches a current question tag.
                    currentTags.push(tag);
                    return false;
                }
                return true;
            });
            if (currentTags.length === 0) {
                //The message contains no tag tag
                const requestOrN0kTags = requestTags;
                const lastRequestOrN0kTag = requestOrN0kTags[requestOrN0kTags.length - 1];
                const newTagEl = funcs.makeTagTagElementWithSpace(tags[0]);
                //Inform the user that the message has been modified by adding the tag tag.
                //The tag with space is actually a document fragment, so we need to find the actual tag <a>, not the document fragment.
                const newTagLink = newTagEl.querySelector('a');
                newTagLink.title = 'This tag was not included in the original message posted by the user. It has been added for your convenience.';
                lastRequestOrN0kTag.parentNode.insertBefore(newTagEl, lastRequestOrN0kTag.nextSibling);
            } else {
                const primaryTag = tags[0];
                if (currentTags.every((currentTagEl) => primaryTag !== currentTagEl.textContent)) {
                    //None of the current tags contain the primary tag. Change the first, or only, tag to the primary tag.
                    //Get the <span> inside the tag's <a>.
                    const currentTagEl = currentTags[0];
                    const currentTagSpan = currentTagEl.querySelector('span');
                    const currentTagText = currentTagSpan.textContent;
                    currentTagSpan.textContent = primaryTag;
                    currentTagEl.title = 'This tag was changed from what was in the original request, ' + currentTagText + ', to match the question\'s current primary tag: ' + primaryTag;
                    currentTagEl.href = funcs.makeTagTagHref(primaryTag);
                }
            }
        });
    };

    //Allow the search terms to be "or"
    if (typeof funcs.orSearch !== 'object') {
        funcs.orSearch = {};
    }

    funcs.orSearch.getNumberSearchPageResults = (element) => {
        //Get the number of search results pages exist for the search.
        if (element) {
            const pageResults = element.querySelectorAll('.pager .page-numbers');
            const adjustment = element.querySelector('.pager .page-numbers.next') ? 2 : 1;
            if (pageResults && pageResults.length > 0) {
                return +pageResults[pageResults.length - adjustment].textContent;
            } //else
        }
        return 1;
    };

    funcs.orSearch.addWaitNotificationToTop = () => {
        //Add a notification to the top of the page that we are collecting information.
        funcs.addNotificationToContainer('Please wait: Collecting results', 'Depending on the search, this may take several seconds to longer than a minute, due to SE Chat search rate limiting.');
    };

    funcs.orSearch.removeWaitNotification = () => {
        //Remove the wait notification from the top of the page.
        funcs.removeNotificationOnContainer();
    };

    funcs.orSearch.addMessagesInSearchUrlToResults = (url, callback) => {
        //Create an iframe that contains the search url, then add all the messages to the main page.
        //  An iframe is used, as it permits any in-page scripts to run which might be needed to format
        //  the DOM. It really doesn't appear that in-page scripts are needed (i.e. we could just fetch the HTML),
        //  but it's working as-is and isn't that inefficient,
        //  given that there's an SE-enforced multi-second delay between fetching from the search URL.
        const frame = document.createElement('iframe');
        frame.src = url;
        frame.style.display = 'none';
        frame.style.width = '1000px';
        frame.style.height = '300px';
        //When the iframe is done loading, process it.
        frame.addEventListener('load', funcs.orSearch.frameToAddIsLoaded.bind(null, callback), true);
        document.body.appendChild(frame);
    };

    funcs.orSearch.frameToAddIsLoaded = (callback, event) => {
        //An iframe from which we are adding all messages to the main frame was loaded.
        const frame = event.target;
        const contentIdDiv = document.getElementById('content');
        const frameContentIdDiv = frame.contentDocument.getElementById('content');
        if (!frameContentIdDiv) {
            //This usually indicates that we've made a request too rapidly.
            const frameBody = frame.contentDocument.body;
            if (frameBody) {
                const frameBodyText = frameBody.textContent;
                if (frameBodyText && frameBodyText.length < 200) {
                    const frameBodyTextMatches = frameBodyText.match(/You can perform this action again in (\d+) seconds./);
                    if (Array.isArray(frameBodyTextMatches) && frameBodyTextMatches.length > 1) {
                        const necesarryDelayS = +frameBodyTextMatches[1];
                        console.log('SE Chat says we can\'t do a search for ', necesarryDelayS, ' seconds. Delaying that long and trying to search again for URL:', frame.src);
                        setTimeout(funcs.orSearch.addMessagesInSearchUrlToResults, 1000 * (necesarryDelayS + 1), frame.src, funcs.orSearch.stageTwoProcessing);
                    }
                }
            }
        }
        //Get the second <br class"clear-both">.
        const elToInsertBefore = contentIdDiv.querySelectorAll('br.clear-both')[1];
        if (frameContentIdDiv && elToInsertBefore) {
            //Check to see if the message already exists in the main frame. If so, discard it.
            [].slice.call(frameContentIdDiv.querySelectorAll('.message')).forEach((frameMessage) => {
                if (contentIdDiv.querySelector('#' + frameMessage.id)) {
                    //The message already exists in the top frame
                    frameMessage.remove();
                }
            });
            //Move the monologues from the iframe to the main frame.
            [].slice.call(frameContentIdDiv.querySelectorAll('.monologue')).reverse().forEach((frameMonologue) => {
                if (frameMonologue.querySelector('.message')) {
                    //There is at least one message left in the monologue. Move it to the top frame.
                    contentIdDiv.insertBefore(frameMonologue, elToInsertBefore);
                } else {
                    //Remove the monologue which has no messages, in case we do more processing.
                    frameMonologue.remove();
                }
            });
        }
        const contentFoundCountP = document.querySelector('#content > p');
        const frameContentFoundCountP = frame.contentDocument.querySelector('#content > p');
        const contentFoundCount = +(contentFoundCountP.textContent.match(/(\d+) messages? found/) || ['', '0'])[1];
        const frameContentFoundCount = frameContentFoundCountP ? +(frameContentFoundCountP.textContent.match(/(\d+) messages? found/) || ['', '0'])[1] : 0;
        const foundCount = contentFoundCount + frameContentFoundCount;
        contentFoundCountP.textContent = `<= ${foundCount} message${(foundCount === 1 ? '' : 's')} found`;
        contentFoundCountP.title = 'Some of the messages found may be duplicates, due to matching more than one OR criteria.';
        //Do what's next
        if (typeof callback === 'function') {
            callback(frame.src, funcs.orSearch.getNumberSearchPageResults(frameContentIdDiv));
        }
        //We are done with the iframe. Remove it.
        frame.remove();
    };

    //Create the HTML to use for the ellipse separator.
    funcs.orSearch.makeCurrentSearchPageDotsHtml = () => '<span class="page-numbers dots">…</span>';

    //Create the HTML to use for the page number.
    funcs.orSearch.makeCurrentSearchPageLinkHtml = (page) => '<span class="page-numbers current">' + page + '</span>';

    funcs.orSearch.getUrlForSearchPageNumber = (page) => {
        //Construct the URL for the page number provided based on the current URL
        const queryWoPage = window.location.search.trim().replace(/&page=(?:[^&#]+)/i, '').replace(/\?page=(?:[^&#]+)&/, '?').replace(/\?page=(?:[^&#]+)$/, '');
        const pageQueryText = (queryWoPage === '' ? '?' : '&') + 'page=' + page;
        var query;
        if (/[?&]room=(?:[^?&#]+)/i.test(window.location.href)) {
            //Put the page just after the room, which is where it "normally" is.
            query = queryWoPage.replace(/([?&]room=(?:[^?&#]+))/, '$1' + pageQueryText);
        } else {
            query = queryWoPage + pageQueryText;
        }
        return window.location.origin + '/search' + query + window.location.hash;
    };

    funcs.orSearch.makeSearchPageNextPrevLinkHtml = (page, nextPrev) => {
        //create the HTML for the "Next" or "Prev" page.
        const displayText = nextPrev === 'next' ? ' ' + nextPrev : nextPrev + ' ';
        return '<a href="' + funcs.orSearch.getUrlForSearchPageNumber(page) + '" title="go to page ' + page + '" rel="' + nextPrev + '"><span class="page-numbers ' + nextPrev + '">' + displayText + '</span></a>';
    };

    //Create the HTML for the link to a search page number.
    funcs.orSearch.makeSearchPageLinkHtml = (page) => '<a href="' + funcs.orSearch.getUrlForSearchPageNumber(page) + '" title="go to page ' + page + '"><span class="page-numbers">' + page + '</span></a>';

    funcs.orSearch.addSearchPageLinkOrCurrent = (newPager, page, currentPage) => {
        //Add the HTML for a search page link, or the current page to the newPager.
        let pageHtml = '';
        if (page === currentPage) {
            pageHtml = funcs.orSearch.makeCurrentSearchPageLinkHtml(page);
        } else {
            pageHtml = funcs.orSearch.makeSearchPageLinkHtml(page);
        }
        newPager.insertAdjacentHTML('beforeend', pageHtml);
    };

    funcs.orSearch.addSearchPageFromTo = (newPager, from, to, currentPage) => {
        //To the newPager, add the page links form page number "from" to page number "to", with the correct HTML for the current page.
        for (let page = from; page <= to; page++) {
            funcs.orSearch.addSearchPageLinkOrCurrent(newPager, page, currentPage);
        }
    };

    funcs.orSearch.addSearchPageLinks = (maxPages) => {
        //Add all the page number links to the bottom of the page.
        if (maxPages <= 1) {
            //There is no display of page numbers if the max is 1 page.
            return;
        }
        const currentPager = document.querySelector('div.pager');
        var currentPage = +funcs.getFirstRegExListMatchInText(window.location.search, /\bpage=(\w+)/i);
        currentPage = currentPage === 0 ? 1 : currentPage;
        if (currentPager) {
            currentPager.remove();
        }
        const elToInsertafter = document.querySelectorAll('#content br.clear-both')[1];
        elToInsertafter.insertAdjacentHTML('afterend', '<div class="pager clear-both"></div>');
        const newPager = document.querySelector('div.pager');
        //Add 'prev', if appropriate.
        if (currentPage !== 1) {
            newPager.insertAdjacentHTML('beforeend', funcs.orSearch.makeSearchPageNextPrevLinkHtml(currentPage - 1, 'prev'));
        }
        //The various ways it is displayed
        if (maxPages <= 7) {
            funcs.orSearch.addSearchPageFromTo(newPager, 1, maxPages, currentPage);
        } else {
            //Show a minimum 6 pages, including the first and last.
            //  It is 1 ... 5 pages ... last
            // if the 5 pages include the first or last, then no dots.
            let lowPage = currentPage - 2;
            let highPage = currentPage + 2;
            if (lowPage < 1) {
                highPage -= lowPage;
                highPage++;
                lowPage = 1;
            }
            if (highPage > maxPages) {
                lowPage -= (highPage - maxPages);
                highPage = maxPages;
            }
            if (lowPage > 1) {
                funcs.orSearch.addSearchPageLinkOrCurrent(newPager, 1, currentPage);
                newPager.insertAdjacentHTML('beforeend', funcs.orSearch.makeCurrentSearchPageDotsHtml());
            }
            funcs.orSearch.addSearchPageFromTo(newPager, lowPage, highPage, currentPage);
            if (highPage < maxPages) {
                newPager.insertAdjacentHTML('beforeend', funcs.orSearch.makeCurrentSearchPageDotsHtml());
                funcs.orSearch.addSearchPageLinkOrCurrent(newPager, maxPages, currentPage);
            }
        }
        //Add 'next', if appropriate.
        if (currentPage !== maxPages) {
            newPager.insertAdjacentHTML('beforeend', funcs.orSearch.makeSearchPageNextPrevLinkHtml(currentPage + 1, 'next'));
        }
    };

    funcs.orSearch.stageTwoProcessing = (url, pages) => {
        //All the monologues/messages have been moved from an iframe into the main frame. This may, or may not, be the last
        //  iframe loaded.
        orSearch.framesToProcess--;
        orSearch.maxPages = Math.max(pages, orSearch.maxPages);
        if (orSearch.framesToProcess <= 0) {
            //This was the last iframe which was to be processed.
            funcs.orSearch.addSearchPageLinks(orSearch.maxPages);
            //Get the times the monologues were posted, so they can be used in appendInfo.
            funcs.addTimestampDatasetToAllMonologues();
            //Sort the monologues into the order they would have been if all were normally in the page.
            funcs.sortMonologuesByTimestamp();
            //Process the page, as if it was that way originally.
            if (isSearchReviewUIActive) {
                funcs.addNotificationToContainer('Please wait: Processing messages', 'Getting information from the SE API about the posts linked in the messages below. This shouldn\'t take very long.');
            } else {
                funcs.orSearch.removeWaitNotification();
            }
            window.dispatchEvent(new CustomEvent('SOCVR-Archiver-Messages-Changed', {
                bubbles: true,
                cancelable: true,
            }));
            funcs.mp.processPageOnce();
        } else {
            //Process the next page in the list, now that the previous one is done.
            funcs.orSearch.processOrList();
        }
    };

    funcs.orSearch.processOrList = () => {
        if (!Array.isArray(orSearch.urlSearchOrs) || orSearch.urlSearchOrs.length === 0) {
            //Force the end of processing
            orSearch.framesToProcess = 0;
            funcs.orSearch.stageTwoProcessing('', 0);
        }
        const queryWoSearch = window.location.search.replace(/[?&]q=(?:[^&#]+)/i, '').replace(/^\?/, '');
        const term = orSearch.urlSearchOrs.pop();
        const newUrl = window.location.origin + window.location.pathname + '?q=' + term + queryWoSearch;
        //Fetch the results from a page.
        //Use a timeout to make SE happy. SE requires a minimal delay between opening search pages, thus we have to stagger
        //  our loading of iframes with search results.
        //  Call stageTwoProcessing after each page is fetched.
        setTimeout(funcs.orSearch.addMessagesInSearchUrlToResults, 2000, newUrl, funcs.orSearch.stageTwoProcessing);
    };

    funcs.orSearch.stageOneProcessing = () => {
        //Begin processing
        if (urlSearchOrs.length > 1) {
            //If the search terms had "OR"s in it, then we need to load pages for the other terms.
            funcs.orSearch.addWaitNotificationToTop();
            orSearch.framesToProcess = urlSearchOrs.length;
            orSearch.maxPages = funcs.orSearch.getNumberSearchPageResults(document);
            orSearch.urlSearchOrs = urlSearchOrs;
            funcs.orSearch.processOrList();
        } else {
            //This is not a search using 'OR', no need to get additional results. Just start processing.
            //Get the times the monologues were posted, so they can be used in appendInfo.
            funcs.addTimestampDatasetToAllMonologues();
            funcs.mp.processPageOnce();
        }
    };

    //Original functionality

    funcs.addRequestStylesToDOM = () => {
        //Add the styles used to the DOM.
        let showCompleted = false;
        if ((isChat && config.nonUi.completedShowOnChat) ||
                (isSearch && config.nonUi.completedShowOnSearch) ||
                (isTranscript && config.nonUi.completedShowOnTranscript) ||
                (isUserPage && config.nonUi.completedShowOnUser)
        ) {
            showCompleted = true;
        }
        funcs.addStylesToDOM('urrsRequestStyles', [
            '.request-info {',
            '    display: inline-block;',
            '    position: absolute;',
            '    top: -6px;',
            '    left: 100%;',
            '    white-space: nowrap;',
            '    padding: 6px 10px;',
            '    width: auto;',
            '    border-left: 5px solid #ff7b18;',
            '    z-index: 2;',
            '}',
            '.request-info-messages {',
            '    -moz-border-radius: 6px;',
            '    -webkit-border-radius: 6px;',
            '    border-radius: 6px;',
            '    float: left;',
            '    word-wrap: break-word;',
            '    color: #222;',
            '    background-color: #f6f6f6;',
            '}',
            '.mine .request-info-messages {',
            '    background-color: #fbf2d9;',
            '}',
            '#chat .request-info,',
            '#transcript-body .request-info {',
            '    top: 0px;',
            '    padding: 0px 4px;',
            '    margin-left: 0px;',
            '    z-index: 2;',
            '}',
            //  That it is highlighted could be detected by class or being present on the message
            '#chat .request-completed:not(:hover) {',
            '    opacity: .4;',
            '}',
            '#chat .request-completed .reply-parent,',
            '#chat .request-completed .reply-child,',
            '#chat .request-completed.reply-parent:not(:hover),',
            '#chat .request-completed.reply-child:not(:hover) {',
            '    opacity: 1;',
            '}',
            '#chat .message .request-info+.flash .stars.always {',
            '    margin-left: -35px;',
            '}',
            '.request-info > a {',
            '    display: block;',
            '}',
            //XXX The following 3 styles are left over from prior to moving the chat left. Need to see if they are still desired.
            '.request-info > a[data-post-status="closed"] {',
            '    margin-left: -2px;',
            '}',
            '.request-info > a[data-post-status="deleted"] {',
            '    margin-left: -2px;',
            '}',
            '.request-info > a[data-post-status="answer"] {',
            '    margin-left: -2px;',
            '}',
            // Add a pixel of space for request info that is "cld" or "closed" due to the "c" being too close to the "l".
            '.request-info > a[data-post-status="closed"]::first-letter {',
            '    margin-right: 1px;',
            '}',
            '.request-info.urrsRequestNoRequestTag {',
            '    border-left: 5px solid #f6f6f6;',
            '}',
            '.mine .messages .request-info.urrsRequestNoRequestTag {',
            '    border-left: 5px solid #fbf2d9;',
            '}',
            '#transcript-body #container {', //Adjust the transcript page so there's room for request-info.
            '    padding: 10px 45px 10px 10px;',
            '}',
            '#container #header {',
            '    min-width: 1050px;',
            '}',
            '.urrs-messageNotInThisRoom {',
            '    background-color: #ec6;',
            '}',
            ((showCompleted && config.nonUi.chatCompleteRequestsFade) ? [
                //Complete requests transition for low opacity and shrunk.
                '.message.urrsRequestComplete:not(.urrsRequestComplete-temp-disable) {',
                '    transition: transform cubic-bezier(.165, .84, .44, 1) .15s, opacity cubic-bezier(.165, .84, .44, 1) .15s;',
                '}',
                //Have a delay in the translation when moving from fully visible to shrunk/fade.
                '.message.urrsRequestComplete:not(:hover):not(.reply-parent):not(.reply-child) {',
                '    transition-delay: 1s;',
                '}',
                //A delay in the translation when moving from shrunk/fade to fully visible.
                //  This allows mouse movement over the page without triggering the expansion and contraction of the message.
                '.message.urrsRequestComplete:hover:not(.reply-parent):not(.reply-child) {',
                '    transition-delay: .3s;',
                '}',
                //Complete requests low opacity to combo with scale
                '.message.urrsRequestComplete:not(:hover):not(.urrsRequestComplete-temp-disable):not(.reply-parent):not(.reply-child) {',
                '    opacity: .4;',
                '}',
                '.monologue.urrsRequestComplete:hover .timestamp.timestamp.timestamp:hover + .message.urrsRequestComplete {',
                '    opacity: 1;',
                '    transform: scale(1) translate(0%,0%);',
                '    transition-delay: 0s;',
                '}',
                //Complete requests scale
                '.message.urrsRequestComplete:not(:hover):not(.urrsRequestComplete-temp-disable):not(.reply-parent):not(.reply-child) {',
                '    transform: scale(0.85) translate(-8.25%,-8%);',
                '}',
                //Complete requests prevent a popup from adjusting
                '.message.urrsRequestComplete:not(:hover):not(.urrsRequestComplete-temp-disable):not(.reply-parent):not(.reply-child) .popup {',
                '    opacity: 1;',
                '    transform: scale(1) translate(0%,0%);',
                '}',
            ].join('\n') : ''),
            ((showCompleted && config.nonUi.chatCompleteRequestsHide) ? [
                //Complete requests Hide
                '.monologue.urrsRequestComplete:not([class*="SOCVR-Archiver-monologue-for-message"]):not(.mine),',
                '.monologue:not(.mine) .message.urrsRequestComplete:not([id^="SOCVR-Archiver-message"]) {',
                '    display: none;',
                '}',
            ].join('\n') : ''),
            (!config.nonUi.chatSearchButtonsShowCV ? [
                //Hide the cv-pls search button
                '#urrs-search-button-cv {',
                '    display: none;',
                '}',
            ].join('\n') : ''),
            (!config.nonUi.chatSearchButtonsShowDel ? [
                //Hide the del-pls search button
                '#urrs-search-button-del {',
                '    display: none;',
                '}',
            ].join('\n') : ''),
            (!config.nonUi.chatSearchButtonsShowReopen ? [
                //Hide the cv-pls search button
                '#urrs-search-button-reopen {',
                '    display: none;',
                '}',
            ].join('\n') : ''),
            (!config.nonUi.chatSearchButtonsShowUndel ? [
                //Hide the cv-pls search button
                '#urrs-search-button-undel {',
                '    display: none;',
                '}',
            ].join('\n') : ''),
            ((!config.nonUi.chatSearchButtonsShowCV && !config.nonUi.chatSearchButtonsShowDel && !config.nonUi.chatSearchButtonsShowReopen && !config.nonUi.chatSearchButtonsShowUndel) ? [
                //Hide the cv-pls search button
                '.urrs-chat-input-search-span {',
                '    display: none;',
                '}',
            ].join('\n') : ''),
            //The CSS to use for visited links.
            (config.nonUi.visitedLinkStyleActive ? [
                //Transcript
                'body#transcript-body #transcript .message a:visited:not(.button):not(.mobile-on),',
                'body#transcript-body #sidebar a:visited:not(.button):not(.mobile-on),',
                (config.nonUi.visitedLinksShowUsers ? 'body#transcript-body #transcript a:visited:not(.button):not(.mobile-on),' : ''),
                //Search page
                'body.outside .messages a:visited:not(.button):not(.mobile-on),',
                'body.outside .searchroom a:visited:not(.button):not(.mobile-on),',
                'body.outside #footer a:visited:not(.button):not(.mobile-on),',
                (config.nonUi.visitedLinksShowUsers ? 'body.outside .signature a:visited:not(.button):not(.mobile-on),' : ''),
                //Chat page
                (config.nonUi.visitedLinksShowInSidebar ? 'body#chat-body #sidebar a:visited:not(.button):not(#leave):not(#leave-all):not(#room-menu):not(#toggle-notify)' + (config.nonUi.visitedLinksShowInSidebarUser ? '' : ':not([href^="/users/"])') + ',' : ''),
                'body#chat-body #input-area a:visited:not(.button):not(#blame-id):not(.mobile-on),',
                //The Archiver's popup (newer and older (lowercase) versions)
                'body#chat-body #SOCVR-Archiver-messagesToMove-container a:visited:not(.button)' + (config.nonUi.visitedLinksShowUsers ? '' : ':not(.signature)') + ',',
                'body#chat-body #SOCVR-archiver-messagesToMove-container a:visited:not(.button)' + (config.nonUi.visitedLinksShowUsers ? '' : ':not(.signature)') + ',',
                //Main chat message area
                'body#chat-body #chat a:visited:not(.button)' + (config.nonUi.visitedLinksShowUsers ? '' : ':not(.signature)') + ' {',
                '    color: #0480DE;',
                '}',
            ].join('\n') : ''),
            //Normal has moderators colored blue. We are using that for visited links. So, show moderators another way.
            (config.nonUi.chatShowModeratorDiamond ? [
                '.username.moderator:not(h4)::before {',
                '    content: "♦\\00202f";', //This is a thin non-breaking space
                '    font-size: 120%;',
                '}',
                'h3 > .username.moderator:not(h4)::before {',
                '    content: "";', //This is a thin non-breaking space
                '    font-size: 100%;',
                '}',
            ].join('\n') : ''),
        ].join('\n'));
    };


    //Shared UI (options page)
    if (typeof funcs.ui !== 'object') {
        funcs.ui = {};
    }

    funcs.ui.addSharedStylesToDOM = () => {
        funcs.addStylesToDOM('urrsStylesForAllPages', [
            //Styles shared on both Chat and Search
            '#urrsOptionsButtonContainer {',
            '    float:none;',
            '    position: relative;',
            '}',
            '.urrsModalDialogOuter {',
            '    position: relative;',
            '    float:none;',
            '    z-index: 999999;',
            '}',
            '#urrsOptionsDialogInner {',
            '    width: 800px;',
            '    height: auto;',
            '}',
            '.urrsModalDialogInner {',
            '    position: absolute;',
            '    max-height: 800px;',
            '    background-color: white;',
            '    z-index: 2000;',
            '    border: 1px solid;',
            '    box-shadow: 0px 2px 5px;',
            '    box-shadow: 0px 0px 10px 5px;',
            '    background-color:white;',
            '    padding:15px;',
            '    opacity:0;',
            '    display:none;',
            '    transition:opacity .2s ease-in-out;',
            '    margin:0 auto;',
            '    resize:both;',
            '    pointer-events: none;',
            '    text-align:left;',
            '    float:none;',
            '}',
            '#urrsOptionsDialogBehind {',
            '    position: fixed;',
            '    height: 100%;',
            '    width: 100%;',
            '    background-color: black;',
            '    top: 0;',
            '    left: 0;',
            '    display: none;',
            '    opacity: 0.5;',
            '}',
            '#urrsModalOptionsExcludeTagCheckboxesContainer {',
            '    width: 250px;',
            '    height: 397px;',
            '    max-height: 100%;',
            '    overflow: auto;',
            '    margin-top: 5px;',
            '    border: 1px solid;',
            '}',
            '#urrsModalOptionsExcludeTagCheckboxesContainer .urrsTagCheckbox {',
            '    display: block;',
            '    margin-top: 3px;',
            '    margin-bottom: 4px;',
            '    margin-left: 15px;',
            '}',
            '#urrsModalOptionsExcludeTagCheckboxesContainer > span {',
            '    margin-left: 5px;',
            '}',
            '.urrsCheckboxesSelectedLabel:first-child {',
            '    margin-top: 3px;',
            '}',
            '.urrsCheckboxesSelectedLabel {',
            '    display: block;',
            '    margin-top: 15px;',
            '    margin-bottom: 0px;',
            '}',
            '.urrsTagCheckbox:hover .ob-post-tag-no-link .ob-post-tag {',
            '    border-width: 1px 0px 0px 1px;',
            '}',
            '.urrsModalOptionsOptionHeader {',
            '    font-weight: bold;',
            '    font-size: 130%;',
            '    margin-bottom: 3px;',
            '    margin-top: 10px;',
            '}',
            '.urrsModalOptionsOptionHeader > div {',
            '    font-size: 80%;',
            '    text-align: center;',
            '}',
            '.urrsModalOptionsOptionSubHeader {',
            '    font-weight: bold;',
            '}',
            '.urrsModalOptionsOptionGroup {',
            '    padding-left: 15px;',
            '}',
            '.urrsModalOptionsTitle {',
            '    font-size: 160%;',
            '    font-weight: bold;',
            '    text-align: center;',
            '    margin-top: -7px;',
            '}',
            '.urrsModalDialogInner label {',
            '    display: block;',
            '}',
            '.urrsModalDialogInner .urrsModalOptionsOptionGroup > label {',
            '    text-indent: -24px;',
            '    margin-left: 24px;',
            '    margin-bottom: 5px;',
            '}',
            '#urrsOptionsDialogInner td:not(:first-child) {',
            '    padding-left: 35px;',
            '}',
            '#urrsOptionsDialogInner #urrsModalOptionsExcludeTagsCell {',
            '    width: 30%;',
            '}',
            '.urrsOptionsRangeContainer {',
            '    vertical-align: middle;',
            '    margin-top: 3px;',
            '    margin-bottom: 5px;',
            '}',
            '.urrsOptionsRangeValueContainer {',
            '    display: inline;',
            '    vertical-align: top;',
            '}',
            '.urrsOptionsRangeValue {',
            '}',
            '#urrsOptionsDialogInner input[type="range"] {',
            '    width: 350px;',
            '}',
            '.urrsModalOptionsTagControlButton:not(:first-child) {',
            '    margin-left: 5px;',
            '}',
            '.urrsModalOptionsTagControlButton {',
            '    display: inline;',
            '    margin-left: 10px;',
            '}',
            '.urrsModalOptionsTagControlButtonContainer {',
            '    display: block;',
            '    margin-top: 9px;',
            '}',
            '.urrsOptionsMultiCheckboxLine {',
            '    display: block;',
            '    margin-bottom: 5px;',
            '}',
            '.urrsOptionsIndented {',
            '    margin-left: 30px;',
            '}',
            '.urrsBlur {',
            '    opacity: .4;',
            '}',
            '.urrsModalDialogInner .urrsOptionsCheckboxLabel-inline {',
            '    display: inline-block;',
            '}',
            'button {',
            '    cursor: pointer;',
            '}',
            //Duplicate the style for chat popup close buttons
            '.urrsOptionsButtonClose:hover {',
            '    background-color: #ff7b18;',
            '}',
            '.urrsOptionsButtonClose {',
            '    background-color: #ccc;',
            '    color: #fff;',
            '    cursor: pointer;',
            '    float: right;',
            '    font-size: 8px;',
            '    font-weight: bold;',
            '    padding: 2px 4px;',
            '    -moz-border-radius: 10px;',
            '    -webkit-border-radius: 10px;',
            '    border-radius: 10px;',
            '    line-height: 10px;',
            '    transform: translateY(-70%) translateX(70%);',
            '    -webkit-transform: translateY(-70%) translateX(70%);',
            '    -ms-transform: translateY(-70%) translateX(70%);',
            '}',
        ].join('\n'));
    };

    //Exclude tag UI, including editing the tag exclusion list.
    funcs.ui.ExcludeTag = function(_exclude) {
        //Basic Object for tracking if a tag should be hidden
        this.exclude = _exclude ? true : false; //Convert to Boolean
    };

    funcs.ui.addAllQuestionTagsToExcludeTagsList = () => {
        //Add any tags in the questions to the config.ui exclude tag list, with default as not excluded.
        if (!config.ui.excludeTagsList) {
            config.ui.excludeTagsList = {};
        }
        [].slice.call(document.querySelectorAll('.message')).forEach((message) => {
            funcs.getListFromDataset(message, 'tagList').forEach((tag) => {
                if (!config.ui.excludeTagsList.hasOwnProperty(tag)) {
                    //There is no record of the tag, so create one.
                    config.ui.excludeTagsList[tag] = new funcs.ui.ExcludeTag(false);
                }
            });
        });
    };

    funcs.ui.makeTagDialogTagCheckbox = (tagName, noLink) => {
        //Construct the label element used for a tag-tag in the exclude-tag selection list
        const container = document.createElement('label');
        container.className = 'urrsTagCheckbox';
        container.innerHTML = [
            '    <input type="checkbox" id="urrsTagCheckbox-' + tagName + '"/>',
        ].join('');
        const tagEl = funcs.makeTagTagElement(tagName, noLink);
        //Don't want the links to actually go anywhere.
        tagEl.href = '';
        container.appendChild(tagEl);
        return container;
    };

    funcs.ui.createOptionsDialog = () => {
        //Add the Options dialog to the DOM and all needed listeners
        const dialog = document.createElement('div');
        dialog.className = 'urrsModalDialogOuter';
        dialog.id = 'urrsOptionsDialog';
        dialog.innerHTML = [
            '<div id="urrsOptionsDialogBehind" class="urrsModalDialogBehind">',
            '</div>',
            '<div id="urrsOptionsDialogInner" class="urrsModalDialogInner">',
            '    <div class="urrsOptionsButtonClose">X</div>',
            '    <div class="urrsModalOptionsTitle">Unclosed Request Review Options</div>',
            '    <table>',
            '        <tbody>',
            '            <tr>',
            '                <td>',
            '                    <div class="urrsModalOptionsOptionGroupDescriptionContainer" id="urrsModalOptionsGeneralOptions">',
            '                        <div class="urrsModalOptionsOptionHeader" title=\'Many of these "General options" require you to reload the chat room page or search page on which you desire for them to take effect.\'>',
            '                            General options',
            '                        </div>',
            '                        <div class="urrsModalOptionsOptionGroup">',
            //Add/correct tag-tag and 20k+ tags.
            '                            <label title="You will need to reload the page to see messages in their original form. On the chat room page, new messages will obey this selection even without reloading the page.">',
            '                                <input type="checkbox" id="urrsOptionsCheckbox-addMisingTagTags"/>',
            '                                Requests: add, or correct, the tag indicating the question\'s primary tag.',
            '                            </label>',
            //Add 20k+ tags.
            '                            <label title="If acting on a request requires 20k+ reputation, then indicate that with a tag. On the chat room page, new messages will obey this selection even without reloading the page.">',
            '                                <input type="checkbox" id="urrsOptionsCheckbox-add20kTag"/>',
            '                                Requests: add/remove 20k+ tags for (un)delete requests.',
            '                            </label>',
            //Add 10k+ tags.
            '                            <label title="For delete/undelete requests, if it doesn\'t require 20k+ add a 10k+ tag (i.e. add a 10k+ tag when 10k+ is required). You will need to reload the page to see messages in their original form. On the chat room page, new messages will obey this selection even without reloading the page.">',
            '                                <input type="checkbox" id="urrsOptionsCheckbox-add10kTagToo"/>',
            '                                Requests: Also, add 10k+ tags for (un)delete requests.',
            '                            </label>',
            //Change bare URLs to question title.
            '                            <label title="When changing to disabled, You will need to reload the page to see messages in their original form. On the chat room page, new messages will obey this selection even without reloading the page.">',
            '                                <input type="checkbox" id="urrsOptionsCheckbox-useQuestionTitleAsLink"/>',
            '                                Change bare question URLs to the question\'s title.',
            '                            </label>',
            //Remember visited posts.
            '                            <label title=\'Remembers the question links you click in the chat room and request search pages, considering them "visited". You can select to not display "visited" questions. "Visited" questions are remembered for 7 days. They are stored only on your machine. When you disable this, it will immediately delete the list of "visited" questions. You may need to reload the appropriate pages to enable this.\'>',
            '                                <input type="checkbox" id="urrsOptionsCheckbox-trackVisitedLinks"/>',
            '                                Remember "visited" posts. Unchecking <em>immediately</em> deletes visited list.',
            '                            </label>',
            //Style for Completed requests.
            '                            <span class="urrsOptionsMultiCheckboxLine">',
            '                                <span title="Clearly indicate that requests are completed.">Completed requests:</span>',
            '                                <label title="Completed messages show normally." class="urrsOptionsCheckboxLabel-inline">',
            '                                    <input type="radio" name="urrsOptionsRadio-completedMessages" id="urrsOptionsCheckbox-chatCompleteRequestsDoNothing"/>',
            '                                    Normal',
            '                                </label>',
            //    Fade/shrink completed
            '                                <label title="Visually indicates when requests are complete. When hovered by the mouse, the messages show normally." class="urrsOptionsCheckboxLabel-inline">',
            '                                    <input type="radio" name="urrsOptionsRadio-completedMessages" id="urrsOptionsCheckbox-chatCompleteRequestsFade"/>',
            '                                    Fade/shrink (all)',
            '                                </label>',
            //    Hide completed
            '                                <label title="Hides complete requests. Makes the transcript look like it would if the ROs immediately moved every complete request (Well, OK, close to that). To prevent confusion, this is not applied to your own requests." class="urrsOptionsCheckboxLabel-inline">',
            '                                    <input type="radio" name="urrsOptionsRadio-completedMessages" id="urrsOptionsCheckbox-chatCompleteRequestsHide"/>',
            '                                    Hide (not yours)',
            '                                </label>',
            '                            </span>',
            //Where show "completed"
            '                            <span class="urrsOptionsMultiCheckboxLine urrsOptionsIndented">',
            '                                <span title="Choose on which pages the completed requests style will be applied.">Use completed style on:</span>',
            //Completed in Chat
            '                                <label title="Apply the &quot;completed&quot; style on Main Chat pages for the rooms in which this script runs." class="urrsOptionsCheckboxLabel-inline">',
            '                                    <input type="checkbox" id="urrsOptionsCheckbox-completedShowOnChat"/>',
            '                                    chat',
            '                                </label>',
            //Completed in Search
            '                                <label title="Apply the &quot;completed&quot; style on Search pages for the rooms in which this script runs." class="urrsOptionsCheckboxLabel-inline">',
            '                                    <input type="checkbox" id="urrsOptionsCheckbox-completedShowOnSearch"/>',
            '                                    search',
            '                                </label>',
            //Completed in Transcripts
            '                                <label title="Apply the &quot;completed&quot; style on transcript pages for the rooms in which this script runs." class="urrsOptionsCheckboxLabel-inline">',
            '                                    <input type="checkbox" id="urrsOptionsCheckbox-completedShowOnTranscript"/>',
            '                                    transcripts',
            '                                </label>',
            //Completed in User pages
            '                                <label title="Apply the &quot;completed&quot; style on user pages." class="urrsOptionsCheckboxLabel-inline">',
            '                                    <input type="checkbox" id="urrsOptionsCheckbox-completedShowOnUser"/>',
            '                                    user',
            '                                </label>',
            '                            </span>',
            //Select click for jump to Tag's filtered CVQ
            '                            <span class="urrsOptionsMultiCheckboxLine">',
            '                                <label  class="urrsOptionsCheckboxLabel-inline" title="When you use the click you select on a tag, the Close Vote Queue (CVQ) will be opened in a new tab with that tag filtered. Click on the &quot;click here&quot; tag with the combination of button with, or without, Alt/Ctrl/Meta/Shift-keys which you want to use to open the CVQ with the tag filtered.\nNote that your browser\'s default action *may* not be prevented for these clicks (browsers sometimes don\'t permit the default action to be prevented). So, you will want to select something where the side-effects, if any, are something you can live with.">',
            '                                    <input type="checkbox" id="urrsOptionsCheckbox-clickTagTagToOpenCVQ"/>',
            '                                    Tag click opens filtered CVQ. Set:&nbsp;',
            '                                </label>',
            (() => {
                const theTag = funcs.makeTagTagElement('click here', true, 'Click here with the type of click you want to use on tags to open the CVQ with that tag filtered.\nYou should be able to use (almost) any mouse button combined with Alt, Ctrl, Meta, and/or Shift. Exactly what combinations will work may be limited by the capabilities of your browser and/or operating system (e.g. Firefox no longer maps any key to Meta. Thus, no combination with Meta is possible in Firefox.).');
                const innerTag = theTag.firstChild;
                innerTag.classList.add('urrs-receiveAllClicks');
                innerTag.id = 'urrsOptions-setTagTagOpenCVQ';
                return theTag.outerHTML;
            })(),
            '                                is:',
            '                                <span id="urrsOptions-clickTagTagToOpenCVQ-clickInfo"/>',
            '                            </span>',
            '                        </div>',
            //SEARCH/review pages
            '                        <div class="urrsModalOptionsOptionHeader">',
            '                            Request review page (searches)',
            '                        </div>',
            '                        <div class="urrsModalOptionsOptionGroup">',
            //Multiple sort criteria
            '                            <label title="One sort criteria at a time is the user experience which most people are familiar with. If you permit multiple criteria, you can, for instance, sort by close request reason then by number of close-votes within each reason. Using multiple criteria takes more clicks on the criteria to select the criteria you want in the order you want. To deselect a criteria you have to click on it until it is in the inactive state.">',
            '                                <input type="checkbox" id="urrsOptionsCheckbox-allowMultipleSortCriteria"/>',
            '                                Permit multiple sort criteria at a time',
            '                            </label>',
            //Search: Show completed (deleted/closed, open for reopen, etc.)
            '                            <label title="Show all requests that have a link to a question or answer, even if their status indicates the request is complete. You must reload the page to have this option take effect. This causes closed and deleted questions to be shown all the time. This is different from the button in the UI which will navigate to a URL which will cause closed and deleted to be shown, but which does not change what is normally shown without the extra parameter(s) in the URL.">',
            '                                <input type="checkbox" id="urrsOptionsCheckbox-searchShowDeletedAndClosed"/>',
            '                                Show completed requests (deleted and closed questions)',
            '                            </label>',
            //Search: messages not in room
            '                            <span title="There\'s a bug in chat which results in messages which have been moved out of the room still being displayed in searches, and sometimes the transcript. These options allow you to either hide them, or have them marked in a different color, and a tooltip displayed when hovered. The bug also causes them not to show up in searches in the room into which they have been moved. Thus, if you hide them, the messages affected by the bug  will never appear in any searches.\nYou must reload the affected page in order for a change in this option to take effect.">Messages in another room:</span>',
            '                            <label title="Messages that are not in the room show normally." class="urrsOptionsCheckboxLabel-inline">',
            '                                <input type="radio" name="urrsOptionsRadio-messagesNotInRoom" id="urrsOptionsCheckbox-transcriptMessagesNotInRoomDoNothing"/>',
            '                                Normal',
            '                            </label>',
            //    Highlight messages not in room
            '                            <label title="Highlight messages which are not in the room you\'re searching or viewing the transcript for. A tooltip is also added." class="urrsOptionsCheckboxLabel-inline">',
            '                                <input type="radio" name="urrsOptionsRadio-messagesNotInRoom" id="urrsOptionsCheckbox-transcriptMessagesNotInRoomMark"/>',
            '                                Highlight & tooltip',
            '                            </label>',
            //    hide messages not in room
            '                            <label title="Hide messages which are not in the room you\'re searching or for which you\'re viewing the transcript. Such messages will not show up in any search." class="urrsOptionsCheckboxLabel-inline">',
            '                                <input type="radio" name="urrsOptionsRadio-messagesNotInRoom" id="urrsOptionsCheckbox-transcriptMessagesNotInRoomHide"/>',
            '                                Hide',
            '                            </label>',
            '                        </div>',
            '                        <div class="urrsModalOptionsOptionHeader">',
            //CHAT page
            '                            Chat page',
            '                        </div>',
            '                        <div class="urrsModalOptionsOptionGroup">',
            //Show post status in chat.
            '                            <label title="To the right of messages with post links, show:\nquestion: # close votes/closed/deleted\nanswer: score/deleted\nIf this was disabled when the chat room page was loaded, you will need to reload the page to have this take effect.">',
            '                                <input type="checkbox" id="urrsOptionsCheckbox-chatShowPostStatus"/>',
            '                                Show the post\'s current status (also affects transcripts)',
            '                            </label>',
            //Chat visited link style
            '                            <span class="urrsOptionsMultiCheckboxLine">',
            '                                <label title="Color visited links blue. If neither of the sub-options are selected, only the visited links within messages are blue. On the URRS review page, all visited links have been blue since 2015. These options are applied on the main chat pages, transcripts, and searches for this room (and associated rooms)." class="urrsOptionsCheckboxLabel-inline">',
            '                                    <input type="checkbox" id="urrsOptionsCheckbox-visitedLinkStyleActive"/>',
            '                                    Blue visited links:',
            '                                </label>',
            //Blue Visited Links: User profiles (left of messages)
            '                                <label title="Show blue visited links for the links to the left of chat messages which are to the author\'s chat-profile.\nFor many people this is confusing, as they are expecting a blue username to indicate that the user is a moderator. However, there\'s also another option to show a diamond next to moderators (see Chat section, as moderators are only indicated on the chat page)." class="urrsOptionsCheckboxLabel-inline">',
            '                                    <input type="checkbox" id="urrsOptionsCheckbox-visitedLinksShowUsers"/>',
            '                                    chat user',
            '                                </label>',
            //Blue Visited Links: Sidebar
            '                                <label title="Show blue visited links in the sidebar (including starboard)." class="urrsOptionsCheckboxLabel-inline">',
            '                                    <input type="checkbox" id="urrsOptionsCheckbox-visitedLinksShowInSidebar"/>',
            '                                    sidebar',
            '                                </label>',
            //Blue Visited Links: User in sidebar
            '                                <label title="Show blue visited links for users in the sidebar (i.e. the starboard). The information as to the user being a moderator doesn\'t exist in the link. The links to users in the starboard are not never colored blue in the stock chat functionality." class="urrsOptionsCheckboxLabel-inline">',
            '                                    <input type="checkbox" id="urrsOptionsCheckbox-visitedLinksShowInSidebarUser"/>',
            '                                    sidebar user',
            '                                </label>',
            '                            </span>',
            //Add moderator indicator
            '                            <label title="This is only done on the actual chat page, because the information isn\'t available in transcripts and searches. You will need to reload the chat room page for this to take effect.">',
            '                                <input type="checkbox" id="urrsOptionsCheckbox-chatShowModeratorDiamond"/>',
            '                                Show ♦ for moderators, when they are the author of a message.',
            '                            </label>',
            //CHAT: What search buttons to show.
            '                            <span class="urrsOptionsMultiCheckboxLine">',
            '                                <span title="Choose what search buttons are added to the chat controls.">Search buttons:</span>',
            //cv-pls
            '                                <label title="cv-pls requests" class="urrsOptionsCheckboxLabel-inline">',
            '                                    <input type="checkbox" id="urrsOptionsCheckbox-chatSearchButtonsShowCV"/>',
            '                                    cv-',
            '                                </label>',
            //del-pls
            '                                <label title="del-pls requests: searches for del-pls, delv-pls, and delete-pls" class="urrsOptionsCheckboxLabel-inline">',
            '                                    <input type="checkbox" id="urrsOptionsCheckbox-chatSearchButtonsShowDel"/>',
            '                                    del-',
            '                                </label>',
            //reopen-pls
            '                                <label title="reopen-pls requests" class="urrsOptionsCheckboxLabel-inline">',
            '                                    <input type="checkbox" id="urrsOptionsCheckbox-chatSearchButtonsShowReopen"/>',
            '                                    reopen-',
            '                                </label>',
            //undel-pls
            '                                <label title="undel-pls requests: searches for undel-pls, undelv-pls, and undelete-pls" class="urrsOptionsCheckboxLabel-inline">',
            '                                    <input type="checkbox" id="urrsOptionsCheckbox-chatSearchButtonsShowUndel"/>',
            '                                    undel-',
            '                                </label>',
            '                            </span>',
            //Optional "Update" button
            '                            <label title="Show the &quot;update&quot; button. Manual updates are largely superfluous, due to automatic updates being available (if not changed in options) at a rate that\'s close to as frequent as the SE API policy permits. This is particularly so given that the data is updated every time you switch back to the tab with the chat room in it (e.g. look at chat; open a tab with a question; look at the question; switch back to the tab &amp; the data is updated).">',
            '                                <input type="checkbox" id="urrsOptionsCheckbox-chatShowUpdateButton"/>',
            '                                Show the manual "update" button.',
            '                            </label>',
            //Update rates
            '                            <div class="urrsModalOptionsOptionSubHeader" title="There\'s a limit of 10,000 SE API requests from your IP address per day. This limit is shared between all scripts for which you have not gone through an OAuth2 authorization process. Keep this in mind if you are setting these numbers to update very rapidly. While this script on its own won\'t use up that many requests in a day, you could set these options so it used about 2,000 in a day, which could impact other high-API-use scripts you might have installed.">',
            '                                Post status update rates',
            '                            </div>',
            '                        <div class="urrsModalOptionsOptionGroup">',
            '                            <div>',
            //Delay between status updates
            '                                <div title="Status updates automatically any time a new message is posted with a link to a question/answer, unless the tab isn\'t visible or it\'s been less than this time from the last update.\nIf this time hasn\'t passed from the last update, the update is delayed until after this time and the tab is visible.\nThe default is 5 seconds.">',
            '                                    Auto-update status: minimum delay.',
            '                                    <div class="urrsOptionsRangeContainer">',
            '                                        <input type="range" min="5" max="300" id="urrsOptionsRange-chatMinimumUpdateDelay"/>',
            '                                        <span class="urrsOptionsRangeValueContainer">',
            '                                            <span id="urrsOptionsRangeValue-chatMinimumUpdateDelay" class="urrsOptionsRangeValue">5</span>',
            '                                            <span>&nbsp;second</span><span class="urrsOptionsPluralValue">s</span>',
            '                                        </span>',
            '                                    </div>',
            '                                </div>',
            //Status updates on a timer.
            '                                <div title="Regardless of the number specified, updates are done when A) a new chat messages is posted with a question link (see above for rate limit), B) you switch back to the tab, or C) you click &quot;update&quot;. This setting will guarantee an update, even with no new posts.\n0 is no time-based updates.\nThe default is ' + DEFAULT_AUTO_UPDATE_RATE + ' minutes.">',
            '                                    Update question status every:',
            '                                    <div class="urrsOptionsRangeContainer">',
            '                                        <input type="range" min="0" max="60"  id="urrsOptionsRange-chatAutoUpdateRate"/>',
            '                                        <span class="urrsOptionsRangeValueContainer">',
            '                                            <span id="urrsOptionsRangeValue-chatAutoUpdateRate" class="urrsOptionsRangeValue">10</span>',
            '                                            <span>&nbsp;minute</span><span class="urrsOptionsPluralValue">s</span>',
            '                                        </span>',
            '                                    </div>',
            '                                </div>',
            '                            </div>',
            '                        </div>',
            '                        </div>',
            '                    </div>',
            '                </td>',
            //Excluded/hidden tags list.
            '                <td id="urrsModalOptionsExcludeTagsCell">',
            '                    <div class="urrsModalOptionsOptionGroupDescriptionContainer" title="This list is not dynamically synchronized between tabs. Like all UI selections, if you want the changes you make in one tab to show up in another tab, you will need to reload the other tab(s) for changes to take effect in that tab. Only the state of the UI for the tab in which you made the most recent change are kept. This means you will loose any UI settings made in a tab if you then make changes in another tab.\r\n\r\nThe position of tags is not dynamically changed when you check/uncheck them, because doing so is annoying in a very long list. The separation of &quot;Will be hidden&quot;/&quot;Won\'t be hidden&quot; will be updated the next time the options dialog is opened.">',
            '                        <div class="urrsModalOptionsOptionHeader">',
            '                            Tags to hide',
            '                            <div>',
            '                                (search page; current filter preset)',
            '                            </div>',
            '                        </div>',
            '                        <div class="urrsModalOptionsOptionGroup">',
            '                            <div class="urrsModalOptionsTagsInfo">Select the tags you desire to be hidden when the "tags" criteria is not selected. A match is checked against all tags on the question, not just the primary tag displayed in the request.</div>',
            '                            <div class="urrsModalOptionsTagControlButtonContainer">',
            '                                <button class="urrsModalOptionsTagControlButton" title="Check all boxes">all</button>',
            '                                <button class="urrsModalOptionsTagControlButton" title="Uncheck all boxes">none</button>',
            '                                <button class="urrsModalOptionsTagControlButton" title="Invert the boxes that are checked">invert</button>',
            '                                <button class="urrsModalOptionsTagControlButton" title="Check all tags that are actually displayed in the visible messages. This is not all tags which are contained in the questions. It is only the tags which you can see on the page, which will generally be the primary tag for the question.">visible</button>',
            '                            </div>',
            '                            <div id="urrsModalOptionsExcludeTagCheckboxesContainer" title="">',
            '                            </div>',
            '                        </div>',
            '                    </div>',
            '                </td>',
            '            </tr>',
            '        </tbody>',
            '    </table>',
            '</div>',
        ].join('');
        //Get the current styles for the background-color and text color. Generally, accounts for people using other themes.
        dialog.style.backgroundColor = funcs.getMainBackgroundColor();
        dialog.style.color = funcs.getMainTextColor();
        //Add event handlers
        dialog.addEventListener('click', funcs.ui.handleOptionsClick, false);
        dialog.addEventListener('input', funcs.ui.handleOptionsClick, false);
        dialog.addEventListener('transitionend', funcs.ui.optionsTransitionend);
        dialog.querySelector('.urrsOptionsButtonClose').addEventListener('click', funcs.ui.hideOptions);
        [].slice.call(dialog.querySelectorAll('.urrs-receiveAllClicks')).forEach((el) => {
            el.addEventListener('urrs-allClicks', funcs.ui.optionDialogHandleCustomAllClicks, false);
        });
        funcs.ui.setGeneralOptionsDialogCheckboxesToConfig(dialog);
        return dialog;
    };

    funcs.ui.optionsSetOptionsEnabledDisabled = () => {
        //Some options should be disabled when others are not selected. Go through the options and disable/enable as configured.
        const enableRequired = {
            'urrsOptionsCheckbox-add20kTag': [
                'urrsOptionsCheckbox-add10kTagToo',
            ],
            'urrsOptionsCheckbox-visitedLinkStyleActive': [
                'urrsOptionsCheckbox-visitedLinksShowUsers',
                'urrsOptionsCheckbox-visitedLinksShowInSidebar',
            ],
            'urrsOptionsCheckbox-visitedLinksShowInSidebar': [
                'urrsOptionsCheckbox-visitedLinksShowInSidebarUser',
            ],
        };
        Object.keys(enableRequired).forEach((checkingKey) => {
            const checkingEl = document.getElementById(checkingKey);
            if (checkingEl) {
                const isChecked = checkingEl.checked;
                enableRequired[checkingKey].forEach((disableKey) => {
                    const disableEl = document.getElementById(disableKey);
                    if (disableEl) {
                        disableEl.disabled = !isChecked;
                    }
                });
            }
        });
    };

    funcs.ui.setGeneralOptionsDialogCheckboxesToConfig = (dialog) => {
        //Set the General options to match what is in the config.
        //This execution path needs to not store the nonUi config. It is called from the event handler for listening to changes
        //  of that value. If it stores the nonUi config, then it is possible for a cross-tab async loop to develop.
        if (!dialog) {
            //This is being called after the dialog exists on the page, so get the dialog element.
            dialog = document.getElementById('urrsOptionsDialog');
        }
        //Get the current config.
        funcs.config.restoreNonUi(config.nonUi);
        [].slice.call(dialog.querySelectorAll('#urrsModalOptionsGeneralOptions input[type="checkbox"], #urrsModalOptionsGeneralOptions input[type="radio"]')).forEach((input) => {
            const option = input.id.replace('urrsOptionsCheckbox-', '');
            input.checked = config.nonUi[option];
        });
        [].slice.call(dialog.querySelectorAll('#urrsModalOptionsGeneralOptions input[type="range"]')).forEach((input) => {
            const option = input.id.replace('urrsOptionsRange-', '');
            input.value = config.nonUi[option];
            const valueEl = input.parentNode.querySelector('#' + input.id.replace('-', 'Value-'));
            if (valueEl) {
                valueEl.textContent = input.value;
            }
            input.parentNode.querySelector('.urrsOptionsPluralValue').textContent = input.value == 1 ? '' : 's'; // eslint-disable-line eqeqeq
        });
        funcs.ui.optionsSetOptionsEnabledDisabled();
    };

    funcs.ui.replaceOptionsDialogExcludeTagsList = () => {
        //Delete and re-construct the exclude tag selection list
        const tagContainer = document.querySelector('#urrsModalOptionsExcludeTagCheckboxesContainer');
        //Delete the old list and begin constructing the new one.
        tagContainer.innerHTML = '<span class="urrsCheckboxesSelectedLabel"><b>Will be hidden:</b></span>';
        Object.keys(config.ui.excludeTagsList).sort((a, b) => {
            //Sort the selected items first
            const aExclude = config.ui.excludeTagsList[a].exclude;
            const bExclude = config.ui.excludeTagsList[b].exclude;
            if (aExclude && !bExclude) {
                return -1;
            } //else
            if (!aExclude && bExclude) {
                return 1;
            } //else
            //Then alpha-sort within selected/non-selected
            return a.localeCompare(b);
        }).forEach((tag) => {
            //Add the tag-tag checkbox and check/uncheck based on current config state.
            const tagEl = tagContainer.appendChild(funcs.ui.makeTagDialogTagCheckbox(tag, true));
            tagEl.querySelector('input').checked = config.ui.excludeTagsList[tag].exclude;
        });
        //Add "Won't be hidden" before the first one that is selected.
        [].slice.call(tagContainer.querySelectorAll('input')).some((input) => {
            if (!input.checked) {
                input.parentNode.insertAdjacentHTML('beforebegin', '<span class="urrsCheckboxesSelectedLabel"><b>Won\'t be hidden:</b></span>');
                return true;
            }
            return false;
        });
        //If there are none that are selected, tell the user.
        if ([].slice.call(tagContainer.querySelectorAll('input')).every((input) => !input.checked)) {
            //Tell the user it is known that there are none that are selected.
            tagContainer.querySelector('.urrsCheckboxesSelectedLabel').insertAdjacentHTML('beforeend', ' (none)');
        }
        funcs.ui.invalidateAllDatasetExcludedTags();
    };

    //A few functions below were copied by Makyen (original author) from Roomba Forecaster:
    //  https://github.com/makyen/StackExchange-userscripts/tree/master/Roomba-Forecaster
    //  then edited for use here.

    funcs.ui.showOptions = () => {
        //Display the options dialog
        //The user may have changed the options for this page, not saved, but then hidden them.
        //  Thus, don't update from config. That was already done when the options dialog was created.
        funcs.ui.replaceOptionsDialogExcludeTagsList();
        funcs.ui.positionOptionDialog();
        funcs.ui.setOptionDialogBackgroundColor();
        funcs.ui.setGeneralOptionsDialogCheckboxesToConfig();
        funcs.ui.optionDialogSetTagTagClickDescriptorToConfig();
        const optionsDiv = document.getElementById('urrsOptionsDialog');
        const optionsAbsDiv = document.getElementById('urrsOptionsDialogInner');
        optionsDiv.style.display = 'block';
        optionsAbsDiv.style.display = 'block';
        optionsAbsDiv.style.opacity = 1;
        optionsAbsDiv.style.pointerEvents = 'auto';
        const optionsBehindDiv = document.getElementById('urrsOptionsDialogBehind');
        optionsBehindDiv.style.display = 'block';
        //Add window click handler to hide the options, not using capture. Most valid clicks will
        //  have the event canceled.
        window.addEventListener('click', funcs.ui.handleWindowClickWhileOptionsShown, true);
    };

    funcs.ui.handleWindowClickWhileOptionsShown = (event) => {
        //Handle a click event in the window when the Options are visible.
        if (!document.getElementById('urrsOptionsDialogInner').contains(event.target)) {
            //Still have to check if the target is in the options div because
            // clicks with non-button 0 are not fired on the element.
            funcs.ui.hideOptions();
        }
    };

    funcs.ui.hideOptions = () => {
        //Hide the options dialog
        const optionsAbsDiv = document.getElementById('urrsOptionsDialogInner');
        optionsAbsDiv.style.opacity = 0;
        optionsAbsDiv.style.pointerEvents = 'none';
        const optionsBehindDiv = document.getElementById('urrsOptionsDialogBehind');
        optionsBehindDiv.style.display = 'none';
        //Stop listening for window clicks to hide the options.
        window.removeEventListener('click', funcs.ui.handleWindowClickWhileOptionsShown, true);
        //Blur focus on the options/edit "tags" button.
        (document.getElementById('urrsOptionsButton') || document.getElementById('urrs-open-options-button')).blur();
        //All of the configuration is updated as we go. Make sure the UI is updated to any changes that may have happened in other tabs (i.e. visited, or other Options dialogs).
        funcs.config.restoreNonUi();
        funcs.executeIfIsFunction(funcs.ui.updateDisplayBasedOnUI);
    };

    funcs.ui.optionsTransitionend = (event) => {
        //Got a transitionend event.
        const optionsAbsDiv = document.getElementById('urrsOptionsDialogInner');
        if (event.target !== optionsAbsDiv) {
            //Ignore transitions on anything we are not specifically interested in.
            return;
        }
        if (+optionsAbsDiv.style.opacity === 0) {
            //Actually hide the options rather than just have their opacity be 0.
            optionsAbsDiv.style.display = 'none';
        }
    };

    funcs.ui.toggleOptionDisplay = (additional) => {
        //Toggle the display of the options dialog
        const optionsDiv = document.getElementById('urrsOptionsDialog');
        const optionsAbsDiv = document.getElementById('urrsOptionsDialogInner');
        if (optionsDiv.style.display === 'none' || +optionsAbsDiv.style.opacity === 0) {
            funcs.ui.showOptions(additional);
        } else {
            funcs.ui.hideOptions();
        }
    };

    funcs.ui.handleClickEventToToggleOptionDisplay = (event) => {
        //Handle a click event on the Roomba status line.
        event.stopPropagation();
        //Currently don't have separate functionality for shift/alt/Ctrl-click.
        const additional = event.shiftKey || event.altKey || event.ctrlKey;
        funcs.ui.toggleOptionDisplay(additional);
    };

    funcs.ui.setOptionDialogBackgroundColor = () => {
        //Set the Options dialog background color to the current computed color.
        //  This is done to support alternate color schemes. This is needed because the
        //  inherited color is sometimes 'transparent', which does not work for an overlay.
        document.getElementById('urrsOptionsDialogInner').style.backgroundColor = funcs.getMainBackgroundColor();
    };

    funcs.ui.optionDialogSetTagTagClickDescriptorToConfig = () => {
        //In the Options Dialog show text indicating what the config is set to for the click combo used for opening the CVQ with a tag filtered.
        const clickDescription = config.nonUi.clickTagTagToOpenCVQButtonInfo;
        const descriptionText = (Object.keys(clickDescription).sort().map((key) => {
            if (key === 'button' || !clickDescription[key]) {
                return null;
            }
            return key.replace(/Key/g, '').replace(/^(.)/, ((value) => value.toUpperCase()));
        }).filter((value) => value).join('-') + '-' + (clickDescription.button < 3 ? ['Left', 'Middle', 'Right'][clickDescription.button] : clickDescription.button) + '-Click').replace(/^-\s*/, '');
        document.getElementById('urrsOptions-clickTagTagToOpenCVQ-clickInfo').textContent = descriptionText;
    };

    funcs.ui.optionDialogHandleCustomAllClicks = (event) => {
        //Handle the custom event indicating that the window event handler detected a click.
        const target = event.target;
        const detail = event.detail;
        const targetId = target.id;
        if (targetId === 'urrsOptions-setTagTagOpenCVQ') {
            //Having this be on a custom event guarantees that the event is one which the window listener will detect.
            const clickDescription = {
                ctrlKey: detail.ctrlKey,
                shiftKey: detail.shiftKey,
                altKey: detail.altKey,
                metaKey: detail.metaKey,
                button: detail.button,
            };
            Object.assign(config.nonUi.clickTagTagToOpenCVQButtonInfo, clickDescription);
            funcs.config.saveNonUi(config.nonUi);
            funcs.addRequestStylesToDOM();
            funcs.ui.optionDialogSetTagTagClickDescriptorToConfig();
        }
    };

    //XXX It may be best just to break the visited list into it's own storage location. That would make it easier to not have to worry about it not being synced
    //prior to updating anything else in nonUI.
    funcs.ui.handleOptionsClick = (event) => {
        //Deal with a click in the exclusion tag dialog.
        const target = event.target;
        const targetId = target.id;
        if (targetId.indexOf('urrsTagCheckbox-') > -1) {
            //Update the config from all the tags, not just the one that was clicked.
            [].slice.call(document.getElementById('urrsModalOptionsExcludeTagCheckboxesContainer').querySelectorAll('input')).forEach((input) => {
                const tag = input.id.replace('urrsTagCheckbox-', '');
                config.ui.excludeTagsList[tag].exclude = input.checked;
            });
            funcs.config.saveUiAndGetSavedNonUi(config);
            funcs.ui.invalidateAllDatasetExcludedTags();
            //Hide/show any affected messages.
            funcs.ui.showHideMessagesPerUI();
        }
        if (targetId.indexOf('urrsOptionsCheckbox-') > -1) {
            //Update all the stored values of the checkbox inputs.
            const generalOptions = document.getElementById('urrsModalOptionsGeneralOptions');
            funcs.config.restoreNonUi(config.nonUi);
            [].slice.call(generalOptions.querySelectorAll('input[type="checkbox"],input[type="radio"]')).forEach((input) => {
                const option = input.id.replace('urrsOptionsCheckbox-', '');
                config.nonUi[option] = input.checked;
            });
            funcs.config.saveNonUi(config.nonUi);
            funcs.executeIfIsFunction(funcs.ui.setVisitedButtonEnabledDisabledByConfig);
            funcs.config.clearVisitedPostsInConfigIfSetNoTracking();
            funcs.executeIfIsFunction(funcs.ui.showHideUpdateButtonByConfig);
        }
        if (targetId.indexOf('urrsOptionsRange-') > -1) {
            //Update all the stored values of the range inputs.
            [].slice.call(document.getElementById('urrsModalOptionsGeneralOptions').querySelectorAll('input[type="range"]')).forEach((input) => {
                const option = input.id.replace('urrsOptionsRange-', '');
                config.nonUi[option] = input.value;
                //Update the value displayed for the range.
                const valueEl = input.parentNode.querySelector('#' + input.id.replace('-', 'Value-'));
                if (valueEl) {
                    valueEl.textContent = input.value;
                }
                input.parentNode.querySelector('.urrsOptionsPluralValue').textContent = input.value == 1 ? '' : 's'; // eslint-disable-line eqeqeq
            });
            funcs.config.saveNonUi(config.nonUi);
        }
        if (targetId === '' && target.nodeName === 'BUTTON') {
            if (target.classList.contains('urrsModalOptionsTagControlButton')) {
                let setCheck = false;
                let unsetCheck = false;
                let invertCheck = false;
                switch (target.textContent) {
                    case 'all':
                        setCheck = true;
                        break;
                    case 'none':
                        unsetCheck = true;
                        break;
                    case 'invert':
                        invertCheck = true;
                        break;
                    case 'visible':
                        [].slice.call(document.querySelectorAll('.monologue:not(.urrsShowButtonHidden) .message .content')).forEach((content) => {
                            funcs.getAllNonRequestTagsInElement(content).forEach((tagTag) => {
                                const tagText = tagTag.textContent;
                                const tag = document.getElementById('urrsTagCheckbox-' + tagText);
                                if (tag) {
                                    tag.checked = true;
                                    config.ui.excludeTagsList[tagText].exclude = true;
                                }
                            });
                        });
                        break;
                    default:
                        //Do nothing
                        break;
                }

                //Perform operation and update the stored values
                if (setCheck || unsetCheck || invertCheck) {
                    [].slice.call(document.getElementById('urrsModalOptionsExcludeTagCheckboxesContainer').querySelectorAll('input')).forEach((input) => {
                        if (setCheck) {
                            input.checked = true;
                        } else if (unsetCheck) {
                            input.checked = false;
                        } else if (invertCheck) {
                            input.checked = !input.checked;
                        }
                        //Update stored value
                        const tag = input.id.replace('urrsTagCheckbox-', '');
                        config.ui.excludeTagsList[tag].exclude = input.checked;
                    });
                }
                target.blur();
            }
            funcs.config.saveNonUi(config.nonUi);
            funcs.ui.invalidateAllDatasetExcludedTags();
            //Hide/show any affected messages.
            funcs.ui.showHideMessagesPerUI();
        }
        funcs.ui.optionsSetOptionsEnabledDisabled();
        funcs.addRequestStylesToDOM();
        funcs.ui.optionDialogSetTagTagClickDescriptorToConfig();
    };

    funcs.ui.invalidateAllDatasetExcludedTags = () => {
        //Force the dataset item which holds calculated values for if the message matches the excluded tags to be invalidated,
        //  forcing them to be re-calculated.
        [].slice.call(document.querySelectorAll('.message')).forEach((message) => {
            const excludedTags = message.dataset.excludedTags;
            if (excludedTags) {
                message.dataset.excludedTags = '';
            }
        });
    };


    //End of functions used on both the search page and chat

    //We want the search UI shown, more info in request-info and non-requests deleted only on searches which are for close-votes and delete-votes.
    //  On other searches, we just want chat-page request-info.
    if (isSearchReviewUIActive) {
        //Only the search page

        //Determine the current user's ID (not actually needed; is redundant to testing for the "mine" class)
        const me = (/\d+/.exec(document.querySelector('.topbar-menu-links a[href^="/users"]').href) || [false])[0];

        //Original Functions for only the search page
        funcs.checkDone = (status) => {
            //Process requests which now have all the data they're going to get.
            //Check for the cases where the user has placed the dup-target in the message along with the dup, where the
            //  dup is closed. In such cases, put the dup-target in the closed list (we won't have any info on delete dups).
            status.closed.forEach((dupClosedRequest) => {
                if (dupClosedRequest.info.closed_reason !== 'duplicate') {
                    return;
                } // else
                dupClosedRequest.info.closed_details.original_questions.forEach((dupTargetQuestion) => {
                    var dupTargetQuestionId = dupTargetQuestion.question_id;
                    status.open = status.open.filter((openRequest) => {
                        //Filter out those questions where the current question Id matches the ID for any dup-target question ID for any closed question.
                        //  This will include cross-request duplicates (rare).
                        var toReturn = openRequest.info.question_id !== dupTargetQuestionId || dupClosedRequest.msg !== openRequest.msg;
                        if (!toReturn) {
                            //For our purposes here, the dup-target is put in the same list, closed, as the duplicate.
                            status.closed.push(openRequest);
                        }
                        return toReturn;
                    });
                });
            });
            //Move locked posts from the open list to the closed list. While they aren't closed, there isn't anything that can be done with them
            //  by non-moderators.  Thus, there's no reason to show them to users under normal circumstances
            status.open = status.open.filter((openRequest) => {
                var locked = !!openRequest.info.locked_date;
                if (locked) {
                    status.closed.push(openRequest);
                }
                return !locked;
            });
            //Define which messages will have request-info data added, and which will end up deleted.
            let addRequestInfoList = status.open;
            let incedentalRequests = [];
            if (isSearchReopen) {
                addRequestInfoList = status.closed;
                if (config.nonUi.searchShowDeletedAndClosed || isForceShowOpen) {
                    //Show open
                    addRequestInfoList = addRequestInfoList.concat(status.open);
                } else {
                    incedentalRequests = incedentalRequests.concat(status.open);
                }
            } else if (config.nonUi.searchShowDeletedAndClosed || isSearchDel || isForceShowClosed) {
                //Show closed
                addRequestInfoList = addRequestInfoList.concat(status.closed);
            } else {
                incedentalRequests = incedentalRequests.concat(status.closed);
            }
            if (config.nonUi.searchShowDeletedAndClosed || isForceShowDeleted) {
                //Show deleted
                addRequestInfoList = addRequestInfoList.concat(status.deleted);
            } else {
                incedentalRequests = incedentalRequests.concat(status.deleted);
            }
            //Add request-info data
            for (const oRequest of addRequestInfoList) {
                funcs.appendInfo(oRequest);
            }
            //Mark all request-info which are not actually on requests as non-requests.
            funcs.mp.markAllRequestInfoOnNonRequests();
            if (isForceShowLinks || isForceShowReplies) {
                [].slice.call(document.querySelectorAll('.message')).forEach((message) => {
                    if (message.querySelector('.request-info:not(.urrsRequestNoRequestTag)')) {
                        return;
                    } //else
                    const content = funcs.getContentFromMessage(message);
                    var contentText = content ? content.textContent : '';
                    if ((isForceShowLinks && funcs.doesMessageContentContainNonTagLinks(message)) ||
                        (isForceShowReplies && /@\w/.test(contentText))
                    ) {
                        //Showing links and there is a link in the content which is not a tag.
                        //  Or showing replies and there is a reply (as loosely determined)
                        //Use a request-info as a marker not to delete
                        message.insertAdjacentHTML('beforeend', '<div class="request-info" style="display:none">');
                    }
                });
            }
            //Remove any monologue that does not have a request-info which is a request
            [].slice.call(document.querySelectorAll('.monologue')).forEach((monologue) => {
                if (!monologue.querySelector('.request-info:not(.urrsRequestNoRequestTag)')) {
                    monologue.remove();
                }
            });
            //Remove any message that does not have a request-info which is a request
            //Done second, because removing messages w/o request-info won't change the status of a monologue.
            [].slice.call(document.querySelectorAll('.message')).forEach((message) => {
                if (!message.querySelector('.request-info:not(.urrsRequestNoRequestTag)')) {
                    message.remove();
                }
            });
            // Add request-info data for incidental requests. For example, additional posts in
            // messages we're displaying, but which were not previsously given a
            // request-info due to already being complete for the type of request we're
            // looking at.
            for (const oRequest of incedentalRequests) {
                funcs.appendInfo(oRequest);
            }
            //Mark all request-info which are not actually on requests as non-requests.
            //  This shouldn't be needed., but is done, just in case.
            funcs.mp.markAllRequestInfoOnNonRequests();
            const links = [].slice.call(document.querySelectorAll('.content a'));
            //Make all links open in a new tab/new window.
            for (const link of links) {
                link.target = '_blank';
            }
            //Do everything to be ready for user interaction that needs to be done after the request-info data has been added to the page.
            funcs.ui.postAPIProcessingUiSetup();
        };


        //Utility functions for the search page

        //Find the main color used for text on the search page.
        funcs.getMainTextColor = () => funcs.getTextColor(document.querySelector(isSearch ? '#refine-search' : '#container'));

        //Find the main color that is used for the background-color on the search page.
        funcs.getMainBackgroundColor = () => funcs.getBackgroundColor(document.querySelector(isSearch ? '#refine-search' : '#container'));


        //UI for search page
        if (typeof funcs.ui !== 'object') {
            funcs.ui = {};
        }

        funcs.ui.addUiStylesToDOM = () => {
            funcs.addStylesToDOM('urrsUiStyles', [
                //Styles for added UI
                'body.outside #container {',
                '    margin: 10px;',
                '    width: 910px;',
                '}',
                '#content .subtabs+p {',
                '    margin: 0;',
                '}',
                'form#refine-search {',
                '    margin-bottom: 5px;',
                '}',
                '.urrsShowButtonHidden {',
                '    display: none;',
                '}',
                '.subtabs .urrsSortDiv a ,',
                '.subtabs .urrsShowDiv a {',
                '    float: none;',
                '    display: inline;',
                '    height: 18px;',
                '    line-height: 18px;',
                '    cursor: pointer;',
                '    padding: 2px 2px 4px;',
                '}',
                '.urrsShowDiv, .urrsSortDiv {',
                '    float: none;',
                '    display: block;',
                '    margin-bottom: .85em;',
                '    width: auto;',
                '}',
                '#refine-search {',
                '    width: 995px;',
                '}',
                '#urrsSortDivOrigSort {',
                '    float: inherit;',
                '    display: inline;',
                '    position: inherit;',
                '}',
                '#urrsTable td + td {',
                '    padding-left: 1.5em;',
                '}',
                '#urrsTable {',
                '    float: right;',
                '    min-width: 570px;',
                '}',
                '#content>p {',
                '    width: 100px;',
                '}',
                'div.subtabs {',
                '    height: 55px;',
                '    float: none;',
                '    position: absolute;',
                '    left: 120px;',
                '    margin-top: 5px;',
                '}',
                'div.subtabs > a {',
                '    float: right;',
                '}',
                '.urrsShowDiv a, .urrsSortDiv a {',
                '    text-align: center;',
                '    margin-bottom: 3px;',
                '}',
                '.urrsShowDiv a:hover, .urrsSortDiv a:hover {',
                '    opacity: 0.8;',
                '}',
                '.urrsShowDiv a:not(.youarehere):hover, .urrsSortDiv a:not(.youarehere):hover {',
                '    opacity: 0.7;',
                '}',
                '.urrsButtonSpacingContainer {',
                '    float: none;',
                '    display: inline;',
                '    position: relative;',
                '}',
                '.urrsButtonActual {',
                '    float: none;',
                '    display: inline;',
                '    position: absolute;',
                '    left: 0px;',
                '}',
                '.urrsButtonSpacer {',
                '    float: none;',
                '    display: inline;',
                '    pointer-events: none;',
                '    visibility: hidden;',
                '}',
                '.urrsButtonDiv {',
                '    float: none;',
                '    display: inline;',
                '    margin-right: auto;',
                '    margin-left: auto;',
                '}',
                '.urrsButtonText {',
                '    white-space: nowrap;',
                '}',
                '.urrsButtonSortOrderText {',
                '    font-size: 10px;',
                '}',
                'a:not(.youarehere) .urrsButtonBadge {',
                '    background-color: #dd7700;',
                '}',
                '.urrsButtonBadge.urrsButtonBadgeHidden{',
                '    background-color: #dd7700;',
                '}',
                'a:not(.youarehere) .urrsButtonBadge.urrsButtonBadgeShown,',
                'a.youarehere .urrsButtonBadge.urrsButtonBadgeShown {',
                '    margin-left: 0;',
                '    margin-right: 1px;',
                '    background-color: #0077dd;',
                '}',
                '.urrsButtonBadge {',
                '    color: white;',
                '    background-color: #0077dd;',
                '    font-size: 10px;',
                '    border-radius: 2px;',
                '    line-height: 1;',
                '    padding: 3px 4px 3px;',
                '    margin: 0;',
                '    border: 0;',
                '    box-sizing: border-box;',
                '}',
                '.urrsButtonText {',
                '    margin-right: 3px;',
                '}',
                '.subtabs > span {',
                '    float: right;',
                '    display: block;',
                '    margin-right: 3px;',
                '    padding-top: 3px;',
                '    padding-right: 4px;',
                '    padding-bottom: 4px;',
                '    padding-left: 4px;',
                '}',
                '.subtabs a {',
                '    display: block;',
                '    float: right;',
                '    line-height: 1;',
                '    margin-right: 3px;',
                '    padding: 2px 4px 4px;',
                '    text-decoration: none;',
                '}',

                '.subtabs a {',
                '    font-family: Trebuchet MS,Liberation Sans,DejaVu Sans,sans-serif;',
                '    font-size: 120%;',
                '    border: 1px solid #ccc;',
                '    color: #808185 !important;',
                '}',
                '.subtabs a.youarehere {',
                '    background-color: #808185;',
                '    border: 1px solid #808185;',
                '    color: #fff !important;',
                '    font-weight: bold;',
                '}',

                '#urrsOpenAllVisibleButton {',
                '    float:none;',
                '    position: absolute;',
                '    left: 330px;',
                '    top: -62px;',
                '    padding-left: 5px;',
                '    padding-right: 5px;',
                '}',
                '#urrsButtonSetUIOptionsGroup-div {',
                '    float:none;',
                '    position: absolute;',
                '    left: 196px;',
                '    top: -75px;',
                '    padding: 5px;',
                '    padding-left: 5px;',
                '    padding-right: 5px;',
                '    display: block;',
                '}',
                '#urrsButtonSetUIOptionsGroup-div-inner {',
                '    float:none;',
                '    width: 96px;',
                '    display: block;',
                '}',
                '#urrsButtonSetUIOptionsGroup-div > span {',
                '    display: block;',
                '    margin-left: 1.5px;',
                '}',
                '.subtabs .urrsButtonSetUIOptionsGroup {',
                '    margin: 1.5px;',
                '    float: none;',
                '    display: inline-block;',
                '    padding-bottom: 2px;',
                '}',
                '.urrsDisabled:hover, ',
                '.urrsDisabled {',
                '    pointer-events: none;',
                '    opacity:.4;',
                '}',
                '#urrsOptionsButton {',
                '    float:none;',
                '    position: absolute;',
                '    left: -159px;',
                '    top: -19px;',
                '    padding-left: 5px;',
                '    padding-right: 5px;',
                '}',
            ].join('\n'));
        };

        funcs.ui.invalidateAllDatasetVisited = () => {
            //The data we have stored regarding each message matching the visited list has
            //  needs to be invalidated. Usually this is because the visited list changed.
            [].slice.call(document.querySelectorAll('.message')).forEach((message) => {
                message.dataset.visited = '';
            });
        };

        //Create a <div> to contain some showing buttons.
        funcs.ui.createShowDiv = (id) => funcs.ui.createButtonContainerDiv(id, 'urrsShowDiv');

        //Create a <div> to contain some sorting buttons.
        funcs.ui.createSortDiv = (id) => funcs.ui.createButtonContainerDiv(id, 'urrsSortDiv');

        funcs.ui.createButtonContainerDiv = (id, className) => {
            //Create a <div> to contain some buttons.
            const div = document.createElement('div');
            div.id = id;
            div.className = className;
            return div;
        };

        funcs.ui.setVisitedButtonEnabledDisabledByConfig = () => {
            //Set the enabled/disabled status of the visited button based on the current config.
            funcs.ui.setVisitedButtonEnabledDisabled(config.nonUi.trackVisitedLinks);
        };

        funcs.ui.setVisitedButtonEnabledDisabled = (isEnabled) => {
            //Set the enabled/disabled state of the visited button
            const visited = showingButtons.buttons.visited;
            const visitedEl = document.getElementById(visited.id);
            if (isEnabled) {
                visitedEl.classList.remove('urrsDisabled');
                if (config.ui.visited) {
                    visitedEl.classList.add('youarehere');
                } else {
                    visitedEl.classList.remove('youarehere');
                }
            } else {
                config.ui.visited = true;
                visitedEl.classList.add('youarehere');
                visitedEl.classList.add('urrsDisabled');
            }
        };

        funcs.ui.addButtonsToNav = () => {
            //Add the buttons to the page and move existing elements to new places in the DOM
            //Remember the "sort" buttons in the original page, which are links to new pages.
            const origSortButtons = [].slice.call(document.querySelectorAll('.subtabs a'));
            //Create table and divs in which show and sort buttons exist
            const uiTable = document.createElement('table');
            uiTable.id = 'urrsTable';
            const uiTableHead = uiTable.createTHead().insertRow();
            const uiTableBody = uiTable.appendChild(document.createElement('tbody'));
            const uiTableRow0 = uiTableBody.insertRow();
            const uiTableRow1 = uiTableBody.insertRow();
            uiTableRow0.insertCell().appendChild(funcs.ui.createShowDiv('urrsShowRow0Include'));
            uiTableRow0.insertCell().appendChild(funcs.ui.createShowDiv('urrsShowRow0Exclude'));
            uiTableRow1.insertCell().appendChild(funcs.ui.createShowDiv('urrsShowRow1Include'));
            uiTableRow1.insertCell().appendChild(funcs.ui.createShowDiv('urrsShowRow1Exclude'));
            funcs.ui.addElementToNav(uiTable);
            //Add Showing buttons
            //Add each showing button to the appropriate div
            var addedToShowDivs = 0;
            showingButtons.order.forEach((prop) => {
                const divIndex = addedToShowDivs >= showingButtons.numberFirstRow ? 1 : 0;
                const incEx = showingButtons.buttons[prop].excluding ? 'Exclude' : 'Include';
                addedToShowDivs++;
                funcs.ui.addButtonToQueryWithListener('#urrsShowRow' + divIndex + incEx, showingButtons.buttons[prop], funcs.ui.showingClick, config.ui[prop]);
            });
            funcs.ui.setVisitedButtonEnabledDisabledByConfig();
            const headerRowFirstCell = uiTableHead.insertCell();
            //A label for the showing buttons.
            const showIncludeSpan = document.createElement('span');
            showIncludeSpan.textContent = 'Show if selected';
            showIncludeSpan.title = [
                'If a message matches any of the selected criteria, it will be shown (even if it also matches another including criteria that is not selected), unless excluded by one of the Hide criteria.',
                ' Posts that are currently excluded (e.g. "my requests", "tags" and "visited"), are not included in the badge numbers.',
                ' Selected criteria have dark backgrounds. The selection is done with simple RegExp matching on the non-linked text in the message.',
                ' Thus, matching will not be 100% accurate.',
            ].join('');
            headerRowFirstCell.appendChild(showIncludeSpan);
            const headerRowSecondCell = uiTableHead.insertCell();
            //The options button
            const optionsButtonContainer = document.createElement('div');
            optionsButtonContainer.id = 'urrsOptionsButtonContainer';
            const optionsButton = document.createElement('button');
            optionsButton.id = 'urrsOptionsButton';
            optionsButton.innerHTML = 'options&nbsp;(edit&nbsp;"tags"&nbsp;list)';
            optionsButton.title = 'Open a dialog to change options and select the tags to hide with the "tags" criteria.';
            optionsButton.addEventListener('click', funcs.ui.handleClickEventToToggleOptionDisplay, true);
            optionsButtonContainer.appendChild(optionsButton);
            optionsButtonContainer.insertAdjacentHTML('beforeend', '<button id="urrsOpenAllVisibleButton" title="Open all the requests which are currently visible in new tabs.">Open all visible requests</button>');
            optionsButtonContainer.querySelector('#urrsOpenAllVisibleButton').addEventListener('click', funcs.ui.openAllVisibleRequests, true);
            optionsButtonContainer.insertAdjacentHTML('beforeend', [
                '<div id="urrsButtonSetUIOptionsGroup-div" title="Set the group of UI options to use for this tab. Each filter preset can hold a different configuration of UI options. These configuration storage groups are different locations for close and delete searches.">',
                '    <span>Filter preset</span>',
                '    <div id="urrsButtonSetUIOptionsGroup-div-inner" title="Set the group of UI options to use for this tab. Each filter preset can hold a different configuration of UI options. These configuration storage groups are different locations for close and delete searches.">',
                         ((new Array(NUMBER_UI_GROUPS).fill(0)).reduce((result, value, index) => result + '<a id="urrsButtonSetUIOptionsGroup-' + (index + 1) + '" class="urrsButtonSetUIOptionsGroup" value="' + (index + 1) + '">' + (index + 1) + '</a>', '')), // eslint-disable-line indent
                '    </div>',
                '</div>',
            ].join(''));
            optionsButtonContainer.querySelector('#urrsButtonSetUIOptionsGroup-div-inner').addEventListener('click', funcs.ui.handleClickOptionGroupSelect, true);
            //Second cell of the header: Excludes
            headerRowSecondCell.appendChild(optionsButtonContainer);
            const showExcludeSpan = document.createElement('span');
            document.body.insertBefore(funcs.ui.createOptionsDialog(), document.body.firstChild);
            showExcludeSpan.textContent = 'Hide unless selected';
            showExcludeSpan.title = [
                'Messages matching a criteria are only shown if that criteria is selected (even if the message also matches a criteria that is selected).',
                ' When not selected, the messages matching the criteria are not included in the badges on the "Include" buttons.',
                ' Selected criteria have dark backgrounds.',
            ].join('');
            headerRowSecondCell.appendChild(showExcludeSpan);
            //Sort Buttons
            //Sort header
            //A label for the sorting buttons
            const sortSpan = document.createElement('span');
            sortSpan.textContent = 'Sort';
            sortSpan.title = [
                'You can optionally sort by multiple criteria at a time.',
                ' To enable sorting by multiple criteria at once, check "Permit multiple sort criteria at a time" in the options dialog.',
                ' If you do, sorting will be in the order you activate the sort criteria.',
                ' This order is indicated by a number in () after the button name.',
                ' If you want to not be sorting by a particular criteria, it must be deselected.',
                ' This requires a total of 3 clicks on that criteria, not just selecting another criteria.',
            ].join('');
            uiTableHead.insertCell().appendChild(sortSpan);
            const sortDivOrigSort = funcs.ui.createSortDiv('urrsSortDivOrigSort');
            uiTableRow0.insertCell().appendChild(funcs.ui.createSortDiv('urrsSortDiv0'));
            uiTableRow1.insertCell().appendChild(funcs.ui.createSortDiv('urrsSortDiv1'));
            //Move original sort buttons into their new Div.
            origSortButtons.forEach((button) => {
                sortDivOrigSort.appendChild(button);
            });
            //Add button to not show the close/delete vote UI
            const withoutUIButton = sortDivOrigSort.appendChild(document.createElement('a'));
            withoutUIButton.textContent = 'without CV UI';
            withoutUIButton.href = window.location.origin + window.location.pathname + window.location.search + '&requestReviewType=none' + window.location.hash;
            withoutUIButton.title = 'Reload this search page, but without the close/delete vote user interface.';
            if (!isForceShowDeleted) {
                //Add button to show the closed/deleted questions.
                let willShow = 'closed & deleted';
                let urlShowParam = 'closedDeleted';
                if (isSearchDel) {
                    willShow = 'deleted';
                }
                if (isSearchReopen) {
                    willShow = 'open & deleted';
                    urlShowParam = 'openDeleted';
                }
                const showClosedDeletedButton = sortDivOrigSort.appendChild(document.createElement('a'));
                showClosedDeletedButton.textContent = 'show ' + willShow;
                showClosedDeletedButton.href = window.location.origin + window.location.pathname + window.location.search + '&requestReviewShow=' + urlShowParam + window.location.hash;
                showClosedDeletedButton.title = 'Reload this search page, but show ' + willShow + ' questions/answers.';
            } else {
                //Add button to not show the closed/deleted questions/answers
                let willShow = 'closed & deleted';
                if (isSearchDel) {
                    willShow = 'deleted';
                } else if (isSearchReopen) {
                    willShow = 'open & deleted';
                }
                const showClosedDeletedButton = sortDivOrigSort.appendChild(document.createElement('a'));
                showClosedDeletedButton.textContent = 'don\'t show ' + willShow;
                //Quick & dirty parameter removal.
                showClosedDeletedButton.href = window.location.href.replace(/&requestReviewShow=[^&#]*/, '');
                showClosedDeletedButton.title = 'Reload this search page, but don\'t show ' + willShow + ' questions/answers.';
            }
            //Move the original sort buttons to the end of the header row.
            document.querySelector('#header').appendChild(sortDivOrigSort);
            //Keep some original CSS intact.
            sortDivOrigSort.classList.add('subtabs');
            //Add each sorting button to the bottom sort div.
            var addedToSortDivs = 0;
            sortingButtons.order.forEach((prop) => {
                const divIndex = addedToSortDivs >= sortingButtons.numberFirstRow ? 1 : 0;
                addedToSortDivs++;
                funcs.ui.addButtonToQueryWithListener('#urrsSortDiv' + divIndex, sortingButtons.buttons[prop], funcs.ui.sortingClick, config.ui[prop]);
            });
            funcs.ui.sortingButtonsSetAllSortingOrderText();
            funcs.ui.setOptionGroupSelectToMostRecentGroup();
        };

        funcs.ui.setUIButtonsToConfig = () => {
            //Make the UI buttons reflect the current state of config.ui
            funcs.ui.setOptionGroupSelectToMostRecentGroup();
            showingButtons.order.forEach((prop) => {
                funcs.ui.setUnsetYouarehere(document.getElementById(showingButtons.buttons[prop].id), config.ui[prop]);
            });
            sortingButtons.order.forEach((prop) => {
                const anchor = document.getElementById(sortingButtons.buttons[prop].id);
                anchor.dataset.sortingState = config.ui[prop];
                funcs.ui.setUnsetYouarehere(anchor, config.ui[prop] != 0); // eslint-disable-line eqeqeq
                funcs.ui.sortingButtonSetTextByState(anchor);
            });
            funcs.ui.sortingButtonsSetAllSortingOrderText();
        };

        funcs.ui.setOptionGroupSelectToMostRecentGroup = (whichType) => {
            //Set the on/off (youarehere) property for all the option group buttons with only the stored most recently selected as active.
            funcs.ui.setOptionGroupSelectToGroup(funcs.config.getWhichUIGroupIsMostRecentlySelected(whichType));
        };

        funcs.ui.setOptionGroupSelectToTarget = (target) => {
            //Set the on/off (youarehere) property for all the option group buttons with only the target as selected.
            const innerDiv = document.getElementById('urrsButtonSetUIOptionsGroup-div-inner');
            [].slice.call(innerDiv.querySelectorAll('.urrsButtonSetUIOptionsGroup')).forEach((button) => funcs.ui.setUnsetYouarehere(button, button === target));
        };

        funcs.ui.setOptionGroupSelectToGroup = (group) => {
            //Set the option group buttons to the specified group
            const target = document.getElementById('urrsButtonSetUIOptionsGroup-' + group);
            funcs.ui.setOptionGroupSelectToTarget(target);
        };

        funcs.ui.handleClickOptionGroupSelect = (event) => {
            //Deal with the user clicking on one of the Option group buttons
            const target = event.target;
            const targetId = target.id;
            const groupMatches = targetId.match(/urrsButtonSetUIOptionsGroup-(\d+)/);
            if (!groupMatches) {
                return;
            } // else
            const group = groupMatches[1];
            funcs.config.setWhichUIGroupIsMostRecentlySelected(group);
            funcs.config.setGlobalUILocationIdToMostRecent();
            funcs.config.restoreUi();
            funcs.ui.setUIButtonsToConfig();
            funcs.ui.updateDisplayBasedOnUI();
        };

        funcs.ui.openAllVisibleRequests = (event) => {
            const links = [].slice.call(document.querySelectorAll('.monologue:not(.urrsShowButtonHidden) .message .request-info a'));
            //Open all the links first to let the user begin work.
            //Doing this separately from the UI update compensates for Firefox being slow using Greasemonkey.
            links.forEach((link) => {
                GM.openInTab(link.href, true);
            });
            //add all the questions at once to the visited list
            funcs.visited.addPostsFromAnchorListToVisitedAndUpdateShown(links);
            //Make the button be not selected.
            event.target.blur();
            //Be sure the UI has been updated to the current state.
            funcs.ui.showHideMessagesPerUI();
        };

        //Add an element to the navigation area
        funcs.ui.addElementToNav = (element) => funcs.ui.appendChildToQuery('.subtabs', element);

        funcs.ui.appendChildToQuery = (query, element) => {
            //Append a child to the element found by a query.
            const location = document.querySelector(query);
            if (location) {
                location.appendChild(element);
            }
            return element;
        };

        funcs.ui.addButtonToQueryWithListener = (query, button, listener, state) => {
            //Construct a button for the UI. A duplicate of the actual button is created to
            //  maintain spacing for this button.
            const buttonContainer = document.createElement('div');
            buttonContainer.classList.add('urrsButtonSpacingContainer');
            const realButton = buttonContainer.appendChild(funcs.ui.createButtonWithListener(button, listener, state));
            const spacingButton = buttonContainer.appendChild(funcs.ui.createButtonWithListener(button, null, state));
            realButton.classList.add('urrsButtonActual');
            spacingButton.classList.add('urrsButtonSpacer');
            //Fill the spacing button with contents that will make it take up "max" space.
            if (typeof button.excluding !== 'undefined') {
                //Showing buttons
                const badgesEl = spacingButton.querySelector('.urrsButtonBadges');
                const shownEl = spacingButton.querySelector('.urrsButtonBadgeShown');
                const hiddenEl = spacingButton.querySelector('.urrsButtonBadgeHidden');
                const separatorSpan = spacingButton.querySelector('.urrsButtonBadgeSeparator');
                shownEl.textContent = 99;
                hiddenEl.textContent = 99;
                badgesEl.style.display = '';
                shownEl.style.display = '';
                separatorSpan.style.display = '';
                hiddenEl.style.display = '';
            } else {
                //Sorting Buttons
                const sortOrderText = spacingButton.querySelector('.urrsButtonSortOrderText');
                sortOrderText.textContent = '(9)';
                sortOrderText.style.display = '';
                const buttonText = spacingButton.querySelector('.urrsButtonText');
                buttonText.textContent = buttonText.textContent.replace(/^(?:[\W])?([\w\s]+)$/, sortingButtons.sortingStates[1] + '$1');
            }
            funcs.ui.appendChildToQuery(query, buttonContainer);
            realButton.style.width = funcs.getElementEffectiveWidth(spacingButton) + 'px';
            //Add the button container to the DOM
            return buttonContainer;
        };

        funcs.ui.createButtonWithListener = (button, listener, state) => {
            //Add a button to the first element matching a query.
            const text = button.text;
            const id = button.id;
            const newButton = document.createElement('a');
            newButton.title = button.tooltip;
            //Whitespace matters in this HTML.
            /* beautify preserve:start *//* eslint-disable indent */
            newButton.innerHTML = [
                '<div class="urrsButtonDiv">',
                    '<span class="urrsButtonText"></span>',
                    '<span class="urrsButtonSortOrderText" style="display:none;"></span>',
                    '<span class="urrsButtonBadges" style="display:none;">',
                        '<span class="urrsButtonBadge urrsButtonBadgeHidden">0</span>',
                        '<span class="urrsButtonBadgeSeparator" style="display:none;">',
                            '/',
                        '</span>',
                        '<span class="urrsButtonBadge urrsButtonBadgeShown">0</span>',
                    '</span>',
                '</div>',
            ].join('');
            /* beautify preserve:end */ /* eslint-enable indent */
            newButton.querySelector('.urrsButtonText').textContent = text;
            if (typeof listener === 'function') {
                newButton.id = id;
                newButton.addEventListener('click', listener, true);
            }
            //Swap the badges, if that type of button
            if (button.excluding) {
                const origHiddenBadge = newButton.querySelector('.urrsButtonBadgeHidden');
                const origShownBadge = newButton.querySelector('.urrsButtonBadgeShown');
                origHiddenBadge.classList.add('urrsButtonBadgeShown');
                origHiddenBadge.classList.remove('urrsButtonBadgeHidden');
                origShownBadge.classList.add('urrsButtonBadgeHidden');
                origShownBadge.classList.remove('urrsButtonBadgeShown');
            }
            //Set the initial selected state of the button.
            if (state) {
                newButton.className = 'youarehere';
            }
            //If the state is a number (a sorting button), then  remember the state in the dataset
            //  and set the text based on state.
            if (typeof state === 'number') {
                newButton.dataset.sortingState = state;
                funcs.ui.sortingButtonSetTextByState(newButton);
            }
            return newButton;
        };

        funcs.ui.getButtonStatesFromUI = (list, buttons, obj) => {
            //Either modify the supplied Object, or return a new one.
            var states = typeof obj === 'object' ? obj : {};
            list.forEach((prop) => {
                const el = document.getElementById(buttons[prop].id);
                const state = el.dataset.sortingState;
                if (typeof state === 'undefined') {
                    //Showing buttons, or sorting buttons where dataset not yet set.
                    states[prop] = el.classList.contains('youarehere');
                } else {
                    //Sorting buttons
                    states[prop] = state;
                }
            });
            return states;
        };

        //Read the state of the showing buttons from the DOM into the object supplied.
        funcs.ui.getShowingStateFromUI = (obj) => funcs.ui.getButtonStatesFromUI(showingButtons.order, showingButtons.buttons, obj);

        //Note that the sorting order of the buttons is not kept in the UI, but in the config.ui:
        //  config.ui.sortingButtonsSortOrder
        //Should consider if this function should read/parse that information from the UI back into the config.ui.
        funcs.ui.getSortingStateFromUI = (obj) => funcs.ui.getButtonStatesFromUI(sortingButtons.order, sortingButtons.buttons, obj);

        funcs.ui.setUnsetYouarehere = (anchor, test) => {
            //Set/unset the 'youarehere' class which indicates that an anchor-checkbox-button is selected, or not.
            if (test) {
                anchor.classList.add('youarehere');
            } else {
                anchor.classList.remove('youarehere');
            }
        };

        funcs.ui.toggleYouarehere = (anchor) => {
            //The "youarehere" class is used to change the background-color of the button/link to indicate that it is active/inactive.
            //This is how the original page changes the color for the sort type used for the page.
            if (anchor.classList.contains('youarehere')) {
                //Currently selected
                anchor.classList.remove('youarehere');
            } else {
                //Not selected
                anchor.classList.add('youarehere');
            }
        };

        funcs.ui.sortingButtonsSetAllSortingOrderText = () => {
            //Set the sorting order text for all the sortingButtons.
            //  All of them are done each time because a change to one (e.g. disabling the middle sort criteria)
            //  can cause changes in others.
            sortingButtons.order.forEach((prop) => {
                const anchor = document.getElementById(sortingButtons.buttons[prop].id);
                if (anchor) {
                    const state = +anchor.dataset.sortingState;
                    const sortOrderEl = anchor.querySelector('#' + sortingButtons.buttons[prop].id + ' .urrsButtonSortOrderText');
                    if (!config.nonUi.allowMultipleSortCriteria || state === 0) {
                        //Not shown if not active or if only one sort criteria at a time is permitted.
                        sortOrderEl.style.display = 'none';
                    } else {
                        //The sorting order for the current button is its index in the sorting order array + 1
                        sortOrderEl.style.display = '';
                        const sortOrderNumber = config.ui.sortingButtonsSortOrder.indexOf(prop) + 1;
                        sortOrderEl.textContent = '(' + sortOrderNumber + ')';
                    }
                }
            });
        };

        funcs.ui.sortingButtonSetTextByState = (anchor) => {
            //Add the up/down arrow to the button if the button is active, remove if not.
            let state = anchor.dataset.sortingState;
            if (!state) { //Handle undefined
                state = 0;
            }
            const textEl = anchor.querySelector('.urrsButtonText');
            textEl.textContent = textEl.textContent.replace(/^(?:[\W])?([\w\s]+)$/, sortingButtons.sortingStates[state] + '$1');
            //The entire sort order may have changes so need to set all.
            funcs.ui.sortingButtonsSetAllSortingOrderText();
        };

        funcs.ui.cycleSortingState = (anchor, stateSet) => {
            //Cycle through the sorting states for each button with accounting for
            //  reversing the order of the active states if so defined in the button object.
            //  If stateSet is a number, then the state for the button is set to that state.
            //Get the current button state stored in the button's dataset
            let state = +anchor.dataset.sortingState;
            //Look up properties of the current button.
            const prop = sortingButtons.propsById[anchor.id];
            const stateOrder = sortingButtons.buttons[prop].stateOrderReversed;
            const maxState = 2;
            const minState = 0;
            //If the order is reversed, the state after 0 is the maxState.
            const state1 = stateOrder ? maxState : 1;
            if (state) { //Also handles undefined state
                state += stateOrder ? -1 : 1;
                if (state > maxState) {
                    state = minState;
                }
                if (state < minState) {
                    state = maxState;
                }
            } else {
                state = state1;
            }
            if (typeof stateSet === 'number') {
                //Force a specific state
                state = stateSet;
            }
            anchor.classList.add('youarehere');
            if (state === 0) {
                anchor.classList.remove('youarehere');
            }
            //Remember the new state
            anchor.dataset.sortingState = state;
            //Track the order in which the sorting buttons were enabled.
            const sortOrderIndex = config.ui.sortingButtonsSortOrder.indexOf(prop);
            if (state === 0) {
                //Remove the button from the sort order when not active
                if (sortOrderIndex > -1) {
                    config.ui.sortingButtonsSortOrder.splice(sortOrderIndex, 1);
                }
            } else {
                //Add the button to sort order if not already there.
                if (sortOrderIndex === -1) {
                    config.ui.sortingButtonsSortOrder.push(prop);
                }
            }
            //Set the sort order text for all the buttons, as the order of other buttons may have changed.
            funcs.ui.sortingButtonSetTextByState(anchor);
            return state;
        };

        funcs.ui.showingClick = (event) => {
            //Handle a click on a showingButton
            event.preventDefault();
            event.stopPropagation();
            const target = event.currentTarget;
            funcs.ui.toggleYouarehere(target);
            //If the user clicks on "tags" and there are no tags selected to exclude, then open the dialog so they can select some.
            if (target.id === showingButtons.buttons.excludedTags.id) {
                if (Object.keys(config.ui.excludeTagsList).every((tag) => !config.ui.excludeTagsList[tag].exclude)) {
                    funcs.ui.showOptions();
                }
            }
            funcs.ui.showHideMessagesPerUI();
        };

        funcs.ui.sortingClick = (event) => {
            //Handle a click on a sortingButton
            event.preventDefault();
            event.stopPropagation();
            if (!config.nonUi.allowMultipleSortCriteria) {
                //Only permit one sort criteria. Clear each sort button, except the one clicked.
                [].slice.call(document.querySelectorAll('.subtabs .urrsSortDiv a.urrsButtonActual')).forEach((sortButton) => {
                    if (sortButton !== event.currentTarget) {
                        //Set state 0 for each button.
                        funcs.ui.cycleSortingState(sortButton, 0);
                    }
                });
            }
            funcs.ui.cycleSortingState(event.currentTarget);
            funcs.ui.sortMessagesByUI();
        };

        funcs.ui.doesMessageMatchButton = (message, prop) => {
            //Detect if a message matches a showingButton.
            if (!message) {
                return null;
            }
            //If match/not match has already been determined for this property and message, then use the data stored in the
            //  message's dataset.
            //  This allows the match to be computed once, on demand, and then reused without recomputing.
            const curDataset = message.dataset[prop];
            if (typeof curDataset !== 'undefined') {
                if (curDataset === 'true') {
                    return true;
                }
                if (curDataset === 'false') {
                    return false;
                }
                //If for some reason the dataset value does not equal the text for a boolean, fall through and compute again.
            }
            var returnValue = false;
            if (prop === 'myRequests') {
                //Two different checks for the message being the user's. Inaccurate identification of own requests was reported as a problem by someone in SOCVR.
                const userLink = message.parentNode.parentNode.querySelector('.username a[href^="/user"]');
                returnValue = message.parentNode.parentNode.classList.contains('mine') || (userLink && ((/\d+/.exec(userLink.href) || [false])[0] === me));
            } else if (prop === 'otherIncluding') {
                //True if no other including type matches
                returnValue = !showingButtons.orderIncluding.some((testProp) => {
                    if (testProp === 'otherIncluding') {
                        return false;
                    }
                    return funcs.ui.doesMessageMatchButton(message, testProp);
                });
            } else if (prop === 'visited') {
                //Check if the post Id matches one that we have recorded as visited.
                returnValue = funcs.getListFromDataset(message, 'postIdList').every((postId) => config.nonUi.visitedPosts.hasOwnProperty(postId));
            } else if (prop === 'user20k') {
                returnValue = funcs.getFirst20kTagInElement(funcs.getContentFromMessage(message)) !== null;
            } else if (prop === 'excludedTags') {
                returnValue = funcs.getListFromDataset(message, 'tagList').some((messageTag) => config.ui.excludeTagsList[messageTag] && config.ui.excludeTagsList[messageTag].exclude);
            } else {
                //All other buttons use a RegExp match against the text of the message, exclusive of link text (e.g. no question titles/tags).
                //Get the text of the message without text from links. Again, determined once and saved.
                let contentWithoutLinks = message.dataset.textWithoutLinks;
                if (typeof contentWithoutLinks === 'undefined') {
                    //If the text without links of this message has not been previously determined, then do so.
                    const cloneContent = funcs.getContentFromMessage(message).cloneNode(true);
                    //Remove any links from the cloned content so we do not match the title of questions/tags.
                    [].slice.call(cloneContent.querySelectorAll('a')).forEach((link) => {
                        link.remove();
                    });
                    contentWithoutLinks = cloneContent.textContent;
                    message.dataset.textWithoutLinks = contentWithoutLinks;
                }
                //Clear any prior state in RegExp.
                showingButtons.buttons[prop].textRegex.lastIndex = 0;
                returnValue = showingButtons.buttons[prop].textRegex.test(contentWithoutLinks);
            }
            //Save this result in the message's dataset so it does not need to be calculated again.
            message.dataset[prop] = returnValue;
            return returnValue;
        };

        funcs.ui.hideMessageOrMonologue = (element) => {
            //Add a class that will hide the element
            element.classList.add('urrsShowButtonHidden');
        };

        funcs.ui.showMessageOrMonologue = (element) => {
            //Remove the class that used to hide the element.
            element.classList.remove('urrsShowButtonHidden');
        };

        funcs.ui.showHideMessagesPerUI = () => {
            //Show or hide messages based on the selected showingButtons.
            //Get the state of the buttons, save it, and load the current state of nonUI (visited links).
            //******** This execution path needs to not store the nonUi config. It is called from the event handler for listening to changes
            //  of that value. If it stores the nonUi config, then it is possible for a cross-tab async loop to develop.
            const buttonStates = funcs.ui.getShowingStateFromUI(config.ui);
            //We don't need to get the saved non-UI config here, as we are either listening for changes of that value, or polling for such changes. The
            //  worst case is that the value will have changed, and this gets called again after a single polling delay.
            //Don't need to save prior to updating the display for the user. This should be slightly more responsive
            setTimeout(funcs.config.saveUi, 0, config.ui);
            const messageCounts = {};
            const messageMatchesHiddenByExcluding = {};
            //Set up an Object to track the number of questions of each type.
            showingButtons.order.forEach((prop) => {
                messageCounts[prop] = {
                    all: 0,
                    shown: 0,
                };
                messageMatchesHiddenByExcluding[prop] = false;
            });
            //Go through each message and each showingButton to see if it matches the showingButton.
            const messages = [].slice.call(document.querySelectorAll('.message'));
            let totalShown = 0;
            messages.forEach((message) => {
                //Track which showing buttons the message matches
                const messageMatches = {};
                showingButtons.order.forEach((prop) => {
                    messageMatches[prop] = false;
                });
                //Determine which buttons the message matches and if it is a match which should
                //  cause the message to be shown, or not shown.
                let negMatch = false;
                let posMatch = false;
                //Don't handle excluding buttons (e.g. 'myRequests') in this loop.
                showingButtons.orderIncluding.forEach((prop) => {
                    if (funcs.ui.doesMessageMatchButton(message, prop)) {
                        messageMatches[prop] = true;
                        messageCounts[prop].all++;
                        if (buttonStates[prop]) {
                            posMatch = true;
                        } else {
                            negMatch = true;
                        }
                    }
                });
                let showMessage = true;
                if (negMatch && !posMatch) {
                    //Only don't show if there was not a match with a shown button.
                    //Tracking both the positive and negative matches is a redundant method of making sure
                    //  unmatched messages are not hidden. It is left over from when there was no "Other"
                    //  category. It could/should be simplified, but costs little and is working.
                    showMessage = false;
                }
                //Unlike the other buttons, excluding buttons (e.g. myRequests, tags, visited) force a message to be hidden, even if it matched another button.
                showingButtons.orderExcluding.forEach((excludeProp) => {
                    if (funcs.ui.doesMessageMatchButton(message, excludeProp)) {
                        messageCounts[excludeProp].all++;
                        messageMatches[excludeProp] = true;
                        if (!buttonStates[excludeProp]) {
                            showMessage = false;
                            //Remove Excluded messages from consideration in shown/not shown badges.
                            showingButtons.orderIncluding.forEach((includeProp) => {
                                if (messageMatches[includeProp] === true) {
                                    messageMatches[includeProp] = false;
                                    messageCounts[includeProp].all--;
                                    messageMatchesHiddenByExcluding[includeProp] = true;
                                }
                            });
                        }
                    }
                });
                if (showMessage) {
                    //Show the message
                    totalShown++;
                    funcs.ui.showMessageOrMonologue(message);
                    //Add a count to shown for all matching buttons.
                    showingButtons.order.forEach((prop) => {
                        if (messageMatches[prop]) {
                            messageCounts[prop].shown++;
                        }
                    });
                } else {
                    //Hide the message
                    funcs.ui.hideMessageOrMonologue(message);
                }
            });
            //Hide all monologues where no messages are shown
            [].slice.call(document.querySelectorAll('.monologue')).forEach((monologue) => {
                if (monologue.querySelector('.message:not(.urrsShowButtonHidden)')) {
                    funcs.ui.showMessageOrMonologue(monologue);
                } else {
                    funcs.ui.hideMessageOrMonologue(monologue);
                }
            });
            funcs.ui.updateShowingButtonBadges(buttonStates, messageCounts, messageMatchesHiddenByExcluding);
            //Display the total number of cv-pls that are open and the count shown.
            const foundText = document.querySelector('#content > p');
            if (foundText) {
                const shownText = totalShown;
                foundText.innerHTML = '<br/>This page:<br>' + messages.length + ((isForceShowClosed || isForceShowDeleted) ? ' ' : ' open ') + (isSearchDel ? 'del' : 'cv') + '-pls<br>' + shownText + ' shown';
            }
        };

        funcs.ui.updateShowingButtonBadges = (buttonStates, messageCounts, messageMatchesHiddenByExcluding) => {
            //Update showingButton count badges
            showingButtons.order.forEach((prop) => {
                const buttonEl = document.getElementById(showingButtons.buttons[prop].id);
                const shown = messageCounts[prop].shown;
                const all = messageCounts[prop].all;
                const notShown = all - shown;
                const badgesEl = buttonEl.querySelector('.urrsButtonBadges');
                const shownEl = buttonEl.querySelector('.urrsButtonBadgeShown');
                const hiddenEl = buttonEl.querySelector('.urrsButtonBadgeHidden');
                const separatorSpan = buttonEl.querySelector('.urrsButtonBadgeSeparator');
                shownEl.textContent = shown;
                shownEl.title = 'The number that matched, but are still visible due to matching another criteria.';
                hiddenEl.textContent = notShown;
                hiddenEl.title = 'The number that matched and are hidden.';
                if (all === 0) {
                    //No matching messages, so display no badges.
                    badgesEl.style.display = 'none';
                } else {
                    badgesEl.style.display = '';
                    shownEl.style.display = '';
                    separatorSpan.style.display = '';
                    hiddenEl.style.display = '';
                    if (shown === all) {
                        //All messages are shown, don't show a badge for hidden.
                        hiddenEl.style.display = 'none';
                        separatorSpan.style.display = 'none';
                    }
                    if (shown === 0) {
                        //No messages shown, don't show its badge.
                        shownEl.style.display = 'none';
                        separatorSpan.style.display = 'none';
                    }
                }
                //Give an indication to the user why they might not think the numbers add up when considering their own posts.
                if (prop !== 'myRequests' && messageMatchesHiddenByExcluding[prop]) {
                    buttonEl.title = showingButtons.buttons[prop].tooltip;
                    const someMessagesExcludedTextMain = '\r\nRequests hidden by excluding criteria (hide unless selected) are not ';
                    const someMessagesExcludedTextBadge = someMessagesExcludedTextMain + 'included in this number.';
                    const someMessagesExcludedTextButton = someMessagesExcludedTextMain + 'displayed in badges. In other words, there are some requests that match this criteria, but are neither shown nor displayed as a count in a not-shown badge for this criteria.';
                    shownEl.title += someMessagesExcludedTextBadge;
                    hiddenEl.title += someMessagesExcludedTextBadge;
                    buttonEl.title += someMessagesExcludedTextButton;
                } else {
                    //No messages are hidden. Restore the original button tooltip.
                    buttonEl.title = showingButtons.buttons[prop].tooltip;
                }
                //Handle messages not being shown when the button is selected.
                //  This is basically a special case for my requests.
                if (buttonStates[prop] && all !== shown) {
                    //In this case, just change the tooltips so the user can know what is going on.
                    shownEl.title = 'The number that matched and are shown.';
                    hiddenEl.title = 'The number that matched, but are hidden due to matching other criteria.';
                }
            });
        };

        funcs.ui.addSortCriteriaInfoToMonologueDataset = () => {
            //Scan through all the monologues to add numeric values for the sort
            //  criteria to each monologue's dataset for easy access.
            funcs.ui.recordOriginalSortOrder();
            /* beautify preserve:start *//* eslint-disable no-multi-spaces */
            //Some variables to improve code readability
            const datasetCloseVotes  = sortingButtons.buttons.closeVotes.datasetProp;
            const datasetReopenVotes = sortingButtons.buttons.reopenVotes.datasetProp;
            const datasetDeleteVotes = sortingButtons.buttons.deleteVotes.datasetProp;
            const datasetViews       = sortingButtons.buttons.views.datasetProp;
            const datasetReason      = sortingButtons.buttons.reason.datasetProp;
            //Date is handled separately so the information is available in appendInfo.
            const datasetUser        = sortingButtons.buttons.user.datasetProp;
            const datasetSortTag     = sortingButtons.buttons.sortTag.datasetProp;
            /* beautify preserve:end */ /* eslint-enable no-multi-spaces */
            [].slice.call(document.querySelectorAll('.monologue')).forEach((monologue) => {
                //This only looks at the first link in the first .request-info
                const requestInfo = monologue.querySelector('.request-info');
                const requestLink = monologue.querySelector('.request-info > a');
                if (requestInfo && requestLink && requestLink.dataset.postStatus !== 'deleted') {
                    if (requestLink.dataset.postStatus === 'answer') {
                        //Answer
                        monologue.dataset[datasetCloseVotes] = 0;
                        //The SE API doesn't actually provide a delete_vote_count for answers. Hopefully, it will in the future, but for
                        //  now just use the placeholder of -1. Any way this is handled, it's going to result in all the answers either sorted
                        //  together, or into the 0 (or other) group. Thus, we sort them into their own group.
                        if (requestLink.dataset.deleteVotes === 'undefined') {
                            monologue.dataset[datasetDeleteVotes] = -2;
                        } else {
                            monologue.dataset[datasetDeleteVotes] = requestLink.dataset.deleteVotes;
                        }
                        monologue.dataset[datasetViews] = -5;
                        monologue.dataset[datasetSortTag] = 'zzzzzzy';
                    } else {
                        //Non-deleted question
                        if (requestLink.dataset.postStatus === 'closed') {
                            monologue.dataset[datasetDeleteVotes] = requestLink.dataset.deleteVotes;
                        } else {
                            //This will sort all delete requests on open questions into their own group.
                            monologue.dataset[datasetDeleteVotes] = -5;
                        }
                        monologue.dataset[datasetCloseVotes] = requestLink.dataset.closeVotes;
                        monologue.dataset[datasetReopenVotes] = requestLink.dataset.reopenVotes;
                        monologue.dataset[datasetViews] = requestLink.dataset.views;
                        monologue.dataset[datasetSortTag] = JSON.parse(requestLink.dataset.questionTags)[0];
                    }
                } else {
                    //Deleted or invalid, so give data that will sort to bottom.
                    monologue.dataset[datasetCloseVotes] = 6;
                    monologue.dataset[datasetDeleteVotes] = 9999;
                    monologue.dataset[datasetViews] = -10;
                    monologue.dataset[datasetSortTag] = 'zzzzzzz';
                }
                monologue.dataset[datasetUser] = monologue.querySelector('.username').textContent;
                //Find the index of the first matching reason (used to sort by reason)
                const message = monologue.querySelector('.message');
                showingButtons.orderIncluding.some((prop, index) => {
                    if (funcs.ui.doesMessageMatchButton(message, prop)) {
                        monologue.dataset[datasetReason] = index;
                        return true;
                    }
                    return false;
                });
            });
        };

        funcs.ui.recordOriginalSortOrder = () => {
            //Remember the original order of the monologues.
            [].slice.call(document.querySelectorAll('.monologue')).forEach((monologue, index) => {
                monologue.dataset.originalSearchOrder = index;
                monologue.dataset.reverseOriginalSearchOrder = 10000 - index;
            });
        };

        funcs.ui.sortMessagesByUI = (obj, orderList) => {
            //Sort the messages based on the current UI state and and the config.ui.sortingButtonsSortOrder.
            var buttonStates;
            var sortOrder;
            if (typeof obj === 'object' && typeof orderList !== 'undefined') {
                //An Object has been passed in to represent the desired sort instead of reading it from the UI buttons.
                buttonStates = obj;
                //Sort by the criteria priorities provided in orderList.
                sortOrder = Array.isArray(orderList) ? orderList : [orderList];
            } else {
                //Read the current state of the UI and use that, along with the sorting state.
                buttonStates = funcs.ui.getSortingStateFromUI(config.ui);
                //We don't need to get the saved non-UI config here, as we are either listening for changes of that value, or polling for such changes. The
                //  worst case is that the value will have changed, and this gets called again after a single polling delay.
                //Don't need to save prior to updating the display for the user. This should be slightly more responsive. But, even eliminating it, doesn't fix the lag issue in FF.
                setTimeout(funcs.config.saveUi, 0, config.ui);
                //Sort by the criteria priorities defined in config.ui.sortingButtonsSortOrder.
                sortOrder = config.ui.sortingButtonsSortOrder;
            }
            //Get an array of monologues, which will be sorted, and then the sort applied to the DOM.
            const monologues = [].slice.call(document.querySelectorAll('.monologue'));
            //Sort into the reverse of the original order (i.e. make them oldest first):
            //  This is done so the default listing encourages people to handle requests which
            //  may expire in the near future.
            monologues.sort((a, b) => b.dataset.originalSearchOrder - a.dataset.originalSearchOrder);
            if (sortOrder.length > 0) {
                //Go through the sort order. If a higher priority criteria finds the messages equal, get
                //  the sort order from the next lower priority criteria.
                monologues.sort((a, b) => sortOrder.reduce((value, prop) => {
                    if (value !== 0) {
                        return value;
                    }
                    //Account for the button state reversing the order of the sort.
                    const state = buttonStates[prop];
                    const datasetProp = sortingButtons.buttons[prop].datasetProp;
                    const aText = a.dataset[datasetProp];
                    const bText = b.dataset[datasetProp];
                    if (sortingButtons.buttons[prop].sortType === 'string') {
                        //Not parse-able as numbers.
                        return (state > 1 ? 1 : -1) * aText.localeCompare(bText);
                    }
                    return (state > 1 ? 1 : -1) * (aText - bText);
                }, 0));
            }
            //Re-order the monologues in the DOM in the order into which they were sorted.
            const content = document.querySelector('#content');
            const putBefore = document.querySelectorAll('#content>br.clear-both')[1];
            if (putBefore) {
                monologues.forEach((monologue) => {
                    content.insertBefore(monologue, putBefore);
                });
            }
        };

        funcs.ui.positionOptionDialog = () => {
            //Move the options dialog to where it should be shown to the user:
            //  centered under the edit "tags" button.
            const optionsDiv = document.getElementById('urrsOptionsDialog');
            const optionsDivInner = optionsDiv.querySelector('#urrsOptionsDialogInner');
            const optionsDivRec = optionsDiv.getBoundingClientRect();
            const buttonRec = document.getElementById('urrsOptionsButton').getBoundingClientRect();
            const optionsDivInnerStyleWidth = parseInt(window.getComputedStyle(optionsDivInner).getPropertyValue('width'));
            optionsDivInner.style.top = ((buttonRec.top - optionsDivRec.top) + buttonRec.height) + 'px';
            optionsDivInner.style.left = ((buttonRec.left - optionsDivRec.left) + (buttonRec.width / 2) - (optionsDivInnerStyleWidth / 2)) + 'px';
        };

        funcs.ui.updateDisplayBasedOnUI = () => {
            //Update the displayed page based on the current state of the UI.
            funcs.ui.showHideMessagesPerUI();
            funcs.ui.sortMessagesByUI();
        };

        funcs.ui.postAPIProcessingUiSetup = () => {
            //All the basic question information has been added to each message. Generate some static information
            //  and update the page based on the stored UI configuration.
            funcs.doForAllMessages(funcs.sortMessageRequestInfoEntries);
            funcs.visited.beginRememberingPostVisits();
            funcs.ui.addAllQuestionTagsToExcludeTagsList();
            funcs.ui.replaceOptionsDialogExcludeTagsList();
            funcs.addMissingQuestionTags();
            funcs.fixN0kTagsInDeleteRequests();
            funcs.adjustAllBareUrlPostinksToHaveQuestionTitle();
            funcs.ui.addSortCriteriaInfoToMonologueDataset();
            funcs.ui.updateDisplayBasedOnUI();
            funcs.removeNotificationOnContainer();
        };

        //Restore the configuration, using defaults.
        funcs.config.setDefaults(config, showingButtons, sortingButtons);
        funcs.config.restore(config);
        funcs.config.listenForConfigChangesIfPossible();

        //Add the styles needed for requests.
        funcs.addRequestStylesToDOM();
        funcs.ui.addSharedStylesToDOM();
        funcs.ui.addUiStylesToDOM();
        //Add the buttons
        funcs.ui.addButtonsToNav();
        //Change the message text so things don't jump around on the page quite so much while it is loading.
        const messageCountText = document.querySelector('#content > p');
        if (messageCountText) {
            messageCountText.innerHTML += '<br/><br/><br/>';
        }

        funcs.mp.handleMessagesNotFromThisRoom = () => {
            //Look through the messages and remove those which are not from this room's transcript.
            [].slice.call(document.querySelectorAll('.message .action-link')).forEach((actionSpan) => {
                const linkHref = actionSpan.parentNode.href;
                if (currentRoom && linkHref.indexOf('/' + currentRoom + '?') === -1) {
                    const message = funcs.getContainingMessage(actionSpan);
                    const monologue = funcs.getContainingMonologue(message);
                    const titleNote = 'This message is not in this room. It probably was at one point and was moved.';
                    if (config.nonUi.transcriptMessagesNotInRoomMark) {
                        message.classList.add('urrs-messageNotInThisRoom');
                        message.title = titleNote;
                    }
                    if (config.nonUi.transcriptMessagesNotInRoomHide) {
                        message.remove();
                    }
                    if (!monologue.querySelector('.message:not(.urrs-messageNotInThisRoom)')) {
                        //No more messages in the monologue which are in this room.
                        if (config.nonUi.transcriptMessagesNotInRoomMark) {
                            monologue.classList.add('urrs-messageNotInThisRoom');
                            monologue.title = titleNote;
                        }
                        if (config.nonUi.transcriptMessagesNotInRoomHide) {
                            monologue.remove();
                        }
                    }
                }
            });
        };

        funcs.mp.processPageOnce = () => {
            if (isSearch) {
                //This is a search page. There may be messages which are no longer in the transcript for this room, but are being displayed in the search results.
                funcs.mp.handleMessagesNotFromThisRoom();
            }
            //Process each message on the page.
            if (isSearchDel || isForceShowLinks) {
                funcs.mp.processAllMessageLinks(false);
            } else {
                funcs.mp.processAllMessageLinks(true);
            }
        };

        //Begin processing the search.
        funcs.orSearch.stageOneProcessing();
    } else {
        //Normal chat page, a search page that doesn't match our active criteria, or a transcript.

        //Listen to CHAT
        funcs.inPageCHATListener = function() {
            //This function is executed in the page context to listen to CHAT events.

            function listenToChat(chatInfo) {
                //Main function which listens to CHAT events sent by SE.
                //  Currently it's main purpose is to record the time at which the message was posted.
                function findMessage() {
                    const messageDivId = 'message-' + chatInfo.message_id;
                    const message = document.getElementById(messageDivId);
                    if (message) {
                        //If the message was found, add the timestamp to the monologue.
                        //'timestamp' is duplicated here because this is run in the page context where the sortingButtons Object is not available.
                        const dateSortDatasetProp = 'timestamp';
                        const now = Date.now();
                        const currentDate = new Date();
                        message.dataset[dateSortDatasetProp] = now;
                        message.dataset.timeReadable = currentDate.toISOString().replace(':00.000', '').replace('T', ' ') + '\r\n' + currentDate.toString();
                        const monologue = $(message).closest('.monologue')[0];
                        if (!monologue.dataset[dateSortDatasetProp]) {
                            monologue.dataset[dateSortDatasetProp] = now;
                        }
                        if (!monologue.dataset.timestampEarliest) {
                            monologue.dataset.timestampEarliest = now;
                        }
                        monologue.dataset.timestampLatest = now;
                    }
                }
                if (chatInfo.event_type === 1 || chatInfo.event_type === 2 || chatInfo.event_type === 10) {
                    findMessage('Immediate: ');
                    setTimeout(findMessage, 0, 'Delay   0: ');
                }
            }
            if (CHAT && typeof CHAT.addEventHandlerHook === 'function') {
                CHAT.addEventHandlerHook(listenToChat);
            }
        };
        if (isChat) {
            funcs.executeInPage(funcs.inPageCHATListener, true, 'urrs-CHAT-listener');
        }

        //Utility functions for the chat page

        //Find the main color used for text on the search page.
        funcs.getMainTextColor = () => funcs.getTextColor(document.querySelector(isChat ? '#chat' : '#container'));

        //Find the main color that is used for the background-color on the search page.
        funcs.getMainBackgroundColor = () => funcs.getBackgroundColor(document.querySelector(isChat ? '#chat' : '#container'));


        //Message MutationObserver
        if (typeof funcs.mmo !== 'object') {
            funcs.mmo = {};
        }

        //While these might be better organized in an Object, they are separate variables for performance reasons in the MutationObserver.
        var initialMessageProcessingDoOnce = true;
        var newMessageObserver;
        var newMessageObserverThrottle = 0;
        var newMessageObserverThrottledMutations = [];
        var newMessageObserverThrottleDumpThrottledMutations = false;

        funcs.mmo.watchForNewMessages = () => {
            //Create a MutationObserver that watches for changes to the contents of #chat.
            //  Mutations are queued until no mutations occur for 100ms. Once there are no
            //  mutations for 100ms, then the mutations are processed.
            //Save a small amount of time not looking through an Object each time in the MO.
            const mmoThrottleFunction = funcs.mmo.throttledNewMessageMutations;
            if (typeof newMessageObserver !== 'object' || newMessageObserver === null) {
                newMessageObserver = new MutationObserver(function(mutations) {
                    if (newMessageObserverThrottle !== 0) {
                        clearTimeout(newMessageObserverThrottle);
                    }
                    if (initialMessageProcessingDoOnce && document.querySelector('.message')) {
                        //Process each message on the page for the first time as soon as the messages are available.
                        //There are a significant string of mutations when the page is first loading which keep the throttle active
                        //  well past where messages are available. This short-circuits that by processing them as soon as the
                        //  messages are available. The additional changes are not relevant to data needed to process the messages.
                        funcs.mp.commitToProcessAllUnlessBackoffTimerActive();
                        initialMessageProcessingDoOnce = false;
                        //Dump the current throttled mutations, as we have processed the page as it is now.
                        newMessageObserverThrottledMutations = [];
                        if (newMessageObserverThrottle !== 0) {
                            clearTimeout(newMessageObserverThrottle);
                        }
                        //Don't restart the throttle, as there are now no mutations to process.
                        return;
                    } //else
                    newMessageObserverThrottle = setTimeout(mmoThrottleFunction, 100);
                    newMessageObserverThrottledMutations.push(mutations);
                });
                //Watch for child changes to the chat element. Need to watch for the subtree
                //  also due to need to see if new messages are added to a monologue.
                newMessageObserver.observe(document.getElementById('chat'), {
                    childList: true,
                    subtree: true,
                });
            }
        };

        funcs.mmo.throttledNewMessageMutations = () => {
            //Called after a sequence of mutation changes which were not separated by more than 100ms.
            //  However, the first change could have been well more than 100ms ago.
            if (newMessageObserverThrottleDumpThrottledMutations) {
                //This is the first set of mutations upon page load. We have already started processing.
                //  Just ignore this first set of mutations.
                newMessageObserverThrottleDumpThrottledMutations = false;
                return;
            }
            //Look through the mutations to find all  message, messages or monologue which were added.
            const newMessages = [];
            newMessageObserverThrottledMutations.forEach((mutation) => {
                mutation.forEach((record) => {
                    for (const added of record.addedNodes) {
                        //It might be faster to get the className once, and test it. Doing so could/should be tested.
                        //Ignoring request-info should no longer be needed as we don't use the .messages class on them
                        // any longer due to interference with the SE scripts on the chat page.
                        // Don't recognize .pending changes. Wait for the message to no longer be pending.
                        if (added.classList && !added.classList.contains('request-info') && !added.classList.contains('pending') && (added.classList.contains('message') || added.classList.contains('monologue') || added.classList.contains('messages'))) {
                            newMessages.push(added);
                        }
                    }
                });
            });
            if (newMessages.length > 0) {
                //We are going to update the status of all messages which have info, so there is no need to
                //  know anything other than that we should do a round of processing.
                //  Thus, only the first new message for which a request-info should be made is detected, not all new messages.
                //  This is any message with a link, or a message with a request tag which is a reply to another message
                //  which contains a question/answer/post link (and is in the current DOM).
                newMessages.some((element) => {
                    //The element here can be a .monologue, a .messages or a .message. These will include ancestors/descendants of each other.
                    //  Thus, we will be checking things more than once (when nothing is found). It is probably easier to just do so, rather
                    //  than try to eliminate the possibility of re-doing some work.
                    let messages;
                    if (element.classList.contains('message')) {
                        messages = [element];
                    } else {
                        messages = [].slice.call(element.querySelectorAll('.message'));
                    }
                    if (messages.some((message) => {
                        //Just quickly determine if there is any message which needs a request info.
                        //Rather than go through every change (there could be a large number), just determine
                        //  if processing needs to happen at all and pass it off to message processing, which
                        //  deals with the DOM in its current state, not the changes which got it to that state.
                        const content = funcs.getContentFromMessage(message);
                        if (!content) {
                            return false;
                        } //else
                        return funcs.getQuestionAnswerOrPostIdsOrInfoFromLinksInElement(content, 'any').length > 0 || funcs.getQuestionAnswerOrPostInfoListFromReplyToIfIsRequestAndNoLinks(message, 'any').length > 0;
                    })) {
                        //The message has a question/answer/post link or is a request which is a reply to a message with a question/answer/post link.
                        messageProcessing.isRequested = true;
                        funcs.mp.processAllIfTimeElapsedAndScheduled();
                        //Only need to find the first one.
                        return true;
                    }
                    return false;
                });
            }
            //Clear the list of mutations.
            newMessageObserverThrottledMutations = [];
            //Just in case
            clearTimeout(newMessageObserverThrottle);
            newMessageObserverThrottle = 0;
        };

        //Message processing
        if (typeof funcs.mp !== 'object') {
            funcs.mp = {};
        }

        funcs.mp.clearThrottle = () => {
            //Clear the timeout used to throttle updating messages.
            clearTimeout(messageProcessing.throttle);
            messageProcessing.throttle = 0;
            messageProcessing.throttleTimeActivated = 0;
        };

        funcs.mp.clearThrottleAndProcessAllIfStillNotProcessed = (origProcessingTime) => {
            //If the last processing time is the same as the passed in time, process now.
            //If not, do nothing, as the desired processing has already happened.
            if (origProcessingTime === messageProcessing.mostRecentRequestInfoTime) {
                funcs.mp.clearThrottleAndProcessAll();
            }
        };

        funcs.mp.clearThrottleAndProcessAllIfImmediatePermitted = () => {
            //If either a minute has passed from the last time processing occurred, or
            //  if processing is requested (which would mean a different request is sent), then process.
            const remainingMinute = (messageProcessing.mostRecentRequestInfoTime + (60 * 1000)) - Date.now();
            if (messageProcessing.isRequested || remainingMinute <= 0) {
                funcs.mp.clearThrottleAndProcessAll();
            } else {
                //Remember the current processing time
                const recentProcessing = messageProcessing.mostRecentRequestInfoTime;
                //Clear the throttle so that processing does happen as soon as possible, if status changes.
                funcs.mp.clearThrottle();
                setTimeout(funcs.mp.clearThrottleAndProcessAllIfStillNotProcessed, remainingMinute, recentProcessing);
                //Inform the user that they have to wait.
                funcs.mp.addWaitingRequestInfoToPostsWithoutRequestInfo(false);
            }
        };

        funcs.mp.clearThrottleAndProcessAll = () => {
            //Force an update, regardless of the throttle state, but not if the tab is hidden.
            funcs.mp.clearThrottle();
            funcs.mp.processAllUnlessHidden();
        };

        funcs.mp.clearThrottleAndProcessAllIfScheduled = () => {
            //Ignore the processing throttle and do an update, if an update has been scheduled (e.g. a new message with a question link has been found).
            funcs.mp.clearThrottle();
            funcs.mp.processAllIfTimeElapsedAndScheduled();
        };

        funcs.mp.processAllIfTimeElapsedAndScheduled = () => {
            //If the throttle timer has expired and an update is "needed", then update question status
            if (messageProcessing.isRequested) {
                funcs.mp.processAllIfTimeElapsed();
            }
        };

        funcs.mp.timedBased = () => {
            //Process the messages based on the minimum-update timer expiring, if it wasn't done recently.
            if (messageProcessing.interval > 0) {
                //Clear any timeout scheduling auto-update.
                clearTimeout(messageProcessing.interval);
                messageProcessing.interval = 0;
            }
            if (config.nonUi.chatAutoUpdateRate > 0) {
                //Set up the timeout now, as it is possible we don't actually process right now.
                //If we actually do process, then this timeout gets immediately cleared.
                messageProcessing.interval = setTimeout(funcs.mp.timedBased, config.nonUi.chatAutoUpdateRate * 60 * 1000);
                //Process if not waiting for the timeout. Shouldn't normally be here if the throttling delay has not expired, but the user can
                //  set it up so that it happens.
                //If the throttle is active, should process when it expires.
                messageProcessing.isRequested = true;
                funcs.mp.processAllIfTimeElapsed();
            }
        };

        funcs.mp.sanityCheckTimers = () => {
            //Check to verify that the processing timer and backoff timer contain sane values.
            //  If not, then clear them and make them sane.
            const secondsFromLastProcess = (Date.now() - messageProcessing.mostRecentRequestInfoTime) / 1000;
            const secondsFromThrottleSet = (Date.now() - messageProcessing.throttleTimeActivated) / 1000;
            if (messageProcessing.throttle !== 0 &&
                //It's been too long from the last time we processed.
                ((MESSAGE_PROCESSING_ASSUMED_MAXIMUM_PROCESSING_SECONDS + config.nonUi.chatMinimumUpdateDelay - secondsFromLastProcess) < 0) &&
                //And we're not in the middle of processing.
                (messageProcessing.throttle !== MESSAGE_THROTTLE_PROCESSING_ACTIVE || secondsFromThrottleSet > (MESSAGE_PROCESSING_ASSUMED_MAXIMUM_PROCESSING_SECONDS + (MESSAGE_PROCESSING_DELAYED_ATTEMPTS * MESSAGE_PROCESSING_DELAY_FOR_MESSAGE_VALID / 1000)))) {
                //The timer should have expired. Clear the timer.
                funcs.mp.clearThrottle();
            }
            if (backoffTimer.timer !== 0 &&
                (((600 - secondsFromLastProcess) < 0) ||
                    ((backoffTimer.timeActivated + backoffTimer.milliseconds) < Date.now()))
            ) {
                //The backoff timer should have expired. Clear the timer.
                funcs.backoff.clear();
            }
        };

        funcs.mp.processAllIfTimeElapsed = () => {
            //If the minimum time between checks has expired, then process the messages.
            funcs.mp.sanityCheckTimers();
            if (messageProcessing.throttle === 0) {
                //The throttle has expired, update all questions, unless the tab is hidden.
                funcs.mp.processAllUnlessHidden();
            } else {
                //Inform the user that they have to wait.
                funcs.mp.addWaitingRequestInfoToPostsWithoutRequestInfo(false);
            }
        };

        funcs.mp.processAllUnlessHidden = () => {
            //Only update question status while the tab is not hidden
            if (!document.hidden) {
                funcs.mp.commitToProcessAllUnlessBackoffTimerActive();
            }
        };

        funcs.mp.commitToProcessAllUnlessBackoffTimerActive = () => {
            //Actually process all messages, without checking for reasons not to do so, except being disabled by use option.
            //Check if there is a backoff timer going.
            if (backoffTimer.timer !== 0) {
                //The backoff timer is still active. Wait for it to expire.
                return;
            }
            messageProcessing.isRequested = false;
            //Get the current options, in case there are no notifications of changes (e.g. Greasemonkey).
            funcs.config.restoreNonUi(config.nonUi);
            if (!config.nonUi.chatShowPostStatus) {
                //Don't actually process messages, as the user has selected not to display status on the chat page.
                return;
            }
            //Time-based auto-update
            if (messageProcessing.interval > 0) {
                //Clear any timeout scheduling auto-update.
                clearTimeout(messageProcessing.interval);
                messageProcessing.interval = 0;
            }
            //Prevent any processing until after this one completes. This is needed here because we have a
            // possible async delay prior to the messages actually being processed, but we are committed to
            // processing (unless significantly delayed).
            funcs.mp.preventAdditionalProcessingUntilComplete();
            //Process the messages
            funcs.mp.processAllMessageLinksIfMessagesValid();
            if (config.nonUi.chatAutoUpdateRate > 0) {
                messageProcessing.interval = setTimeout(funcs.mp.timedBased, config.nonUi.chatAutoUpdateRate * 60 * 1000);
            }
        };

        funcs.mp.processAllMessageLinksIfMessagesValid = (delayCount) => {
            //Delay processing if the message is invalid. Probably could just abort processing at this time and
            //  rely on the MutationObserver to start processing again once the message is valid. Alternately,
            //  these checks could be pushed back into the throttled MutationObserver, so updating is not even
            //  called until the messages are all valid.
            if (typeof delayCount !== 'number') {
                delayCount = 0;
            }
            //The period between when the message is added to the DOM and it is no longer "pending" can be upward of multiple seconds.
            const pending = document.querySelector('.messages > .message.pending');
            if (pending || [].slice.call(document.querySelectorAll('.message')).reverse().some((message) => funcs.getContentFromMessage(message) === null)) {
                delayCount++;
                //The message has not finished updating / is not yet valid.
                //Delay processing by 1000ms, but not more than 20 times (in case something is broken).
                if (delayCount <= MESSAGE_PROCESSING_DELAYED_ATTEMPTS) {
                    setTimeout(funcs.mp.processAllMessageLinksIfMessagesValid, MESSAGE_PROCESSING_DELAY_FOR_MESSAGE_VALID, delayCount);
                } else {
                    //This has been delayed enough times. Let it be retried after the normal throttle delay.
                    //  This will also clear the value set in funcs.mp.preventAdditionalProcessingUntilComplete().
                    funcs.mp.processAllMessageLinks();
                }
                return;
            } //else
            funcs.mp.processAllMessageLinks();
        };

        funcs.mp.addWaitingRequestInfoToPostsWithoutRequestInfo = (onlyQuestions) => {
            //Add a request-info that shows "wait" to the user. This indicates to the user that the
            //  question in the message was recognized.  It also explains what the maximum wait might be.
            //  Should consider adding the current amount of time.
            const requests = funcs.mp.generateRequestsForAllAppropriateMessages(onlyQuestions);
            MESSAGE_PROCESSING_REQUEST_TYPES.forEach((type) => {
                if (!requests[type] || !Array.isArray(requests[type])) {
                    return;
                } //else
                requests[type].forEach((request) => {
                    if (!request.msg.querySelector('.request-info')) {
                        //The message the request is for does not currently have a request-info, add a 'wait'.
                        funcs.mp.addRequestInfoWaitToMessage(request.msg, type);
                    }
                });
            });
        };

        funcs.mp.addRequestInfoWaitToMessage = (message, type) => {
            //Add a 'wait' request-info to a message.
            funcs.appendInfo(new funcs.mp.Request(message, -9999, type, true, messageProcessing.mostRecentRequestInfoTime), true);
        };

        funcs.mp.checkDone = (status) => {
            //All of the data is back from the SE API. Process that data.
            //Add request-info for all questions.
            const allRequests = status.open.concat(status.closed, status.deleted);
            if (allRequests.length > 0) {
                //There is at least some valid data. If there is none, then keep the old information, and don't post-process anything.
                //  With no valid data, just reset the processing timer, so we can try again after it expires.
                //Remember where the screen is scrolled to now.
                const scrollX = window.scrollX;
                const scrollY = window.scrollY;
                funcs.removeAllRequestInfo();
                for (const oRequest of allRequests) {
                    funcs.appendInfo(oRequest, true);
                }
                //Mark all the request-info that are not associated with an actual request.
                //XXX Searching in text (true) is for testing. This should not be left that way in release, as the
                // searches for requests will not find them due to limitations in the chat search capabilities, and how we
                // have to limit searches as a result.
                // Basically, this needs to wait for switching to using Chat Events, instead of the search interface.
                funcs.mp.markAllRequestInfoOnNonRequests(true);
                funcs.mp.markAllMessagesByRequestState();
                //All the basic question information has been added to each message. Generate some static information
                //  and update the page based on the stored configuration.
                funcs.doForAllMessages(funcs.sortMessageRequestInfoEntries);
                funcs.addMissingQuestionTags();
                funcs.fixN0kTagsInDeleteRequests();
                funcs.adjustAllBareUrlPostinksToHaveQuestionTitle();
                //Restore the original scroll location. This is done due to the possibility that there may be extra lines
                //  in the transcript added to display the request-info if the number of links exceeds the number of lines
                //  in a message. While this might disrupt things when that message is processed for the first time, it
                //  will keep the page from jumping around as new messages are added and that one is re-processed.
                // We should determine the location of the bottom, middle, or top
                // message and scroll such that it's in the same position.
                // No, determine the element under the cursor and scroll so that element is
                // still at the same location.  Basically, the size of the elements that are
                // in view may change, thus it may not be possible for there to be no
                // movement.  OTOH, a change in the size of old messages is unlikely, but
                // possible (e.g.  invalid del-pls changing state).
                window.scroll(scrollX, scrollY);
            }
            //Record when processing was complete
            messageProcessing.mostRecentRequestInfoTime = Date.now();
            //Throttle any requests.
            funcs.mp.resetThrottle();
        };

        funcs.mp.preventAdditionalProcessingUntilComplete = () => {
            //Indicate that there is a message processing throttle in process, but don't set a timeout to clear it
            if (messageProcessing.throttle !== MESSAGE_THROTTLE_PROCESSING_ACTIVE) {
                //Don't update the time activated if it is already throttled.
                messageProcessing.throttle = MESSAGE_THROTTLE_PROCESSING_ACTIVE;
                messageProcessing.throttleTimeActivated = Date.now();
            }
        };

        funcs.mp.resetThrottle = () => {
            //Throttle any requests to at most once every config.nonUi.chatMinimumUpdateDelay seconds, unless user clicks update, or switches away from tab and back (always update upon switching back).
            funcs.mp.clearThrottle();
            messageProcessing.throttle = setTimeout(funcs.mp.clearThrottleAndProcessAllIfScheduled, config.nonUi.chatMinimumUpdateDelay * 1000);
            messageProcessing.throttleTimeActivated = Date.now();
        };

        //Assign the function used on the chat/transcript pages for processing once to the property used to call it.
        funcs.mp.processPageOnce = funcs.mp.commitToProcessAllUnlessBackoffTimerActive;

        //UI for chat page
        if (typeof funcs.ui !== 'object') {
            funcs.ui = {};
        }

        funcs.ui.showHideMessagesPerUI = () => {
            //Empty. Exists to duplicate a function from the Search page.
        };

        funcs.ui.positionOptionDialog = () => {
            //This is handled with CSS on the Chat page.
            //  This empty function just allows us not to have to check for it's existence prior to executing it.
        };

        funcs.ui.createButton = (text, title, action) => {
            const button = document.createElement('button');
            button.className = 'button urrs-requests-button';
            button.textContent = text;
            button.title = title;
            button.addEventListener('click', action, false);
            return button;
        };

        funcs.ui.addButtonAfterStockButtons = (text, title, action) => {
            const knownButtons = [
                'sayit-button',
                'upload-file',
                'codify-button',
                'cancel-editing-button',
            ];
            const chatButton = document.getElementById('chat-buttons');
            let afterLastKnown = chatButton.lastElementChild;
            while (afterLastKnown && knownButtons.indexOf(afterLastKnown.id) === -1) {
                afterLastKnown = afterLastKnown.previousSibling;
            }
            afterLastKnown = afterLastKnown ? afterLastKnown.nextSibling : null;
            const newButton = funcs.ui.createButton(text, title, action);
            chatButton.insertBefore(newButton, afterLastKnown);
            chatButton.insertBefore(document.createTextNode(' '), afterLastKnown);
            return newButton;
        };

        funcs.ui.addButton = (text, title, action) => {
            //Add a button to the chatbox
            const nodes = {};
            nodes.scope = document.getElementById('chat-buttons');
            if (!nodes.scope) {
                return null;
            } //else
            nodes.scope.appendChild(document.createTextNode(' '));
            nodes.button = funcs.ui.createButton(text, title, action);
            nodes.scope.appendChild(nodes.button);
            nodes.scope.appendChild(document.createTextNode(' '));
            return nodes.button;
        };

        funcs.ui.addText = (text) => {
            //Append text to the chat button area.
            const nodes = {};
            nodes.scope = document.querySelector('#chat-buttons');
            if (!nodes.scope) {
                return;
            } //else
            nodes.scope.appendChild(document.createTextNode(' '));
            nodes.scope.appendChild(document.createTextNode(text));
            nodes.scope.appendChild(document.createTextNode(' '));
        };

        funcs.ui.addHtml = (htmlText) => {
            //Append HTML text to the chat button area.
            const nodes = {};
            nodes.scope = document.querySelector('#chat-buttons');
            if (!nodes.scope) {
                return;
            } //else
            nodes.scope.insertAdjacentHTML('beforeend', htmlText);
        };

        funcs.ui.addOptionsButton = () => {
            //Add "options" button to the non-search chat page.
            const openOptionsButton = funcs.ui.addButtonAfterStockButtons('⚙', 'Open Unclosed Request Review options dialog.', function(event) {
                funcs.ui.showOptions();
                event.target.blur();
            });
            if (openOptionsButton) {
                openOptionsButton.id = 'urrs-open-options-button';
            }
        };

        funcs.ui.addUpdateButton = () => {
            if (config.nonUi.chatShowPostStatus) {
                //Add an "update" button. Initially for testing, but users like control.
                //  Only add the button if question status is being shown. If not, there is no reason for "update".
                //XXX This needs to be updated when the delays change. Currently it is static.
                const updateButton = funcs.ui.addButtonAfterStockButtons('update', [
                    'Clicking this button will update the status displayed for questions & answers, if a new message with a question/answer has been added.',
                    ' If not, then you need to wait for at least a minute from the last update (per the SE API rules). Once clicked, when that minute has expired, it will update status.',
                    ' Post status is automatically updated when a new message is added with a question link, or you have switched away from this tab and switch back.',
                    ' For both of those, the maximum update rate can be set in the options dialog on the search page.',
                    ' The maximum auto-update rate is currently once every ' + config.nonUi.chatMinimumUpdateDelay + ' seconds (' + DEFAULT_MINIMUM_UPDATE_DELAY + ' seconds is the default).',
                    ' Post status is also updated on a timed basis.',
                    ' Currently, it auto-updates, regardless of any new questions being posted, every ' + config.nonUi.chatAutoUpdateRate + ' minute' + (config.nonUi.chatAutoUpdateRate === 1 ? '' : 's'),
                    ' (' + DEFAULT_AUTO_UPDATE_RATE + ' minutes is the default).',
                    ' None of the automatic updates occur when the tab this page is in is not visible, but an update will occur when you switch back to this tab.',
                ].join(''), (event) => {
                    //This may still be prevented by the backoff timer.
                    //The questions on Stack Apps explicitly cover that users should be prevented from performing the same request more often that
                    //  once per minute.
                    funcs.mp.clearThrottleAndProcessAllIfImmediatePermitted();
                    event.target.blur();
                });
                if (updateButton) {
                    updateButton.id = 'urrs-update-button';
                }
            }
        };

        funcs.ui.addSearchButtons = () => {
            funcs.ui.addHtml('<br/><span class="urrs-chat-input-search-span">Search:</span>');
            const chatButtonTd = document.querySelector('#chat-buttons');
            if (chatButtonTd) {
                //Adjust the chat buttons up a bit to leave the legal footer fully visible.
                chatButtonTd.style.paddingTop = '0';
            }

            //Add "cv- requests" button to the non-search chat page.
            let searchButton = funcs.ui.addButton('cv-', 'Open the cv-pls requests search page.', function(event) {
                GM.openInTab(window.location.origin + '/search?q=tagged%2Fcv&room=' + currentRoom + '&page=1&pagesize=100&sort=newest');
                event.target.blur();
            });
            if (searchButton) {
                searchButton.id = 'urrs-search-button-cv';
            }

            //Add "del- requests" button to the non-search chat page.
            searchButton = funcs.ui.addButton('del-', 'Open the del-pls requests search page.', function(event) {
                //Search for 'del', 'delv', 'delete' and 'dv' tags:
                GM.openInTab(window.location.origin + '/search?q=tagged%2Fdel+OR+tagged%2Fdelv+OR+tagged%2Fdelete+OR+tagged%2Fdv&user=&room=' + currentRoom + '&page=1&pagesize=100&sort=newest');
                event.target.blur();
            });
            if (searchButton) {
                searchButton.id = 'urrs-search-button-del';
            }

            //Add "reopen- requests" button to the non-search chat page.
            searchButton = funcs.ui.addButton('reopen-', 'Open the reopen-pls requests search page.', function(event) {
                //Search for 'reopen' tags:
                GM.openInTab(window.location.origin + '/search?q=tagged%2Freopen+OR+tagged%2Fre-open&room=' + currentRoom + '&page=1&pagesize=100&sort=newest');
                event.target.blur();
            });
            if (searchButton) {
                searchButton.id = 'urrs-search-button-reopen';
            }

            //Add "undel- requests" button to the non-search chat page.
            searchButton = funcs.ui.addButton('undel-', 'Open the undel-pls requests search page.', function(event) {
                //Search for 'undel' tags:
                GM.openInTab(window.location.origin + '/search?q=tagged%2Fundel+OR+tagged%2Fundelete+OR+tagged%2Fundelv&room=' + currentRoom + '&page=1&pagesize=100&sort=newest');
                event.target.blur();
            });
            if (searchButton) {
                searchButton.id = 'urrs-search-button-undel';
            }
        };

        funcs.ui.addOptionsDialog = () => {
            //Add the options dialog to the DOM
            document.body.insertBefore(funcs.ui.createOptionsDialog(), document.body.firstChild);
        };

        funcs.ui.addChatUI = () => {
            funcs.ui.addOptionsButton();
            funcs.ui.addUpdateButton();
            funcs.ui.addSearchButtons();
            funcs.ui.addOptionsDialog();
            funcs.ui.showHideUpdateButtonByConfig();
        };

        funcs.ui.showHideUpdateButtonByConfig = () => {
            const updateButton = document.getElementById('urrs-update-button');
            if (updateButton) {
                if (config.nonUi.chatShowUpdateButton) {
                    updateButton.style.display = '';
                } else {
                    updateButton.style.display = 'none';
                }
            }
        };

        //Use Message Processing checkDone for SE API result processing.
        funcs.checkDone = funcs.mp.checkDone;

        //Get the config
        funcs.config.setDefaults(config);
        funcs.config.restore(config);

        if (isChat) {
            funcs.ui.addChatUI();
        }

        //Remember which questions were visited
        //Restore the configuration, using defaults.
        funcs.visited.beginRememberingPostVisits();
        //Listen for requests to update the request-info
        window.addEventListener('urrs-Request-Info-update-desired', function() {
            funcs.mp.clearThrottleAndProcessAllIfImmediatePermitted();
        }, true);
        //Listen for requests to update the request-info
        window.addEventListener('urrs-Request-Info-update-immediate', function() {
            funcs.mp.clearThrottleAndProcessAll();
        }, true);

        funcs.addStylesToDOM('urrsChatOptionDialogStyles', [
            '#urrsOptionsDialogInner {',
            '    position: fixed;',
            '    height: auto;',
            '    top: 50px;',
            '    left: 50%;',
            '    transform: translateX(-50%);',
            '    -webkit-transform: translateX(-50%);',
            '    -ms-transform: translateX(-50%);',
            '}',
        ].join('\n'));
        funcs.addRequestStylesToDOM();
        funcs.ui.addSharedStylesToDOM();
        funcs.config.listenForConfigChangesIfPossible();
        if (config.nonUi.chatShowPostStatus) {
            funcs.addStylesToDOM('urrsChatStyles', [
                '#chat-body #container {',
                '    padding: 10px 35px 10px 10px;',
                '}',
            ].join('\n'));
            //If the element we are going to attach the MutationObserver to does not exist, then just process once.
            if (!document.getElementById('chat') || isSearch || isTranscript) {
                if (isSearch) {
                    //If this is a search page, then implement "OR".
                    funcs.orSearch.stageOneProcessing();
                } else {
                    funcs.mp.commitToProcessAllUnlessBackoffTimerActive();
                }
            } else {
                funcs.mmo.watchForNewMessages();
                //Visibility change is only watched to update messages.
                window.addEventListener('visibilitychange', () => {
                    if (!document.hidden) {
                        //Process immediately if permitted.
                        funcs.mp.clearThrottleAndProcessAllIfImmediatePermitted();
                    }
                });
            }
        }
    }
})();
