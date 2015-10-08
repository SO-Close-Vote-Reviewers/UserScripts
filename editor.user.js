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
// @version        1.5.2.25
// @description    Fix common grammar/usage annoyances on Stack Exchange posts with a click
// @include        /^https?://\w*.?(stackoverflow|stackexchange|serverfault|superuser|askubuntu|stackapps)\.com/(questions|posts|review)/(?!tagged|new).*/
// ==/UserScript==

(function() {
    "use strict";
    function extendEditor(root) {
        var App = {};

        // Place edit items here
        App.items = {};
        App.originals = {};

        // Place selected jQuery items here
        App.selections = {};

        // Place "global" app data here
        App.globals = {};

        // Place "helper" functions here
        App.funcs = {};
        
        // True to display rule names in Edit Summary
        App.globals.showRules = false;

        //Preload icon alt
        var SEETicon = new Image();

        SEETicon.src = '//i.imgur.com/d5ZL09o.png';

        App.globals.root = root;

        App.globals.spacerHTML = '<li class="wmd-spacer wmd-spacer3" id="wmd-spacer3" style="left: 400px !important;"></li>';

        App.globals.reasons = {};

        App.globals.replacedStrings = {
            "auto":   [],
            "quote":  [],
            "inline": [],
            "block":  [],
            "links":  [],
            "tags":  []
        };
        App.globals.placeHolders = {
            "auto":   "_xAutoxInsertxTextxPlacexHolder_",
            "quote":  "_xBlockxQuotexPlacexHolderx_",
            "inline": "_xCodexInlinexPlacexHolderx_",
            "block":  "_xCodexBlockxPlacexHolderx_",
            "links":  "_xLinkxPlacexHolderx_",
            "tags":   "_xTagxPlacexHolderx_"
        };
        App.globals.placeHolderChecks = {
            "auto":   /_xAutoxInsertxTextxPlacexHolder_/gi,
            "quote": /_xBlockxQuotexPlacexHolderx_/gi,
            "inline": /_xCodexInlinexPlacexHolderx_/gi,
            "block":  /_xCodexBlockxPlacexHolderx_/gi,
            "links":  /_xLinkxPlacexHolderx_/gi,
            "tags":   /_xTagxPlacexHolderx_/gi
        };
        App.globals.checks = {
            //        https://regex101.com/r/cI6oK2/1 automatically inserted text
            "auto":   /[^]*\<\!\-\- End of automatically inserted text \-\-\>/g,
            //        https://regex101.com/r/fU5lE6/1 blockquotes
            "quote":  /^\>(?:(?!\n\n)[^])+/gm,
            //        https://regex101.com/r/lL6fH3/1 single-line inline code
            "inline": /`[^`\n]+`/g,
            //        https://regex101.com/r/eC7mF7/1 code blocks and multiline inline code.
            "block":  /`[^`]+`|(?:(?:[ ]{4}|[ ]{0,3}\t).+(?:[\r\n]?(?!\n\S)(?:[ ]+\n)*)+)+/g,
            //        https://regex101.com/r/tZ4eY3/5 links and link-sections
            "links":  /\[[^\]\n]+\](?:\([^\)\n]+\)|\[[^\]\n]+\])|(?:  (?:\[\d\]): \w*:+\/\/.*\n*)+|(?!.net)(?:\/\w+|.:\\|\.[^ \n\r.]+|\w+:\/\/)[^\s)]*/g,
            //        tags and html comments  TODO: needs test 
            "tags":   /\<[\/a-z]+\>|\<\!\-\-[^>]+\-\-\>/g
        };
        App.globals.checksr = (function(o1){
            var o2 = {};
            var k= Object.keys(o1);
            for(var i = k.length-1; i >= 0; --i) o2[k[i]] = o1[k[i]];
            return o2;
        })(App.globals.checks);

        // Assign modules here
        App.globals.pipeMods = {};

        // Define order in which mods affect  here
        App.globals.order = ["omit", "codefix", "edit", "replace"];

        // Define edit rules
        App.edits = {
            // All caps
            noneedtoyell: {
                expr: /^((?=.*[A-Z])[^a-z]*)$/g,
                replacement: function(input) {
                    return input.trim().substr(0, 1).toUpperCase() + input.trim().substr(1).toLowerCase();
                },
                reason: 'no need to yell'
            },
            // Trademark capitalization
            so: {
                expr: /\bstack\s*overflow\b/gi,
                replacement: "Stack Overflow",
                reason: "'Stack Overflow' is the legal name"
            },
            se: {
                expr: /\bstack\s*exchange\b/gi,
                replacement: "Stack Exchange",
                reason: "'Stack Exchange' is the legal name"
            },
            expansionSO: {
                expr: /([^\b\w.]|^)SO\b/g,
                replacement: "$1Stack Overflow",
                reason: "'Stack Overflow' is the legal name"
            },
            expansionSE: {
                expr: /([^\b\w.]|^)SE\b/g,
                replacement: "$1Stack Exchange",
                reason: "'Stack Exchange' is the legal name"
            },
            javascript: {
                expr: /([^\b\w.]|^)(javascript|js)\b/gi,
                replacement: "$1JavaScript",
                reason: "trademark capitalization"
            },
            jsfiddle: {
                expr: /\bjsfiddle\b/gi,
                replacement: "JSFiddle",
                reason: "trademark capitalization"
            },
            jquery: {
                expr: /\bjquery\b/gi,
                replacement: "jQuery",
                reason: "trademark capitalization"
            },
            angular: {
                expr: /\bangular(?:js)?\b/gi,
                replacement: "AngularJS",
                reason: "trademark capitalization"
            },
            html: {
                expr: /([^\b\w.]|^)html(\d)?\b/gi,
                replacement: "$1HTML$2",
                reason: "trademark capitalization"
            },
            css: {
                expr: /([^\b\w.]|^)css\b/gi,
                replacement: "$1CSS",
                reason: "trademark capitalization"
            },
            json: {
                expr: /\bjson\b/gi,
                replacement: "JSON",
                reason: "acronym capitalization"
            },
            ajax: {
                expr: /\bajax\b/gi,
                replacement: "AJAX",
                reason: "acronym capitalization"
            },
            php: {
                expr: /([^\b\w.]|^)php\b/gi,
                replacement: "$1PHP",
                reason: "trademark capitalization"
            },
            voting: {
                expr: /\b(down|up)\Wvot/gi,
                replacement: "$1vote",
                reason: "the proper spelling (despite the tag name) is '$1vote' (one word)"
            },
            c: {
                expr: /\bc\b([#+]+)?/gi,
                replacement: "C$1",
                reason: "trademark capitalization"
            },
            java: {
                expr: /\bjava\b/gi,
                replacement: "Java",
                reason: "trademark capitalization"
            },
            sql: {
                expr: /([^\b\w.]|^)sql\b/gi,
                replacement: "$1SQL",
                reason: "trademark capitalization"
            },
            sqlite: {
                expr: /\bsqlite\s*([0-9]*)\b/gi,
                replacement: "SQLite $2",
                reason: "trademark capitalization"
            },
            android: {
                expr: /\bandroid\b/gi,
                replacement: "Android",
                reason: "trademark capitalization"
            },
            oracle: {
                expr: /\boracle\b/gi,
                replacement: "Oracle",
                reason: "trademark capitalization"
            },
            windows: {
                // https://regex101.com/r/jF9zK1/5
                expr: /\b(?:win|windows)\s+(2k|[0-9.]+|ce|me|nt|xp|vista|server)|(?:win|windows)\b/gi,
                replacement: function(match, ver) {
                    ver = !ver ? '' : ver.replace(/ce/i, ' CE')
                    .replace(/me/i, ' ME')
                    .replace(/nt/i, ' NT')
                    .replace(/xp/i, ' XP')
                    .replace(/2k/i, ' 2000')
                    .replace(/vista/i, ' Vista')
                    .replace(/server/i, ' Server');
                    return 'Windows' + ver;
                },
                reason: "trademark capitalization"
            },
            linux: {
                expr: /\blinux\b/gi,
                replacement: "Linux",
                reason: "trademark capitalization"
            },
            wordpress: {
                expr: /\bwordpress\b/gi,
                replacement: "WordPress",
                reason: "trademark capitalization"
            },
            google: {
                expr: /\bgoogle\b/gi,
                replacement: "Google",
                reason: "trademark capitalization"
            },
            mysql: {
                expr: /\bmysql\b/gi,
                replacement: "MySQL",
                reason: "trademark capitalization"
            },
            apache: {
                expr: /\bapache\b/gi,
                replacement: "Apache",
                reason: "trademark capitalization"
            },
            git: {
                expr: /\bgit\b/gi,
                replacement: "Git",
                reason: "trademark capitalization"
            },
            github: {
                expr: /\bgithub\b/gi,
                replacement: "GitHub",
                reason: "trademark capitalization"
            },
            facebook: {
                expr: /\bfacebook\b/gi,
                replacement: "Facebook",
                reason: "trademark capitalization"
            },
            python: {
                expr: /\bpython\b/gi,
                replacement: "Python",
                reason: "trademark capitalization"
            },
            urli: {
                expr: /\b(ur[li])\b/gi,
                replacement: function(match) {
                    return match.toUpperCase();
                },
                reason: "acronym capitalization"
            },
            ios: {
                expr: /\bios\b/gi,
                replacement: "iOS",
                reason: "trademark capitalization"
            },
            iosnum: {
                expr: /\bios([0-9])\b/gi,
                replacement: "iOS $1",
                reason: "trademark capitalization"
            },
            ubuntu: {
                expr: /\b[uoa]*b[uoa]*[tn][oua]*[tnu][oua]*\b/gi,
                replacement: "Ubuntu",
                reason: "trademark capitalization"
            },
            vbnet: {
                expr: /(?:vb)?(?:\.net|\s?[0-9]+)\s?(?:framework|core)?/gi,
                replacement: function(str) {
                    return str.replace(/vb/i, 'VB')
                    .replace(/net/i, 'NET')
                    .replace(/framework/i, 'Framework')
                    .replace(/core/i, 'Core');
                },
                reason: "trademark capitalization"
            },
            regex: {
                expr: /\bregex(p)?\b/gi,
                replacement: "RegEx$1",
                reason: "trademark capitalization"
            },
            postgresql: {
                expr: /\bpostgres(ql|s)?\b/gi,
                replacement: "PostgreSQL",
                reason: "trademark capitalization"
            },
            paypal: {
                expr: /\bpaypal\b/gi,
                replacement: "PayPal",
                reason: "trademark capitalization"
            },
            pdf: {
                expr: /\bpdf(s)*/gi,
                replacement: "PDF$1",
                reason: "trademark capitalization"
            },
            api: {
                expr: /\bapi(s)*\b/gi,
                replacement: "API$1",
                reason: "acronym capitalization"
            },
            // Noise reduction
            editupdate: {
                // https://regex101.com/r/tT2pK6/2
                expr: /(?!(?:edit|update)\w*\s*[^:]*$)(?:^\**)(edit|update)\w*(\s*#?[0-9]+)?:?(?:\**):?/gmi,
                replacement: "",
                reason: "noise reduction"
            },
            hello: { // TODO: Update badsentences (new) to catch everything hello (old) did.
                expr: /(?:^|\s)(hi\s+guys|hi|hello|good\s(?:evening|morning|day|afternoon))(?:\.|!|\ )/gmi,
                replacement: "",
                reason: "noise reduction"
            },
            badwords: {
                expr: /[^\n.!?:]*\b(?:th?anks?|th(?:an)?x|tanx|folks?|ki‌nd(‌?:est|ly)|first\s*question)\b[^,.!?\n]*[,.!?]*/gi,
                replacement: "",
                reason: "noise reduction"
            },
            badphrases: {
                expr: /[^\n.!?:]*(?:h[ea]lp|hope|appreciate|pl(?:ease|z|s))[^.!?\n]*(?:helps?|appreciated?)[^,.!?\n]*[,.!?]*/gi,
                replacement: "",
                reason: "noise reduction"
            },
            imnew: {
                expr: /(?! )[\w\s]*\bi[' ]?a?m +(?:kinda|really) *new\w* +(?:to|in) *\w* *(?:and|[;,.!?])? */gi,
                replacement: "",
                reason: "noise reduction"
            },
            salutations: {
                expr: /[\r\n]*(regards|cheers?),?[\t\f ]*[\r\n]?\w*\.?/gi,
                replacement: "",
                reason: "noise reduction"
            },
            sorry4english: { // https://regex101.com/r/pG3oD6/1
                expr: /(?:^|\s)[^.!\n\r]*(sorry).*?(english).*?(?:[.! \n\r])/gmi,
                replacement: "",
                reason: "noise reduction"
            },
            // Grammar and spelling
            apostrophe_d: {
                expr: /\b(he|she|who|you)[^\w']*(d)\b/gi,
                replacement: "$1'$2",
                reason: "grammar and spelling"
            },
            apostrophe_ll: {
                expr: /\b(they|what|who|you)[^\w']*(ll)\b/gi,
                replacement: "$1'$2",
                reason: "grammar and spelling"
            },
            apostrophe_re: {
                expr: /\b(they|what|you)[^\w']*(re)\b/gi,
                replacement: "$1'$2",
                reason: "grammar and spelling"
            },
            apostrophe_s: {
                expr: /\b(he|she|that|there|what|where)[^\w']*(s)\b/gi,
                replacement: "$1'$2",
                reason: "grammar and spelling"
            },
            apostrophe_t: {
                expr: /\b(aren|can|didn|doesn|don|hasn|haven|isn|mightn|mustn|shan|shouldn|won|wouldn)[^\w']*(t)\b/gi,
                replacement: "$1'$2",
                reason: "grammar and spelling"
            },
            prolly: {
                expr: /\bproll?y\b/gi,
                replacement: "probably",
                reason: "grammar and spelling"
            },
            i: {
                expr: /\bi('|\b)/g,  // i or i-apostrophe
                replacement: "I",
                reason: "grammar and spelling"
            },
            im: {
                expr: /\bim\b/gi,
                replacement: "I'm",
                reason: "grammar and spelling"
            },
            ive: {
                expr: /\bive\b/gi,
                replacement: "I've",
                reason: "grammar and spelling"
            },
            ur: {
                expr: /\bur\b/gi,
                replacement: "your", // May also be "you are", but less common on SO
                reason: "grammar and spelling"
            },
            u: {
                expr: /\bu\b/gi,
                replacement: "you",
                reason: "grammar and spelling"
            },
            gr8: {
                expr: /\bgr8\b/gi,
                replacement: "great",
                reason: "grammar and spelling"
            },
            allways: {
                expr: /\b(a)llways\b/gi,
                replacement: "$1lways",
                reason: "grammar and spelling"
            },
            // Punctuation & Spacing come last
            firstcaps: {
                //    https://regex101.com/r/qR5fO9/12
                // This doesn't work quite right, because is finds all sentences, not just ones needing caps.
                //expr: /(?:(?!\n\n)[^\s.!?]+[ ]*)+([.!?])*[ ]*/g, 
                expr: /((?!\n\n)(?:[^?.!])*([?.!]|\n\n)?\)*)/gm, 
                replacement: function(str, endpunc) { 
                    if (str === "undefined") return '';
                    console.log('str: '+str);
                    //                 https://regex101.com/r/bL9xD7/1 find and capitalize first letter
                    return str.replace(/^(\W*)([a-z])(.*)/g, function(sentence, pre, first, post) {
                        if (!pre) pre = '';
                        if (!post) post = '';
                        console.log('sentence ('+sentence+') pre ('+pre+') first ('+first+') post ('+post+') endpunc ('+endpunc+')');
                        var update = pre + first.toUpperCase() + post// + (!endpunc && /\w/.test(post.substr(-1)) ? '.' : '');
                        console.log('update ('+update+')');
                        return update;
                    });
                },
                reason: "Caps at start of sentences"
            },
            multiplesymbols: {
                //    https://regex101.com/r/bE9zM6/1
                expr: /([^\w\s*#.\-_])\1{1,}/g,
                replacement: "$1",
                reason: "punctuation & spacing"
            },
            spacesbeforesymbols: {
                expr: /\s+([.,!?;:])(?!\w)/g,
                replacement: "$1",
                reason: "punctuation & spacing"
            },
            multiplespaces: {
                // https://regex101.com/r/hY9hQ3/1
                expr: /[ ]{2,}(?!$)/g,
                replacement: " ",
                reason: "punctuation & spacing"
            }
        };

        // This is where the magic happens: this function takes a few pieces of information and applies edits to the post with a couple exceptions
        App.funcs.fixIt = function(input, expression, replacement, reasoning) {
            // If there is nothing to search, exit
            if (!input) return false;
            // Scan the post text using the expression to see if there are any matches
            var matches = input.match(expression);
            if (!matches) return false;
            console.log(JSON.stringify(matches))
            var count = matches.length;  // # replacements to do
            var tmpinput = input;
            input = input.replace(expression, function() {
                var matches = [].slice.call(arguments, 0, -2);
                reasoning = reasoning.replace(/[$](\d)+/g, function() {
                    var phrases = [].slice.call(arguments, 0, -2);
                    var phrase = matches[phrases[1]];
                    return phrase ? phrase : '';
                });
                return arguments[0].replace(expression, replacement);
            });
            if (input !== tmpinput) {
                return {
                    reason: reasoning,
                    fixed: String(input).trim(),
                    count: count
                };
            } else return false;
        };

        App.funcs.applyListeners = function() { // Removes default Stack Exchange listeners; see https://github.com/AstroCB/Stack-Exchange-Editor-Toolkit/issues/43
            function removeEventListeners(e) {
                if (e.which === 13) {
                    if (e.metaKey || e.ctrlKey) {
                        // CTRL/CMD + Enter -> Activate the auto-editor
                        App.selections.buttonFix.click();
                    } else {
                        // It's possible to remove the event listeners, because of the way outerHTML works.
                        this.outerHTML = this.outerHTML;
                        App.selections.submitButton.click();
                    }
                }
            }

            // Tags box
            App.selections.tagField.keydown(removeEventListeners);

            // Edit summary box
            App.selections.summary.keydown(removeEventListeners);
        };

        // Populate or refresh DOM selections
        App.funcs.popSelections = function() {
            App.selections.redoButton   = App.globals.root.find('[id^="wmd-redo-button"]');
            App.selections.body         = App.globals.root.find('[id^="wmd-input"]');
            App.selections.title        = App.globals.root.find('[class*="title-field"]');
            App.selections.summary      = App.globals.root.find('[id^="edit-comment"]');
            App.selections.tagField     = App.globals.root.find(".tag-editor");
            App.selections.submitButton = App.globals.root.find('[id^="submit-button"]');
            App.selections.helpButton   = App.globals.root.find('[id^="wmd-help-button"]');
            App.selections.editor       = App.globals.root.find('.post-editor');
        };

        // Populate edit item sets from DOM selections
        App.funcs.popItems = function() {
            var i = App.items, s = App.selections;
            ['title', 'body', 'summary'].forEach(function(v) {
                i[v] = String(s[v].val()).trim();
            });
        };

        // Populate original item sets from DOM selections
        App.funcs.popOriginals = function() {
            var i = App.originals, s = App.selections;
            ['title', 'body', 'summary'].forEach(function(v) {
                i[v] = String(s[v].val()).trim();
            });
        };

        // Insert editing button(s)
        App.funcs.createButton = function() {
            if (!App.selections.redoButton.length) return false;

            App.selections.buttonWrapper = $('<div class="ToolkitButtonWrapper"/>');
            App.selections.buttonFix = $('<button class="wmd-button ToolkitFix" title="Fix the content!" />');
            App.selections.buttonInfo = $('<div class="ToolkitInfo">');

            // Build the button
            App.selections.buttonWrapper.append(App.selections.buttonFix);
            App.selections.buttonWrapper.append(App.selections.buttonInfo);

            // Insert button
            App.selections.redoButton.after(App.selections.buttonWrapper);
            // Insert spacer
            App.selections.redoButton.after(App.globals.spacerHTML);

            // Attach the event listener to the button
            App.selections.buttonFix.click(App.funcs.fixEvent);

            App.selections.helpButton.css({
                'padding': '0px'
            });
            App.selections.buttonWrapper.css({
                'position': 'relative',
                'left': '430px',
                'padding-top': '2%'
            });
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
        };

        App.funcs.makeDiffTable = function() {
            App.selections.diffTable = $('<table class="diffTable"/>');
            App.selections.editor.append(App.selections.diffTable);
        };

        App.funcs.fixEvent = function(e) {
            if (e) e.preventDefault();
            // Refresh item population
            App.funcs.popOriginals();
            App.funcs.popItems();
            // Pipe data through editing modules
            App.pipe(App.items, App.globals.pipeMods, App.globals.order);
        };

        App.funcs.diff = function() {
            App.selections.diffTable.empty();

            function maakRij(x, y, type, rij) {

                var tr = $('<tr/>');

                if (type === '+') tr.addClass('add');
                if (type === '-') tr.addClass('del');

                tr.append($('<td class="codekolom">' + y + '</td>'));
                tr.append($('<td class="codekolom">' + x + '</td>'));
                tr.append($('<td class="bredecode">' + type + ' ' + rij.replace(/\</g, '&lt;') + '</td>'));

                App.selections.diffTable.append(tr);
            }

            function getDiff(matrix, a1, a2, x, y) {
                if (x > 0 && y > 0 && a1[y - 1] === a2[x - 1]) {
                    getDiff(matrix, a1, a2, x - 1, y - 1);
                    maakRij(x, y, ' ', a1[y - 1]);
                } else {
                    if (x > 0 && (y === 0 || matrix[y][x - 1] >= matrix[y - 1][x])) {
                        getDiff(matrix, a1, a2, x - 1, y);
                        maakRij(x, '', '+', a2[x - 1]);
                    } else if (y > 0 && (x === 0 || matrix[y][x - 1] < matrix[y - 1][x])) {
                        getDiff(matrix, a1, a2, x, y - 1);
                        maakRij('', y, '-', a1[y - 1], '');
                    } else {
                        return;
                    }
                }

            }

            
            var a1 = App.originals.body.split('\n');
            var a2 = App.items.body.split('\n');
            
            var matrix = new Array(a1.length + 1);
            var x, y;
            for (y = 0; y < matrix.length; y++) {
                matrix[y] = new Array(a2.length + 1);

                for (x = 0; x < matrix[y].length; x++) {
                    matrix[y][x] = 0;
                }
            }

            for (y = 1; y < matrix.length; y++) {
                for (x = 1; x < matrix[y].length; x++) {
                    if (a1[y - 1] === a2[x - 1]) {
                        matrix[y][x] = 1 + matrix[y - 1][x - 1];
                    } else {
                        matrix[y][x] = Math.max(matrix[y - 1][x], matrix[y][x - 1]);
                    }
                }
            }

            try {
                getDiff(matrix, a1, a2, x - 1, y - 1);
            } catch (e) {
                alert(e);
            }
        };

        // Handle pipe output
        App.funcs.output = function(data) {
            App.selections.title.val(data.title);
            App.selections.body.val(data.body);
            App.selections.summary.val(data.summary);
            App.selections.summary.focus();
            App.selections.editor.append(App.funcs.diff());
            StackExchange.MarkdownEditor.refreshAllPreviews();
            App.selections.buttonInfo.text(App.globals.changes + (App.globals.changes>1 ? ' changes' : ' change')+' made');
        };

        // Pipe data through modules in proper order, returning the result
        App.pipe = function(data, mods, order) {
            var modName;
            for (var i in order) {
                if (order.hasOwnProperty(i)) {
                    modName = order[i];
                    mods[modName](data);
                }
            }
            App.funcs.output(data);
        };

        App.globals.pipeMods.omit = function(data) {
            if (!data.body) return false;
            for (var type in App.globals.checks) {
                data.body = data.body.replace(App.globals.checks[type], function(match) {
                    App.globals.replacedStrings[type].push(match);
                    return App.globals.placeHolders[type];
                });
            }
            return data;
        };

        App.globals.pipeMods.codefix = function() {
            var replaced = App.globals.replacedStrings.block, str;
            for (var i in replaced) {
                // https://regex101.com/r/tX9pM3/1       https://regex101.com/r/tX9pM3/2                 https://regex101.com/r/tX9pM3/3
                if (/^`[^]+`$/.test(replaced[i])) replaced[i] = /(?!`)((?!`)[^])+/.exec(replaced[i])[1].replace(/(.+)/g, '    $1');
            }
        };

        App.globals.pipeMods.replace = function(data) {
            if (!data.body) return false;
            for (var type in App.globals.checksr) {
                var i = 0;
                data.body = data.body.replace(App.globals.placeHolderChecks[type], function(match) {
                    return App.globals.replacedStrings[type][i++];
                });
            }
            return data;
        };

        App.globals.pipeMods.edit = function(data) {
            // Visually confirm edit - SE makes it easy because the jQuery color animation plugin seems to be there by default
            App.selections.body.animate({
                backgroundColor: '#c8ffa7'
            }, 10);
            App.selections.body.animate({
                backgroundColor: '#fff'
            }, 1000);

            // List of fields to be edited
            var fields = {body:'body',title:'title'};
            // Loop through all editing rules
            for (var j in App.edits) {
                for (var field in fields) {
                    if (App.edits.hasOwnProperty(j)) {
                        var fix = App.funcs.fixIt(data[field], App.edits[j].expr,
                                                  App.edits[j].replacement, App.edits[j].reason);
                        if (fix) {
                            // HACK ALERT
                            if (j === 'firstcaps') fix.count = 1;

                            if (!App.globals.reasons.hasOwnProperty(fix.reason)) {
                                App.globals.reasons[fix.reason] = {reason:fix.reason, editId:j, count:fix.count};
                            }
                            else {
                                App.globals.reasons[fix.reason].count += fix.count;
                            }
                            data[field] = fix.fixed;
                            App.edits[j].fixed = true;
                        }
                    }
                }
            }

            // If there are no reasons, exit
            if (App.globals.reasons == {}) return false;

            // We need a place to store the reasons being applied to the summary. 
            var reasons = [];
            App.globals.changes = 0;
          
            for (var z in App.globals.reasons) {
                // For each type of change made, add a reason string with the reason text,
                // optionally the rule ID, and the number of repeats if 2 or more.
                reasons.push(App.globals.reasons[z].reason
                             + (App.globals.showRules ? ' ['+ App.globals.reasons[z].editId +']' : '')
                             + ((App.globals.reasons[z].count > 1) ? ' ('+App.globals.reasons[z].count+')' : '') );
                App.globals.changes += App.globals.reasons[z].count;
            }
          
            var reasonStr = reasons.join('; ')+'.';  // Unique reasons separated by ; and terminated by .
            reasonStr = reasonStr.charAt(0).toUpperCase() + reasonStr.slice(1);  // Cap first letter.

            if (!data.summaryOrig) data.summaryOrig = data.summary.trim(); // Remember original summary
            if (data.summaryOrig.length) data.summaryOrig = data.summaryOrig + ' ';
          
            data.summary = data.summaryOrig + reasonStr;
            // Limit summary to 300 chars
            if (data.summary.length > 300) data.summary = data.summary.substr(0,300-3) + '...';

            return data;
        };

        // Init app
        App.init = function() {
            var count = 0;
            var toolbarchk = setInterval(function(){
                //console.log('waiting for toolbar');
                if(++count === 10) clearInterval(toolbarchk)
                if(!App.globals.root.find('.wmd-button-row').length) return;
                clearInterval(toolbarchk);
                //console.log('found toolbar');
                App.funcs.popSelections();
                App.funcs.createButton();
                App.funcs.applyListeners();
                App.funcs.makeDiffTable();
            }, 100);
            return App;
        };

        return App.init();
    }
    try {
        var test = window.location.href.match(/.posts.(\d+).edit/);
        if(test) extendEditor($('form[action^="/posts/' + test[1] + '"]'));
        else $(document).ajaxComplete(function() { 
            test = arguments[2].url.match(/posts.(\d+).edit-inline/);
            if(!test) {
                test = arguments[2].url.match(/review.inline-edit-post/)
                if(!test) return;
                test = arguments[2].data.match(/id=(\d+)/);
                if(!test) return;
            }
            extendEditor($('form[action^="/posts/' + test[1] + '"]'));
        });
        if($('#post-form').length) extendEditor($('#post-form'));
        // This is the styling for the diff output.
        $('body').append('<style>.diff { max-width: 100%; overflow: auto; } td.bredecode, td.codekolom { padding: 1px 2px; } td.bredecode { width: 100%; padding-left: 4px; white-space: pre-wrap; word-wrap: break-word; } td.codekolom { text-align: right; min-width: 3em; background-color: #ECECEC; border-right: 1px solid #DDD; color: #AAA; } tr.add { background: #DFD; } tr.del { background: #FDD; }</style>');
    } catch (e) {
        console.log(e);
    }
})();
