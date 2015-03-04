// ==UserScript==
// @name         Current Completed Reviews in Queue
// @namespace    http://stackoverflow.com/users/578411/rene
// @version      0.1
// @description  Adds the current number of reviews you have completed in the queue in front of your total reviews on the review tab
// @author       Rene, SOCVR
// @match        http://stackoverflow.com/review/*
// @grant        none
// ==/UserScript==

(function($, window) {

    var parts,
        statsurl,
        currenthref = window.location.href,
        // here we put our stat
        stat = $('<div></div>')
        .html('...&nbsp;/&nbsp;')
        .css('float','left')
        .css('padding-top','13px');

    // build the stats url
    parts = window.location.pathname.split('/');
    parts[parts.length-1] = 'stats';

    statsurl = parts.join('/');

    // integate in the review page
    $('#badge-progress').prepend(
            stat);

    // get the (fullblown) stats page and find your own stat
    function refreshstat() {
        $.get(statsurl, function (data) {
            var html = $(data),
                td = html.find('td.review-stats-count-current-user:first');
            // replace our current stat with the just loaded one
            stat.html(td.text() + '&nbsp;/&nbsp;');    
        });
    }

    // check regularly (every 5 seconds) if we done a review yet
    window.setInterval(function () {
        // if the url changed, lets get the new stat
        if (window.location.href !== currenthref) {
            currenthref = window.location.href;
            refreshstat();
        }
    }, 5000); // now 5 seconds because we hardly ever review quicker than that
    refreshstat(); // run once for an initial value

}($ || unsafeWindow.$, window || unsafeWindow));
