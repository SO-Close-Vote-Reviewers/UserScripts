// ==UserScript==
// @name        SO Show Burninated Tags
// @namespace   SOCVRStackOverflowAdjustments
// @description On the 10k tools pages, indicate tags that have been burninated by making them red.
// @author      Makyen
// @version     1.0.0
// @match       *://*.stackoverflow.com/tools*
// @exclude     *://chat.stackoverflow.com/*
// @exclude     *://meta.stackoverflow.com/*
// @grant       none
// ==/UserScript==

//This script gets a list of burninated tags from:
//    https://github.com/SOBotics/Tagdor/blob/master/StatusCompletedBurninateRequests.csv
//  which is based off of the spreadsheet kept by the Trogdor room:
//    https://chat.stackoverflow.com/rooms/165597/trogdor

(function() {
    'use strict';

    /* The following code for detecting browsers is from my answer at:
     *   http://stackoverflow.com/a/41820692/3773011
     *   which is based on code from:
     *   http://stackoverflow.com/a/9851769/3773011
     */
    //Opera 8.0+ (tested on Opera 42.0)
    //const isOpera = (!!window.opr && !!window.opr.addons) || !!window.opera || navigator.userAgent.indexOf(' OPR/') >= 0;
    //Firefox 1.0+ (tested on Firefox 45 - 53)
    const isFirefox = typeof InstallTrigger !== 'undefined';
    //Internet Explorer 6-11
    //   Untested on IE (of course). Here because it shows some logic for isEdge.
    const isIE = /*@cc_on!@*/false || !!document.documentMode;
    //Edge 20+ (tested on Edge 38.14393.0.0)
    const isEdge = !isIE && !!window.StyleMedia;
    //The other browsers are trying to be more like Chrome, so picking
    //  capabilities which are in Chrome, but not in others, is a moving
    //  target.  Just default to Chrome if none of the others is detected.
    //const isChrome = !isOpera && !isFirefox && !isIE && !isEdge;
    // Blink engine detection (tested on Chrome 55.0.2883.87 and Opera 42.0)
    //const isBlink = (isChrome || isOpera) && !!window.CSS;

    $.get('https://rawgit.com/SOBotics/Tagdor/master/StatusCompletedBurninateRequests.csv').done((response) => {
        const lines = response.toLowerCase().split(/[\r\n]+/);
        lines.shift();
        if (!lines) {
            return;
        } //else
        const tags = [].concat.apply([], lines.map((line) => {
            const csv = line.split(',');
            csv.shift();
            return csv.join(' ').replace(/["'[\]]+/g, '').replace(/\.\.\./g, '').trim().split(/ +/);
        })).filter((tag) => tag);
        const tagUrlList = tags.map((tag) => `/questions/tagged/${tag}`);
        const baseSelectorList = tagUrlList.map((url) => `body.tools-page .post-tag[href="${url}"]`);
        const cssFirefox = `
            background-color: #FFFFE1;
            border: 1px solid #8D8D7C;
        `;
        const cssEdge = `
            border: 2px solid #808080;
            background-color: #FFFFFF;
        `;
        const cssChrome = `
            border: 1px solid #767676;
            background-color: #FFFFFF;
        `;
        const css = `
            ${(baseSelectorList.join(',\n'))} {
                background-color: red;
                color: white;
                position:relative;
            }
            ${(baseSelectorList.join(':hover:after,\n'))}:hover:after {
                opacity: 1;
                transition: all 0.1s ease 0.5s;
                visibility: visible;
            }
            ${(baseSelectorList.join(':after,\n'))}:after {
                content: "This tag was previously burninated.";
                color: #111;
                position: absolute;
                padding: 3px;
                bottom: -1.6em;
                left: 0;
                white-space: nowrap;
                box-shadow: 0px 5px 5px -3px #8E8E8E;
                opacity: 0;
                z-index: 99999;
                visibility: hidden;
                ${(isFirefox ? cssFirefox : '')}
                ${(isEdge ? cssEdge : '')}
                ${((!isFirefox && !isEdge) ? cssChrome : '')}
            }
        `;
        $(document.documentElement).append(`<style id="showBurniatedTags">${css}</style>`);
    }).fail(function() {
        console.error('Failed to fetch CSV values:', arguments);
    });
})();