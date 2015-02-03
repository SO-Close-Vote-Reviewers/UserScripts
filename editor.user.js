// ==UserScript==
// @name           Stack-Exchange-Editor-Toolkit
// @author         Cameron Bernhardt (AstroCB)
// @developer      Jonathan Todd (jt0dd)
// @developer      sathyabhat
// @contributor    Unihedron
// @namespace  http://github.com/AstroCB
// @version        1.3.0
// @description  Fix common grammar/usage annoyances on Stack Exchange posts with a click
// @include        *://*.stackexchange.com/questions/*
// @include        *://stackoverflow.com/questions/*
// @include        *://meta.stackoverflow.com/questions/*
// @include        *://serverfault.com/questions/*
// @include        *://meta.serverfault.com/questions/*
// @include        *://superuser.com/questions/*
// @include        *://meta.superuser.com/questions/*
// @include        *://askubuntu.com/questions/*
// @include        *://meta.askubuntu.com/questions/*
// @include        *://stackapps.com/questions/*
// @include        *://*.stackexchange.com/posts/*
// @include        *://stackoverflow.com/posts/*
// @include        *://meta.stackoverflow.com/posts/*
// @include        *://serverfault.com/posts/*
// @include        *://meta.serverfault.com/posts/*
// @include        *://superuser.com/posts/*
// @include        *://meta.superuser.com/posts/*
// @include        *://askubuntu.com/posts/*
// @include        *://meta.askubuntu.com/posts/*
// @include        *://stackapps.com/posts/*
// @exclude        *://*.stackexchange.com/questions/tagged/*
// @exclude        *://stackoverflow.com/questions/tagged/*
// @exclude        *://meta.stackoverflow.com/questions/tagged/*
// @exclude        *://serverfault.com/questions/tagged/*
// @exclude        *://meta.serverfault.com/questions/*
// @exclude        *://superuser.com/questions/tagged/*
// @exclude        *://meta.superuser.com/questions/tagged/*
// @exclude        *://askubuntu.com/questions/tagged/*
// @exclude        *://meta.askubuntu.com/questions/tagged/*
// @exclude        *://stackapps.com/questions/tagged/*
// ==/UserScript==
var main = function() {
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

    SEETicon.src = '//i.imgur.com/d5ZL09o.png';

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
    App.globals.order = ["omit", "edit", "replace"];


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
            reason: "'Stack Overflow' is the legal name"
        },
        se: {
            expr: /(^|\s)[Ss]tack\s*exchange|StackExchange(.|$)/gm,
            replacement: "$1Stack Exchange$2",
            reason: "'Stack Exchange' is the legal name"
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
            reason: "copy edited"
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
            expr: /(^|\s)ajax(\s|$)/gm,
            replacement: "$AJAX$2",
            reason: "AJAX stands for Asynchronous JavaScript and XML"
        },
        angular: {
            expr: /[Aa]ngular[Jj][Ss]/g,
            replacement: "AngularJS",
            reason: "'AngularJS is the proper capitalization"
        },
        thanks: {
            expr: /(thanks|pl[ease|z|s]\s+h[ea]lp|cheers|regards|thx|thank\s+you|my\s+first\s+question|kindly\shelp).*$/gmi,
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
            expr: /(?:^|\s)(hi\s+guys|hi|hello|good\s(?:evening|morning|day|afternoon))(?:\.|!|\ )/gmi,
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
            reason: "C$2 is the proper capitalization"
        },
        java: {
            expr: /(^|\s)java(\s|$)/gmi,
            replacement: "$1Java$2",
            reason: "Java should be capitalized"
        },
        sql: {
            expr: /(^|\s)[Ss]ql(\s|$)/gm,
            replacement: "$1SQL$2",
            reason: "SQL is the proper capitalization"
        },
        sqlite: {
            expr: /(^|\s)[Ss]qlite([0-9]*)(\s|$)/gm,
            replacement: "$1SQLite$2$3",
            reason: "SQLite is the proper capitalization"
        },
        android: {
            expr: /(^|\s)android(\s|$)/gmi,
            replacement: "$1Android$2",
            reason: "Android should be capitalizaed"
        },
        oracle: {
            expr: /(^|\s)oracle(\s|$)/gmi,
            replacement: "$1Oracle$2",
            reason: "Oracle should be capitalized"
        },
        windows: {
            expr: /(win(?:\ ?)(\sxp|\svista|\s[0-9]+)|window(?:s?))(\s|$)/igm,
            replacement: "Windows$2$3",
            reason: "Windows should be capitalized"
        },
        ubuntu: {
            expr: /(ubunto|ubunut|ubunutu|ubunu|ubntu|ubutnu|ubanto[o?]|unbuntu|ubunt|ubutu)(\s|$)/igm,
            replacement: "Ubuntu$2",
            reason: "corrected Ubuntu spelling"
        },
        linux: {
            expr: /(linux)(\s|$)/igm,
            replacement: "Linux$2",
            reason: "Linux should be capitalized"
        },
        apostrophes: {
            expr: /(^|\s)(can|doesn|don|won|hasn|isn|didn)t(\s|$)/gmi,
            replacement: "$1$2't$3",
            reason: "English contractions use apostrophes"
        }
    };

    // Populate funcs
    App.popFuncs = function() {
        // This is where the magic happens: this function takes a few pieces of information and applies edits to the post with a couple exceptions
        App.funcs.fixIt = function(input, expression, replacement, reasoning) {
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
                    input = input.replace(expression, function(data, match1) {
                        // Save what is removed for the edit summary (see below)
                        phrase = match1;

                        // Replace with nothing
                        return "";
                    });

                    // This is an interesting tidbit: if you want to make the edit summaries dynamic, you can keep track of a match that you receive
                    // from overriding the replace() function and then use that in the summary
                    reasoning = reasoning.replace("$1", phrase);

                    // This allows me to combine the upvote and downvote replacement schemes into one
                } else if (replacement == "$1vote") {
                    input = input.replace(expression, function(data, match1) {
                        phrase = match1;
                        return phrase + "vot";
                    });
                    reasoning = reasoning.replace("$1", phrase.toLowerCase());

                    // This is used to capitalize letters; it merely takes what is matched, uppercases it, and replaces what was matched with the uppercased version
                } else if (replacement === "$1") {
                    input = input.replace(expression, function(data, match1) {
                        return match1.toUpperCase();
                    });

                    // I can use C, C#, and C++ capitalization in one rule
                } else if (replacement === "$1C$2") {
                    var newPhrase;
                    input = input.replace(expression, function(data, match1, match2) {
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
        App.funcs.omitCode = function(str, type) {
            str = str.replace(App.globals.checks[type], function(match) {
                App.globals.replacedStrings[type].push(match);
                return App.globals.placeHolders[type];
            });
            return str;
        };

        // Replace code
        App.funcs.replaceCode = function(str, type) {
            for (var i = 0; i < App.globals.replacedStrings[type].length; i++) {
                str = str.replace(App.globals.placeHolders[type],
                    App.globals.replacedStrings[type][i]);
            }
            return str;
        };

        // Eliminate duplicates in array (awesome method I found on SO, check it out!)
        // From AstroCB: the original structure of the edit formation prevents duplicates.
        // Unless you changed that structure somehow, this shouldn't be needed.
        App.funcs.eliminateDuplicates = function(arr) {
            var i, len = arr.length,
                out = [],
                obj = {};

            for (i = 0; i < len; i++) {
                obj[arr[i]] = 0;
            }
            for (i in obj) {
                if (obj.hasOwnProperty(i)) { // Prevents messiness of for..in statements
                    out.push(i);
                }
            }
            return out;
        };

        App.funcs.applyListeners = function() { // Removes default Stack Exchange listeners; see https://github.com/AstroCB/Stack-Exchange-Editor-Toolkit/issues/43
            function removeEventListeners(e) {
                if (e.which === 13) {
                    if (e.metaKey || e.ctrlKey) {
                        // CTRL/CMD + Enter -> Activate the auto-editor
                        App.selections.buttonFix.click();
                        this.focus();
                    } else {
                        // It's impossible to remove the event listeners, so we have to clone the element without any listeners
                        var elClone = this.cloneNode(true);
                        this.parentNode.replaceChild(elClone,
                            this);
                        App.selections.submitButton.click();
                    }
                }
            }

            // Tags box
            App.selections.tagField.keydown(removeEventListeners);

            // Edit summary box
            App.selections.summaryBox.keydown(removeEventListeners);
        };

        // Wait for relevant dynamic content to finish loading
        App.funcs.dynamicDelay = function(callback, id, inline) {
            if (inline) { // Inline editing
                setTimeout(function() {
                    App.selections.buttonBar = $('#wmd-button-bar-' + id);
                    App.selections.buttonBar.unbind();
                    setTimeout(function() {
                        callback();
                    }, 0);
                }, 500);
            } else { // Question page editing
                App.selections.buttonBar = $('#wmd-button-bar-' + id);
                // When button bar updates, dynamic DOM is ready for selection
                App.selections.buttonBar.unbind().on('DOMSubtreeModified', function() {
                    // Avoid running it more than once
                    if (!App.globals.barReady) {
                        App.globals.barReady = true;

                        // Run asynchronously - this lets the bar finish updating before continuing
                        setTimeout(function() {
                            callback();
                        }, 0);
                    }
                });
            }
        };

        // Populate or refresh DOM selections
        App.funcs.popSelections = function() {
            App.selections.redoButton = $('#wmd-redo-button-' + App.globals.questionNum);
            App.selections.bodyBox = $("#wmd-input-" + App.globals.questionNum);
            App.selections.titleBox = $(".ask-title-field");
            App.selections.summaryBox = $("#edit-comment-" + App.globals.questionNum);
            App.selections.tagField = $($(".tag-editor")[0]);
            App.selections.submitButton = $("#submit-button-" + App.globals.questionNum);
        };

        // Populate edit item sets from DOM selections
        App.funcs.popItems = function() {
            App.items[0] = {
                title: App.selections.titleBox.val(),
                body: App.selections.bodyBox.val(),
                summary: ''
            };
        };

        // Insert editing button(s)
        App.funcs.createButton = function() {
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
        App.funcs.styleButton = function() {
            var buttonCSS = {
                'position': 'relative',
                'left': '430px'
            };

            // This should fix the M/SO redesign styling issues; design may be pushed to other sites later
            if (App.globals.URL.search("stackoverflow") > -1) {
                buttonCSS["padding-top"] = "2%";
                // I have no idea why, but the above fix causes the help button to jump down, too; this should fix that
                $("#wmd-help-button-" + App.globals.questionNum).css({
                    'padding': '0px'
                });
            }
            App.selections.buttonWrapper.css(buttonCSS);

            App.selections.buttonFix.css({
                'position': 'static',
                'float': 'left',
                'border-width': '0px',
                'background-color': 'white',
                'background-image': 'url("//i.imgur.com/79qYzkQ.png")',
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

            App.selections.buttonFix.hover(function() {
                App.globals.infoContent = App.selections.buttonInfo.text();
                App.selections.buttonInfo.text('Fix the content!');
                App.selections.buttonFix.css({
                    'background-image': 'url("//i.imgur.com/d5ZL09o.png")'
                });
            }, function() {
                App.selections.buttonInfo.text(App.globals.infoContent);
                App.selections.buttonFix.css({
                    'background-image': 'url("//i.imgur.com/79qYzkQ.png")'
                });
            });
        };

        // Listen to button click
        App.funcs.listenButton = function() {
            App.selections.buttonFix.click(function(e) {
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

        // Figure out the last selected element before pressing the button so we can return there after focusing the summary field
        App.funcs.setLastFocus = function() {
            App.selections.titleBox.click(function() {
                App.globals.lastSelectedElement = $(this);
            });

            App.selections.bodyBox.click(function() {
                App.globals.lastSelectedElement = $(this);
            });

            App.selections.summaryBox.click(function() {
                App.globals.lastSelectedElement = $(this);
            });

            App.selections.tagField.click(function() {
                App.globals.lastSelectedElement = $(this);
            });
        };

        // Handle pipe output
        App.funcs.output = function(data) {
            App.selections.titleBox.val(data[0].title);
            App.selections.bodyBox.val(data[0].body);
            App.selections.summaryBox.val(data[0].summary);

            // Update the comment: focusing on the input field to remove placeholder text, but scroll back to the user's original location
            var currentPos = document.body.scrollTop;
            if ($("#wmd-input")) {
                $("#wmd-input").focus();
                $("#edit-comment").focus();
                $("#wmd-input").focus();
            } else {
                $(".wmd-input")[0].focus();
                $(".edit-comment")[0].focus();
                $(".wmd-input")[0].focus();
            }
            window.scrollTo(0, currentPos);
            App.globals.infoContent = App.globals.editCount +
                ' changes made';
            App.selections.buttonInfo.text(App.globals.editCount +
                ' changes made');
        };
    };

    // Pipe data through modules in proper order, returning the result
    App.pipe = function(data, mods, order) {
        var modName;
        for (var i in order) {
            if (order.hasOwnProperty(i)) {
                modName = order[i];
                data = mods[modName](data);
            }
        }
        App.funcs.output(data);
    };

    // Init app
    App.init = function(inline, targetID) {
        // Check if there was an ID passed (if not, use question ID from URL);
        if (!targetID) {
            targetID = App.globals.questionNum;
        }

        App.popFuncs();
        App.funcs.dynamicDelay(function() {
            App.funcs.popSelections();
            App.funcs.createButton();
            App.funcs.styleButton();
            App.funcs.popItems();
            App.funcs.listenButton();
            App.funcs.applyListeners();
            App.funcs.setLastFocus();
        }, targetID, inline);
    };

    App.globals.pipeMods.omit = function(data) {
        data[0].body = App.funcs.omitCode(data[0].body, "block");
        data[0].body = App.funcs.omitCode(data[0].body, "inline");
        return data;
    };

    App.globals.pipeMods.replace = function(data) {
        data[0].body = App.funcs.replaceCode(data[0].body, "block");
        data[0].body = App.funcs.replaceCode(data[0].body, "inline");
        return data;
    };

    App.globals.pipeMods.edit = function(data) {
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
                var fix = App.funcs.fixIt(data[0].body, App.edits[j].expr,
                    App.edits[j].replacement, App.edits[j].reason);
                if (fix) {
                    App.globals.reasons[App.globals.numReasons] = fix.reason;
                    data[0].body = fix.fixed;
                    App.globals.numReasons++;
                    App.edits[j].fixed = true;
                }

                // Check title
                fix = App.funcs.fixIt(data[0].title, App.edits[j].expr,
                    App.edits[j].replacement, App.edits[j].reason);
                if (fix) {
                    data[0].title = fix.fixed;
                    if (!App.edits[j].fixed) {
                        App.globals.reasons[App.globals.numReasons] =
                            fix.reason;
                        App.globals.numReasons++;
                        App.edits[j].fixed = true;
                    }
                }
            }
            // Quickly focus the summary field to show generated edit summary, and then jump back
            App.selections.summaryBox.focus();

            // Asynchronous to get in both focuses
            setTimeout(function() {
              if(App.globals.lastSelectedElement){
                App.globals.lastSelectedElement.focus();
              } else {
                window.scrollTo(0);
              }
            }, 0);
        }

        // Eliminate duplicate reasons
        App.globals.reasons = App.funcs.eliminateDuplicates(App.globals.reasons);

        for (var z = 0; z < App.globals.reasons.length; z++) {
            // Check that summary is not getting too long
            if (data[0].summary.length < 200) {

                // Capitalize first letter
                if (z === 0) {
                    data[0].summary += App.globals.reasons[z][0].toUpperCase() +
                        App.globals.reasons[z].substring(1);

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

    if ($(".edit-post")[0]) { // User has editing privileges; wait for button press
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
