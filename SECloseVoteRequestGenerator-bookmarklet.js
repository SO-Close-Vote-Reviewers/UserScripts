//
// Version 1.0.2
//
//The bookmarklet is minified in order to fit in the 2088 character limit imposed by some browsers (e.g. IE, Edge).
//The minified bookmarklet was produced by running the code below through:
//  uglifyjs SECloseVoteRequestGenerator-bookmarklet.js --compress collapse_vars,reduce_vars --beautify beautify=false,quote_style=1 --mangle toplevel | sed -e "s/^\!/javascript:void\(/" -e 's/;$/)/' > SECloseVoteRequestGenerator-bookmarklet.min.js
//uglifyjs can be found at: https://github.com/mishoo/UglifyJS2

//Formatted source for bookmarklet
javascript:void((function() {
    function restoreHistory(){
        //Restore the original location, if possible.
        try {
            history.replaceState({}, '', currentLocation);
        } catch(e) {
        }
    }
    var reasons = {
        't': 'Too Broad',
        'u': 'Unclear',
        'p': 'Primarily Opinion Based',
        'o': 'Opinion Based',
        'd': 'Duplicate',
        'm': 'No MCVE',
        'r': 'Typo or Cannot Reproduce',
        'g': 'General Computing',
        's': 'Super User',
        'f': 'Server Fault',
        'l': 'Request for Off-Site Resource',
        get: function(r) {
            var a = r.split(' ');
            a.forEach(function(v, i) {
                a[i] = reasons.hasOwnProperty(v) && v !== 'get' ? reasons[v] : v;
            });
            return a.join(' ');
        }
    };
    var win = window;
    var winLocation = win.location;
    var currentLocation = winLocation.href;
    var $win = $(win);
    var scroll = $win.scrollTop();
    var notify = StackExchange.notify;
    var notifyId = 483912;
    var success;
    var reqType = ($('.special-status .question-status H2 B').filter(function() {
        return /hold|closed|marked/i.test($(this).text()); 
    }).length ? 'reopen' : 'cv') + '-pls';
    var base = 'https://' + winLocation.hostname;
    var reason = window.prompt('Request reason:', '');
    if (!reason) {
        restoreHistory();
        return;
    }
    reason = reasons.get(reason);
    var title = '[' + $('#question-header h1 a').text().replace(/(\[|\])/g, '\\$1').replace(/^\s+|\s+$/gm, '') + '\u202D](' + base + $('#question .short-link').attr('href') + ')';
    var user = $('.post-signature:not([align=\'right\'],#popup-close-question .post-signature) .user-details').text().trim().match(/[^\n]+/)[0].trim();
    var time;
    var tag = $('#question a.post-tag').first().text();
    var owner = $('#question .owner:not(#popup-close-question .owner)');
    var ownerLink = $('a', owner);
    if (ownerLink.length) {
        user = '[' + user + '](' + base + ownerLink.attr('href') + ')';
    }
    var timeEl = $('.relativetime', owner);
    if (timeEl.length) {
        time = timeEl.attr('title');
    }
    var result = '[tag:' + reqType + '] [tag:' + tag + '] ' + reason + ' ' + title + ' - ' + user + (time ? '\u202D - ' + time : '');
    var resultInTextArea = '<textarea class=\'cvrg-result\' style=\'width:95%;display:block;margin:10px auto;\'>' + result + '</textarea>';
    var textarea = $(resultInTextArea).appendTo(document.body);
    var textForYour = 'The text for your ' + reqType;
    try {
        //Try to copy the text to the clipboard
        textarea[0].select();
        success = document.execCommand('copy');
        //If failed, go with notification of text.
        if (!success) throw 1;
        var copiedToClipboadText = 'been copied to the clipboard.';
        var message = textForYour + ' has ' + copiedToClipboadText;
        //Notify the user that the request has been copied to the clipboard.
        notify.show(message, notifyId);
        setTimeout(notify.close, 3000, notifyId);
    } catch (e) {
        //If something goes wrong, fallback to StackExchange.notify().
        var note1 = textForYour + ' is:';
        var note2 = resultInTextArea;
        var note3 = 'It has ' + (success ? '' : 'NOT ') + copiedToClipboadText;
        try {
            notify.show(note1 + note2 + note3 + ' You can press Ctrl-C now to copy it.', notifyId);
        } catch (e) {
            //If something goes wrong again, fallback to alert().
            alert(note1 + '\n\n' + result + '\n\n' + note3);
        }
    }
    textarea.remove();
    $win.scrollTop(scroll);
    loopCount = 0;
    setTimeout(function loop(){
        loopCount++;
        var notifyTextarea = $('.cvrg-result');
        if(notifyTextarea.length) {
            notifyTextarea[0].select();
            restoreHistory();
        } else if(loopCount < 100){
            setTimeout(loop, 200);
        } else {
            restoreHistory();
        }
    }, 200);
})())