// ==UserScript==
// @name         Stack Exchange CV Request Generator
// @namespace    https://github.com/SO-Close-Vote-Reviewers/
// @version      1.4
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
        get: function(r) { return this[r]; }
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
        $.getScript('https://rawgit.com/SO-Close-Vote-Reviewers/UserScripts/master/SECloseVoteRequestGenerator.version.js',function(){
            console.log(VERSION,GM_info.script.version);
            if(isVersionNewer(VERSION,GM_info.script.version)) {
                var lastAcknowledgedVersion = getStorage('LastAcknowledgedVersion');
                if(lastAcknowledgedVersion != VERSION || force) {
                    if(confirm('A new version of The Close Vote Request Generator is available, would you like to install it now?'))
                        window.location.href = URL;
                    else
                        setStorage('LastAcknowledgedVersion',VERSION);
                }
            } else if(force) alert('No new version available');
        });
    }
    
    function sendRequest(roomURL,result) {            
        GM_xmlhttpRequest({
            method: 'GET',
            url: roomURL[0] + '/rooms/' + roomURL[1],
            onload: function(response) {
                var fkey = response.responseText.match(/hidden" value="([\dabcdef]{32})/)[1];
                if(!fkey) {
                    alert('Failed retrieving key, is the room URL valid?');
                    return false;
                }
                GM_xmlhttpRequest({
                    synchronous: true,
                    method: 'POST',
                    url: roomURL[0] + '/chats/' + roomURL[1] + '/messages/new',
                    headers: {'Content-Type': 'application/x-www-form-urlencoded'},
                    data: 'text=' + encodeURIComponent(result) + '&fkey=' + fkey,
                    onload: function() {
                        alert('Close vote request sent.');
                    },
                    onerror: function() {
                        alert('Failed sending close vote request.');
                    }
                });
            },
            onerror: function() {
                alert('Failed retrieving fkey from chat.');
            }
        });
    }
    
    function cvRequest() {
        if(!roomURL) {
            alert('Invalid room URL. Please set a valid room.');
            return false;
        }
        cvList.hide();
        var reason = window.prompt('Reason for closing'); 
        if(!reason) return false;
        if(reason.length === 1 && reasons.get(reason))
            reason = reasons.get(reason);
        var tit = '[' + $('#question-header h1 a').text() + '](' + base + $('#question .short-link').attr('href') + ')'; 
        var usr = '[' + $('#question .owner a').text() + '](' + base + $('#question .owner a').attr('href') + ')';
        var tim = $('#question .owner .relativetime').html();
        var result = '[tag:cv-pls] ' + reason + ' ' + tit + ' - ' + usr + ' ' + tim;
        sendRequest(roomURL,result);
    }
    
    function getRoom(room) {
        var m = /(http:\/\/chat\.(meta\.)?stack(overflow|exchange)\.com)\/rooms\/(.*)\/.*/.exec(room);
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

    var cvButton = $('<a href="javascript:void(0)" style="position:relative;display:inline-block">cv-pls</a>');
    var cvList = $('<dl style="display:none;position:absolute;white-space:nowrap;border:1px solid #eee;padding: 5px 10px;border-radius:3px;background:#FFF;box-shadow:0px 1px 5px -2px black"/>');
    var cvListRoom = $('<dd><a href="javascript:void(0)">Set target room</a>');
    var cvListSend = $('<dd><a href="javascript:void(0)">Send request</a>');
    var cvListUpdt = $('<dd><a href="javascript:void(0)">Check for updates</a>');
    var cvListSep = $('<dd style="border-bottom: 1px solid #eee;margin: 2.5px 0;"/>');

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
    
    $('a').not(cvButton).on('click',function(){
        if(cvList.is(':visible')) cvList.hide();
    });
    
    cvButton.on('click', function(e){ 
        e.stopPropagation();
        cvList.toggle(); 
    });
    
    cvListRoom.on('click',function(e){
        e.stopPropagation();
        cvList.hide();
        var response = window.prompt('Paste the URL of the room.', room);
        if(!response) return false;
        var roomURLt = getRoom(response);
        if(!roomURLt) {
            alert('Invalid room URL. Please set a valid room.');
            return false;
        }
        roomURL = roomURLt;
        setStorage(base + 'room', room = response);
    });
    
    cvListSend.on('click',function(e){
        e.stopPropagation();
        cvRequest();
    });
    
    cvListUpdt.on('click',function(e){
        e.stopPropagation();
        cvList.hide();
        checkUpdates(true);
    });
    
    $(document).keydown(function(e) {
        if(e.ctrlKey && e.shiftKey && e.which === 65)
            cvRequest();
    });
    
    checkUpdates();
    
})();
