// ==UserScript==
// @name           Stack-Exchange-Editor-Toolkit
// @author         Cameron Bernhardt (AstroCB)
// @developer      Jonathan Todd (jt0dd)
// @contributor    Unihedron
// @contributor    sathyabhat
// @namespace  http://github.com/AstroCB
// @version        1.0.2
// @description  Fix common grammar/usage annoyances on Stack Exchange posts with a click
// @include        http://*.stackexchange.com/questions/*
// @include        http://stackoverflow.com/questions/*
// @include        http://meta.stackoverflow.com/questions/*
// @include        http://serverfault.com/questions/*
// @include        http://meta.serverfault.com/questions/*
// @include        http://superuser.com/questions/*
// @include        http://meta.superuser.com/questions/*
// @include        http://askubuntu.com/questions/*
// @include        http://meta.askubuntu.com/questions/*
// @include        http://stackapps.com/questions/*
// @include        http://*.stackexchange.com/posts/*
// @include        http://stackoverflow.com/posts/*
// @include        http://meta.stackoverflow.com/posts/*
// @include        http://serverfault.com/posts/*
// @include        http://meta.serverfault.com/posts/*
// @include        http://superuser.com/posts/*
// @include        http://meta.superuser.com/posts/*
// @include        http://askubuntu.com/posts/*
// @include        http://meta.askubuntu.com/posts/*
// @include        http://stackapps.com/posts/*
// @exclude        http://*.stackexchange.com/questions/tagged/*
// @exclude        http://stackoverflow.com/questions/tagged/*
// @exclude        http://meta.stackoverflow.com/questions/tagged/*
// @exclude        http://serverfault.com/questions/tagged/*
// @exclude        http://meta.serverfault.com/questions/*
// @exclude        http://superuser.com/questions/tagged/*
// @exclude        http://meta.superuser.com/questions/tagged/*
// @exclude        http://askubuntu.com/questions/tagged/*
// @exclude        http://meta.askubuntu.com/questions/tagged/*
// @exclude        http://stackapps.com/questions/tagged/*
// ==/UserScript==
var main = function () {
    // Define app namespace
    var App = {};

    // Place edit items here
    App.items = [];

    // Place selected JQuery items here
    App.selections = {};

    // Place "global" app data here
    App.globals = {};

    // Place "helper" functions here
    App.funcs = {};

    //Preload icon alt

    var SEETicon = new Image();

    SEETicon.src = 'http://i.imgur.com/d5ZL09o.png';

    // Populate global data

    // Get url for question id used in id and class names
    App.globals.URL = window.location.href;

    // Get question num from URL
    App.globals.questionNum = App.globals.URL.match(/\/(\d+)\//g);
    App.globals.questionNum = App.globals.questionNum[0].split("/").join("");

    // Define variables for later use
    App.globals.barReady = false;
    App.globals.editsMade = false;
    App.globals.editCount = 0;
    App.globals.infoContent = '';

    App.globals.spacerHTML = '<li class="wmd-spacer wmd-spacer3" id="wmd-spacer3-' + App.globals.questionNum + '" style="left: 400px !important;"></li>';
    App.globals.buttonHTML = '<div id="ToolkitButtonWrapper"><button class="wmd-button" id="ToolkitFix"></button><div id="ToolkitInfo"></div></div>';

    App.globals.reasons = [];
    App.globals.numReasons = 0;

    App.globals.replacedStrings = {
        "block": [],
            "inline": []
    };
    App.globals.placeHolders = {
        "block": "_xCodexBlockxPlacexHolderx_",
            "inline": "_xCodexInlinexPlacexHolderx_"
    };
    App.globals.checks = {
        "block": /(    )+.*/gm,
        "inline": /`.*`/gm
    };

    // Assign modules here
    App.globals.pipeMods = {};

    // Define order in which mods affect  here
    App.globals.order = [
        "omit",
        "edit",
    	"replace"];


    // Define edit rules
    App.edits = {
        i: {
            expr: /(^|\s|\()i(\s|,|\.|!|\?|;|\/|\)|'|$)/gm,
            replacement: "$1I$2",
            reason: "in English, the pronoun 'I' is capitalized"
        },
        so: {
            expr: /(^|\s)[Ss]tack\s*overflow|StackOverflow(.|$)/gm,
            replacement: "$1Stack Overflow$2",
            reason: "'Stack Overflow' is the proper capitalization"
        },
        se: {
            expr: /(^|\s)[Ss]tack\s*exchange|StackExchange(.|$)/gm,
            replacement: "$1Stack Exchange$2",
            reason: "'Stack Exchange' is the proper capitalization"
        },
        expansionSO: {
            expr: /(^|\s)SO(\s|,|\.|!|\?|;|\/|\)|$)/gm,
            replacement: "$1Stack Overflow$2",
            reason: "'SO' expansion"
        },
        expansionSE: {
            expr: /(^|\s)SE(\s|,|\.|!|\?|;|\/|\)|$)/gm,
            replacement: "$1Stack Exchange$2",
            reason: "'SE' expansion"
        },
        javascript: {
            expr: /(^|\s)[Jj]ava\s*script(.|$)/gm,
            replacement: "$1JavaScript$2",
            reason: "'JavaScript' is the proper capitalization"
        },
        jsfiddle: {
            expr: /(^|\s)[Jj][Ss]\s+[Ff]iddle(.|$)/gm,
            replacement: "$1JSFiddle$2",
            reason: "'JSFiddle' is the currently accepted capitalization"
        },
        caps: {
            expr: /^(?!https?)([a-z])/gm,
            replacement: "$1",
            reason: "basic capitalization"
        },
        jquery: {
            expr: /(^|\s)[Jj][Qq]uery(.|$)/gm,
            replacement: "$1jQuery$2",
            reason: "'jQuery' is the proper capitalization"
        },
        html: {
            expr: /(^|\s)[Hh]tml(5|\s|$)/gm,
            replacement: "$1HTML$2",
            reason: "HTML stands for HyperText Markup Language"
        },
        css: {
            expr: /(^|\s)[Cc]ss(\s|$)/gm,
            replacement: "$1CSS$2",
            reason: "CSS stands for Cascading Style Sheets"
        },
        json: {
            expr: /(^|\s)[Jj]son(\s|$)/gm,
            replacement: "$1JSON$2",
            reason: "JSON stands for JavaScript Object Notation"
        },
        ajax: {
            expr: /(^|\s)[Aa]jax(\s|$)/gm,
            replacement: "$1AJAX$2",
            reason: "AJAX stands for Asynchronous JavaScript and XML"
        },
        angular: {
            expr: /[Aa]ngular[Jj][Ss]/g,
            replacement: "AngularJS",
            reason: "'AngularJS is the proper capitalization"
        },
        thanks: {
            expr: /(thanks|pl[ease|z|s]\s+h[ea]lp|cheers|regards|thx|thank\s+you|my\s+first\s+question).*$/gmi,
            replacement: "",
            reason: "'$1' is unnecessary noise"
        },
        commas: {
            expr: /,([^\s])/g,
            replacement: ", $1",
            reason: "punctuation & spacing"
        },
        php: {
            expr: /(^|\s)[Pp]hp(\s|$)/gm,
            replacement: "$1PHP$2",
            reason: "PHP stands for PHP: Hypertext Preprocessor"
        },
        hello: {
            expr: /(?:^|\s)(hi\s+guys|good\s(?:evening|morning|day|afternoon))(?:\.|!)/gmi,
            replacement: "",
            reason: "greetings like '$1' are unnecessary noise"
        },
        edit: {
            expr: /(?:^\**)(edit|update):?(?:\**):?/gmi,
            replacement: "",
            reason: "Stack Exchange has an advanced revision history system: 'Edit' or 'Update' is unnecessary"
        },
        voting: {
            expr: /([Dd]own|[Uu]p)[\s*\-]vot/g,
            replacement: "$1vote",
            reason: "the proper spelling (despite the tag name) is '$1vote' (one word)"
        },
        mysite: {
            expr: /mysite\./g,
            replacement: "example.",
            reason: "links to mysite.domain are not allowed: use example.domain instead"
        },
        c: {
          expr: /(^|\s)c(#|\++|\s|$)/gm,
          replacement: "$1C$2",
          reason: "capitalized C$2"
        },
        java: {
          expr: /(^|\s)java(\s|$)/gmi,
          replacement: "$1Java$2",
          reason: "capitalized Java"
        },
        android: {
          expr: /(^|\s)android(\s|$)/gmi,
          replacement: "$1Android$2",
          reason: "capitalized Android"
        },
        oracle: {
          expr: /(^|\s)oracle(\s|$)/gmi,
          replacement: "$1Oracle$2",
          reason: "capitalized Oracle"
        },
        windows: {
          expr:  /(win(?:\ ?)(xp|vista|[0-9]+)|window(?:s?))(\s|$)/igm,
          replacement: "Windows $2$3",
          reason: "corrected Windows"
        },
        apostrophes: {
          expr: /(^|\s)(can|doesn|don|won|hasn|isn|didn)t(\s|$)/gmi,
          replacement: "$1$2't$3",
          reason: "contractions are with apostrophes"
        }

        // Expansion reminder: let's support those non web devs with capitalization for popular languages such as C#
    };

    // Populate funcs
    App.popFuncs = function () {
        // This is where the magic happens: this function takes a few pieces of information and applies edits to the post with a couple exceptions
        App.funcs.fixIt = function (input, expression, replacement, reasoning) {

            // Scan the post text using the expression to see if there are any matches
            var match = input.search(expression);
            // If so, increase the number of edits performed (used later for edit summary formation)
            if (match !== -1) {
                App.globals.editCount++;

                // Later, this will store what is removed for the first case
                var phrase;

                // Then, perform the edits using replace()
                // What follows is a series of exceptions, which I will explain below; I perform special actions by overriding replace()

                // This is used for removing things entirely without giving a replacement; it matches the expression and then replaces it with nothing

                if (replacement === "") {
                    input = input.replace(expression, function (data, match1) {

                        // Save what is removed for the edit summary (see below)
                        phrase = match1;

                        // Replace with nothing
                        return "";
                    });

                    // This is an interesting tidbit: if you want to make the edit summaries dynamic, you can keep track of a match that you receive
                    //from overriding the replace() function and then use that in the summary
                    reasoning = reasoning.replace("$1", phrase);

                    // This allows me to combine the upvote and downvote replacement schemes into one
                } else if (replacement == "$1vote") {
                    input = input.replace(expression, function (data, match1) {
                        phrase = match1;
                        return phrase + "vot";
                    });
                    reasoning = reasoning.replace("$1", phrase.toLowerCase());

                    // This is used to capitalize letters; it merely takes what is matched, uppercases it, and replaces what was matched with the uppercased verison
                } else if (replacement === "$1") {
                    input = input.replace(expression, function (data, match1) {
                        return match1.toUpperCase();
                    });

                    // I can use C, C#, and C++ capitalization in one rule
                } else if (replacement === "$1C$2"){
                    var newPhrase;
                    input = input.replace(expression, function (data, match1, match2) {
                        newPhrase = match2;
                        return match1 + "C" + match2;
                    });
                    reasoning = reasoning.replace("$2", newPhrase);

                    // Default: just replace it with the indicated replacement
                } else {
                    input = input.replace(expression, replacement);
                }

                // Return a dictionary with the reasoning for the fix and what is edited (used later to prevent duplicates in the edit summary)
                return {
                    reason: reasoning,
                    fixed: input
                };
            } else {

                // If nothing needs to be fixed, return null
                return null;
            }
        };

        // Omit code
        App.funcs.omitCode = function (str, type) {
            str = str.replace(App.globals.checks[type], function (match) {
                App.globals.replacedStrings[type].push(match);
                return App.globals.placeHolders[type];
            });
            return str;
        };

        // Replace code
        App.funcs.replaceCode = function (str, type) {
            for (var i = 0; i < App.globals.replacedStrings[type].length; i++) {
                str = str.replace(App.globals.placeHolders[type], App.globals.replacedStrings[type][i]);
            }
            return str;
        };

        // Eliminate duplicates in array (awesome method I found on SO, check it out!)
        // From AstroCB: the original structure of the edit formation prevents duplicates.
        // Unless you changed that structure somehow, this shouldn't be needed.
        App.funcs.eliminateDuplicates = function (arr) {
            var i,
            len = arr.length,
            out = [],
            obj = {};

            for (i = 0; i < len; i++) {
                obj[arr[i]] = 0;
            }
            for (i in obj) {
              if(obj.hasOwnProperty(i)){ // Prevents messiness of for..in statements
                out.push(i);
              }
            }
            return out;
        };

        // Wait for relevant dynamic content to finish loading
        App.funcs.dynamicDelay = function (callback, id, inline) {
          if(inline){ // Inline editing
            setTimeout(function(){
              App.selections.buttonBar = $('#wmd-button-bar-' + id);
              App.selections.buttonBar.unbind();
              setTimeout(function () {
                  callback();
              }, 0);
            }, 500);
          }else{ // Question page editing
            App.selections.buttonBar = $('#wmd-button-bar-' + id);
            // When button bar updates, dynamic DOM is ready for selection
            App.selections.buttonBar.unbind().on('DOMSubtreeModified', function () {
                // Avoid running it more than once
                if (!App.globals.barReady) {
                    App.globals.barReady = true;

                    // Run asynchronously - this lets the bar finish updating before continuing
                    setTimeout(function () {
                        callback();
                    }, 0);
                }
            });
          }
        };

        // Populate or refresh DOM selections
        App.funcs.popSelections = function () {
            App.selections.redoButton = $('#wmd-redo-button-' + App.globals.questionNum);
            App.selections.bodyBox = $(".wmd-input");
            App.selections.titleBox = $(".ask-title-field");
            App.selections.summaryBox = $("#edit-comment");
        };

        // Populate edit item sets from DOM selections - currently does not support inline edits
        App.funcs.popItems = function () {
            App.items[0] = {
                title: App.selections.titleBox.val(),
                body: App.selections.bodyBox.val(),
                summary: ''
            };
        };

        // Insert editing button(s)
        App.funcs.createButton = function () {

            // Insert button
            App.selections.redoButton.after(App.globals.buttonHTML);

            // Insert spacer
            App.selections.redoButton.after(App.globals.spacerHTML);

            // Add new elements to selections
            App.selections.buttonWrapper = $('#ToolkitButtonWrapper');
            App.selections.buttonFix = $('#ToolkitFix');
            App.selections.buttonInfo = $('#ToolkitInfo');
        };

        // Style button
        App.funcs.styleButton = function () {
            App.selections.buttonWrapper.css({
                'position': 'relative',
                    'left': '430px'
            });
            App.selections.buttonFix.css({
                'position': 'static',
                    'float': 'left',
                    'border-width': '0px',
                    'background-color': 'white',
                    'background-image': 'url("http://i.imgur.com/79qYzkQ.png")',
                    'background-size': '100% 100%',
                    'width': '18px',
                    'height': '18px',
                    'outline': 'none'
            });
            App.selections.buttonInfo.css({
                'position': 'static',
                    'float': 'left',
                    'margin-left': '5px',
                    'font-size': '12px',
                    'color': '#424242',
                    'line-height': '19px'
            });

            App.selections.buttonFix.hover(function () {
                App.globals.infoContent = App.selections.buttonInfo.text();
                App.selections.buttonInfo.text('Fix the content!');
                App.selections.buttonFix.css({
                    'background-image': 'url("http://i.imgur.com/d5ZL09o.png")'
                });
            }, function () {
                App.selections.buttonInfo.text(App.globals.infoContent);
                App.selections.buttonFix.css({
                    'background-image': 'url("http://i.imgur.com/79qYzkQ.png")'
                });
            });
        };

        // Listen to button click
        App.funcs.listenButton = function () {
            App.selections.buttonFix.click(function (e) {
                e.preventDefault();
                if (!App.globals.editsMade) {

                    // Refresh item population
                    App.funcs.popItems();

                    // Pipe data through editing modules
                    App.pipe(App.items, App.globals.pipeMods, App.globals.order);
                    App.globals.editsMade = true;
                }
            });
        };

        // Handle pipe output
        App.funcs.output = function (data) {
            App.selections.titleBox.val(data[0].title);
            App.selections.bodyBox.val(data[0].body);
            App.selections.summaryBox.val(data[0].summary);

            // Update the comment: focusing on the input field to remove placeholder text,
            //but scroll back to the user's original location
            var currentPos = document.body.scrollTop;
            $("#wmd-input").focus();
            $("#edit-comment").focus();
            $("#wmd-input").focus();
            window.scrollTo(0, currentPos);
            App.globals.infoContent = App.globals.editCount + ' changes made';
            App.selections.buttonInfo.text(App.globals.editCount + ' changes made');
        };
    };

    // Pipe data through modules in proper order, returning the result
    App.pipe = function (data, mods, order) {
        var modName;
        for (var i in order) {
          if(order.hasOwnProperty(i)){
            modName = order[i];
            data = mods[modName](data);
          }
        }
        App.funcs.output(data);
    };

    // Init app
    App.init = function (inline, targetID) {
      // Check if there was an ID passed (if not, use question ID from URL);
      if(!targetID){
        targetID = App.globals.questionNum;
      }
        App.popFuncs();
        App.funcs.dynamicDelay(function () {
            App.funcs.popSelections();
            App.funcs.createButton();
            App.funcs.styleButton();
            App.funcs.popItems();
            App.funcs.listenButton();
        }, targetID, inline);
    };

    App.globals.pipeMods.omit = function (data) {
        data[0].body = App.funcs.omitCode(data[0].body, "block");
        data[0].body = App.funcs.omitCode(data[0].body, "inline");
        return data;
    };

    App.globals.pipeMods.replace = function(data){
        data[0].body = App.funcs.replaceCode(data[0].body, "block");
        data[0].body = App.funcs.replaceCode(data[0].body, "inline");
        return data;
    };

    App.globals.pipeMods.edit = function (data) {

        // Visually confirm edit - SE makes it easy because the jQuery color animation plugin seems to be there by default
        App.selections.bodyBox.animate({
            backgroundColor: '#c8ffa7'
        }, 10);
        App.selections.bodyBox.animate({
            backgroundColor: '#fff'
        }, 1000);

        // Loop through all editing rules
        for (var j in App.edits) {
            if (App.edits.hasOwnProperty(j)) {
                // Check body
                var fix = App.funcs.fixIt(data[0].body, App.edits[j].expr, App.edits[j].replacement, App.edits[j].reason);
                if (fix) {
                    App.globals.reasons[App.globals.numReasons] = fix.reason;
                    data[0].body = fix.fixed;
                    App.globals.numReasons++;
                    App.edits[j].fixed = true;
                }

                // Check title
                fix = App.funcs.fixIt(data[0].title, App.edits[j].expr, App.edits[j].replacement, App.edits[j].reason);
                if (fix) {
                    data[0].title = fix.fixed;
                    if (!App.edits[j].fixed) {
                        App.globals.reasons[App.globals.numReasons] = fix.reason;
                        App.globals.numReasons++;
                        App.edits[j].fixed = true;
                    }
                }
            }
        }

        // Eliminate duplicate reasons
        App.globals.reasons = App.funcs.eliminateDuplicates(App.globals.reasons);

        for (var z = 0; z < App.globals.reasons.length; z++) {

            // Check that summary is not getting too long
            if (data[0].summary.length < 200) {

                // Capitalize first letter
                if (z === 0) {
                    data[0].summary += App.globals.reasons[z][0].toUpperCase() + App.globals.reasons[z].substring(1);

                // Post rest of reasons normally
                } else {
                    data[0].summary += App.globals.reasons[z];
                }

                // Not the last reason
                if (z !== App.globals.reasons.length - 1) {
                    data[0].summary += "; ";

                    // If at end, punctuate
                } else {
                    data[0].summary += ".";
                }
            }
        }

        return data;
    };

    if($(".edit-post")[0]) { // User has editing privileges; wait for button press
      $(".edit-post").click(function(e) {
          App.init(true, e.target.href.match(/\d/g).join("")); // If there are multiple posts, we need to pass the post ID
      });
    } else { // User does not have editing privileges or is editing on question page; start immediately
      App.init(false);
    }
};

// Inject the main script
var script = document.createElement('script');
script.type = "text/javascript";
script.textContent = '(' + main.toString() + ')();';
document.body.appendChild(script);
