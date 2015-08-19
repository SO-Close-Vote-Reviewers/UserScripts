// ==UserScript==
// @name         Stack Exchange CV Request Generator
// @namespace    https://github.com/SO-Close-Vote-Reviewers/
// @version      1.4.7
// @description  This script generates formatted close vote requests and sends them to a specified chat room
// @author       @TinyGiant
// @match        http://*.stackoverflow.com/questions/*
// @match        http://*.stackexchange.com/questions/*
// @match        http://*.stackoverflow.com/questions/*
// @match        http://*.serverfault.com/questions/*
// @match        http://*.superuser.com/questions/*
// @match        http://*.askubuntu.com/questions/*
// @match        http://*.stackapps.com/questions/*
// @match        http://*.mathoverflow.net/questions/*
// @exclude      http://*.stackoverflow.com/questions/tagged/*
// @exclude      http://*.stackexchange.com/questions/tagged/*
// @exclude      http://*.stackoverflow.com/questions/tagged/*
// @exclude      http://*.serverfault.com/questions/tagged/*
// @exclude      http://*.superuser.com/questions/tagged/*
// @exclude      http://*.askubuntu.com/questions/tagged/*
// @exclude      http://*.stackapps.com/questions/tagged/*
// @exclude      http://*.mathoverflow.net/questions/tagged/*
// @require      https://code.jquery.com/jquery-2.1.4.min.js
// @grant        GM_xmlhttpRequest
// ==/UserScript==

