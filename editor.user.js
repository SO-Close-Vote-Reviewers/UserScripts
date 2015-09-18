// ==UserScript==
// @name           Stack-Exchange-Editor-Toolkit
// @author         Cameron Bernhardt (AstroCB)
// @developer      Jonathan Todd (jt0dd)
// @developer      sathyabhat
// @contributor    Unihedron
// @contributor    Tiny Giant
// @contributor    Mogsdad
// @grant          none
// @license        MIT
// @namespace      http://github.com/AstroCB
// @version        1.5.2.6
// @description    Fix common grammar/usage annoyances on Stack Exchange posts with a click
// @include        *://*.stackexchange.com/questions/*
// @include        *://stackoverflow.com/questions/*
// @include        *://stackoverflow.com/review/helper/*
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
// @include        *://*.stackexchange.com/review/*
// @include        *://stackoverflow.com/review/*
// @include        *://meta.stackoverflow.com/review/*
// @include        *://serverfault.com/review/*
// @include        *://meta.serverfault.com/review/*
// @include        *://superuser.com/review/*
// @include        *://meta.superuser.com/review/*
// @include        *://askubuntu.com/review/*
// @include        *://meta.askubuntu.com/review/*
// @include        *://stackapps.com/review/*
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
    function EditorToolkit(targetID) {
        if (!(this instanceof EditorToolkit)) return false;

        var App = this;

        // Place edit items here
        App.items = [];

        // Place selected jQuery items here
        App.selections = {};

        // Place "global" app data here
        App.globals = {};

        // Place "helper" functions here
        App.funcs = {};

        //Preload icon alt
        var SEETicon = new Image();

        SEETicon.src = '//i.imgur.com/d5ZL09o.png';

        // Define variables for later use
        App.globals.barReady = false;
        App.globals.editsMade = false;
        App.globals.editCount = 0;
        App.globals.infoContent = '';

        // Check if there was an ID passed (if not, use question ID from URL);
        if (!targetID) targetID = window.location.href.match(/\/(\d+)\//g)[0].split("/").join("");
        App.globals.targetID = targetID;

        App.globals.spacerHTML = '<li class="wmd-spacer wmd-spacer3" id="wmd-spacer3-' + App.globals.targetID + '" style="left: 400px !important;"></li>';

        App.selections.buttonWrapper = $('<div class="ToolkitButtonWrapper"/>');
        App.selections.buttonFix = $('<button class="wmd-button ToolkitFix" />');
        App.selections.buttonInfo = $('<div class="ToolkitInfo">');

        App.selections.buttonWrapper.append(App.selections.buttonFix);
        App.selections.buttonWrapper.append(App.selections.buttonInfo);

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
                reason: "in English, the personal pronoun is 'I'"
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
                expr: /(^|\s)[Jj]ava\s*[Ss]cript(.|$)/gm,
                replacement: "$1JavaScript$2",
                reason: "'JavaScript' is the proper capitalization"
            },
            jsfiddle: {
                expr: /(^|\s)[Jj][Ss]\s*[Ff]iddle(.|$)/gm,
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
                expr: /(^|\s)[Hh]tml([5]?)\b(\S|)(?!\S)/gm,
                replacement: "$1HTML$2$3",
                reason: "HTML stands for HyperText Markup Language"
            },
            css: {
                expr: /(^|\s)[Cc]ss\b(\S|)(?!\S)/gm,
                replacement: "$1CSS$2",
                reason: "CSS stands for Cascading Style Sheets"
            },
            json: {
                expr: /(^|\s)[Jj]son\b(\S|)(?!\S)/gm,
                replacement: "$1JSON$2",
                reason: "JSON stands for JavaScript Object Notation"
            },
            ajax: {
                expr: /(^|\s)ajax\b(\S|)(?!\S)/gm,
                replacement: "$1AJAX$2",
                reason: "AJAX stands for Asynchronous JavaScript and XML"
            },
            angular: {
                expr: /[Aa]ngular[Jj][Ss]/g,
                replacement: "AngularJS",
                reason: "'AngularJS is the proper capitalization"
            },
            thanks: {
                expr: /(thanks|pl(?:ease|z|s)\s+h[ea]lp|cheers|regards|thx|thank\s+you|my\s+first\s+question|kindly\shelp).*$/gmi,
                replacement: "",
                reason: "'$1' is unnecessary noise"
            },
            commas: {
                expr: /,([^\s])/g,
                replacement: ", $1",
                reason: "punctuation & spacing"
            },
            php: {
                expr: /(^|\s)[Pp]hp\b(\S|)(?!\S)/gm,
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
                expr: /(^|\s)java\b(\S|)(?!\S)/gmi,
                replacement: "$1Java$2",
                reason: "Java should be capitalized"
            },
            sql: {
                expr: /(^|\s)[Ss]ql\b(\S|)(?!\S)/gm,
                replacement: "$1SQL$2",
                reason: "SQL is the proper capitalization"
            },
            sqlite: {
                expr: /(^|\s)[Ss]qlite([0-9]*)\b(\S|)(?!\S)/gm,
                replacement: "$1SQLite$2$3",
                reason: "SQLite is the proper capitalization"
            },
            android: {
                expr: /(^|\s)android\b(\S|)(?!\S)/gmi,
                replacement: "$1Android$2",
                reason: "Android should be capitalized"
            },
            oracle: {
                expr: /(^|\s)oracle\b(\S|)(?!\S)/gmi,
                replacement: "$1Oracle$2",
                reason: "Oracle should be capitalized"
            },
            windows: {
                expr: /(win|windows(?:\ ?)(\s[0-9]+))\b(\S|)(?!\S)/igm,
                replacement: "Windows$2$3",
                reason: "Windows should be capitalized"
            },
            windowsXP: {
                expr: /(win|windows(?:\ ?)(\sxp))\b(\S|)(?!\S)/igm,
                replacement: "Windows XP$3",
                reason: "Windows XP should be capitalized"
            },
            windowsVista: {
                expr: /(win|windows(?:\ ?)(\svista))\b(\S|)(?!\S)/igm,
                replacement: "Windows Vista$3",
                reason: "Windows Vista should be capitalized"
            },
            ubuntu: {
                expr: /(ubunto|ubunut|ubunutu|ubunu|ubntu|ubutnu|ubanto[o]+|unbuntu|ubunt|ubutu)\b(\S|)(?!\S)/igm,
                replacement: "Ubuntu$2",
                reason: "corrected Ubuntu spelling"
            },
            linux: {
                expr: /(linux)\b(\S|)(?!\S)/igm,
                replacement: "Linux$2",
                reason: "Linux should be capitalized"
            },
            apostrophes: {
                expr: /(^|\s)(can|doesn|don|won|hasn|isn|didn)t(\s|$)/gmi,
                replacement: "$1$2't$3",
                reason: "English contractions use apostrophes"
            },
            ios: {
                expr: /\b(?:ios|iOs|ioS|IOS|Ios|IoS|ioS)\b(\S|)(?!\S)/gm,
                replacement: "iOS$1",
                reason: "the proper usage is 'iOS'"
            },
            iosnum: {
                expr: /\b(?:ios|iOs|ioS|IOS|Ios|IoS|ioS)([0-9]?)\b(\S|)(?!\S)/gm,
                replacement: "iOS $1$2",
                reason: "the proper usage is 'iOS' followed by a space and the version number"
            },
            yell: {
                expr: /^((?=.*[A-Z])[^a-z]*)$/g,
                replacement: "$1",
                reason: "no need to yell"
            },
            wordpress: {
                expr: /[Ww]ordpress/g,
                replacement: "WordPress",
                reason: "'WordPress' is the proper capitalization"
            },
            google: {
                expr: /(google)\b(\S|)(?!\S)/igm,
                replacement: "Google$2",
                reason: "Google is the proper capitalization"
            },
            mysql: {
                expr: /(mysql)\b(\S|)(?!\S)/igm,
                replacement: "MySQL$2",
                reason: "MySQL is the proper capitalization"
            },
            apache: {
                expr: /(apache)\b(\S|)(?!\S)/igm,
                replacement: "Apache$2",
                reason: "Apache is the proper capitalization"
            },
            git: {
                expr: /(^|\s)(git|GIT)\b(\S|)(?!\S)/gm,
                replacement: "$1Git$3",
                reason: "Git is the proper capitalization"
            },
            harddisk: {
                expr: /(hdd|harddisk)\b(\S|)(?!\S)/igm,
                replacement: "hard disk$2",
                reason: "Hard disk is the proper capitalization"
            },
            github: {
                expr: /\b([gG]ithub|GITHUB)\b(\S|)(?!\S)/gm,
                replacement: "GitHub$2",
                reason: "GitHub is the proper capitalization"
            },
            facebook: {
                expr: /\b([fF]acebook|FACEBOOK)\b(\S|)(?!\S)/gm,
                replacement: "Facebook$2",
                reason: "Facebook is the proper capitalization"
            },
            python: {
                expr: /(^|\s)[Pp]ython(.|$)/gm,
                replacement: "$1Python$2",
                reason: "'Python' is the proper capitalization"
            },
            im: {
                expr: /(^|\s|\()im(\s|,|\.|!|\?|;|\/|\)|'|$)/gm,
                replacement: "$1I'm$2",
                reason: "in English, the personal pronoun is 'I'"
            },
            ive: {
                expr: /(^|\s|\()ive(\s|,|\.|!|\?|;|\/|\)|'|$)/gm,
                replacement: "$1I've$2",
                reason: "in English, the personal pronoun is 'I'"
            },
            ur: {
                expr: /(^|\s|\()ur(\s|,|\.|!|\?|;|\/|\)|'|$)/gm,
                replacement: "$1you are$2",
                reason: "de-text"
            },
            u: {
                expr: /(^|\s|\()u(\s|,|\.|!|\?|;|\/|\)|'|$)/gm,
                replacement: "$1you$2",
                reason: "de-text"
            },
            allways: {
                expr: /(^|\s|\()(a)llways(\s|,|\.|!|\?|;|\/|\)|'|$)/gmi,
                replacement: "$1$2lways$3",
                reason: "spelling"
            },
            appreciated: {
                expr: /(?:[\s-,']\w*)*(help|suggestion|advice).*(?:appreciated).*/gmi,
                replacement: "",
                reason: "$1 requests are unnecessary noise"
            },
            hopeMaybeHelps: {
                expr: /(?:[\s-,']\w*)*(maybe|hope)+(?:[\s-,']\w*)*\s(help[s]*)(?:[\s-,']\w*)*[\.!?]/gmi,
                replacement: "",
                reason: "$1...$2 is unnecessary noise"
            },
            regex: {
                expr: /regex(p)?/gmi,
                replacement: function(match,p){ return "RegEx"+((p === undefined)?"":p).toLowerCase(); },
                reason: "RegEx or RegExp are the correct capitalizations"
            },
            multiplesymbols: {
                expr: /\?\?+/gm,
                replacement: "?",
                reason: "One question mark for one question"
            },
            // Whitespace compression comes last
            multiplespaces: {
                expr: /(\S)  +(\S)/gm,
                replacement: "$1 $2",
                reason: "One space at a time"
            },
            spacesbeforepunctuation: {
                expr: / +([.,:;?!])/g,
                replacement: "$1 ",
                reason: "punctuation & spacing"
            },
            spacesafterpunctuation: {
                expr: /([.,:;?!])  +/g,
                replacement: "$1 ",
                reason: "punctuation & spacing"
            },
            leadingspace: {
                expr: /^ +(\S)/gm,
                replacement: "$1",
                reason: "punctuation & spacing"
            },
            blanklines: {
                expr: /(?:\s*[\r\n]){3,}/gm,
                replacement: "\n\n",
                reason: "punctuation & spacing"
            },
            endblanklines: {
                expr: /[\s\r\n]+$/g,
                replacement: "",
                reason: "punctuation & spacing"
            }
        };

        // Populate funcs
        App.popFuncs = function() {
            // This is where the magic happens: this function takes a few pieces of information and applies edits to the post with a couple exceptions
            App.funcs.fixIt = function(input, expression, replacement, reasoning) {
                // If there is nothing to search, exit
                if (!input) return false;
                // Scan the post text using the expression to see if there are any matches
                var match = input.search(expression);
                // If so, increase the number of edits performed (used later for edit summary formation)
                if (match !== -1) {

                    // Later, this will store what is removed for the first case
                    var phrase;

                    // Then, perform the edits using replace()
                    // What follows is a series of exceptions, which I will explain below; I perform special actions by overriding replace()
                    // This is used for removing things entirely without giving a replacement; it matches the expression and then replaces it with nothing
                    if (replacement === "") {
                        var phrase2; // Hack on a hack - allow 2 replacements
                        input = input.replace(expression, function(data, match1, match2) {
                            // Save what is removed for the edit summary (see below)
                            phrase = match1;
                            phrase2 = match2;


                            // Replace with nothing
                            return "";
                        });

                        // This is an interesting tidbit: if you want to make the edit summaries dynamic, you can keep track of a match that you receive
                        // from overriding the replace() function and then use that in the summary
                        reasoning = reasoning.replace("$1", phrase)
                            .replace("$2", phrase2);


                        // This allows me to combine the upvote and downvote replacement schemes into one
                    } else if (replacement == "$1vote") {
                        input = input.replace(expression, function(data, match1) {
                            phrase = match1;
                            return phrase + "vot";
                        });
                        reasoning = reasoning.replace("$1", phrase.toLowerCase());

                        // Fix all caps
                    } else if (reasoning === "no need to yell") {
                        input = input.replace(expression, function(data, match1) {
                            return match1.substring(0, 1).toUpperCase() + match1.substring(1).toLowerCase();
                        });
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

                        // iOS numbering/spacing fixes
                    } else if (replacement === "iOS $2") {
                        input = input.replace(expression, function(data, match1) {
                            if (match1.match(/\d/)) { // Is a number
                                return "iOS " + match1;
                            }

                            return "iOS" + match1;
                        });

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
                            this.parentNode.replaceChild(elClone, this);
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
            App.funcs.dynamicDelay = function(callback) {
                setTimeout(function() {
                    App.selections.buttonBar = $('#wmd-button-bar-' + App.globals.targetID);
                    App.selections.buttonBar.unbind();
                    setTimeout(function() {
                        callback();
                    }, 0);
                }, 500);
            };

            // Populate or refresh DOM selections
            App.funcs.popSelections = function() {
                var targetID = App.globals.targetID;
                var scope = $('div[data-questionid="' + targetID + '"]');
                if (!scope.length) scope = $('div[data-answerid="' + targetID + '"]');
                if (!scope.length) scope = $('body');
                App.selections.redoButton = $('[id^="wmd-redo-button"]', scope);
                App.selections.bodyBox = $('[id^="wmd-input"]', scope);
                App.selections.titleBox = $('[class*="title-field"]', scope);
                App.selections.summaryBox = $('[id^="edit-comment"]', scope);
                App.selections.tagField = $(".tag-editor", scope);
                App.selections.submitButton = $('[id^="submit-button"]', scope);
            };

            // Populate edit item sets from DOM selections
            App.funcs.popItems = function() {
                App.items[0] = {
                    title: String(App.selections.titleBox.val()).trim(),
                    body: String(App.selections.bodyBox.val()).trim(),
                    summary: String(App.selections.summaryBox.val()).trim()
                };
            };

            // Insert editing button(s)
            App.funcs.createButton = function() {
                // Insert button
                App.selections.redoButton.after(App.selections.buttonWrapper);
                // Insert spacer
                App.selections.redoButton.after(App.globals.spacerHTML);
            };

            // Style button
            App.funcs.styleButton = function() {
                var buttonCSS = {
                    'position': 'relative',
                    'left': '430px',
                    'padding-top': '2%'
                };
                $("#wmd-help-button-" + App.globals.targetID).css({
                    'padding': '0px'
                });
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
                    'outline': 'none',
                    'box-shadow': 'none'
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
                    // Refresh item population
                    App.funcs.popItems();
                    // Pipe data through editing modules
                    App.pipe(App.items, App.globals.pipeMods, App.globals.order);
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
                App.globals.currentPos = document.body.scrollTop;
                if ($("#wmd-input")) {
                    $("#wmd-input").focus();
                    $("#edit-comment").focus();
                    $("#wmd-input").focus();
                } else {
                    $(".wmd-input")[0].focus();
                    $(".edit-comment")[0].focus();
                    $(".wmd-input")[0].focus();
                }
                window.scrollTo(0, App.globals.currentPos);
                App.globals.infoContent = App.globals.reasons.length + ' changes made';
                App.selections.buttonInfo.text(App.globals.infoContent);
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
        App.init = function() {
            App.popFuncs();
            App.funcs.dynamicDelay(function() {
                App.funcs.popSelections();
                App.funcs.createButton();
                App.funcs.styleButton();
                App.funcs.popItems();
                App.funcs.listenButton();
                App.funcs.applyListeners();
                App.funcs.setLastFocus();
            });
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
                        App.globals.reasons[App.globals.reasons.length] = fix.reason;
                        data[0].body = fix.fixed;
                        App.edits[j].fixed = true;
                    }

                    // Check title
                    fix = App.funcs.fixIt(data[0].title, App.edits[j].expr,
                        App.edits[j].replacement, App.edits[j].reason);
                    if (fix) {
                        data[0].title = fix.fixed;
                        if (!App.edits[j].fixed) {
                            App.globals.reasons[App.globals.reasons.length] = fix.reason;
                            App.edits[j].fixed = true;
                        }
                    }
                }
            }
            
            // If there are no reasons, exit
            if(!App.globals.reasons.length) return false;
            
            // We want to store the generated summary separately so we can check if any changes have been made to it.
            // This is so we can click the button multiple times. I know, I know but it is a UX thing. 
            var tmpSummary = '';
            
            for (var z = App.globals.reasons.length - 1, x = 0; z >= 0; --z) {
                // Check that summary is not getting too long
                if (data[0].summary.length + tmpSummary.length + App.globals.reasons[z].length + 2 > 300) break;
                
                // If the reason already exists, skip it
                if (data[0].summary.indexOf(App.globals.reasons[z]) !== -1) continue;
                
                // Capitalize first letter
                if (x === 0) App.globals.reasons[z] = App.globals.reasons[z][0].toUpperCase() + App.globals.reasons[z].substring(1);

                // If the reason already exists, skip it
                if (data[0].summary.indexOf(App.globals.reasons[z]) !== -1) continue;
                
                // Append the reason and a semicolon (or period if it is the last reason) to the summary
                tmpSummary += App.globals.reasons[z] + (z === 0 ? "." : "; "); ++x;
            }
            
            // If no reasons have been applied, exit
            if (!tmpSummary) return false;
            
            // Store the summary for readability
            var summary = data[0].summary;
            
            // This whole ternary mess is for if the summary is not empty, and if this is the first time around or not
            data[0].summary = (summary ? (summary.substr(-1) !== -1 ? summary.substr(0,summary.length-1) : summary) + '; ' : '') + tmpSummary;
            
            // Focus the summary field
            App.selections.summaryBox.focus();

            return data;
        };

        App.init();
    }
    var Apps = [];
    
    // It will be this if you are in the queue
    var targetID = $('.post-id').text();
    
    var selector = '.edit-post, [value*="Edit"]:not([value="Save Edits"])';
    var clickables = $(selector);
    if (clickables.length) {
        clickables.click(function(e) {
            if(e.target.href) targetID = e.target.href.match(/\d/g).join("");
            console.log(Apps[targetID] = new EditorToolkit(targetID));
        });
    } else Apps[$('#post-id').val()] = new EditorToolkit($('#post-id').val());
};

// Inject the main script
var script = document.createElement('script');
script.type = "text/javascript";
script.textContent = '(' + main.toString() + ')();';
document.body.appendChild(script);
