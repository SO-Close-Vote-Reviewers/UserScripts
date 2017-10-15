// ==UserScript==
// @name           Stack Exchange CV Request Generator
// @namespace      https://github.com/SO-Close-Vote-Reviewers/
// @version        1.5.22
// @description    This script generates formatted close vote requests and sends them to a specified chat room, fixes #65
// @author         @TinyGiant
// @contributor    @rene @Tunaki
// @include        /^https?:\/\/\w*.?(stackexchange.com|stackoverflow.com|serverfault.com|superuser.com|askubuntu.com|stackapps.com|mathoverflow.net)\/q(uestions)?\/\d+/
// @require        https://code.jquery.com/jquery-2.1.4.min.js
// @connect        rawgit.com
// @connect        raw.githubusercontent.com
// @connect        chat.stackoverflow.com
// @connect        chat.stackexchange.com
// @grant          GM_xmlhttpRequest
// ==/UserScript==

if(typeof StackExchange === "undefined")
    var StackExchange = unsafeWindow.StackExchange;

(function(){
    var isclosed = $(".close-question-link").data("isclosed");

    var reasons = {
        't': 'too broad',
        'u': 'unclear',
        'p': 'pob',
        'd': 'duplicate',
        'm': 'no mcve',
        'r': 'no repro',
        's': 'superuser',
        'f': 'serverfault',
        'l': 'library/tool/resource',
        get: function(r) {
            var a = r.split(' ');
            a.forEach(function(v,i){
                a[i] = reasons.hasOwnProperty(v) && v !== 'get' ? reasons[v] : v;
            });
            return a.join(' ');
        }
    };

    var URL = "https://rawgit.com/SO-Close-Vote-Reviewers/UserScripts/master/SECloseVoteRequestGenerator.user.js";
    var notifyint = 0;
    function notify(m,t) {
        var timeout;
        (function(i){
            var div = $('#notify-' + (i - 1));
            if(div.length) {
                clearTimeout(timeout);
                if(i > 1)StackExchange.notify.close(i-1);
            }
            StackExchange.notify.show(m,i);
            if(t) timeout = setTimeout(function(){
                StackExchange.notify.close(i);
            },t);
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
        GM_xmlhttpRequest({
            method: 'GET',
            url: 'https://rawgit.com/SO-Close-Vote-Reviewers/UserScripts/master/SECloseVoteRequestGenerator.version',
            onload: function(response) {
                var VERSION = response.responseText.trim();
                if(isVersionNewer(VERSION,GM_info.script.version)) {
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

    function displayRequestText (requestText, message) {
        message += "" +
            "<br/><br/>" +
            "<span>"+
                "Request text "+
                "("+
                    "<a href='#' class='SECVR-copy-to-clipboard' title='Click here to copy the request text to the clipboard.'>"+
                        "copy"+
                    "</a>"+
                "):"+
            "</span>"+
            "<br/>"+
            "<textarea class='SECVR-request-text' style='width: 95%;'>" +
                requestText +
            "</textarea>"+
            "<br/>" +
            "";

        notify(message);

        // Select the notification for Ctrl + C copy.
        var requestTextInput = $("textarea.SECVR-request-text").last();
        requestTextInput.select();

        // Bind a click handler on the "copy" anchor to copy the text manually.
        $("a.SECVR-copy-to-clipboard").last().on("click", function() {
            requestTextInput.select();
            var success = document.execCommand("copy");

            if(!success) {
                alert("Failed to copy the request text! Please copy it manually.");

                setTimeout(function(elem) {
                    elem.select();
                    elem.focus();
                }, 100, requestTextInput);
            }
        });
    }

    function sendRequest(result) {
        RoomList.getRoom(function(room){
            GM_xmlhttpRequest({
                method: 'GET',
                url: room.url,
                onload: function(response) {
                    var fkey = response.responseText.match(/hidden" value="([\dabcdef]{32})/)[1];
                    if(!fkey) {
                        notify('Failed retrieving key, is the room URL valid?');
                        return false;
                    }
                    GM_xmlhttpRequest({
                        method: 'POST',
                        url: room.host + '/chats/' + room.id + '/messages/new',
                        headers: {'Content-Type': 'application/x-www-form-urlencoded'},
                        data: 'text=' + encodeURIComponent(result) + '&fkey=' + fkey,
                        onload: function() {
                            notify('Close vote request sent.',1000);
                            hideMenu();
                        },
                        onerror: function(err) {
                            hideMenu();
                            var message = "Failed to send close vote request. See the console for more details.";
                            console.error(message, err);
                            displayRequestText(result, message);
                        }
                    });
                },
                onerror: function(resp) {
                    var message = "Failed to retrieve fkey from chat. (Error Code: " + resp.status + ") See the console for more details.";
                    console.error(message, resp);
                    displayRequestText(result, message);
                }
            });
        });
    }

    function appendInfo() {
        if(getStorage('appendInfo') === "1") return true;
        return false;
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
    RoomList.url = function(name)   { return this.search('url',name);   };
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
            url = getStorage(base + 'room');
        var m = /(https?:\/\/chat\.(meta\.)?stack(overflow|exchange)\.com)\/rooms\/(.*)\/.*/.exec(url);
        if(m) {
            var room = RoomList.url(url);
            if(room) {
                if(callback) callback(room);
                return false;
            }
            GM_xmlhttpRequest({
                method: 'GET',
                url: url,
                onload: function(response){
                    var name = /.*<title>(.*)\ \|.*/.exec(response.response);
                    if(!name) {
                        notify('Failed finding room name. Is it a valid room?');
                        if(callback) callback(false);
                    } else {
                        if(callback) callback(RoomList.insert({
                            host: m[1],
                            url: url,
                            id: m[4],
                            name: name[1]
                        }));
                    }
                },
                onerror: function(){
                    notify('Failed retrieving room name. Is it a valid room?');
                    if(callback) callback(false);
                }
            });
        } else {
            console.log(url);
            notify('The chat room URL you supplied is invalid.');
            if(callback) callback(false);
        }
    };
    RoomList.setRoom = function(url) {
        var exists;
        if(this.url(url))
            exists = true;
        RoomList.getRoom(function(room) {
            if(room && getStorage(base + 'room') !== room.url) {
                setStorage(base + 'room',room.url);
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

    //Wrap local storage access so that we avoid collisions with other scripts
    var prefix = "SECloseVoteRequestGenerator_"; //prefix to avoid clashes in localstorage
    function getStorage(key) { return localStorage[prefix + key]; }
    function setStorage(key, val) { return (localStorage[prefix + key] = val); }

    var base = 'https://' + window.location.hostname;

    if(!getStorage(base + 'room'))
        setStorage(base + 'room', 'http://chat.stackoverflow.com/rooms/41570/so-close-vote-reviewers');

    RoomList.init();

    var CVRGUI = {};
    CVRGUI.wrp    = $('<span class="cvrgui" />');
    CVRGUI.button = $('<a href="javascript:void(0)" class="cv-button">' + (isclosed?'reopen-pls':'cv-pls') + '</a>');
    CVRGUI.list   = $('<dl class="cv-list" />');
    CVRGUI.css    = $('<style>.post-menu > span > a{padding:0 3px 2px 3px;color:#888}.post-menu > span > a:hover{color:#444;text-decoration:none} .cvrgui { position:relative;display:inline-block } .cvrgui * { box-sizing: border-box } .cv-list { display: none; margin:0; z-index:1; position:absolute; white-space:nowrap; border:1px solid #ccc;border-radius:3px;background:#FFF;box-shadow:0px 5px 10px -5px rgb(0,0,0,0.5) } .cv-list dd, .cv-list dl { margin: 0; padding: 0; } .cv-list dl dd { padding: 0px; margin: 0; width: 100%; display: table } .cv-list dl label, .cv-list dl form { display: table-cell } .cv-list dl button { margin: 2.5px 0; } .cv-list dl label { width: 100%; padding: 0px; }  .cv-list * { vertical-align: middle; } .cv-list dd > div { padding: 0px 15px; padding-bottom: 15px; } .cv-list dd > div > form { white-space: nowrap } .cv-list dd > div > form > input { display: inline-block; vertical-align: middle } .cv-list dd > div > form > input[type="text"] { width: 300px; margin-right: 5px; } .cv-list hr { margin:0 15px; border: 0px; border-bottom: 1px solid #ccc; } .cv-list a { display: block; padding: 10px 15px;}  .cv-list label { display: inline-block; padding: 10px 15px;} .cv-list label:last-child { padding-left: 0; }</style>');
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
    CVRGUI.items  = {
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

    $('#question .post-menu').append(CVRGUI.wrp);

    $('.question').on('click', '[type="submit"], .new-post-activity a', function(e){
        var self = this;
        var menuCheck = setInterval(function(){
            if($('#question .post-menu').length === 1) {
                clearInterval(menuCheck);
                $('#question .post-menu').append(CVRGUI.wrp);
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
        var tit = '[' + $('#question-header h1 a').text().replace(/(\[|\])/g, '\\$1').replace(/^\s+|\s+$/gm, '') + '](' + base + $('#question .short-link').attr('href') + ')';
        var usr = $('.post-signature:not([align="right"],#popup-close-question .post-signature) .user-details').text().trim().match(/[^\n]+/)[0].trim(), tim;
        var tag = $('#question a.post-tag').first().text(); //huh, sponsored tags have images =/ and off-topic tag like C++ are URL encoded -> get the text only
		// for duplicate cv-pls, when the dupe is selected, the mini-review messes up the selector for username and date: it is removed with :not
        if($('#question .owner:not(#popup-close-question .owner) a').length) usr = '[' + usr + '](' + base + $('#question .owner:not(#popup-close-question .owner) a').attr('href') + ')';
        if($('#question .owner:not(#popup-close-question .owner) .relativetime').length) tim = $('#question .owner:not(#popup-close-question .owner) .relativetime').attr('title');
        var result = '[tag:'+ (isclosed?'reopen-pls':'cv-pls') +'] [tag:' + tag + '] ' + reason + ' ' + tit + ' - ' + usr + (tim ? '\u200E - ' + tim : ''); //username can be RTL... need to insert a LTR marker to have proper direction
        sendRequest(result);
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
    var closereasons = {
        4: "General Computing",
        7: "Serverfault.com",
        16: "Request for Off-Site Resource",
        13: "No MCVE",
        11: "Typo or Cannot Reproduce",
        3: "custom",
        2: "Belongs on another site"
    };
    $('.close-question-link').click(function(){
        var cpcheck = setInterval(function(){
            var popup = $('#popup-close-question'), selected, discard;
            if(!popup.length) return;
            clearInterval(cpcheck);
            var remainingvotes = $('.remaining-votes', popup);

            if($('input', remainingvotes).length) return false;

            var checkbox = $('<label><input type="checkbox" style="vertical-align:middle;margin-left: 5px;">Send cv-pls request</label>');

            $('.remaining-votes', popup).append(checkbox);
            $('[name="close-reason"]').change(function(){
               discard = this.checked && (selected = $(this)) && $('input[type="text"]', CVRGUI.items.send).val(this.value.replace(/(?!^)([A-Z])/g, ' $1'));
            });
            $('[name="close-as-off-topic-reason"]').change(function(){
               discard = this.checked && (selected = $(this)) && $('input[type="text"]', CVRGUI.items.send).val(closereasons[this.value]);
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
