// ==UserScript==
// @name         find reviews
// @namespace    http://stackoverflow.com/users/578411/rene
// @version      0.5
// @description  find reviews from the history pages 
// @author       rene
// @match        *://stackoverflow.com/review/*/history
// @match        *://*.stackexchange.com/review/*/history
// @match        *://*.superuser.com/review/*/history
// @match        *://*.serverfault.com/review/*/history
// @match        *://*.askubuntu.com/review/*/history
// @match        *://*.stackapps.com/review/*/history
// @match        *://*.mathoverflow.net/review/*/history
// @grant        none
// ==/UserScript==

/* global $: true */

(function($) {
    var hdr = $('.s-page-title--header'); // not a JS hook but there is nothing else to go on

    // search on single review page
    function searchPage(postid, page) {
        // get the specific page
        $.get(window.location + '/?page=' + page, function(data) {
            var $reviews = $(data),
                result = {},
                // check if post id is in the link
                $qlink = $reviews.find('#content a[href*="/questions/' + postid + '/"]'),
                $review;
            // maybe answers
            if ($qlink.length === 0) {
                   $qlink = $reviews.find('#content a[href*="/answers/' + postid + '#"]');
            }
            if ($qlink.length > 0) {
                // find the review task by navigating up the dom
                // to the row
                // and then take the 3 table cell
                // which holds the a href to the reviewtask
                $review = $($qlink.parent().parent().find('td')[2]).find('a');
                // build our result object
                result = {text: 'found', url: $review.attr('href')};
                state = 0;
            } else {
                // stop if search needs to go beyond an insane amount of pages
                if (page < 400) {
                    // prevent getting throttled
                    if (state === 1) {
                        window.setTimeout( function () { searchPage(postid, page + 1);} , 500); // 500 ms
                        // some feedback
                        result = { text: 'page ' + page + '...' , url: window.location + '/?page='+page };
                    } else {
                        result = { text: 'stopped on page ' + page, url: window.location + '/?page='+page };
                        state = 0;
                    }
                } else {
                    // bail out
                    result = { text: 'no results in 400 pages', url: window.location + '/?page='+page};
                    state = 0;
                }
            }
            // show result object
            $('#search-result').attr('href', result.url).text(result.text);
        });
    }

    var state = 0;
    // gets the postid from the input box
    function startSearch() {
        var inp = $('#search-review').val(),
            page = 1;
        if (state === 0) {
          $('#search-result').attr('href', '#').text('starting').show();
          searchPage(inp, page);
        }

        state++;
    }

    // if you hate how things looks, apply css fu here
    hdr.append(
        $('<div id="search-for-review"></div>')
        .css('display','inline-block')
        .append(
            $('<input id="search-review" type="text"/>'))
        .append(
            $('<input type="button" />&nbsp;')
            .prop('value', 'find review')
            .on('click', startSearch))
        .append(
            $('<a id="search-result"></a>').hide()));
}($));
