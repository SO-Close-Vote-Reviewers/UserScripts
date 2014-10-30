// ==UserScript==
// @name           Stack-Exchange-Editor-Toolkit
// @author         Cameron Bernhardt (AstroCB)
// @namespace  http://github.com/AstroCB
// @version        2.0
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
    
    //get url for question id used in id and class names
    var URL = window.location.href;
    var questionNum = URL.match(/\d/g);
    questionNum = questionNum.join("");
    
    // Select button bar
    var buttonBar = $('#wmd-button-bar-' + questionNum);
    var barReady = false;
    var editsMade = false;
    var editCount = 0;
    var toolkitGlobals = {};
    toolkitGlobals.infoContent = '';
    
    // Wait for the button bar to update
    buttonBar.unbind().on('DOMSubtreeModified', function () {
        if (!barReady) {
            barReady = true;
            
            // Run asynchronously (important)
            setTimeout(function () {
                var redoButton = $('#wmd-redo-button-' + questionNum);
                var privileges = true;
                var spacerHTML = '<li class="wmd-spacer wmd-spacer3" id="wmd-spacer3-' + questionNum + '" style="left: 400px !important;"></li>';
                var buttonHTML = '<div id="ToolkitButtonWrapper"><button class="wmd-button" id="ToolkitFix"></button><div id="ToolkitInfo"></div></div>';
                
                redoButton.after(buttonHTML); // Insert button
                redoButton.after(spacerHTML); // Insert spacer
                // Select the button
                var buttonWrapper = $('#ToolkitButtonWrapper');
                var buttonFix = $('#ToolkitFix');
                var buttonInfo = $('#ToolkitInfo');
                
                // Assign button info to toolkitGlobals for use in other functions
                toolkitGlobals.buttonInfo = buttonInfo;
                
                // Style button
                buttonWrapper.css({
                    'position': 'relative',
                    'left': '430px'
                });
                buttonFix.css({
                    'position': 'static',
                    'float': 'left',
                    'border-width': '0px',
                    'background-color': 'white',
                    'background-image': 'url("http://i.imgur.com/cLCZ21L.png")',
                    'background-size': '100% 100%',
                    'width': '18px',
                    'height': '18px',
                    'outline': 'none'
                });
                buttonInfo.css({
                    'position': 'static',
                    'float': 'left',
                    'margin-left': '5px',
                    'font-size': '12px',
                    'color': '#424242',
                    'line-height': '19px'
                });
                
                buttonFix.hover(function () {
                    toolkitGlobals.infoContent = toolkitGlobals.buttonInfo.text();
                    toolkitGlobals.buttonInfo.text('Fix the content!');
                    buttonFix.css({
                        'background-image': 'url("http://i.imgur.com/kyE5p6d.png")'
                    });
                }, function () {
                    toolkitGlobals.buttonInfo.text(toolkitGlobals.infoContent);
                    buttonFix.css({
                        'background-image': 'url("http://i.imgur.com/cLCZ21L.png")'
                    });
                });
                
                buttonFix.click(function (e) {
                    e.preventDefault();
                    if (!editsMade) {
                        EM.edit(e);
                        editsMade = true;
                    }
                });
            }, 0);
        }
    });
    
    //check for editing privledges
    if (window.location.href.search(/\/posts\/\d*\/edit/) !== -1) { // No editing privileges
        privileges = false;
        if (localStorage) {
            if (!localStorage.hasAsked) {
                alert("You do not have editing privileges on this site.\nBe aware that your edits may be rejected.");
                localStorage.hasAsked = true;
            }
        }
    }
    
    //Note: by adding a modular name space to all variables, we don't have to worry about mixing variables 
    //between various functions that we implement. This is more useful in larger projects, but it's not a 
    //bad thing to practice regularly. Instead of coming up with complex variable names for other functonalities 
    //within the same function scope, we can now use simple names appended to a namespace object. Also makes it 
    //much easier passing vars between scopes.
    
    //define Editing Module namespace 
    var EM = {};
    EM.reasons = [];
    EM.numReasons = 0;
    
    // Grab input fields
    EM.populate = function(){
        EM.bodyBox = $(".wmd-input");
        EM.titleBox = $(".ask-title-field");
        EM.body = EM.bodyBox.val();
        EM.title = EM.titleBox.val();
    }
    
    EM.populate();
    
    // This is where the magic happens: this function takes a few pieces of information and applies edits to the post with a couple exceptions
    EM.fixIt = function (input, expression, replacement, reasoning) {
        
        // Scan the post text using the expression to see if there are any matches
        var match = input.search(expression);
        
        // If so, increase the number of edits performed (used later for edit summary formation)
        if (match !== -1) {
            editCount++;
            
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
    
    //define namespace vars
    EM.replacedStrings = {
        "block": [],
        "inline": []
    };
    EM.placeHolders = {
        "block": "_xCodexBlockxPlacexHolderx_",
        "inline": "_xCodexInlinexPlacexHolderx_"
    };
    EM.checks = {
        "block": /(    )+.*/gm,
        "inline": /`.*`/gm
    };
    EM.placeHolderChecks = {
        "block": /_xCodexBlockxPlacexHolderx_/g,
        "inline": /_xCodexInlinexPlacexHolderx_/g
    };
    
    //omit code
    EM.omitCode = function (str, type) {
        str = str.replace(EM.checks[type], function (match) {
            EM.replacedStrings[type].push(match);
            return EM.placeHolders[type];
        });
        return str;
    };
    
    //omit code
    EM.replaceCode = function (str, type) {
        for (var i = 0; i < EM.replacedStrings[type].length; i++) {
            str = str.replace(EM.placeHolders[type], EM.replacedStrings[type][i]);
        }
        return str;
    };
    
    //eliminate duplicates in array (awesome method I found on SO, check it out!)
    EM.eliminateDuplicates = function(arr) {
        var i,
            len=arr.length,
            out=[],
            obj={};
        
        for (i=0;i<len;i++) {
            obj[arr[i]]=0;
        }
        for (i in obj) {
            out.push(i);
        }
        return out;
    }
    
    //pipeline body through code omitter
    EM.body = EM.omitCode(EM.body, "block");
    EM.body = EM.omitCode(EM.body, "inline");
    
    //Note: no reason to redefine all of these rules for every edit
    
    // Define edit rules
    EM.edits = {
        i: {
            expr: /(^|\s|\()i(\s|,|\.|!|\?|;|\/|\)|'|$)/gm,
            replacement: "$1I$2",
            reason: "basic capitalization"
        },
        so: {
            expr: /(^|\s)[Ss]tack\s*overflow|StackOverflow(.|$)/gm,
            replacement: "$1Stack Overflow$2",
            reason: "'Stack Overflow' in improper format"
        },
        se: {
            expr: /(^|\s)[Ss]tack\s*exchange|StackExchange(.|$)/gm,
            replacement: "$1Stack Exchange$2",
            reason: "'Stack Exchange' in improper format"
        },
        expansionSO: {
            expr: /(^|\s)SO(\s|,|\.|!|\?|;|\/|\)|$)/gm,
            replacement: "$1Stack Overflow$2",
            reason: "'SO' expanded"
        },
        expansionSE: {
            expr: /(^|\s)SE(\s|,|\.|!|\?|;|\/|\)|$)/gm,
            replacement: "$1Stack Exchange$2",
            reason: "'SE' expanded"
        },
        javascript: {
            expr: /(^|\s)[Jj]ava\s*script(.|$)/gm,
            replacement: "$1JavaScript$2",
            reason: "'JavaScript' improper capitalization"
        },
        jsfiddle: {
            expr: /(^|\s)[Jj][Ss][Ff]iddle(.|$)/gm,
            replacement: "$1JSFiddle$2",
            reason: "'JSFiddle' improper capitalization"
        },
        caps: {
            expr: /^(?!https?)([a-z])/gm,
            replacement: "$1",
            reason: "basic capitalization"
        },
        jquery: {
            expr: /(^|\s)[Jj][Qq]uery(.|$)/gm,
            replacement: "$1jQuery$2",
            reason: "'jQuery' improper capitalization"
        },
        html: {
            expr: /(^|\s)[Hh]tml(?:5*)(\s|$)/gm,
            replacement: "$1HTML$2",
            reason: "HTML capitalized"
        },
        css: {
            expr: /(^|\s)[Cc]ss(\s|$)/gm,
            replacement: "$1CSS$2",
            reason: "CSS capitalized"
        },
        json: {
            expr: /(^|\s)[Jj]son(\s|$)/gm,
            replacement: "$1JSON$2",
            reason: "JSON capitalized"
        },
        ajax: {
            expr: /(^|\s)[Aa]jax(\s|$)/gm,
            replacement: "$1AJAX$2",
            reason: "AJAX capitalized"
        },
        angular: {
            expr: /[Aa]ngular[Jj][Ss]/g,
            replacement: "AngularJS",
            reason: "'AngularJS capitalization"
        },
        thanks: {
            expr: /(thanks|please\s+help|cheers|regards|thx|thank\s+you|my\s+first\s+question).*$/gmi,
            replacement: "",
            reason: "'$1' in the question is just noise"
        },
        commas: {
            expr: /,([^\s])/g,
            replacement: ", $1",
            reason: "punctuation & spacing"
        },
        php: {
            expr: /(^|\s)[Pp]hp(\s|$)/gm,
            replacement: "$1PHP$2",
            reason: "PHP capitalized"
        },
        hello: {
            expr: /(?:^|\s)(hi\s+guys|good\s(?:evening|morning|day|afternoon))(?:\.|!)/gmi,
            replacement: "",
            reason: "'$1' in the question is just noise"
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
        }
        
        //expansion reminder: let's support those non web devs with capitalization for popular languages such as C#
    };
    
    EM.edit = function () {
        
        EM.populate();
        
        // Visually confirm edit - SE makes it easy because the jQuery color animation plugin seems to be there by default
        EM.bodyBox.animate({
            backgroundColor: '#c8ffa7'
        }, 10);
        EM.bodyBox.animate({
            backgroundColor: '#fff'
        }, 1000);
        
        //loop through all editing rules
        for (var j in EM.edits) {
            if (EM.edits.hasOwnProperty(j)) {
                
                // Check body
                var fix = EM.fixIt(EM.body, EM.edits[j].expr, EM.edits[j].replacement, EM.edits[j].reason);
                if (fix) {
                    
                    //replace removed code blocks
                    console.log(fix.fixed);
                    fix.fixed = EM.replaceCode(fix.fixed, "block");
                    fix.fixed = EM.replaceCode(fix.fixed, "inline");
                    
                    //insert results
                    EM.reasons[EM.numReasons] = fix.reason;
                    EM.bodyBox.val(fix.fixed);
                    EM.numReasons++;
                    EM.edits[j].fixed = true;
                }
                
                // Check title
                fix = EM.fixIt(EM.title, EM.edits[j].expr, EM.edits[j].replacement, EM.edits[j].reason);
                if (fix) {
                    console.log(fix);
                    EM.titleBox.val(fix.fixed);
                    console.log(EM.titleBox.val());
                    if (!EM.edits[j].fixed) {
                        EM.reasons[EM.numReasons] = fix.reason;
                        EM.numReasons++;
                        EM.edits[j].fixed = true;
                    }
                }
            }
        }
        
        // Create summary
        var summary = "";
        
        //eliminate duplicate reasons
        console.log(EM.reasons);
        EM.reasons = EM.eliminateDuplicates(EM.reasons);
        console.log(EM.reasons);
        
        for (var z = 0; z < EM.reasons.length; z++) {
            
            //check that summary is not getting too long
            if (summary.length < 200){
                
                //capitalize first letter
                if (z === 0) {
                    summary += EM.reasons[z][0].toUpperCase() + EM.reasons[z].substring(1);
                    console.log(summary);
                    
                    //post rest of reasons normally
                } else {
                    summary += EM.reasons[z];
                }
                
                //if it's not the last reason
                if (z !== EM.reasons.length - 1) {
                    summary += "; ";
                    console.log(summary);
                    
                    //if at end, punctuate
                } else {
                    summary += ".";
                    console.log(summary);
                }
            }
        }
        
        // Update the comment: focusing on the input field to remove placeholder text, but scroll back to the user's original location
        var currentPos = document.body.scrollTop;
        if (privileges) {
            $(".edit-comment").val(summary);
            $(".wmd-input").focus();
            $(".edit-comment").focus();
            $(".wmd-input").focus();
        } else {
            $("#edit-comment").val(summary);
            $("#wmd-input").focus();
            $("#edit-comment").focus();
            $("#wmd-input").focus();
        }
        window.scrollTo(0, currentPos);
        toolkitGlobals.infoContent = editCount + ' changes made';
        toolkitGlobals.buttonInfo.text(editCount + ' changes made');
    };
};

// Inject the main script
var script = document.createElement('script');
script.type = "text/javascript";
script.textContent = '(' + main.toString() + ')();';
document.body.appendChild(script);
