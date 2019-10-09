// ==UserScript==
// @name           Stack Exchange CV Request Generator
// @namespace      https://github.com/SO-Close-Vote-Reviewers/
// @version        1.6.11
// @description    This script generates formatted close vote requests and sends them to a specified chat room.
// @author         @TinyGiant
// @contributor    @rene @Tunaki @Makyen @paulroub @machavity
// @include        /^https?:\/\/([^/.]+\.)*(stackexchange.com|stackoverflow.com|serverfault.com|superuser.com|askubuntu.com|stackapps.com|mathoverflow.net)\/(?:q(uestions)?\/\d+)/
// @exclude        *://chat.stackoverflow.com/*
// @exclude        *://chat.stackexchange.com/*
// @exclude        *://chat.*.stackexchange.com/*
// @exclude        *://api.*.stackexchange.com/*
// @exclude        *://data.stackexchange.com/*
// @require        https://code.jquery.com/jquery-2.1.4.min.js
// @require        https://github.com/SO-Close-Vote-Reviewers/UserScripts/raw/master/gm4-polyfill.js
// @connect        github.com
// @connect        raw.githubusercontent.com
// @connect        chat.stackoverflow.com
// @connect        chat.stackexchange.com
// @connect        chat.meta.stackexchange.com
// @grant          GM_xmlhttpRequest
// @grant          GM.xmlHttpRequest
// ==/UserScript==
/* globals $, StackExchange */

if(typeof StackExchange === "undefined")
    var StackExchange = unsafeWindow.StackExchange;

