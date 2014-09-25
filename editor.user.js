// ==UserScript==
// @name           Stack-Exchange-Editor-Toolkit
// @author         Cameron Bernhardt (AstroCB)
// @namespace  http://github.com/AstroCB
// @version        1.0
// @description  Fix common grammar annoyances with a click
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

window.onload = function(){
  var edits = document.getElementsByClassName("edit-post");
  var rows = document.getElementsByClassName("wmd-button-row");
  var rowNum = 0;
  var privileges = true;

  var button = document.createElement("button");
  var left = parseInt(rows[rowNum].children[rows[rowNum].children.length - 2].style.left) + 25 + "px"; //grabs the positioning of the last element in the row and adds the proper spacing
  button.setAttribute("class", "wmd-button");
  button.setAttribute("id", "fix");
  button.setAttribute("style", "left: " + left);
  button.textContent = "Fix";
  button.addEventListener("click", go);

  if (window.location.href.search(/\/posts\/\d*\/edit/) !== -1) { //no editing privileges
  	privileges = false;
    alert("You do not have editing privileges on this site. The script will still work, but be aware of what it is doing and understand that it may be rejected.");
  	rows[0].appendChild(button);
    rowNum++;
  } else {
  	for (var x = 0; x < edits.length; x++) {
  		edits[x].addEventListener("click", function () {
  			window.setTimeout(function () {
  				rows[rowNum].appendChild(button);
  				rowNum++;
  			}, 750); //inserts after menu loads: probably a better way to do this
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

  	var edits = {
  		i: {
  			expr: /(^|\s|\()i(\s|,|\.|!|\?|;|\/|\)|'|$)/gm,
  			replacement: "$1I$2",
  			reason: "in the English language, the pronoun 'I' is capitalized",
  		},

  		so: {
  			expr: /(^|\s)[Ss]tack\s*[Oo]verflow(.|$)/gm,
  			replacement: "$1Stack Overflow$2",
  			reason: "the legal name is 'Stack Overflow' (two words, capitalized)",
  		},

  		se: {
  			expr: /(^|\s)[Ss]tack\s*[Ee]xchange(.|$)/gm,
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
  			expr: /^([a-z])/gm,
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
  			expr: /(thanks|cheers|regards|thx|thank\s+you|first\s+(?:question|post)).*$/gmi,
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
  			expr: /(?:^|\s)([Hh]i\s+[Gg]uys|[Gg]ood\s(?:[Ee]vening|[Mm]orning))/gm,
  			replacement: "",
  			reason: "please don't include '$1' in your question: it is unnecessary noise",
  		},

  		edit: {
  			expr: /[Ee]dit:/g,
  			replacement: "",
  			reason: "Stack Exchange has an advanced revision history system: please don't include 'Edit' with edits, as the revision history makes the timing of your edits clear",
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

  		/*openpar: {
  		 expr: /(\S)\(/g,
  		 replacement: "$1 (",
  		 reason: "parentheses have space between them and their corresponding text",
  		 },*/

  		/*closepar: {
  		 expr: /(\((\S))/g,
  		 replacement: ") $1",
  		 reason: "parentheses have space between them and their corresponding text",
  		 }*/

  	};

  	var boxes = document.getElementsByClassName("wmd-input");
  	var box = boxes[rowNum - 1].value;
  	var titles = document.getElementsByClassName("ask-title-field");
  	var title = titles[rowNum - 1].value;

  	var reasons = [];
  	var numReasons = 0;

  	for (var j in edits) {
  		if (edits.hasOwnProperty(j)) {
  			var fix = fixIt(box, edits[j].expr, edits[j].replacement, edits[j].reason); //check body
  			if (fix) {
  				reasons[numReasons] = fix.reason;
  				box = fix.fixed;
  				numReasons++;
  				edits[j].fixed = true;
  			}

  			fix = fixIt(title, edits[j].expr, edits[j].replacement, edits[j].reason); //check title
  			if (fix) {
  				title = fix.fixed;
  				if (!edits[j].fixed) {
  					reasons[numReasons] = fix.reason;
  					numReasons++;
  					edits[j].fixed = true;
  				}
  			}
  		}
  	}

  	boxes[rowNum - 1].value = box;
  	titles[rowNum - 1].value = title;

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
  	   document.getElementsByClassName("edit-comment")[rowNum - 1].value = summary;
     }else{
       document.getElementById("edit-comment").value = summary;
     }

  }
}
