// ==UserScript==
// @name           Stack-Exchange-Editor-Toolkit
// @author         Cameron Bernhardt (AstroCB)
// @namespace  http://github.com/AstroCB
// @version        1.0
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

window.addEventListener("load", function(){
  var edits = document.getElementsByClassName("edit-post");
  var rows = document.getElementsByClassName("wmd-button-row");
  var rowNum = 0;
  var privileges = true;

  var button = document.createElement("button");
  button.setAttribute("class", "wmd-button");
  button.setAttribute("id", "fix");
  button.textContent = "Fix";
  button.addEventListener("click", go);

  if (window.location.href.search(/\/posts\/\d*\/edit/) !== -1) { // No editing privileges
  	privileges = false;

    if(localStorage){
      if(!localStorage.hasAsked){ // Only warn users about privileges once per site if their browser supports localStorage
        alert("You do not have editing privileges on this site. The script will still work, but be aware of what it is doing and understand that it may be rejected.");
        localStorage.hasAsked = true;
      }
    }else{
      alert("You do not have editing privileges on this site. The script will still work, but be aware of what it is doing and understand that it may be rejected.");
    }

    var left = parseInt(rows[0].children[rows[0].children.length - 2].style.left) + 25 + "px"; // Grabs the positioning of the last element in the row and adds the proper spacing
    button.setAttribute("style", "left: " + left);

  	rows[0].appendChild(button);
    rowNum++;
  } else {
  	for (var x = 0; x < edits.length; x++) {
  		edits[x].addEventListener("click", function () {
        var left = parseInt(rows[rowNum].children[rows[rowNum].children.length - 2].style.left) + 25 + "px"; // Grabs the positioning of the last element in the row and adds the proper spacing
        button.setAttribute("style", "left: " + left);

  			window.setTimeout(function () {
  				rows[rowNum].appendChild(button);
  				rowNum++;
  			}, 750); // Inserts after menu loads: probably a better way to do this
  		});
  	}
  }

  function fixIt(input, expression, replacement, reasoning) {
  	var there = input.search(expression);

  	if (there !== -1) {
  		var phrase;
  		if (replacement === "") {
  			input = input.replace(expression, function (data, match1) {
  				phrase = match1;
  				return "";
  			});
  			reasoning = reasoning.replace("$1", phrase);
  		} else if (replacement == "$1vote") {
  			input = input.replace(expression, function (data, match1) {
  				phrase = match1;
  				return phrase + "vot";
  			});
  			reasoning = reasoning.replace("$1", phrase.toLowerCase());
  		} else if (replacement === "$1") {
  			input = input.replace(expression, function (data, match1) {
  				return match1.toUpperCase();
  			});
  		} else {
  			input = input.replace(expression, replacement);
  		}

  		return {
  			reason: reasoning,
  			fixed: input,
  		};
  	} else {
  		return null;
  	}
  }

  function go(e) {
  	e.preventDefault();

// This dictionary contains the presets for editing reasons; feel free to add in any that you'd like
  	var edits = {
  		i: {
  			expr: /(^|\s|\()i(\s|,|\.|!|\?|;|\/|\)|'|$)/gm,
  			replacement: "$1I$2",
  			reason: "in the English language, the pronoun 'I' is capitalized",
  		},

  		so: {
  			expr: /(^|\s)[Ss]tack\s*overflow|StackOverflow(.|$)/gm,
  			replacement: "$1Stack Overflow$2",
  			reason: "the legal name is 'Stack Overflow' (two words, capitalized)",
  		},

  		se: {
  			expr: /(^|\s)[Ss]tack\s*exchange|StackExchange(.|$)/gm,
  			replacement: "$1Stack Exchange$2",
  			reason: "the legal name is 'Stack Exchange' (two words, capitalized)",
  		},

  		expansionSO: {
  			expr: /(^|\s)SO(\s|,|\.|!|\?|;|\/|\)|$)/gm,
  			replacement: "$1Stack Overflow$2",
  			reason: "expansion",
  		},

  		expansionSE: {
  			expr: /(^|\s)SE(\s|,|\.|!|\?|;|\/|\)|$)/gm,
  			replacement: "$1Stack Exchange$2",
  			reason: "expansion",
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
  			reason: "copy edited",
  		},

  		jquery: {
  			expr: /(^|\s)[Jj][Qq]uery(.|$)/gm,
  			replacement: "$1jQuery$2",
  			reason: "the proper capitalization is 'jQuery' (see http://jquery.com)",
  		},

  		html: {
  			expr: /(^|\s)[Hh]tml(?:5*)(\s|$)/gm,
  			replacement: "$1HTML$2",
  			reason: "HTML is an initialism for HyperText Markup Language",
  		},

  		css: {
  			expr: /(^|\s)[Cc]ss(\s|$)/gm,
  			replacement: "$1CSS$2",
  			reason: "CSS is an initialism for Cascading Style Sheets",
  		},

  		json: {
  			expr: /(^|\s)[Jj]son(\s|$)/gm,
  			replacement: "$1JSON$2",
  			reason: "JSON is an initialism for JavaScript Object Notation",
  		},

  		ajax: {
  			expr: /(^|\s)[Aa]jax(\s|$)/gm,
  			replacement: "$1AJAX$2",
  			reason: "AJAX is an initialism for Asynchronous JavaScript and XML",
  		},

  		angular: {
  			expr: /[Aa]ngular[Jj][Ss]/g,
  			replacement: "AngularJS",
  			reason: "the 'JS' in 'AngularJS' is capitalized",
  		},

  		thanks: {
  			expr: /(thanks|please\s+help|cheers|regards|thx|thank\s+you|my\s+first\s+question).*$/gmi,
  			replacement: "",
  			reason: "please don't include '$1' in your question: it is unnecessary noise",
  		},

  		commas: {
  			expr: /,([^\s])/g,
  			replacement: ", $1",
  			reason: "commas have one space after them",
  		},

  		php: {
  			expr: /(^|\s)[Pp]hp(\s|$)/gm,
  			replacement: "$1PHP$2",
  			reason: "PHP is an initialism for PHP: Hypertext Preprocessor (recursive)",
  		},

  		hello: {
  			expr: /(?:^|\s)(hi\s+guys|good\s(?:evening|morning|day|afternoon))(?:\.|!)/gmi,
  			replacement: "",
  			reason: "please don't include '$1' in your question: it is unnecessary noise",
  		},

  		edit: {
  			expr: /(?:^\**)(edit|update):?(?:\**):?/gmi,
  			replacement: "",
  			reason: "Stack Exchange has an advanced revision history system: please don't include 'Edit' or 'Update' with edits, as the revision history makes the timing of your edits clear",
  		},

  		voting: {
  			expr: /([Dd]own|[Uu]p)[\s*\-]vot/g,
  			replacement: "$1vote",
  			reason: "the proper spelling (despite the tag name) is '$1vote' (one word)"
  		},

  		mysite: {
  			expr: /mysite\./g,
  			replacement: "example.",
  			reason: "links to mysite.domain are not allowed: use example.domain instead",
  		},

  	};

// The following is what acually performs the edits on the body and title of the post

  	var boxes = document.getElementsByClassName("wmd-input");
  	var box = boxes[0].value; // This refers to the value of the main post body
  	var titles = document.getElementsByClassName("ask-title-field");
  	var title = titles[0].value; // This refers to the title field if it exists (for questions)

  	var reasons = [];

  	for (var j in edits) {
  		if (edits.hasOwnProperty(j)) {
  			var fix = fixIt(box, edits[j].expr, edits[j].replacement, edits[j].reason); // Check body
  			if (fix) {
  				reasons.push(fix.reason); // Adds reason to an array of edit reasons
  				box = fix.fixed;
  				edits[j].fixed = true;
  			}
        if (title) {
    			fix = fixIt(title, edits[j].expr, edits[j].replacement, edits[j].reason); // Check title
    			if (fix) {
    				title = fix.fixed;
    				if (!edits[j].fixed) {
    					reasons.push(fix.reason);
    					edits[j].fixed = true;
    				}
    			}
        }
  		}
  	}

  	boxes[0].value = box; // Replace body with edited body
    if(titles){
  	   titles[0].value = title; // Replace title with edited title
    }

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

    if(privileges){
  	   document.getElementsByClassName("edit-comment")[0].value = summary; // Inline editing privs cause multiple summary fields
     }else{
       document.getElementById("edit-comment").value = summary; // No editing privs == only one field
     }

  }
});
