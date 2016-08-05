// ==UserScript==
// @name         CV Request Archiver
// @namespace    https://github.com/SO-Close-Vote-Reviewers/
// @version      2.0.1.5
// @description  Scans the chat transcript and checks all cv+delete+reopen+dupe requests for status, then moves the closed/deleted/reopened ones. Possible dupe requests (and their replies) are moved after 30 minutes.
// @author       @TinyGiant @rene @Tunaki
// @include      /https?:\/\/chat(\.meta)?\.stack(overflow|exchange).com\/rooms\/.*/
// @grant        none
// ==/UserScript==
/* jshint -W097 */
'use strict';

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
    nodes.scope.appendChild(nodes.startbtn);

    nodes.scope.appendChild(document.createElement('br'));

    nodes.form = document.createElement('form');
    nodes.form.className = 'archiver-form';
    nodes.scope.appendChild(nodes.form);

    nodes.count = document.createElement('input');
    nodes.count.className = 'button archiver-count';
    nodes.count.placeholder = '#';
    nodes.count.type = 'text';
    nodes.count.style.display = 'none';
    nodes.form.appendChild(nodes.count);

    nodes.gobtn = document.createElement('button');
    nodes.gobtn.className = 'button archiver-gobtn';
    nodes.gobtn.textContent = 'scan';
    nodes.gobtn.style.display = 'none';
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
        nodes.count.style.display = '';
        nodes.gobtn.style.display = '';
        nodes.cancel.style.display = '';
        nodes.scandate.style.display = '';
        nodes.count.focus();
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
            }
        });
    };

    function scanEvents(){
        nodes.progress.style.width = '';
        for(var i in events) for(var j in events[i]) checkEvent(events[i][j], i, events.length);
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
    
    var cvRegexes = [
        /(?:tagged\/cv-pl(?:ease|s|z)|\[cv-pl(?:ease|s|z)\]).*(?:q[^\/]*|posts)\/(\d+)/,
        /(?:q[^\/]*|posts)\/(\d+).*(?:tagged\/cv-pl(?:ease|s|z)|\[cv-pl(?:ease|s|z)\])/,
    ];
    
    var deleteRegexes = [
        /(?:tagged\/del(?:ete)?(?:v)?-?(?:vote)?-pl(?:ease|s|z)|\[del(?:ete)?(?:v)?-?(?:vote)?-pl(?:ease|s|z)\]).*(?:q[^\/]*|posts|a[^\/]*)\/(\d+)/,
        /(?:q[^\/]*|posts|a[^\/]*)\/(\d+).*(?:tagged\/del(?:ete)?(?:v)?-?(?:vote)?-pl(?:ease|s|z)|\[del(?:ete)?(?:v)?-?(?:vote)?-pl(?:ease|s|z)\])/,
    ];
    
    var reopenRegexes = [
        /(?:tagged\/reopen-pl(?:ease|s|z)|\[reopen-pl(?:ease|s|z)\]).*(?:q[^\/]*|posts)\/(\d+)/,
        /(?:q[^\/]*|posts)\/(\d+).*(?:tagged\/reopen-pl(?:ease|s|z)|\[reopen-pl(?:ease|s|z)\])/,
    ];
    
    var dupeRegexes = [
        /(?:tagged\/possible-duplicate).*(?:q[^\/]*|posts)\/(\d+)/,
        /(?:q[^\/]*|posts)\/(\d+).*(?:tagged\/possible-duplicate)/,
    ];
    
    var repliesRegexes = [
        /@queen (?:f|k)/
    ];
    
    var RequestType = {
        CLOSE: 'close-vote',
        DELETE: 'delete-vote',
        REOPEN: 'reopen-vote',
        DUPE: 'possible-dupe',
        REPLY: 'feedback'
    }
    
    function matchesRegex(message, regexes) {
        for(var j in regexes) {
            if(regexes[j].test(message)) {
                return true;
            }
        }
        return false;
    }
    
    function checkEvent(event, current, total) {
        nodes.indicator.value = 'checking events... (' + current + ' / ' + total + ')';
        nodes.progress.style.width = Math.ceil((current * 100) / total) + '%';
        var message = event.content;
        var type = RequestType.CLOSE;
        var isCVReq = matchesRegex(message, cvRegexes), isDelReq = false, isOpenReq = false, isDupeReq = false, isReplyReq = false;
        if (!isCVReq) {
            isDelReq = matchesRegex(message, deleteRegexes);
            type = RequestType.DELETE;
            if (!isDelReq) {
                isOpenReq = matchesRegex(message, reopenRegexes);
                type = RequestType.REOPEN;
                if (!isOpenReq) {
                    isDupeReq = matchesRegex(message, dupeRegexes);
                    type = RequestType.DUPE;
                    if (!isDupeReq) {
                        isReplyReq = matchesRegex(message, repliesRegexes);
                        type = RequestType.REPLY;
                        if (!isReplyReq) return false;
                    }
                }
            }
        }
        
        if (type != RequestType.REPLY) {
            var matches = message.match(/(?:q[^\/]*|posts|a[^\/]*)\/(\d+)/g);
            var posts = [];
            // matches will be null if an user screws up the formatting
            if (matches !== null) {
                for(var k in Object.keys(matches)) {
                    posts.push(/(?:q[^\/]*|posts|a[^\/]*)\/(\d+)/.exec(matches[k])[1]);
                }
            }
            for(var l in posts) requests.push({ msg: event.message_id, post: posts[l], time: event.time_stamp, type: type });
        } else {
            requests.push({ msg: event.message_id, post: -1, time: event.time_stamp, type: type });
        }
    }
    
    function checkRequests() {
        var currentreq = requests.pop();

        var left = [rlen,rlen - (requests.length * 100)][+(rlen > 100)];

        nodes.indicator.value = 'checking requests... (' + left + ' / ' + rlen + ')'; 
        nodes.progress.style.width = Math.ceil((left * 100) / rlen) + '%';

        checkRequestsQueen(currentreq);
        checkRequestsOthers(currentreq);
    }
    
    function checkRequestsQueen(currentreq) {
        // just move all possible-dupe and replies posted more than 30 minutes ago
        for(var j in currentreq) {
            if((currentreq[j].type == RequestType.DUPE || currentreq[j].type == RequestType.REPLY)) {
                if ((Date.now() - (currentreq[j].time * 1000)) > (1000 * 60 * 30)) {
                    messagesToMove.push(currentreq[j]);
                } else {
                    delete currentreq[j];
                }
            }
        }
    }

    function checkRequestsOthers(currentreq) {
        var xhr = new XMLHttpRequest();

        xhr.addEventListener("load", function(){
            if(this.status !== 200) {
                console.log(this);
                checkDone();
                return false;
            }

            var response = JSON.parse(this.response);
            var items = response.items;

            for(var i in items) {
                for(var j in currentreq) {
                    if(currentreq[j].post == items[i].question_id && currentreq[j].type == RequestType.DELETE) delete currentreq[j];
                }
                if(!items[i].closed_date) {
                    for(var j in currentreq) {
                        if(currentreq[j].type == RequestType.CLOSE && items[i].close_vote_count == 0 && ((Date.now() - (currentreq[j].time * 1000)) > (1000 * 60 * 60 * 24 * 3))) continue;
                        if(currentreq[j].post == items[i].question_id && currentreq[j].type == RequestType.CLOSE) delete currentreq[j];
                    }
                }
                if(items[i].closed_date) {
                    for(var j in currentreq) {
                        if(currentreq[j].type == RequestType.REOPEN && items[i].reopen_vote_count == 0 && ((Date.now() - (currentreq[j].time * 1000)) > (1000 * 60 * 60 * 24 * 3))) continue;
                        if(currentreq[j].post == items[i].question_id && currentreq[j].type == RequestType.REOPEN) delete currentreq[j];
                    }
                }
            }
            
            var xhr2 = new XMLHttpRequest();
            xhr2.addEventListener("load", function(){
                if(this.status !== 200) {
                    console.log(this);
                    checkDone();
                    return false;
                }

                var response = JSON.parse(this.response);
                var items = response.items;

                for(var i in items) {
                    for(var j in currentreq) {
                        if(currentreq[j].post == items[i].answer_id && currentreq[j].type == RequestType.DELETE) delete currentreq[j];
                    }
                }
                for(var i in currentreq) messagesToMove.push(currentreq[i]);
                if(!requests.length) {
                    checkDone();
                    return false;
                }
                setTimeout(checkRequests, response.backoff * 1000);
            });

            var url = '//api.stackexchange.com/2.2/answers/' + formatPosts(currentreq) + '?' + [
                'pagesize=100',
                'site=stackoverflow',
                'key=qhq7Mdy8)4lSXLCjrzQFaQ(('
            ].join('&');

            xhr2.open("GET", url);
            xhr2.send();
            
        });

        var url = '//api.stackexchange.com/2.2/questions/' + formatPosts(currentreq) + '?' + [
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
