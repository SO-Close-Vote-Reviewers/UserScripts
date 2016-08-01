// ==UserScript==
// @name         Unclosed Request Review Script
// @namespace    http://github.com/Tiny-Giant
// @version      1.0.1.2
// @description  Adds a button to the chat buttons controls; clicking on the button takes you to the recent unclosed close vote request query, then it scans the results  for closed or deleted requests, or false positives and hides them.
// @author       @TinyGiant @rene
// @match        *://chat.stackoverflow.com/rooms/41570/*
// @match        *://chat.stackoverflow.com/search?q=tagged%2Fcv-pls&Room=41570&page=*&pagesize=50&sort=newest
// @grant        GM_xmlhttpRequest
// ==/UserScript==
/* jshint -W097 */
/* jshint esnext:true */
(function() {
    'use strict';

    if (window.location.pathname === '/search')
    {
        const regexes = [
            /(?:tagged\/cv-pl(?:ease|s|z)|\[cv-pl(?:ease|s|z)\]).*(?:q[^\/]*|posts)\/(\d+)/,
            /(?:q[^\/]*|posts)\/(\d+).*(?:tagged\/cv-pl(?:ease|s|z)|\[cv-pl(?:ease|s|z)\])/,
        ];

        const closed = [];
        const open = [];
        const funcs = {};

        let post, message, id, rlen;

        let requests = [];

        funcs.appendInfo = (request) =>
        {
            const scope = request.msg;
            const info = request.info;

            const text = [
                info.score,
                '(+' + info.up_vote_count + '/-' + info.down_vote_count + ')',
                'c:(' + info.close_vote_count + ')',
                'v:(' + info.view_count + ')'
            ].join(' ');

            const existing = scope.querySelector('.request-info');

            const link = document.createElement('a');
            link.href = window.location.protocol + '//stackoverflow.com/q/' + request.info.question_id;
            link.target = '_blank';
            link.title = 'Click to open this question in a new tab.';
            link.appendChild(document.createTextNode(text));

            if (existing !== null)
            {
                existing.appendChild(document.createElement('br'));
                existing.appendChild(link);
                scope.parentNode.parentNode.style.minHeight = existing.clientHeight + 'px';
            }
            else
            {
                const node = document.createElement('span');
                node.className = 'request-info messages';
                node.appendChild(link);
                scope.appendChild(node);
            }
        };

        funcs.checkDone = () =>
        {
            for (let orequest of open)
            {
                const parent = orequest.msg.parentNode.parentNode;

                if ((/\d+/.exec(parent.querySelector('.username a[href^="/user"]').href) || [false])[0] === me)
                {
                    parent.remove();
                    continue;
                }

                funcs.appendInfo(orequest);
            }

            for (let crequest of closed)
            {
                const message = crequest.msg;
                const parent = message.parentNode ? message.parentNode.parentNode: message.parentNode;

                message.remove();

                if (parent && !parent.querySelector('.message'))
                {
                    parent.remove();
                }
            }

            const links = [].slice.call(document.querySelectorAll('.content a'));

            for (let link of links)
            {
                link.target = "_blank";
            }
        };

        funcs.formatPosts = arr => arr.map(item => item.post).join(';');

        funcs.chunkArray = (arr, len) =>
        {
            const tmp = [];
            const num = Math.ceil(arr.length / len);

            for (let i = 0; i < num; ++i)
            {
                tmp.push([]);
            }

            let ind = 0;

            for (let j in arr)
            {
                if (arr.hasOwnProperty(j))
                {
                    if (j > 0 && !(j % len)) ++ind;

                    tmp[ind].push(arr[j]);
                }
            }

            return tmp;
        };

        funcs.checkRequests = () =>
        {
            let currentreq = requests.pop();

            if (typeof currentreq === 'undefined')
            {
                return;
            }

            let xhr = new XMLHttpRequest();

            xhr.addEventListener("load", event =>
                                 {
                if (xhr.status !== 200)
                {
                    console.log(xhr.status, xhr.statusText, xhr.responseText);
                    funcs.checkDone();
                    return;
                }

                let response = JSON.parse(xhr.responseText);
                let items = response.items;

                for (let item of items)
                {
                    if (item.closed_date)
                    {
                        continue;
                    }

                    for (let j in currentreq)
                    {
                        if (currentreq.hasOwnProperty(j))
                        {
                            if (currentreq[j].post == item.question_id)
                            {
                                open.push({
                                    msg: currentreq[j].msg,
                                    info: item
                                });

                                delete currentreq[j];

                                break;
                            }
                        }
                    }
                }

                for (let request of currentreq)
                {
                    if (typeof request !== 'undefined')
                    {
                        closed.push(request);
                    }
                }

                if (!requests.length)
                {
                    funcs.checkDone();
                    return;
                }

                setTimeout(funcs.checkRequests, response.backoff * 1000);

            }, false);

            let url = window.location.protocol + '//api.stackexchange.com/2.2/questions/' + funcs.formatPosts(currentreq) + '?' + [
                'pagesize=100',
                'site=stackoverflow',
                'key=YvvkfBc3LOSK*mwaTPkUVQ((',
                'filter=!*1SgQGDMA8qLEtv8iqQCAvh1tX2WDEre5g0fErdQn'
            ].join('&');

            xhr.open("GET", url);

            xhr.send();
        };

        let scope = document.body;

        let style = document.createElement('style');
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

        let me = (/\d+/.exec(document.querySelector('.topbar-menu-links a[href^="/users"]').href) || [false])[0];

        let messages = [].slice.call(document.querySelectorAll('.message'));

        for (let message of messages)
        {
            const parent = message.parentNode.parentNode;

            let content = message.querySelector('.content');

            if (content === null || content.innerHTML.trim() === '')
            {
                continue;
            }
            else
            {
                content = content.innerHTML.trim();
            }

            let isreq = false;

            for (let regex of regexes)
            {
                if (regex.test(message.innerHTML))
                {
                    isreq = true;
                    break;
                }
            }

            if (!isreq)
            {
                message.remove();

                if (!parent.querySelector('.message'))
                {
                    parent.remove();
                }

                continue;
            }

            const matches = message.innerHTML.match(/(?:q[^\/]*|posts)\/(\d+)/g);

            if (matches === null)
            {
                continue;
            }

            const posts = [];

            for (let key of Object.keys(matches))
            {
                posts.push(/(?:q[^\/]*|posts)\/(\d+)/.exec(matches[key])[1]);
            }

            for (let l in posts) requests.push(
                {
                    msg: message,
                    post: posts[l]
                });
        }

        rlen = requests.length;

        if (rlen !== 0)
        {
            requests = funcs.chunkArray(requests, 100);

            funcs.checkRequests();
        }
    }
    else
    {
        const nodes = {};

        nodes.scope = document.querySelector('#chat-buttons');

        nodes.scope.appendChild(document.createTextNode(' '));

        nodes.button = document.createElement('button');
        nodes.button.className = 'button requests-button';
        nodes.button.textContent = 'requests';
        nodes.scope.appendChild(nodes.button);

        nodes.scope.appendChild(document.createTextNode(' '));

        nodes.button.addEventListener('click', function()
                                      {
            window.open(window.location.origin + '/search?q=tagged%2Fcv-pls&Room=41570&page=1&pagesize=50&sort=newest');
        }, false);
    }
})();
