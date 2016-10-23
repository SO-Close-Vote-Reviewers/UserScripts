// ==UserScript==
// @name         Unclosed Request Review Script
// @namespace    http://github.com/Tiny-Giant
// @version      1.0.1.4
// @description  Adds a button to the chat buttons controls; clicking on the button takes you to the recent unclosed close vote request query, then it scans the results  for closed or deleted requests, or false positives and hides them.
// @author       @TinyGiant @rene @mogsdad
// @match        *://chat.stackoverflow.com/rooms/41570/*
// @match        *://chat.stackoverflow.com/search?q=tagged%2Fcv-pls&Room=41570&page=*&pagesize=50&sort=newest
// @grant        GM_addStyle
// ==/UserScript==
/* jshint -W097 */
/* jshint esnext:true */
(function() {
    'use strict';

    if (window.location.pathname === '/search') {
        GM_addStyle(`
            .request-info {
                display: inline-block;
                position: absolute;
                top: -6px;
                left: 100%;
                white-space: nowrap;
                padding: 6px 10px;
                width: auto;
                border-left: 5px solid #ff7b18;
            }
            .content a:visited {
                color: #0480DE;
            }
        `);

        const regexes = [
            /(?:tagged\/cv-pl(?:ease|s|z)|\[cv-pl(?:ease|s|z)\]).*(?:q[^\/]*|posts)\/(\d+)/,
            /(?:q[^\/]*|posts)\/(\d+).*(?:tagged\/cv-pl(?:ease|s|z)|\[cv-pl(?:ease|s|z)\])/,
        ];

        const me = (/\d+/.exec(document.querySelector('.topbar-menu-links a[href^="/users"]').href) || [false])[0];

        const funcs = {};

        funcs.formatPosts = arr => arr.map(item => item.post).join(';');

        funcs.chunkArray = (arr, len) => {
            const tmp = [];
            const num = Math.ceil(arr.length / len);

            for (let i = 0; i < num; ++i) {
                tmp.push([]);
            }

            let ind = 0;

            for (let j in arr) {
                if (arr.hasOwnProperty(j)) {
                    if (j > 0 && !(j % len)) ++ind;

                    tmp[ind].push(arr[j]);
                }
            }

            return tmp;
        };

        funcs.isRequest = message => {
            if (!(message instanceof Node)) {
                return false;
            }

            for (let regex of regexes) {
                if (regex.test(message.innerHTML)) {
                    return true;
                }
            }

            return false;
        };

        funcs.removeMessage = message => {
            if (!(message instanceof Node)) {
                return false;
            }

            const parent = message.parentNode;

            message.remove();

            if (!(parent instanceof Node)) {
                return true;
            }

            const messages = parent.querySelectorAll('.message');

            if (messages.length <= 0) {
                parent.parentNode.remove();
            }
        };

        funcs.appendInfo = (scope, info) => {

            const text = [
                info.score,
                '(+' + info.up_vote_count + '/-' + info.down_vote_count + ')',
                'c:(' + info.close_vote_count + ')',
                'v:(' + info.view_count + ')'
            ].join(' ');

            const existing = scope.querySelector('.request-info');

            const link = document.createElement('a');
            link.href = window.location.protocol + '//stackoverflow.com/q/' + info.question_id;
            link.target = '_blank';
            link.title = 'Click to open this question in a new tab.';
            link.appendChild(document.createTextNode(text));

            if (existing !== null) {
                existing.appendChild(document.createElement('br'));
                existing.appendChild(link);
                scope.parentNode.parentNode.style.minHeight = existing.clientHeight + 'px';
            } else {
                const node = document.createElement('span');
                node.className = 'request-info messages';
                node.appendChild(link);
                scope.appendChild(node);
            }
        };

        funcs.filterMessages = messages => {
            const requests = [];

            for (let message of messages) {
                if (!funcs.isRequest(message)) {
                    funcs.removeMessage(message);

                    continue;
                }

                const [, match] = /(?:q[^\/]*|posts)\/(\d+)/g.exec(message.innerHTML);

                if (typeof match === 'undefined') {
                    continue;
                }

                requests.push({
                    message: message,
                    post: match
                });
            }

            return requests;
        };

        funcs.checkRequestChunks = (chunks, chunk_index) => {
            if (!chunk_index) {
                chunk_index = 0;
            }

            if (!(chunks[chunk_index] instanceof Array)) {
                console.log('Chunk is not an array');
                return;
            }

            const current_chunk = chunks[chunk_index];

            const url = (function() {
                const protocol = window.location.protocol;
                const location = 'api.stackexchange.com/2.2/questions';
                const posts = funcs.formatPosts(current_chunk);
                const pagesize = 'pagesize=100';
                const site = 'site=stackoverflow';
                const key = 'key=YvvkfBc3LOSK*mwaTPkUVQ((';
                const filter = 'filter=!*1SgQGDMA8qLEtv8iqQCAvh1tX2WDEre5g0fErdQn';

                return `${ protocol }//${ location }/${ posts }?&${ pagesize}&${ site}&${ key }&${ filter }`;
            })();

            fetch(url).then(r => r.json()).then(response => {
                if ("error_id" in response) {
                    console.log(response);
                    return;
                }

                const items = response.items;

                if (typeof items === "undefined") {
                    console.log("items property not set in response from API");
                    return;
                }

                for (let request of current_chunk) {
                    let deleted = true;

                    for (let item of items) {
                        if (request.post == item.question_id) {
                            const message = request.message;

                            const [author] = /\d+/.exec(message.parentNode.parentNode.className) || [false];

                            if (item.closed_date || author == me) {
                                funcs.removeMessage(message);
                            } else {
                                funcs.appendInfo(message, item);
                            }

                            deleted = false;

                            break;
                        }
                    }

                    if (deleted) {
                        funcs.removeMessage(request.message);
                    }
                }

                if (chunk_index == chunks.length - 1) {
                    funcs.checkDone();
                } else if (response.has_more) {
                    setTimeout(funcs.checkRequestChunks, response.backoff * 1000, chunks, ++chunk_index);
                }
            });
        };

        funcs.init = () => {
            const messages = [...document.querySelectorAll('.message')];

            const requests = funcs.filterMessages(messages);

            if (requests.length === 0) {
                return false;
            }

            const chunks = funcs.chunkArray(requests, 100);

            funcs.checkRequestChunks(chunks);

            const links = [...document.querySelectorAll('.content a')];

            for (let link of links) {
                link.target = "_blank";
            }
        };

        funcs.init();
    } else {
        const nodes = {};

        nodes.scope = document.querySelector('#chat-buttons');

        nodes.scope.appendChild(document.createTextNode(' '));

        nodes.button = document.createElement('button');
        nodes.button.className = 'button requests-button';
        nodes.button.textContent = 'requests';
        nodes.scope.appendChild(nodes.button);

        nodes.button.addEventListener('click', window.open.bind(`${ window.location.origin }/search?q=tagged%2Fcv-pls&Room=41570&page=1&pagesize=50&sort=newest`));
    }
})();
