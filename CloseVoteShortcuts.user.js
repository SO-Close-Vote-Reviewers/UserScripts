// ==UserScript==
// @name         StackOverflow close votes shortcuts
// @namespace    https://github.com/kappa7194/stackoverflow-close-votes-shortcuts
// @version      1.0.2
// @description  A script to add keyboard shortcuts to StackOverflow's close votes review queue
// @author       Albireo, rene
// @match        *://stackoverflow.com/review/close*
// @grant        none
// ==/UserScript==

/*global $:false , document:false, MutationObserver:false,  */
(function () {
    'use strict';

    $(document).ready(function () {
        var keys = {
            '1': 49,
            '2': 50,
            '3': 51,
            '4': 52,
            '5': 53,
            '6': 54,
            '7': 55,
            '8': 56,
            '9': 57,
            '0': 48
        },
            configuration = {
                'actions': {
                    'leaveOpen': { 'key': '1', 'value': '8' },
                    'close': { 'key': '2', 'value': '6' },
                    'edit': { 'key': '3', 'value': '5' },
                    'skip': { 'key': '4', 'value': '1' },
                    'next': { 'key': '0', 'value': '254' }
                },
                'closeReasons': {
                    'duplicate': { 'key': '1', 'value': 'Duplicate' },
                    'offTopic': { 'key': '2', 'value': 'OffTopic' },
                    'unclear': { 'key': '3', 'value': 'Unclear' },
                    'tooBroad': { 'key': '4', 'value': 'TooBroad' },
                    'opinionBased': { 'key': '5', 'value': 'OpinionBased' }
                },
                'offTopicReasons': {
                    'superUser': { 'key': '1', 'value': '4' },
                    'serverFault': { 'key': '2', 'value': '7' },
                    'recommend': { 'key': '3', 'value': '16' },
                    'minimalProgram': { 'key': '4', 'value': '13' },
                    'typo': { 'key': '5', 'value': '11' },
                    'migration': { 'key': '6', 'value': '2' },
                    'other': { 'key': '7', 'value': '3' }
                },
                'migrationReasons': {
                    'meta': { 'key': '1', 'value': 'meta.stackoverflow.com' },
                    'superUser': { 'key': '2', 'value': 'superuser.com' },
                    'tex': { 'key': '3', 'value': 'tex.stackexchange.com' },
                    'dba': { 'key': '4', 'value': 'dba.stackexchange.com' },
                    'stats': { 'key': '5', 'value': 'stats.stackexchange.com' }
                }
            };

        (function () {
            var states = {
                atQuestion: 1,
                atCloseReason: 2,
                atDuplicate: 3,
                atOffTopic: 4,
                atOtherSite: 5
            },
                state = states.atQuestion;

            function clickElement(selector) {
                $(selector).focus().click();
            }

            function clickAction(action) {
                clickElement('.review-actions [data-result-type="' + action + '"]');
            }

            function clickCloseReason(reason) {
                clickElement('[name="close-reason"][value="' + reason + '"]');
            }

            function clickOffTopicReason(reason) {
                clickElement('[name="close-as-off-topic-reason"][value="' + reason + '"]');
            }

            function clickOtherSite(site) {
                clickElement('[name="migration"][value="' + site + '"]');
            }

            function resetState() {
                state = states.atQuestion;
            }

            function actionHandler(key) {
                switch (key) {
                case keys[configuration.actions.leaveOpen.key]:
                    clickAction(configuration.actions.leaveOpen.value);
                    resetState();
                    break;
                case keys[configuration.actions.close.key]:
                    state = states.atCloseReason;
                    clickAction(configuration.actions.close.value);
                    break;
                case keys[configuration.actions.edit.key]:
                    clickAction(configuration.actions.edit.value);
                    resetState();
                    break;
                case keys[configuration.actions.skip.key]:
                    clickAction(configuration.actions.skip.value);
                    resetState();
                    break;
                case keys[configuration.actions.next.key]:
                    clickAction(configuration.actions.next.value);
                    resetState();
                    break;
                }
            }

            function closeReasonHandler(key) {
                switch (key) {
                case keys[configuration.closeReasons.duplicate.key]:
                    clickCloseReason(configuration.closeReasons.duplicate.value);
                    state = states.atDuplicate;
                    break;
                case keys[configuration.closeReasons.offTopic.key]:
                    clickCloseReason(configuration.closeReasons.offTopic.value);
                    state = states.atOffTopic;
                    break;
                case keys[configuration.closeReasons.unclear.key]:
                    clickCloseReason(configuration.closeReasons.unclear.value);
                    break;
                case keys[configuration.closeReasons.tooBroad.key]:
                    clickCloseReason(configuration.closeReasons.tooBroad.value);
                    break;
                case keys[configuration.closeReasons.opinionBased.key]:
                    clickCloseReason(configuration.closeReasons.opinionBased.value);
                    break;
                }
            }

            function offTopicHandler(key) {
                switch (key) {
                case keys[configuration.offTopicReasons.superUser.key]:
                    clickOffTopicReason(configuration.offTopicReasons.superUser.value);
                    break;
                case keys[configuration.offTopicReasons.serverFault.key]:
                    clickOffTopicReason(configuration.offTopicReasons.serverFault.value);
                    break;
                case keys[configuration.offTopicReasons.recommend.key]:
                    clickOffTopicReason(configuration.offTopicReasons.recommend.value);
                    break;
                case keys[configuration.offTopicReasons.minimalProgram.key]:
                    clickOffTopicReason(configuration.offTopicReasons.minimalProgram.value);
                    break;
                case keys[configuration.offTopicReasons.typo.key]:
                    clickOffTopicReason(configuration.offTopicReasons.typo.value);
                    break;
                case keys[configuration.offTopicReasons.migration.key]:
                    state = states.atOtherSite;
                    clickOffTopicReason(configuration.offTopicReasons.migration.value);
                    break;
                case keys[configuration.offTopicReasons.other.key]:
                    clickOffTopicReason(configuration.offTopicReasons.other.value);
                    break;
                }
            }

            function otherSiteHandler(key) {
                switch (key) {
                case keys[configuration.migrationReasons.meta.key]:
                    clickOtherSite(configuration.migrationReasons.meta.value);
                    break;
                case keys[configuration.migrationReasons.superUser.key]:
                    clickOtherSite(configuration.migrationReasons.superUser.value);
                    break;
                case keys[configuration.migrationReasons.tex.key]:
                    clickOtherSite(configuration.migrationReasons.tex.value);
                    break;
                case keys[configuration.migrationReasons.dba.key]:
                    clickOtherSite(configuration.migrationReasons.dba.value);
                    break;
                case keys[configuration.migrationReasons.stats.key]:
                    clickOtherSite(configuration.migrationReasons.stats.value);
                    break;
                }
            }

            function keyHandler(key) {
                switch (state) {
                case states.atQuestion:
                    actionHandler(key);
                    break;
                case states.atCloseReason:
                    closeReasonHandler(key);
                    break;
                case states.atOffTopic:
                    offTopicHandler(key);
                    break;
                case states.atOtherSite:
                    otherSiteHandler(key);
                    break;
                }
            }

            $(document).on('click', '#popup-close-question .popup-close a', function () {
                resetState();
            });

            $(document).on('click', '#popup-close-question .popup-submit', function () {
                resetState();
            });

            $(document).on('keyup', function (e) {
                if (e.keyCode === 27) {
                    resetState();
                    return;
                }

                if ((e.target.tagName === 'INPUT' && e.target.type === 'text') || e.target.tagName === 'TEXTAREA') {
                    return;
                }
                
                // numpad handling
                if ((e.keyCode > 95) && (e.keyCode < 106)) {
                    e.keyCode = e.keyCode - 48; 
                }

                keyHandler(e.keyCode);
            });
        }());

        (function () {
            var lookup = { }, observer;
            lookup[configuration.actions.leaveOpen.value] = configuration.actions.leaveOpen.key;
            lookup[configuration.actions.close.value] = configuration.actions.close.key;
            lookup[configuration.actions.edit.value] = configuration.actions.edit.key;
            lookup[configuration.actions.skip.value] = configuration.actions.skip.key;
            lookup[configuration.actions.next.value] = configuration.actions.next.key;

            observer = new MutationObserver(function (mutations) {
                mutations.forEach(function (mutation) {
                    var i, j, node;
                    for (i = 0, j = mutation.addedNodes.length; i < j; i = i + 1) {
                        node = $(mutation.addedNodes[i]);
                        if (node.prop('tagName') === 'INPUT' &&
                                node.prop('type') === 'button' &&
                                node.val().indexOf('[') === -1) {
                            node.val('[' + lookup[node.data('result-type')] + '] ' + node.val());
                        }
                    }
                });
            });

            observer.observe(document.querySelector('.review-actions'), { 'childList': true });
        }());

        (function () {

            var observer;

            // the mutation observers picks up this change as well
            // this function prevent adding another [1] if it already has one
            function singleAdd(elem, key) {
                var add = '[' + key + '] ';
                //strangely some elem doesn't contain html hence the null check...
                if (elem.html() !== null && elem.html().indexOf(add) !== 0) {
                    elem.html(add + elem.html());
                }
            }

            // never provide a non-numeric key !
            function addSiblingHelper(root, selector, key) {
                var element = $(root).find(selector).next(),
                    keyNumber = parseInt(key, 10),
                    i;
                // if a custom close reason has been given
                // multiple elements are found
                // in that case we iterate and increase the keyNumber by one
                // this works as long as the custom reason is the last one...
                for (i = 0; i < element.length; i = i + 1) {
                    singleAdd($(element[i]), keyNumber.toString());
                    keyNumber = keyNumber + 1;
                }
            }

            function addCousinHelper(root, selector, key) {
                var element = $(root).find(selector).parent().next().next();
                singleAdd(element, key);
            }

            function addCloseReasonHelper(root, reason, key) {
                addSiblingHelper(root, '[name="close-reason"][value="' + reason + '"]', key);
            }

            function addOffTopicReasonHelper(root, reason, key) {
                addSiblingHelper(root, '[name="close-as-off-topic-reason"][value="' + reason + '"]', key);
            }

            function addMigrationHelper(root, reason, key) {
                addCousinHelper(root, '[name="migration"][value="' + reason + '"]', key);
            }

            function addHelpers(root) {
                addCloseReasonHelper(root, configuration.closeReasons.duplicate.value, configuration.closeReasons.duplicate.key);
                addCloseReasonHelper(root, configuration.closeReasons.offTopic.value, configuration.closeReasons.offTopic.key);
                addCloseReasonHelper(root, configuration.closeReasons.unclear.value, configuration.closeReasons.unclear.key);
                addCloseReasonHelper(root, configuration.closeReasons.tooBroad.value, configuration.closeReasons.tooBroad.key);
                addCloseReasonHelper(root, configuration.closeReasons.opinionBased.value, configuration.closeReasons.opinionBased.key);
                addOffTopicReasonHelper(root, configuration.offTopicReasons.superUser.value, configuration.offTopicReasons.superUser.key);
                addOffTopicReasonHelper(root, configuration.offTopicReasons.serverFault.value, configuration.offTopicReasons.serverFault.key);
                addOffTopicReasonHelper(root, configuration.offTopicReasons.recommend.value, configuration.offTopicReasons.recommend.key);
                addOffTopicReasonHelper(root, configuration.offTopicReasons.minimalProgram.value, configuration.offTopicReasons.minimalProgram.key);
                addOffTopicReasonHelper(root, configuration.offTopicReasons.typo.value, configuration.offTopicReasons.typo.key);
                addOffTopicReasonHelper(root, configuration.offTopicReasons.migration.value, configuration.offTopicReasons.migration.key);
                addOffTopicReasonHelper(root, configuration.offTopicReasons.other.value, configuration.offTopicReasons.other.key);
                addMigrationHelper(root, configuration.migrationReasons.meta.value, configuration.migrationReasons.meta.key);
                addMigrationHelper(root, configuration.migrationReasons.superUser.value, configuration.migrationReasons.superUser.key);
                addMigrationHelper(root, configuration.migrationReasons.tex.value, configuration.migrationReasons.tex.key);
                addMigrationHelper(root, configuration.migrationReasons.dba.value, configuration.migrationReasons.dba.key);
                addMigrationHelper(root, configuration.migrationReasons.stats.value, configuration.migrationReasons.stats.key);
            }

            observer = new MutationObserver(function (mutations) {
                mutations.forEach(function (mutation) {
                    var i, j, node;
                    for (i = 0, j = mutation.addedNodes.length; i < j; i = i + 1) {
                        node = mutation.addedNodes[i];
                        if (node.tagName === 'DIV' && node.id === 'popup-close-question') {
                            addHelpers(node);
                            return false;
                        }
                    }
                });
            });

            observer.observe(document.querySelector('.review-content'), { 'childList': true, 'subtree': true });
        }());
    });
}());
