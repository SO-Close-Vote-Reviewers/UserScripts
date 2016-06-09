// ==UserScript==
// @name         Close Reason Under Title
// @namespace    https://github.com/SO-Close-Vote-Reviewers/UserScripts
// @version      0.1
// @description  In the event a close vote has already been cast, put the close reason under the title.  Bottom Line Up Front and all that.
// @author       Richard Slater
// @match        *://stackoverflow.com/questions/*
// @grant        none
// ==/UserScript==

(function() {
    'use strict';

    $(document).ready(function() {
        if ($(".close-question-link").attr("title").substr(0, 21) === "You voted to close as") {
            var closeReason = $(".close-question-link").attr("title").split(".")[0];
            $("#question-header").append("<div style='background-color:#FFFFE0;padding: 1em; margin-bottom: 0.5em;'>" + closeReason + "</div>");
        }
    });
})();
