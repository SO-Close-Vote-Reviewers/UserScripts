// ==UserScript==
// @name         Stack Exchange Close Question Helper
// @namespace    https://amido.com/
// @version      0.3
// @description  Entirely "mouse free" access to the the Close Question functionality on Stack Overflow, Server Fault, Super User and all other Stack Exchange sites.
// @author       Richard Slater
// @match        http://*.stackoverflow.com/questions*
// @match        https://*.stackoverflow.com/questions*
// @match        http://*.serverfault.com/questions*
// @match        https://*.serverfault.com/questions*
// @match        http://*.superuser.com/questions*
// @match        https://*.superuser.com/questions*
// @match        http://stackapps.com/questions*
// @match        https://stackapps.com/questions*
// @match        http://*.stackexchange.com/questions*
// @match        https://*.stackexchange.com/questions*
// @match        http://*.askubuntu.com/questions*
// @match        https://*.askubuntu.com/questions*
// @match        http://*.answers.onstartups.com/questions*
// @match        https://*.answers.onstartups.com/questions*
// @grant        none
// ==/UserScript==

(function() {
    'use strict';
    $(document).ready(function () {
        document.onkeypress = function (e) {
            e = e || window.event;
            if (!isNaN(parseInt(e.key))) {
                $('.popup-active-pane ul li[data-close-helper-key=' + e.key + '] input').focus().click();
            }
        };

        var closeStatus = $('.close-question-link').attr('title');
        if (closeStatus.substring(0, 21) == 'You voted to close as') {
            $('#question-header').after('<div style="font-weight: bold; text-align: center; padding: 10px; border-left: 2px solid #F99; margin: 10px; background-color: #fee;">' + closeStatus + '</div>');
        }

        $('.close-question-link').attr('accesskey', 'x');

        var observer = new MutationObserver(function (mutations) {
            mutations.forEach(function (mutation) {
                for (var i = 0, j = mutation.addedNodes.length; i < j; i++) {
                    var node = mutation.addedNodes[i];
                    if (node.tagName === 'DIV' && node.id === 'popup-close-question') {
                        $('.action-list').each(function(pi, pitem) {
                            Array.prototype.forEach.call(pitem.children, function(uitem, ui) {
                                uitem.setAttribute('data-close-helper-key', ui + 1);
                            });
                        });

                        $('li[data-close-helper-key]').each(function (i, item) {
                            if (i <= 10) {
                                var action = item.getElementsByClassName('action-name')[0];
                                if (action.innerText.substring(0, 1) != '[') {
                                    action.prepend('[' + item.getAttribute('data-close-helper-key') + '] ');
                                }
                            }
                        });
                    }
                }
            });
        });

        observer.observe(document.querySelector('.question'), { 'childList': true, 'subtree': true });
    });
})();