(function(){
    var isclosed = $(".close-question-link").data("isclosed");
    var isdeleted = $(".question .post-menu .deleted-post").length > 0;
    var alreadyPostedRequest = false;

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

    function SiteConfig(_name, _siteRegExp, _offTopicCloseReasons, _quickSubstitutions, _defaultRoom) {
        this.name = _name;
        this.siteRegExp = _siteRegExp;
        this.offTopicCloseReasons = _offTopicCloseReasons;
        //this.quickSubstitutions = _quickSubstitutions;
        this.quickSubstitutions = new QuickSubstitutions(_quickSubstitutions);
        this.defaultRoom = _defaultRoom;
    }

    //The quick substitutions are changed in the text a user types for their request reason.
    //  They are usually a single character, but can be more. As a single character, they need
    //  to stay away from anything the user is going to type as a single character. In particular,
    //  that means they need to not be "a".
    var defaultQuickSubstitutions = {
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
        //'c': '(not enough code to duplicate)',
        //'b': '(no desired behavior)',
        //'e': '(no specific problem or error)',
    }, defaultQuickSubstitutions), 'https://chat.stackoverflow.com/rooms/41570/so-close-vote-reviewers'));
    //Meta Stack Exchange
    configsForSites.push(new SiteConfig('Meta Stack Exchange', /^meta.stackexchange.com$/, Object.assign({
        5: 'Does not seek input or discussion',
        6: 'Cannot be reproduced',
        8: 'Not about Stack Exchange Network software',
        11: 'Specific to a single site',
    }, defaultOffTopicCloseReasonsWithoutOtherSite), Object.assign({
        'i': 'Does not seek input or discussion',
        'r': 'Cannot be reproduced',
        'n': 'Not about Stack Exchange Network software',
        's': 'Specific to a single site',
    }, defaultQuickSubstitutions), 'https://chat.meta.stackexchange.com/rooms/89/tavern-on-the-meta'));
    //Code Review Stack Exchange
    configsForSites.push(new SiteConfig('Code Review Stack Exchange', /^codereview.stackexchange.com$/, Object.assign({
        20: 'Lacks concrete context',
        23: 'Code not implemented or not working as intended',
        25: 'Authorship of code',
    }, defaultOffTopicCloseReasons), Object.assign({
        'c': 'Lacks concrete context',
        'i': 'Code not implemented or not working as intended',
        's': 'Authorship of code',
    }, defaultQuickSubstitutions), 'https://chat.stackexchange.com/rooms/85306/se-code-review-close-questions-room'));
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
    }, defaultQuickSubstitutions), 'https://chat.stackexchange.com/rooms/2165/crude'));

    //Default site configuration
    var currentSiteConfig = new SiteConfig('Default', /./, defaultOffTopicCloseReasons, defaultQuickSubstitutions, 'https://chat.stackexchange.com/rooms/11254/the-stack-exchange-network');

    //If we are not trying to be compatible with IE, then could use .find here.
    configsForSites.some(function(siteConfig) {
        if (siteConfig.siteRegExp.test(window.location.hostname)) {
            currentSiteConfig = siteConfig;
            return true;
        } // else
        return false;
    });

    var reasons = currentSiteConfig.quickSubstitutions;
    var offTopicCloseReasons = currentSiteConfig.offTopicCloseReasons;

    var URL = "https://github.com/SO-Close-Vote-Reviewers/UserScripts/raw/master/SECloseVoteRequestGenerator.user.js";
    var notifyint = 0;
    function notify(m,t) {
        var timeout;
        (function(i){
            if(StackExchange && StackExchange.notify && typeof StackExchange.notify.show === 'function') {
                var div = $('#notify-' + (i - 1));
                if(div.length) {
                    clearTimeout(timeout);
                    if(i > 1)StackExchange.notify.close(i-1);
                }
                StackExchange.notify.show(m,i);
                if(t) timeout = setTimeout(function(){
                    StackExchange.notify.close(i);
                },t);
            } else {
                alert('SOCVR Request Generator: ' + m);
            }
        })(++notifyint);
    }

    function isVersionNewer(proposed, current) {
        proposed = proposed.split(".");
        current = current.split(".");

        while (proposed.length < current.length) proposed.push("0");
        while (current.length < proposed.length) current.push("0");

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
        GM.xmlHttpRequest({
            method: 'GET',
            url: 'https://raw.githubusercontent.com/SO-Close-Vote-Reviewers/UserScripts/master/SECloseVoteRequestGenerator.version',
            onload: function(response) {
                var VERSION = response.responseText.trim();
                if(isVersionNewer(VERSION,GM.info.script.version)) {
                    var lastAcknowledgedVersion = getStorage('LastAcknowledgedVersion');
                    if(lastAcknowledgedVersion != VERSION || force) {
                        if(confirm('A new version of The Close Vote Request Generator is available, would you like to install it now?'))
                            window.location.href = URL;
                        else
                            setStorage('LastAcknowledgedVersion',VERSION);
                    }
                } else if(force) notify('No new version available');
            }
        });
    }

    function hideMenu() {
        closeTarget();
        $('div', CVRGUI.items.send).hide();
        CVRGUI.list.hide();
    }

    function sendRequest(request) {
        RoomList.getRoom(function(room){

            function displayRequestText (requestText, message) {
                message += '' +
                    '<br/><br/>' +
                    '<span>' +
                    '    Request text ' +
                    '    (<a href="#" class="SECVR-copy-to-clipboard" title="Click here to copy the request text to the clipboard.">copy</a>):' +
                    '</span>' +
                    '<br/>' +
                    '<textarea class="SECVR-request-text" style="width: 95%;">' +
                        requestText +
                    '</textarea>'+
                    '<br/>' +
                    '';
                notify(message);
                // Select the notification for Ctrl + C copy.
                var requestTextInput = $('textarea.SECVR-request-text').last();
                requestTextInput.select();
                // Bind a click handler on the "copy" anchor to copy the text manually.
                var copyButton = $('a.SECVR-copy-to-clipboard');
                var thisNotification = copyButton.closest('[id^="notify-"]').filter(function() {
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
                    if(!success) {
                        alert('Failed to copy the request text! Please copy it manually.');
                        //Restore the selection and focus. (not normally needed, but doesn't hurt)
                        requestTextInput.select();
                        requestTextInput.focus();
                        //The GUI is left open here because we don't have a way to determine if the user is actually
                        //  done with the request.
                    } else {
                        //Copy succeeded. Send another notification to cause the original notification to be dismissed.
                        //  This really should be handled by creating a function which dismisses the current notification.
                        notify('',10);
                        hideMenu();
                    }
                });
            }

            function handleError(message, error) {
                var seeConsole = '<br/>See the console for more details.';
                console.error(message, error);
                displayRequestText(request, message + seeConsole);
            }
            GM.xmlHttpRequest({
                method: 'GET',
                url: room.url,
                onload: function(response) {
                    var matches = response.responseText.match(/hidden" value="([\dabcdef]{32})/);
                    var fkey = matches ? matches[1] : '';
                    if(!fkey) {
                        handleError('responseText did not contain fkey. Is the room URL valid?', response);
                        return false;
                    } // else
                    GM.xmlHttpRequest({
                        method: 'POST',
                        url: room.host + '/chats/' + room.id + '/messages/new',
                        headers: {'Content-Type': 'application/x-www-form-urlencoded'},
                        data: 'text=' + encodeURIComponent(request) + '&fkey=' + fkey,
                        onload: function(newMessageResponse) {
                            if(newMessageResponse.status != 200) {
                                var responseText = newMessageResponse.responseText;
                                var shownResponseText = newMessageResponse.responseText.length < 100 ? ' ' + newMessageResponse.responseText : '';
                                handleError('Failed sending chat request message.' + shownResponseText, newMessageResponse);
                            } else {
                                alreadyPostedRequest = true;
                                notify('Close vote request sent.',1000);
                                hideMenu();
                            }
                        },
                        onerror: function(error) {
                            handleError('Got an error when sending chat request message.', error);
                        }
                    });
                },
                onerror: function(response) {
                    handleError('Failed to retrieve fkey from chat. (Error Code: ' + response.status + ')', response);
                }
            });
        });
    }

    function appendInfo() {
        if(getStorage('appendInfo') === "1") return true;
        return false;
    }

    if (isdeleted) {
      return;
    }

    var RoomList = {};
    RoomList.rooms = {};
    RoomList.save = function() {
        setStorage('rooms',JSON.stringify(this.rooms));
        console.log(getStorage('rooms'));
    };
    RoomList.each = function(callback) {
        for(var i in this.rooms)
            callback(this.rooms[i],i);
        return this;
    };
    RoomList.search = function(key,value) {
        var success;
        this.each(function(room){
            if(room[key] === value)
                success = room;
        });
        return success;
    };
    RoomList.count = function() {
        return Object.keys(this.rooms).length;
    };
    RoomList.name = function(name)  { return this.search('name',name);  };
    RoomList.index = function(name) { return this.search('index',name); };
    RoomList.id = function(name)    { return this.search('id',name);    };
    RoomList.url = function(url)    { return this.search('url',RoomList.useHttpsForStackExchangeAndTrim(url));};
    RoomList.insert = function(room) {
        if(!RoomList.url(room.url)) {
            this.rooms[room.url] = room;
            this.save();
        }
        return this.rooms[room.url];
    };
    RoomList.getRoom = function(callback,url) {
        var rooms = this.rooms;
        if(!url)
            url = getCurrentRoom();
        if(typeof callback !== 'function')
            callback = function() {};
        url = RoomList.useHttpsForStackExchangeAndTrim(url);
        var m = /^(https:\/\/chat\.(meta\.)?stack(overflow|exchange)\.com)\/rooms\/(\d+)\/.*$/.exec(url);
        if(m) {
            var room = RoomList.url(url);
            if(room) {
                callback(room);
                return false;
            }
            GM.xmlHttpRequest({
                method: 'GET',
                url: url,
                onload: function(response){
                    var name = /.*<title>(.*)\ \|.*/.exec(response.response);
                    if(!name) {
                        notify('Failed finding room name. Is it a valid room?');
                        callback(false);
                    } else {
                        callback(RoomList.insert({
                            host: m[1],
                            url: url,
                            id: m[4],
                            name: name[1]
                        }));
                    }
                },
                onerror: function(error){
                    console.log('error:', error);
                    notify('Failed retrieving room name. Is it a valid room?');
                    callback(false);
                }
            });
        } else {
            console.log(url);
            notify('The chat room URL you supplied is invalid.');
            callback(false);
        }
    };
    RoomList.setRoom = function(url) {
        var exists;
        url = RoomList.useHttpsForStackExchangeAndTrim(url);
        if(this.url(url))
            exists = true;
        RoomList.getRoom(function(room) {
            if(room && getCurrentRoom() !== room.url) {
                setCurrentRoom(room.url);
                CVRGUI.roomList.find('[type="checkbox"]').prop('checked',false);
                if(!exists)
                    CVRGUI.roomList.append($('<dd><label><input type="radio" name="target-room" value="' + room.url + '" checked>' + room.name + '</label><form><button>-</button></form></dd>'));
                else
                    CVRGUI.roomList.find('[value="' + room.url + '"]').prop('checked', true);
                closeTarget();
            }
        },url);
    };
    RoomList.init = function() {
        if(!getStorage('rooms'))
            RoomList.getRoom();
        else
            RoomList.rooms = JSON.parse(getStorage('rooms'));
    };
    RoomList.useHttpsForStackExchangeAndTrim = function(url) {
        //Change a SE/SO URL to HTTPS instead of HTTP.
        return /(https?:\/\/chat\.(meta\.)?stack(overflow|exchange)\.com)/.test(url) ? url.replace(/http:/ig, 'https:').replace(/(https:\/\/chat\.(?:meta\.)stack(?:exchange|overflow)\.com\/rooms\/\d+)\b.*$/ig, '$1/') : url;
    };
    RoomList.changeToHttpsForStackExchange = function() {
        //Just change the JSON (pass it through parse/stringify to remove any duplicates):
        // The RegExp is probably overly restrictive, as the rooms should never already contain non-stackexchange/stackoverflow URLs, as such are considered invalid.
        try {
            setStorage('rooms', JSON.stringify(JSON.parse(getStorage('rooms').replace(/http:\/\/chat\.(meta\.)?stack(exchange|overflow)\.com/ig, 'https://chat.$1stack$2.com').replace(/(https:\/\/chat\.(?:meta\.)?stack(?:exchange|overflow)\.com\/rooms\/\d+)\b[^"]*/ig, '$1/'))));
        } catch (e) {
            //No storage or Invalid JSON in 'rooms'
            setStorage('rooms', JSON.stringify({}));
        }
        var roomStorage = getCurrentRoom();
        roomStorage = roomStorage ? roomStorage : '';
        setCurrentRoom(RoomList.useHttpsForStackExchangeAndTrim(roomStorage));
    };


    //Wrap local storage access so that we avoid collisions with other scripts
    var prefix = "SECloseVoteRequestGenerator_"; //prefix to avoid clashes in localStorage
    function getStorage(key) { return localStorage[prefix + key]; }
    function setStorage(key, val) { return (localStorage[prefix + key] = val); }
    function getCurrentRoom(){ return getStorage(base + 'room'); }
    function setCurrentRoom(url){ return setStorage(base + 'room', url); }

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


    var base = 'https://' + window.location.hostname;

    if(!getCurrentRoom()) {
        setCurrentRoom(currentSiteConfig.defaultRoom);
    }
    //Change the localStorage to HTTPS prior to initializing the RoomList.
    RoomList.changeToHttpsForStackExchange();

    RoomList.init();

    var CVRGUI = {};
    CVRGUI.wrp    = $('<span class="cvrgui" />');
    CVRGUI.button = $('<a href="javascript:void(0)" class="cv-button">' + (isclosed?'reopen-pls':'cv-pls') + '</a>');
    CVRGUI.list   = $('<dl class="cv-list" />');
    CVRGUI.css    = $('<style>.post-menu > span > a,.post-menu .post-menu-container > span > a{padding:0 3px 2px 3px;color:#888}.post-menu > span > a:hover,.post-menu .post-menu-container > span > a:hover{color:#444;text-decoration:none} .cvrgui { display:inline-block } .cvrgui * { box-sizing: border-box } .cv-list { display: none; margin:0; z-index:1; position:absolute; white-space:nowrap; border:1px solid #ccc;border-radius:3px;background:#FFF;box-shadow:0px 5px 10px -5px rgb(0,0,0,0.5) } .cv-list dd, .cv-list dl { margin: 0; padding: 0; } .cv-list dl dd { padding: 0px; margin: 0; width: 100%; display: table } .cv-list dl label, .cv-list dl form { display: table-cell } .cv-list dl button { margin: 2.5px 0; } .cv-list dl label { width: 100%; padding: 0px; }  .cv-list * { vertical-align: middle; } .cv-list dd > div { padding: 0px 15px; padding-bottom: 15px; } .cv-list dd > div > form { white-space: nowrap } .cv-list dd > div > form > input { display: inline-block; vertical-align: middle } .cv-list dd > div > form > input[type="text"] { width: 300px; margin-right: 5px; } .cv-list hr { margin:0 15px; border: 0px; border-bottom: 1px solid #ccc; } .cv-list a { display: block; padding: 10px 15px;}  .cv-list label { display: inline-block; padding: 10px 15px;} .cv-list label:last-child { padding-left: 0; }</style>');
    CVRGUI.target = (function(){
        var link = $('<a href="javascript:void(0)"></a>').on('click',function(){
            var div = $('div', $(this).parent());
            $('div', CVRGUI.list).not(div).hide();
            if(div.is(':hidden')) {
                div.show().find('[type="text"]').focus();
                $(this).html('Set target room:');
            } else closeTarget();
        });
        RoomList.getRoom(function(room){
            link.html(room.name);
        });
        return link;
    })();
    function closeTarget() {
        RoomList.getRoom(function(room){ $(CVRGUI.target).html(room.name); });
        $('div', CVRGUI.items.room).hide();
        $('div', CVRGUI.items.send).show();
        $('input[type="text"]', CVRGUI.items.send).focus();
    }
    CVRGUI.items = {
        send:    $('<dd><a href="javascript:void(0)">Send request</a><div style="display:none"><form><input type="text" placeholder="Close reason"/><input type="submit" value="Send"></form></div><hr></dd>'),
        room:    (function(){
            var item = $('<dd></dd>');
            var list = $('<dl>');
            var div = $('<div style="display:none"/>');
            RoomList.getRoom(function(r){
                RoomList.each(function(room){
                    list.append($('<dd><label><input type="radio" name="target-room" value="' + room.url + '"' + (r.url === room.url ? ' checked' : '' ) + '>' + room.name + '</label><form><button>-</button></form></form></dd>'));
                });
                list.on('change',function(e){
                    RoomList.setRoom(e.target.value);
                });
                list.on('submit', function(e){
                    e.preventDefault();
                    var room = RoomList.url($('[name="target-room"]', $(e.target).parent()).val());
                    if(room) {
                        if(RoomList.count() === 1) {
                            notify('Cannot remove last room');
                            return false;
                        }
                        if($('[checked]', $(e.target).parent()).length) {
                            RoomList.setRoom($('input[name="target-room"]:not([value="' + room.url + '"])', list).val());
                        }
                        delete RoomList.rooms[room.url];
                        RoomList.save();
                        $(e.target).parent().remove();
                    }
                });
                div.append(list);
                div.append($('<form><input type="text"/><input type="submit" value="Set"></form>').on('submit',function(e) {
                    e.preventDefault();
                    var response = $('input[type="text"]', this).val();
                    if(!response) return false;
                    RoomList.setRoom(response);
                }));
                item.append(CVRGUI.target);
                item.append(div);
                item.append($('<hr>'));
                CVRGUI.roomList = list;
            });
            return item;
        })(),
        update:  $('<dd><a href="javascript:void(0)">Check for updates</a>   </dd>')
    };
    for(var item in CVRGUI.items) {
        CVRGUI.list.append(CVRGUI.items[item]);
    }
    CVRGUI.wrp.append(CVRGUI.button);
    CVRGUI.wrp.append(CVRGUI.list);
    CVRGUI.wrp.append(CVRGUI.css);

    var postMenuContainer = $('#question .post-menu .post-menu-container');
    if (!postMenuContainer.length) {
        postMenuContainer = $('#question .post-menu');
    }
    postMenuContainer.append(CVRGUI.wrp);

    $('.question').on('click', '[type="submit"], .new-post-activity a', function(e){
        var self = this;
        var menuCheck = setInterval(function(){
            var questionPostMenuContainer = $('#question .post-menu .post-menu-container');
            if (!questionPostMenuContainer.length) {
                questionPostMenuContainer = $('#question .post-menu');
            }
            if(questionPostMenuContainer.length === 1) {
                clearInterval(menuCheck);
                questionPostMenuContainer.append(CVRGUI.wrp);
            }
        });
    });

    $(document).on('click',function(){
        if(CVRGUI.list.is(':visible'))
            hideMenu();
    });

    $('a:not(.cvrgui a)').on('click',function(){
        if(CVRGUI.list.is(':visible'))
            hideMenu();
    });
    $('.cv-list *:not(a)').on('click',function(e){
        e.stopPropagation();
    });

    CVRGUI.button.on('click', function(e){
        e.stopPropagation();
        $('div', CVRGUI.list).hide();
        CVRGUI.list.toggle();
    });

    CVRGUI.items.send.on('click',function(e){
        e.stopPropagation();
        if($('div', CVRGUI.items.send).is(':hidden'))
            closeTarget();
        else $('div', CVRGUI.items.send).hide();
    });

    $('form', CVRGUI.items.send).on('submit',function(e){
        e.preventDefault();
        var reason = $('input[type="text"]', CVRGUI.items.send).val();
        if(!reason) return false;
        reason = reasons.get(reason);
        var title = createMarkdownLinkWithText($('#question-header h1 a').text().replace(/^\s+|\s+$/gm, ''), base + $('#question .js-share-link').attr('href').replace(/(\/\d+)\/\d+$/, '$1'));
        try {
            var user = $('.question .post-signature.owner:not([align="right"],#popup-close-question .post-signature) .user-details > *:not(.d-none):not(.-flair), .question .post-signature:not([align="right"],#popup-close-question .post-signature) .user-details .community-wiki').first().text().trim().match(/[^\n]+/)[0].trim();
        } catch (e) {
            user = '';
        }
        var userLink = $('#question .owner:not(#popup-close-question .owner) a');
        if(userLink.length && user) user = createMarkdownLinkWithText(user, base + userLink.attr('href'));
        var time = $('#question .owner:not(#popup-close-question .owner) .relativetime');
        time = time.length ? ' ' + time.attr('title') : '';
        var tag = $('#question a.post-tag').first().text(); //huh, sponsored tags have images =/ and off-topic tag like C++ are URL encoded -> get the text only
		// for duplicate cv-pls, when the dupe is selected, the mini-review messes up the selector for username and date: it is removed with :not
        var request = '[tag:'+ (isclosed?'reopen-pls':'cv-pls') +'] [tag:' + tag + '] ' + reason + ' ' + title + ' - ' + user + time;
        if(alreadyPostedRequest && !window.confirm('You\'ve already sent a request about this question. Do you want to send another?')) {
            return;
        } // else
        sendRequest(request);
    });

    CVRGUI.items.update.on('click',function(e){
        e.stopPropagation();
        hideMenu();
        checkUpdates(true);
    });

    var combo;
    $(document).keydown(function(e) {
        if(e.ctrlKey && e.shiftKey && e.which === 65) {
            e.preventDefault();
            combo = true;
        }
    });
    $(document).keyup(function(e) {
        if(combo) {
            combo = false;
            if($('div', CVRGUI.items.send).is(':hidden')) {
                CVRGUI.list.show();
                $('div', CVRGUI.items.send).show().find('input[type="text"]').focus();
            } else {
                hideMenu();
            }
        }
    });
    setTimeout(checkUpdates);
    $('.close-question-link').click(function(){
        var cpcheck = setInterval(function(){
            var popup = $('#popup-close-question'), selected, discard;
            if(!popup.length) return;
            clearInterval(cpcheck);
            var remainingvotes = $('.remaining-votes', popup);

            if($('input', remainingvotes).length) return false;

            if (currentSiteConfig.name === 'Default') {
                var offTopicInputs = $('.close-as-off-topic-pane input', popup);
                offTopicInputs.each(function() {
                    var value = this.value;
                    var thisParent = this.parentNode;
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
                        }
                        offTopicCloseReasons[value] = offTopicCloseReasons[value].replace(/\s+/, ' ').trim();
                        var parentText = thisParent.innerText;
                        if (!offTopicCloseReasons[value]) {
                            var matches = parentText.match(/"([^"]+)"/g);
                            if(matches) {
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

            $('.remaining-votes', popup).append(checkbox);
            $('[name="close-reason"]').change(function(){
               discard = this.checked && (selected = $(this)) && $('input[type="text"]', CVRGUI.items.send).val(this.value.replace(/(?!^)([A-Z])/g, ' $1'));
            });
            $('[name="close-as-off-topic-reason"]').change(function(){
               discard = this.checked && (selected = $(this)) && $('input[type="text"]', CVRGUI.items.send).val(offTopicCloseReasons[this.value]);
            });
            $('.popup-submit').click(function() {
                if(selected.val() === '3') {
                    var parent = selected.parent().parent();
                    $('input[type="text"]', CVRGUI.items.send).val($('textarea',parent).val().replace($('[type="hidden"]',parent).val(),''));
                }
                discard= checkbox.find('input').is(':checked') && $('form', CVRGUI.items.send).submit();
            });
        }, 100);
    });
})();
