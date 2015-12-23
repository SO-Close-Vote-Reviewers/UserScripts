// ==UserScript==
// @name         Unclosed Request Review Script
// @namespace    http://github.com/Tiny-Giant
// @version      1.0.0.7
// @description  Adds a button to the chat buttons controls; clicking on the button takes you to the recent unclosed close vote request query, then it scans the results  for closed or deleted requests, or false positives and hides them.
// @author       @TinyGiant
// @match        *://chat.stackoverflow.com/rooms/41570/*
// @match        *://chat.stackoverflow.com/search?q=tagged%2Fcv-pls&Room=41570&page=*&pagesize=50&sort=newest
// @grant        GM_xmlhttpRequest
// ==/UserScript==
/* jshint -W097 */

if (window.location.pathname === '/search') {
    var regexes = [
        /(?:tagged\/cv-pl(?:ease|s|z)|\[cv-pl(?:ease|s|z)\]).*(?:q[^\/]*|posts)\/(\d+)/,
        /(?:q[^\/]*|posts)\/(\d+).*(?:tagged\/cv-pl(?:ease|s|z)|\[cv-pl(?:ease|s|z)\])/,
    ], post, message, id, rlen;
    var requests = [];
    var closed = [];
    var open = [];
        
    function appendInfo(scope, info) {
        var node = document.createElement('span');
        node.className = 'request-info messages';
        node.textContent = info.score + ' (+' + info.up_vote_count + '/-' + info.down_vote_count + ') c:(' + info.close_vote_count + ') v:(' + info.view_count + ')';
        scope.appendChild(node);
    }

    function checkDone() {
        for(var i in open) {
            var parent = open[i].msg.parentNode.parentNode;
            if((/\d+/.exec(parent.querySelector('.username a[href^="/user"]').href)||[false])[0] === me) {
                parent.remove();
                continue;
            }
            appendInfo(open[i].msg, open[i].info);
        }
        for(var j in closed) {
            var message = closed[j].msg;
            var parent = message.parentNode.parentNode;
            message.remove();
            if(!parent.querySelector('.message')) parent.remove();
        }
        var links = document.querySelectorAll('.content a');
        for(var i in Object.keys(links)) links[i].target = "_blank";
    }

    function formatPosts(arr) {
        var tmp = [];
        for(var i in arr) tmp.push(arr[i].post);
        return tmp.join(';');
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
    
    function checkRequests() {
        var currentreq = requests.pop();

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
                if(!items[i].closed_date) {
                    for(var j in currentreq) {
                        if(currentreq[j].post == items[i].question_id) {
                            open.push({ msg: currentreq[j].msg, info: items[i] });
                            delete currentreq[j];
                            break;
                        }
                    }
                }
            }

            for(var i in currentreq) closed.push(currentreq[i]);

            if(!requests.length) {
                checkDone();
                return false;
            }

            setTimeout(checkRequests, response.backoff * 1000);
        });

        var url = window.location.protocol + '//api.stackexchange.com/2.2/questions/' + formatPosts(currentreq) + '?' + [
            'pagesize=100',
            'site=stackoverflow',
            'key=YvvkfBc3LOSK*mwaTPkUVQ((',
            'filter=!*1SgQGDMA8qLEtv8iqQCAvh1tX2WDEre5g0fErdQn'
        ].join('&');

        xhr.open("GET", url);

        xhr.send();
    }
    
    var scope = document.body;
    
    var style = document.createElement('style');
    style.type = 'text/css';
    style.textContent = [
        '.request-info {',
        '    display: inline-block;',
        '    position: absolute;',
        '    top: -6px;',
        '    left: 100%;',
        '    white-space: nowrap;',
        '    padding: 6px 10px;',
        '    width: auto;',
        '    border-left: 5px solid #ff7b18;',
        '}',
        '.content a:visited {',
        '    color: #0480DE;',
        '}'
    ].join('\n');
    scope.appendChild(style);

    var me = (/\d+/.exec(document.querySelector('.topbar-menu-links a[href^="/users"]').href)||[false])[0];

    var messages = document.querySelectorAll('.message');

    for(var i in Object.keys(messages)) {
        message = (messages[i].querySelector('.content').innerHTML||'').trim();
        if (!message) continue;
        var isreq = false;
        for(var j in regexes) {
            if(regexes[j].test(message)) {
                isreq = true;
                break;
            }
        }
        if (!isreq) {
            var parent = messages[i].parentNode.parentNode;
            messages[i].remove();
            if(!parent.querySelector('.message')) parent.remove();
            continue;
        }
        var matches = /http.*?(?:q[^\/]*|posts)\/(\d+)/g.exec(message);
        matches.shift();
        var posts = [];
        for(var k in Object.keys(matches)) {
            if(!matches[k]) continue;
            posts.push(matches[k]);
        }
        for(var l in posts) requests.push({ msg: messages[i], post: posts[l]});
    }
    rlen = requests.length;
    requests = chunkArray(requests, 100);

    checkRequests();
} else {
    var nodes = {};

    nodes.scope = document.querySelector('#chat-buttons');

    nodes.scope.appendChild(document.createTextNode(' '));

    nodes.button = document.createElement('button');
    nodes.button.className = 'button requests-button';
    nodes.button.textContent = 'requests';
    nodes.scope.appendChild(nodes.button);

    nodes.scope.appendChild(document.createTextNode(' '));

    nodes.button.addEventListener('click', function(){
        window.open(window.location.origin + '/search?q=tagged%2Fcv-pls&Room=41570&page=1&pagesize=50&sort=newest');
    }, false);
}

