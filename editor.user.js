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
	// Select button bar
	var URL = window.location.href;
	var questionNum = URL.match(/\d/g);
	questionNum = questionNum.join("");

	var buttonBar = $('#wmd-button-bar-' + questionNum);
	var barReady = false;
	var editsMade = false;
	var editCount = 0;
	var toolkitGlobals = {};

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
					'left': '430px',
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
					toolkitGlobals.buttonInfo.text('Fix the content!');
					buttonFix.css({
						'background-image': 'url("http://i.imgur.com/kyE5p6d.png")'
					});
				}, function () {
					toolkitGlobals.buttonInfo.text('');
					buttonFix.css({
						'background-image': 'url("http://i.imgur.com/cLCZ21L.png")'
					});
				});

				buttonFix.click(function (e) {
					if (!editsMade) {
						edit(e);
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

	// This is where the magic happens: this function takes a few pieces of information and applies edits to the post with a couple exceptions

	function fixIt(input, expression, replacement, reasoning) {
		var there = input.search(expression); // Scan the post text using the expression to see if there are any matches
		if (there !== -1) { // If so, increase the number of edits performed (used later for edit summary formation)
			editCount++;
			var phrase; // Later, this will store what is removed for the first case
			// Then, perform the edits using replace()
			// What follows is a series of exceptions, which I will explain below; I perform special actions by overriding replace()
			if (replacement === "") { // This is used for removing things entirely without giving a replacement; it matches the expression and then replaces it with nothing
				input = input.replace(expression, function (data, match1) {
					phrase = match1; // Save what is removed for the edit summary (see below)
					return ""; // Replace with nothing
				});
				reasoning = reasoning.replace("$1", phrase); // This is an interesting tidbit: if you want to make the edit summaries dynamic, you can keep track of a match that you receive from overriding the replace() function and then use that in the summary
			} else if (replacement == "$1vote") { // This allows me to combine the upvote and downvote replacement schemes into one
				input = input.replace(expression, function (data, match1) {
					phrase = match1;
					return phrase + "vot"; // "return" in this context is what is used to replace what is matched
				});
				reasoning = reasoning.replace("$1", phrase.toLowerCase());
			} else if (replacement === "$1") { // This is used to capitalize letters; it merely takes what is matched, uppercases it, and replaces what was matched with the uppercased verison
				input = input.replace(expression, function (data, match1) {
					return match1.toUpperCase();
				});
			} else { // Default: just replace it with the indicated replacement
				input = input.replace(expression, replacement);
			}
			return { // Return a dictionary with the reasoning for the fix and what is edited (used later to prevent duplicates in the edit summary)
				reason: reasoning,
				fixed: input
			};
		} else {
			return null; // If nothing needs to be fixed, return null
		}
	}

	function edit(e) {
		// Grab input fields
		var box = $(".wmd-input");
		var title = $(".ask-title-field");
		var reasons = [];
		var numReasons = 0;

		e.preventDefault();
		// Visually confirm edit - SE makes it easy because the jQuery color animation plugin seems to be there by default
		box.animate({
			backgroundColor: '#c8ffa7'
		}, 10);
		box.animate({
			backgroundColor: '#fff'
		}, 1000);


		// Define edit rules
		var edits = {
			i: {
				expr: /(^|\s|\()i(\s|,|\.|!|\?|;|\/|\)|'|$)/gm,
				replacement: "$1I$2",
				reason: "in the English language, the pronoun 'I' is capitalized"
			},
			so: {
				expr: /(^|\s)[Ss]tack\s*overflow|StackOverflow(.|$)/gm,
				replacement: "$1Stack Overflow$2",
				reason: "the legal name is 'Stack Overflow' (two words, capitalized)"
			},
			se: {
				expr: /(^|\s)[Ss]tack\s*exchange|StackExchange(.|$)/gm,
				replacement: "$1Stack Exchange$2",
				reason: "the legal name is 'Stack Exchange' (two words, capitalized)"
			},
			expansionSO: {
				expr: /(^|\s)SO(\s|,|\.|!|\?|;|\/|\)|$)/gm,
				replacement: "$1Stack Overflow$2",
				reason: "expansion"
			},
			expansionSE: {
				expr: /(^|\s)SE(\s|,|\.|!|\?|;|\/|\)|$)/gm,
				replacement: "$1Stack Exchange$2",
				reason: "expansion"
			},
			javascript: {
				expr: /(^|\s)[Jj]ava\s*script(.|$)/gm,
				replacement: "$1JavaScript$2",
				reason: "the proper capitalization is 'JavaScript' (see http://en.wikipedia.org/wiki/JavaScript)"
			},
			jsfiddle: {
				expr: /(^|\s)[Jj][Ss][Ff]iddle(.|$)/gm,
				replacement: "$1JSFiddle$2",
				reason: "the current accepted capitalization is 'JSFiddle' (see title tag on http://jsfiddle.net)"
			},
			caps: {
				expr: /^(?!https?)([a-z])/gm,
				replacement: "$1",
				reason: "basic capitalization"
			},
			jquery: {
				expr: /(^|\s)[Jj][Qq]uery(.|$)/gm,
				replacement: "$1jQuery$2",
				reason: "the proper capitalization is 'jQuery' (see http://jquery.com)"
			},
			html: {
				expr: /(^|\s)[Hh]tml(?:5*)(\s|$)/gm,
				replacement: "$1HTML$2",
				reason: "HTML is an initialism for HyperText Markup Language"
			},
			css: {
				expr: /(^|\s)[Cc]ss(\s|$)/gm,
				replacement: "$1CSS$2",
				reason: "CSS is an initialism for Cascading Style Sheets"
			},
			json: {
				expr: /(^|\s)[Jj]son(\s|$)/gm,
				replacement: "$1JSON$2",
				reason: "JSON is an initialism for JavaScript Object Notation"
			},
			ajax: {
				expr: /(^|\s)[Aa]jax(\s|$)/gm,
				replacement: "$1AJAX$2",
				reason: "AJAX is an initialism for Asynchronous JavaScript and XML"
			},
			angular: {
				expr: /[Aa]ngular[Jj][Ss]/g,
				replacement: "AngularJS",
				reason: "the 'JS' in 'AngularJS' is capitalized"
			},
			thanks: {
				expr: /(thanks|please\s+help|cheers|regards|thx|thank\s+you|my\s+first\s+question).*$/gmi,
				replacement: "",
				reason: "please don't include '$1' in your question: it is unnecessary noise"
			},
			commas: {
				expr: /,([^\s])/g,
				replacement: ", $1",
				reason: "commas have one space after them"
			},
			php: {
				expr: /(^|\s)[Pp]hp(\s|$)/gm,
				replacement: "$1PHP$2",
				reason: "PHP is an initialism for PHP: Hypertext Preprocessor (recursive)"
			},
			hello: {
				expr: /(?:^|\s)(hi\s+guys|good\s(?:evening|morning|day|afternoon))(?:\.|!)/gmi,
				replacement: "",
				reason: "please don't include '$1' in your question: it is unnecessary noise"
			},
			edit: {
				expr: /(?:^\**)(edit|update):?(?:\**):?/gmi,
				replacement: "",
				reason: "Stack Exchange has an advanced revision history system: please don't include 'Edit' or 'Update' with edits, as the revision history makes the timing of your edits clear"
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

		//loop through all editing rules
		for (var j in edits) {
			if (edits.hasOwnProperty(j)) {

				// Check body
				var fix = fixIt(box.val(), edits[j].expr, edits[j].replacement, edits[j].reason);
				if (fix) {
					reasons[numReasons] = fix.reason;
					box.val(fix.fixed);
					numReasons++;
					edits[j].fixed = true;
				}

				// Check title
				fix = fixIt(title.val(), edits[j].expr, edits[j].replacement, edits[j].reason);
				if (fix) {
					title.val(fix.fixed);
					if (!edits[j].fixed) {
						reasons[numReasons] = fix.reason;
						numReasons++;
						edits[j].fixed = true;
					}
				}
			}
		}

		// Create summary
		var summary = "";
		for (var z = 0; z < reasons.length; z++) {
			if (z === 0) {
				summary += reasons[z][0].toUpperCase() + reasons[z].substring(1);
			} else if (z !== reasons.length - 1) {
				summary += reasons[z] + "; ";
			} else {
				summary += reasons[z];
			}
			if (z === 0 && reasons.length > 1) {
				summary += "; ";
			}
			if (z === reasons.length - 1) {
				summary += ".";
			}
		}

		// Update the comment: focusing on the input field to remove placeholder text, but scroll back to the user's original location
		var currentPos = document.body.scrollTop;
		if (privileges) {
			$(".edit-comment").val(summary);
			$(".wmd-input").focus();
			$(".edit-comment").focus();
		} else {
			$("#edit-comment").val(summary);
			$("#wmd-input").focus();
			$("#edit-comment").focus();
		}
		window.scrollTo(0, currentPos);
		toolkitGlobals.buttonInfo.text(editCount + ' changes made');
	}
};

// Inject the main script
var script = document.createElement('script');
script.type = "text/javascript";
script.textContent = '(' + main.toString() + ')();';
document.body.appendChild(script);
