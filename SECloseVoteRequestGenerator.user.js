// ==UserScript==
// @name         Stack Exchange CV Request Generator
// @namespace    https://github.com/SO-Close-Vote-Reviewers/
// @version      1.4.3
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

(function(){
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
                //console.log(GM_info.script.version,VERSION);
                if(isVersionNewer(VERSION,GM_info.script.version)) {
                    var lastAcknowledgedVersion = getStorage('LastAcknowledgedVersion');
                    if(lastAcknowledgedVersion != VERSION || force) {
                        if(confirm('A new version of The Close Vote Request Generator is available, would you like to install it now?'))
                            window.location.href = URL;
                        else
                            setStorage('LastAcknowledgedVersion',VERSION);
                    }
                } else if(force) alert('No new version available');
            }
        });
    }

    function sendRequest(roomURL,result) {            
        GM_xmlhttpRequest({
            method: 'GET',
            url: roomURL[0] + '/rooms/' + roomURL[1],
            onload: function(response) {
                var fkey = response.responseText.match(/hidden" value="([\dabcdef]{32})/)[1];
                if(!fkey) {
                    StackExchange.notify.show('Failed retrieving key, is the room URL valid?',1);
                    return false;
                }
                GM_xmlhttpRequest({
                    synchronous: true,
                    method: 'POST',
                    url: roomURL[0] + '/chats/' + roomURL[1] + '/messages/new',
                    headers: {'Content-Type': 'application/x-www-form-urlencoded'},
                    data: 'text=' + encodeURIComponent(result) + '&fkey=' + fkey,
                    onload: function() {
                        StackExchange.notify.show('Close vote request sent.',1);
                        spinner.remove();
                        $('div', cvList).hide();
                        cvList.hide();
                    },
                    onerror: function() {
                        StackExchange.notify.show('Failed sending close vote request.',1);
                        spinner.remove();
                        $('div', cvList).hide();
                        cvList.hide();
                    }
                });
            },
            onerror: function() {
                StackExchange.notify.show('Failed retrieving fkey from chat.',1);
            }
        });
    }


    function getRoom(room) {
        var m = /(https?:\/\/chat\.(meta\.)?stack(overflow|exchange)\.com)\/rooms\/(.*)\/.*/.exec(room);
        if(m) return [m[1],m[4]];
        return false;
    }

    //Wrap local storage access so that we avoid collisions with other scripts
    var prefix = "SECloseVoteRequestGenerator_"; //prefix to avoid clashes in localstorage
    function getStorage(key) { return localStorage[prefix + key]; }
    function setStorage(key, val) { return (localStorage[prefix + key] = val); }

    var base = 'http://' + window.location.hostname;

    if(!getStorage(base + 'room'))
        setStorage(base + 'room', 'http://chat.stackoverflow.com/rooms/41570/so-close-vote-reviewers');

    var room = getStorage(base + 'room');
    var roomURL = getRoom(room);

    var spinner = $('<img src="http://i.imgur.com/vrjXpiS.gifv">');
    var style      = $('<style>.cv-button { position:relative;display:inline-block } .cv-list { display:none;position:absolute;white-space:nowrap;border:1px solid #eee;padding: 7.5px;border-radius:3px;background:#FFF;box-shadow:0px 1px 5px -2px black } .cv-list dd { margin: 5px; } .cv-list-sep { border-bottom: 1px solid #eee;margin: 2.5px 0 } .cv-list a { display: block; } .cv-list input { display: inline-block; vertical-align: middle; } .cv-list input:first-child { margin-right: 5px; } .cv-list a div:focus { display: block }</style>');
    var cvButton   = $('<a href="javascript:void(0)" class="cv-button">cv-pls</a>');
    var cvList     = $('<dl class="cv-list" />');
    var cvListRoom = $('<dd><a href="javascript:void(0)">Set target room</a><div style="display:none"><form><input type="text"/><input type="submit"></form></div></dd>');
    var cvListSend = $('<dd><a href="javascript:void(0)">Send request</a><div style="display:none"><form><input type="text"/><input type="submit"></form></div></dd>');
    var cvListUpdt = $('<dd><a href="javascript:void(0)">Check for updates</a></dd>');
    var cvListSep  = $('<dd class="cv-list-sep"/>');

    cvList.append(style);
    cvList.append(cvListRoom);
    cvList.append(cvListSep.clone());
    cvList.append(cvListSend);
    cvList.append(cvListSep.clone());
    cvList.append(cvListUpdt);
    cvButton.append(cvList);
    $('#question .post-menu').append(cvButton);

    $(document).on('click',function(){
        if(cvList.is(':visible'))
            cvList.hide();
    });

    $('a:not(.cv-button,.cv-button a)').on('click',function(){
        if(cvList.is(':visible')) cvList.hide();
    });
    $('.cv-list *:not(a)').on('click',function(e){
        e.stopPropagation();
    });

    cvButton.on('click', function(e){ 
        e.stopPropagation();
        cvList.toggle(); 
        $('div', cvList).hide();
    });

    cvListRoom.on('click',function(e){
        e.stopPropagation();
        var div = $('div', this).toggle();
        $('div', cvList).not(div).hide();
        $('input[type="text"]', this).val(getStorage(base + 'room'));
        if(div.is(':visible')) $('input[type="text"]', div).focus();
    });
    $('form', cvListRoom).on('submit',function(e) {
        e.preventDefault();
        var response = $('input[type="text"]', this).val();
        console.log(response);
        if(!response) return false;
        var roomURLt = getRoom(response);
        if(!roomURLt) {
            StackExchange.notify.show('Invalid room URL. Please set a valid room.');
            return false;
        }
        roomURL = roomURLt;
        setStorage(base + 'room', room = response);
    });

    cvListSend.on('click',function(e){
        e.stopPropagation();
        var div = $('div', this).toggle();
        $('div', cvList).not(div).hide();
        if(div.is(':visible')) $('input[type="text"]', div).focus();
    });

    $('form', cvListSend).on('submit',function(e){
        e.preventDefault();
        $('div', this).append(spinner);
        if(!roomURL) {
            StackExchange.notify.show('Invalid room URL. Please set a valid room.');
            return false;
        }
        var reason = $('input[type="text"]', cvListSend).val();
        if(!reason) return false;
        reason = reasons.get(reason);
        var tit = '[' + $('#question-header h1 a').text() + '](' + base + $('#question .short-link').attr('href') + ')'; 
        var usr = '[' + $('#question .owner a').text() + '](' + base + $('#question .owner a').attr('href') + ')';
        var tim = $('#question .owner .relativetime').html();
        var result = '[tag:cv-pls] ' + reason + ' ' + tit + ' - ' + usr + ' ' + tim;
        sendRequest(roomURL,result);
    });
    $('input[type="text"]', cvListRoom).on('focus', function(){
        $(this).select();
    });

    cvListUpdt.on('click',function(e){
        e.stopPropagation();
        cvList.hide();
        checkUpdates(true);
    });

    $(document).keyup(function(e) {
        if(e.ctrlKey && e.shiftKey && e.which === 65) {
            cvList.show();
            cvListSend.click();
        } 
    });

    checkUpdates();
})();
