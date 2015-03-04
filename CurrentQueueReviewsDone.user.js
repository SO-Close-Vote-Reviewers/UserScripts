// ==UserScript==
// @name         Current Completed Reviews in Queue
// @namespace    http://stackoverflow.com/users/578411/rene
// @version      0.2
// @description  Adds the current number of reviews you have completed in the queue in front of your total reviews on the review tab
// @author       Rene, SOCVR
// @match        http://stackoverflow.com/review/*
// @grant        none
// ==/UserScript==

// this script comes from the request here: http://meta.stackexchange.com/q/250580/213671
// rene originally made this: http://meta.stackexchange.com/a/250622/213671

(function($, window) {

    var parts,
        statsurl,
        currenthref = window.location.href,
        // here we put our stat
        stat = $('<div></div>')
        .html('...&nbsp;/&nbsp;')
        .css('float','left')
        .css('padding-top','13px');

    function buildUrl() {
        // build the stats url
        parts = window.location.pathname.split('/');
        if (parts.length>3) {
           parts[parts.length-1] = 'stats';
        } else {
            parts.push('stats');
        }
        return parts.join('/');
    }

    statsurl = buildUrl();

    // integate in the review page
    $('#badge-progress').prepend(stat);

    // get the (fullblown) stats page and find your own stat
    function refreshstat() {
        $.get(statsurl, function (data) {
            var html = $(data),
                td = html.find('td.review-stats-count-current-user:first');
            // replace our current stat with the just loaded one
            stat.html(td.text() + '&nbsp;/&nbsp;');    
        }).fail(function(prom, error, msg) {
            debugger;
            if (msg === 'Not Found') {
                // the url is not correct, try a new one
                statsurl = buildUrl();
            }
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
