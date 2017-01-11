// ==UserScript==
// @name         Show Timeout in Chat for mods and RO's
// @namespace    http://stackoverflow.com/users/578411/rene
// @version      0.1
// @description  show a timeout message for RO's and mods
// @author       rene
// @match        *://chat.stackoverflow.com/rooms/*
// @match        *://chat.stackexchange.com/rooms/*
// @match        *://chat.meta.stackexchange.com/rooms/*
// @grant        none
// ==/UserScript==

(function() {
    'use strict';

    var MS = 10000, // 10 seconds
        cb=$('#chat-buttons'),
        todiv = $('<div></div>'),
        timer,
        room = /.+\/rooms\/(\d+)/.exec(window.location.href)[1];

    cb.append(todiv);
    todiv.hide();

    function giantS(num, text) {
        return num === 1 ? text : text + 's';
    }

    // poll ....
    timer = setInterval(function() {
          // post to events, we need one record
          $.post('/chats/' + room + '/events',
          {
               fkey:  $("input[name='fkey']").attr("value"),
               mode: 'Messages',
               since: 0,
               msgCount: 1
          },
          function (data) { 
             // yes, the root object either has a timeout property, or not
             if (data.timeout) {
                  todiv.text('Timeout ' + data.timeout + giantS(data.timeout,' second') + ' remaining');
                  todiv.show();
              } else {
                  todiv.hide();
              }
          });
      }, MS);
})();
