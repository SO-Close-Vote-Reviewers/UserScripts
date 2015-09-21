// ==UserScript==
// @name         find reviews
// @namespace    http://stackoverflow.com/users/578411/rene
// @version      0.2
// @description  find reviews from the history pages 
// @author       rene
// @match        *://stackoverflow.com/review/*/history
// @grant        none
// ==/UserScript==

(function($) {
    var hdr = $('.subheader h1');
    
    // search on single review page
    function searchPage(postid, page) {
        // get the specific page
        $.get(window.location + '/?page=' + page, function(data) {
            var $reviews = $(data),
                result = {},
                // check if post id is in the link
                $qlink = $reviews.find('a.question-hyperlink[href*="/' + postid + '/"]'),
                $review;
            // maybe answers
            if ($qlink.length === 0) {
                   $qlink = $reviews.find('a.answer-hyperlink[href*="/' + postid + '#"]');
            }
            if ($qlink.length > 0) {
                // find the review task by navigating up the dom
                // to the row
                // and then take the 3 table cell
                // which holds the a href to the reviewtask
                $review = $($qlink.parent().parent().find('td')[2]).find('a');
                // build our result object
                result = {text: 'found', url: $review.attr('href')};
            } else {
                // stop if search needs to go beyond an insane amount of pages
                if (page < 100) {
                    // prevent getting throttled
                    window.setTimeout( function () { searchPage(postid, page + 1);} , 500); // 500 ms 
                    // some feedback
                    result = { text: 'page ' + page + '...' , url: window.location + '/?page='+page };
                } else {
                    // bail out 
                    result = { text: 'no results in 100 pages', url: window.location + '/?page='+page};
                }
            }
            // show result object
            $('#search-result').attr('href', result.url).text(result.text);
        });
    }
    
    // gets the postid from the input box
    function startSearch() {
        var inp = $('#search-review').val(),
            page = 1;
        $('#search-result').attr('href', '#').text('starting').show();
        searchPage(inp, page);
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