StackExchange.ready(function(){
    "use strict";
    
    var reasons = {
        't': 'too broad', 
        'u': 'unclear',
        'p': 'pob', 
        'd': 'duplicate',
        'm': 'no mcve',
        'r': 'no repro',
        's': 'superuser',
        'f': 'serverfault',
        get: function(r) { return r.length === 1 && this[r] ? this[r] : r; }
    };

    var URL = "https://rawgit.com/SO-Close-Vote-Reviewers/UserScripts/master/SECloseVoteRequestGenerator.user.js";
    function notify(m,t) {
        var timeout;
        if(getStorage('notifyStyle') === 'fancy') {
            clearTimeout(timeout);
            StackExchange.notify.close(1);
            StackExchange.notify.show(m,1);
            if(t) timeout = setTimeout(function(){
                StackExchange.notify.close(1);
            },t);
        } else {
            alert(m);
        }
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
        $('div', CVRGUI.list).hide();
        CVRGUI.list.hide();

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
                        synchronous: true,
                        method: 'POST',
                        url: room.host + '/chats/' + room.id + '/messages/new',
                        headers: {'Content-Type': 'application/x-www-form-urlencoded'},
                        data: 'text=' + encodeURIComponent(result) + '&fkey=' + fkey,
                        onload: function() {
                            notify('Close vote request sent.',1000);
                            hideMenu();
                        },
                        onerror: function() {
                            notify('Failed sending close vote request.');
                            hideMenu();
                        }
                    });
                },
                onerror: function() {
                    notify('Failed retrieving fkey from chat.');
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
        var rooms = {}
        this.each(function(room,i){
            delete room.rooms;
            rooms[i] = room;
        });
        return setStorage('rooms',JSON.stringify(rooms));
    };
    RoomList.each = function(callback) {
        for(var i in this.rooms)
            callback(this.rooms[i],i);
        return this;
    };
    RoomList.spread = function(index) {
        this.each(function(room){
            if(room.index >= index)
                ++room.index;
        });
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
        var count = 1;
        this.each(function() { ++count; });
        return count;
    };
    RoomList.name = function(name)  { return this.search('name',name);  };
    RoomList.index = function(name) { return this.search('index',name); };
    RoomList.id = function(name)    { return this.search('id',name);    };
    RoomList.url = function(name)   { return this.search('url',name);   };
    RoomList.insert = function(room,index) {
        if(!index)
            index = this.count();
        room.index = index;
        if(RoomList.index(index))
            this.spread(index);
        room.rooms = this.rooms;
        this.rooms[room.url] = room;
        this.save();
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
                callback(room);
                return false;
            }
            GM_xmlhttpRequest({
                method: 'GET',
                url: url,
                synchronous: true,
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
                            name: name[1],
                            rooms: rooms
                        }));
                    }
                },
                onerror: function(){
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
        if(this.url(url))
            exists = true;
        RoomList.getRoom(function(room) {
            if(room && getStorage(base + 'room') !== room.url) {
                setStorage(base + 'room',room.url);
                CVRGUI.roomList.find('input[type="checkbox"]').prop('checked',false);
                if(!exists)
                    CVRGUI.roomList.append($('<dd><label><input type="radio" name="target-room" value="' + room.url + '" checked>' + room.name + '</label><form><button value="' + room.url + '">-</button></form></dd>'));
                else
                    CVRGUI.roomList.find('[value="' + room.url + '"]').prop('checked', true);
                notify('Target room changed to ' + room.name,2500);
                //$('div', CVRGUI.room).hide();
            }
        },url);
    };
    RoomList.init = function() {
        try {
            var rooms = getStorage('rooms');
            if(rooms) {
                this.rooms = JSON.parse(getStorage('rooms'));
                this.each(function(room){ room.rooms = this.rooms; });
            }
            this.getRoom(function(room) {
                if(room)
                    this.rooms = room.rooms;
            });
        } catch(e) {
            console.log(e);
        }
    };

    //Wrap local storage access so that we avoid collisions with other scripts
    var prefix = "SECloseVoteRequestGenerator_"; //prefix to avoid clashes in localstorage
    function getStorage(key) { return localStorage[prefix + key]; }
    function setStorage(key, val) { return (localStorage[prefix + key] = val); }

    try {
        var base = 'http://' + window.location.hostname;

        if(!getStorage(base + 'room'))
            setStorage(base + 'room', 'http://chat.stackoverflow.com/rooms/41570/so-close-vote-reviewers');

        if(!getStorage('appendInfo'))
            setStorage('appendInfo', 1);

        if(!getStorage('notifyStyle'))
            setStorage('notifyStyle', 'fancy');

        RoomList.init();

        var CVRGUI = {};
        CVRGUI.wrp    = $('<span class="cvrgui" />');
        CVRGUI.button = $('<a href="javascript:void(0)" class="cv-button">cv-pls</a>');
        CVRGUI.list   = $('<dl class="cv-list" />');
        CVRGUI.css    = $('<style>.cvrgui { position:relative;display:inline-block } .cvrgui * { box-sizing: border-box } .cv-list { display: none; margin:0; z-index:1; position:absolute; white-space:nowrap; border:1px solid #ccc;border-radius:3px;background:#FFF;box-shadow:0px 5px 10px -5px rgb(0,0,0,0.5) } .cv-list dd, .cv-list dl { margin: 0; padding: 0; } .cv-list dl dd { padding: 0px; margin: 0; width: 100%; display: table } .cv-list dl label, .cv-list dl button { display: table-cell } .cv-list dl button { margin: 2.5px 0; } .cv-list dl label { width: 100%; padding: 0px; }  .cv-list * { vertical-align: middle; } .cv-list dd > div { padding: 0px 15px; padding-bottom: 15px; } .cv-list dd > div > form { white-space: nowrap } .cv-list dd > div > form > input { display: inline-block; vertical-align: middle } .cv-list dd > div > form > input[type="text"] { width: 300px; margin-right: 5px; } .cv-list hr { margin:0 15px; } .cv-list a { display: block; padding: 10px 15px;}  .cv-list label { display: inline-block; padding: 10px 15px;} .cv-list label:last-child { padding-left: 0; }</style>');
        CVRGUI.items  = {
            room:    (function(){
                var item = $('<dd></dd>');
                var list = $('<dl>');
                var div = $('<div style="display:none"/>');
                RoomList.getRoom(function(r){
                    RoomList.each(function(room){
                        list.append($('<dd><label><input type="radio" name="target-room" value="' + room.url + '"' + (r.url === room.url ? ' checked' : '' ) + '>' + room.name + '</label><form><button value="' + room.url + '">-</button></form></dd>'));
                    });
                    list.on('change',function(e){
                        RoomList.setRoom(e.target.value);
                    });
                    list.on('submit',function(e){
                        e.preventDefault();
                        var value = $('button', e.target).val();
                        var room = RoomList.url(value);
                        if($(':selected', $(e.target).parent()).length) {
                            if(RoomList.count() === 1) {
                                notify('Cannot remove last room');
                                return false;
                            }
                            $('input[name="target-room"]:not([value="' + room.url + '"])').eq(0).prop('checked',true);
                        }
                        if(room) {
                            delete RoomList.rooms[room.url];
                            RoomList.save();
                            console.log(RoomList.rooms);
                        }
                        $(e.target).parent().remove();
                    });
                    div.append(list);
                    div.append($('<form><input type="text"/><input type="submit" value="Set"></form>').on('submit',function(e) {
                        e.preventDefault();
                        var response = $('input[type="text"]', this).val();
                        if(!response) return false;
                        RoomList.setRoom(response);
                    }));
                    (function(div){
                        item.append($('<a href="javascript:void(0)">Set target room</a>').on('click',function(e){
                            e.stopPropagation();
                            div.toggle();
                            $('div', CVRGUI.list).not(div).hide();
                            if(div.is(':visible')) $('input[type="text"]', div).focus();
                        }));
                    })(div);
                    item.append(div);
                    item.append($('<hr>'));
                    CVRGUI.roomList = list;
                });
                return item;
            })(),
            send:    $('<dd><a href="javascript:void(0)">Send request</a><div style="display:none"><form><input type="text"/><input type="submit" value="Send"></form></div><hr></dd>'),
            update:  $('<dd><a href="javascript:void(0)">Check for updates</a><hr></dd>'),
            stamp:   $('<dd><label><input type="checkbox"' + (appendInfo() ? ' checked' : '') + '>Append user / time</label><hr></dd>'),
            notify:  $('<dd><label><input type="radio" name="notify-style" value="classic"' + (getStorage('notifyStyle') === 'classic' ? ' checked' : '') + '>Classic</label><label><input type="radio" name="notify-style" value="fancy"' + (getStorage('notifyStyle') === 'fancy' ? ' checked' : '') + '>Fancy</label></dd>')
        };
        for(var item in CVRGUI.items) {
            CVRGUI.list.append(CVRGUI.items[item]);
        }
        CVRGUI.wrp.append(CVRGUI.button);
        CVRGUI.wrp.append(CVRGUI.list);
        CVRGUI.wrp.append(CVRGUI.css);

        $('#question .post-menu').append(CVRGUI.wrp);
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
            if(getStorage('notifyStyle') === 'fancy') {
                var div = $('div', this).toggle();
                $('div', CVRGUI.list).not(div).hide();
                if(div.is(':visible')) $('input[type="text"]', div).focus();
            } else {
                $('input[type="text"]', CVRGUI.items.send).val(prompt('Please enter reason'));
                $('form', CVRGUI.items.send).submit();
            }
        });

        $('form', CVRGUI.items.send).on('submit',function(e){
            e.preventDefault();
            var reason = $('input[type="text"]', CVRGUI.items.send).val();
            if(!reason) return false;
            reason = reasons.get(reason);
            var tit = '[' + $('#question-header h1 a').text() + '](' + base + $('#question .short-link').attr('href') + ')'; 
            var result = '[tag:cv-pls] ' + reason + ' ' + tit;
            if(appendInfo()) {
                var usr = '[' + $('#question .owner a').text() + '](' + base + $('#question .owner a').attr('href') + ')';
                var tim = $('#question .owner .relativetime').html();
                result += ' - ' + usr + ' ' + tim;
            }
            sendRequest(result);
        });
        $('input[type="text"]', CVRGUI.items.room).on('focus', function(){
            $(this).select();
        });

        CVRGUI.items.update.on('click',function(e){
            e.stopPropagation();
            hideMenu();
            checkUpdates(true);
        });

        CVRGUI.items.stamp.on('change','#append-info',function(e) {
            e.stopPropagation();
            setStorage('appendInfo',(e.target.checked ? 1 : 2));
        });

        $('input', CVRGUI.items.notify).on('change',function(){
            setStorage('notifyStyle',this.value);
            if(this.value === 'classic')
                $('div', CVRGUI.list).hide();
        });

        var combo;
        $(document).keydown(function(e) {
            if(e.ctrlKey && e.shiftKey && e.which === 65)
                combo = true;
        });
        $(document).keyup(function() {
            if(combo) {
                combo = false;
                if(getStorage('notifyStyle') === 'fancy') {
                    if($('div', CVRGUI.items.send).is(':hidden')) {
                        CVRGUI.list.show();
                        $('div', CVRGUI.items.send).show().find('input[type="text"]').focus();
                    } else {
                        hideMenu();
                    }
                } else {
                    $('input[type="text"]', CVRGUI.items.send).val(prompt('Please enter reason'));
                    $('form', CVRGUI.items.send).submit();
                }
            } 
        });
        setTimeout(checkUpdates);
    } catch(exception) {  console.log(exception); }
});
