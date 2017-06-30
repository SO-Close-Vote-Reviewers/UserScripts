// ==UserScript==
// @name         Unclosed Request Review Script
// @namespace    http://github.com/Tiny-Giant
// @version      1.0.1.5
// @description  Adds a button to the chat buttons controls; clicking on the button takes you to the recent unclosed close vote request query, then it scans the results  for closed or deleted requests, or false positives and hides them.
// @author       @TinyGiant @rene @mogsdad @Makyen @PaulRoub
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

        let post, message, id;

        let requests = [];

        funcs.appendInfo = (request) =>
        {
            //Add the request-info to the matching message.
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
                //Add additional data to the existing request-info for this message.
                existing.appendChild(document.createElement('br'));
                existing.appendChild(link);
                scope.parentNode.parentNode.style.minHeight = existing.clientHeight + 'px';
            }
            else
            {
                //Add the first request-info for this message.
                const node = document.createElement('span');
                node.className = 'request-info messages';
                node.appendChild(link);
                scope.appendChild(node);
            }
        };

        funcs.checkDone = () =>
        {
            //Add request-info for all open questions (except the user's own).
            for (let orequest of open)
            {
                const parent = orequest.msg.parentNode.parentNode;                
                const reporter = parent.querySelector('.username a[href^="/user"]');

                if (reporter)
                {
                    if (((/\d+/.exec(reporter).href) || [false])[0] === me)
                    {
                        parent.remove();
                        continue;
                    }
                }

                funcs.appendInfo(orequest);
            }

            //Delete the messages about closed (or deleted) questions.
            for (let crequest of closed)
            {
                const message = crequest.msg;
                //Don't delete if the message has request-info in case there was more than one
                //  request in the message.
                if (message && !message.querySelector('.request-info'))
                {
                    const parent = message.parentNode ? message.parentNode.parentNode: message.parentNode;

                    message.remove();

                    //If there are no more messages in the monolouge, then delete the whole thing.
                    if (parent && !parent.querySelector('.message'))
                    {
                        parent.remove();
                    }
                }
            }

            const links = [].slice.call(document.querySelectorAll('.content a'));

            //Make all links open in a new tab/new window.
            for (let link of links)
            {
                link.target = "_blank";
            }
        };

        funcs.formatPosts = arr => arr.map(item => item.post).join(';');

        funcs.chunkArray = (arr, len) =>
        {
            //Chop a single array into an array of arrays. Each new array contains len number of
            //  elements, except the last one.
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

            //Handle the response from the API.
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

                //Process each question for which data was received.
                for (let item of items)
                {
                    //Treat closed questions the same as deleted questions, for which we get no data from the API.
                    if (item.closed_date)
                    {
                        continue;
                    }

                    //Find requests which match this question_id
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
                                //If we:
                                //continue;
                                // here, then all messsages which are about this question_id will get request-info.
                                // However, we only want to insert the request-info in the first one found. So:
                                break;
                            }
                        }
                    }
                }

                //Add any remaining requests to the "closed" list. This should be requests for questions which are
                //  either A) closed (had a closed_date), or B) did not produce any data from the API (deleted).
                for (let request of currentreq)
                {
                    if (typeof request !== 'undefined')
                    {
                        closed.push(request);
                    }
                }

                //If there are no more requests to make, continue processing.
                if (!requests.length)
                {
                    funcs.checkDone();
                    return;
                }

                //Make the next request of the API, complying with any backoff time required.
                setTimeout(funcs.checkRequests, response.backoff * 1000);

            }, false);

            //Construct and send the API request.
            let url = window.location.protocol + '//api.stackexchange.com/2.2/questions/' + funcs.formatPosts(currentreq) + '?' + [
                'pagesize=100',
                'site=stackoverflow',
                'key=YvvkfBc3LOSK*mwaTPkUVQ((',
                'filter=!*1SgQGDMA8qLEtv8iqQCAvh1tX2WDEre5g0fErdQn'
            ].join('&');

            xhr.open("GET", url);

            xhr.send();
        };

        //Add the styles used to the DOM.
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

        //Determine the current user's ID
        let me = (/\d+/.exec(document.querySelector('.topbar-menu-links a[href^="/users"]').href) || [false])[0];

        //Process each message on the page.
        let messages = [].slice.call(document.querySelectorAll('.message'));

        for (let message of messages)
        {
            const parent = message.parentNode.parentNode;

            let content = message.querySelector('.content');

            //If the message has no content, continue.
            if (content === null || content.innerHTML.trim() === '')
            {
                continue;
            }
            else
            {
                content = content.innerHTML.trim();
            }

            //Determine if this is a cv-pls tagged message
            let isreq = false;

            for (let regex of regexes)
            {
                if (regex.test(message.innerHTML))
                {
                    isreq = true;
                    break;
                }
            }

            //If not a cv-pls tagged message, remove it. Remove the parent if no more messages in parent.
            if (!isreq)
            {
                message.remove();

                if (!parent.querySelector('.message'))
                {
                    parent.remove();
                }

                continue;
            }

            //Find things that look like they might be URLs to questions/posts
            const matches = message.innerHTML.match(/(?:q[^\/]*|posts)\/(\d+)/g);

            //If there is not something that looks like a question/post URL, then go to next message.
            if (matches === null)
            {
                continue;
            }

            //For each URL (match) create a requests entry which associates the post with the message.
            const posts = [];

            //We can have duplicates here due to possible HTML: <a href="questionURL">questionURL</a>
            for (let key of Object.keys(matches))
            {
                let post = /(?:q[^\/]*|posts)\/(\d+)/.exec(matches[key])[1];
                //Don't add duplicate posts for the same question.
                if(posts.indexOf(post) === -1)
                {
                    posts.push(post);
                }
            }

            //For each post found in this message, create a request mapping the post to the message.
            for (let post of posts)
            {
                requests.push(
                {
                    msg: message,
                    post: post
                });
            }
        }

        if (requests.length !== 0)
        {
            //API requests are max 100 questions each. So, break the array into 100 post long chunks.
            requests = funcs.chunkArray(requests, 100);

            funcs.checkRequests();
        }
    }
    else
    {
        //Normal chat page (not a search result)
        //Add "requests" button to the non-search chat page.
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
