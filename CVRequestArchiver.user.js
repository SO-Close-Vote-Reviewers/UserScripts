// ==UserScript==
// @name         CV Request Archiver
// @namespace    https://github.com/SO-Close-Vote-Reviewers/
// @version      2.0.1.11
// @description  Scans the chat transcript and checks all cv+delete+undelete+reopen+dupe requests for status, then moves the closed/deleted/undeleted/reopened ones. Possible dupe requests (and their replies) are moved after 30 minutes.
// @author       @TinyGiant @rene @Tunaki
// @include      /https?:\/\/chat(\.meta)?\.stack(overflow|exchange).com\/rooms\/.*/
// @grant        none
// ==/UserScript==
/* jshint -W097 */
/* global $:true */
'use strict';

(function() {
    var me = (/\d+/.exec($('#active-user').attr('class'))||[false])[0];
    if(!me) return false;

    var fkey = $('#fkey');
    if(!fkey.length) return false;
    fkey = fkey.val();

    var room = (/chat.stackoverflow.com.rooms.(\d+)/.exec(window.location.href)||[false,false])[1];
    if(!room) return false;

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

        nodes.scope = document.querySelector('#chat-buttons');

        nodes.startbtn = document.createElement('button');
        nodes.startbtn.className = 'button archiver-startbtn';
        nodes.startbtn.textContent = 'archiver';
        nodes.startbtn.title = 'Open the controls for the request archiver.';
        nodes.scope.appendChild(nodes.startbtn);

        nodes.scan5kbtn = document.createElement('button');
        nodes.scan5kbtn.className = 'button archiver-scan1k';
        nodes.scan5kbtn.textContent = 'scan 5k';
        nodes.scan5kbtn.title = 'Open the controls for the request archiver and scan 5k events.';
        nodes.scope.appendChild(nodes.scan5kbtn);

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
            '}'
        ].join('\n');
        nodes.scope.appendChild(nodes.style);

        nodes.startbtn.addEventListener('click', function(){
            nodes.startbtn.disabled = true;
            nodes.scan5kbtn.disabled = true;
            nodes.count.style.display = '';
            nodes.gobtn.style.display = '';
            nodes.cancel.style.display = '';
            nodes.scandate.style.display = '';
            nodes.count.focus();
        }, false);

        nodes.scan5kbtn.addEventListener('click', function(){
            nodes.startbtn.click();
            nodes.count.value = '5000';
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

        nodes.movebtn.addEventListener('click', movePosts, false);

        function reset() {
            if(this.disabled) return false;
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
            nodes.scan5kbtn.disabled = false;
            nodes.cancel.style.display = 'none';
            nodes.scandate.style.display = 'none';
            nodes.scandate.textContent = '';
            nodes.indicator.style.display = 'none';
            nodes.indicator.textContent = '';
            nodes.movebtn.style.display = 'none';
            nodes.startbtn.disabled = false;
            nodes.progresswrp.style.display = 'none';
            nodes.progress.style.width = '';
        }

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
                    events.push(response.events);

                    // no more events in the transcript
                    if(!response.events[0]) {
                        scanEvents();
                        return false;
                    }

                    nodes.scandate.textContent = new Date(1000 * response.events[0].time_stamp).toISOString();

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
        var undeleteRegexes = makeTagRegExArray('undel(?:ete)?(?:v)?-?(?:vote)?-', please);
        var reopenRegexes = makeTagRegExArray('reopen-', please);
        var dupeRegexes = makeTagRegExArray('pos?sib(?:le|el)-dup(?:e|licate)?');
        var repliesRegexes = [
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
            DUPE: { regexes: dupeRegexes },
            REPLY: { regexes: repliesRegexes },
            FA: { regexes: faRegexes },
            FAREPLY: { regexes: faRepliesRegexes },
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

            //Determine if it matches one of the RegExp.
            for (var i in RequestType) {
                if (matchesRegex(message, RequestType[i].regexes)) {
                    //Use the RegExp array as the indicator of the type.
                    type = RequestType[i];
                    break;
                }
            }

            if (!type) return false;

            // don't handle replies
            if ((type != RequestType.REPLY) && (type != RequestType.FAREPLY)) {
                var matches = message.match(/stackoverflow.com\/(?:q[^\/]*|posts|a[^\/]*)\/(\d+)/g);
                var posts = [];
                // matches will be null if an user screws up the formatting
                if (matches !== null) {
                    for(var k in Object.keys(matches)) {
                        posts.push(/stackoverflow.com\/(?:q[^\/]*|posts|a[^\/]*)\/(\d+)/.exec(matches[k])[1]);
                    }
                }
                for(var l in posts) requests.push({ msg: event.message_id, post: posts[l], time: event.time_stamp, type: type });
            } else {
                // if this is a cv-pls reply for firealarm
                if (type == RequestType.FAREPLY ) {
                    // find its parent, aka the message it replies to
                    if (event.parent_id) {
                        for(var r=0; r < requests.length; r++) {
                            if (requests[r].msg === event.parent_id ) {
                                // and make sure both parent and this reply are the same so the check for if the post is closed will work
                                // store parent as well, we need it later
                                requests.push({ msg: event.message_id, parent:event.parent_id, post: requests[r].post, time: event.time_stamp, type: type });
                            }
                        }
                    } else {
                        // do nothing for non-sense replies to FireAlarm
                    }
                } else {
                    requests.push({ msg: event.message_id, post: -1, time: event.time_stamp, type: type });
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
                if(currentreq[j].type == RequestType.FA) {
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
                if((currentreq[j].type == RequestType.DUPE || currentreq[j].type == RequestType.REPLY)) {
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
                if(currentreq[j].type == RequestType.FA) {
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
                        if (currentreq[i].type != RequestType.DUPE && currentreq[i].type != RequestType.REPLY) {
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

            nodes.indicator.value = messagesToMove.length + ' request' + ['','s'][+(messagesToMove.length > 1)] + ' found';
            nodes.movebtn.style.display = '';
            nodes.cancel.disabled = false;
            nodes.progresswrp.style.display = 'none';
            nodes.progress.style.width = '';
        }

        function movePosts() {
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
                        return false;
                    }

                    setTimeout(movePosts, 5000);
                },
                error: function(xhr, status, error) {
                    console.log('AJAX Error moving posts', '::  xhr:', xhr, '::  status:', status, '::  error:', error);
                    console.log('currentids:', currentids, '::  target:', target, '::  fkey,:', fkey, '::  ids:', ids);
                    alert('$.ajax encountered an error moving posts. See console for data.');
                },
                }
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

        function chunkArray(arr, len) {
            var tmp = [];
            var num = Math.ceil(arr.length / len);
            for(var i = 0; i < num; ++i) {
                tmp.push([]);
            }
            var ind = 0;
            for(var j in arr) {
                if(j > 0 && !(j % len)) ++ind;
                tmp[ind].push(arr[j]);
            }
            return tmp;
        }
    }
})();
