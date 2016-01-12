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
// @version        1.5.2.56
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

        // Place "const" app data here
        App.consts = {};

        // Place "helper" functions here
        App.funcs = {};

        // True to display counts and / or rule names in Edit Summary
        App.globals.showCounts = false;
        App.globals.showRules = false;

        App.globals.root = root;

        App.globals.reasons = {};

        App.globals.replacedStrings = {
            "auto":   [],
            "quote":  [],
            "inline": [],
            "block":  [],
            "lsec":   [],
            "links":  [],
            "tags":   []
        };
        App.globals.placeHolders = {
            "auto":   "_xAutoxInsertxTextxPlacexHolder_",
            "quote":  "_xBlockxQuotexPlacexHolderx_",
            "inline": "_xCodexInlinexPlacexHolderx_",
            "block":  "_xCodexBlockxPlacexHolderx_",
            "lsec":   "_xLinkxSectionxPlacexHolderx_",
            "links":  "_xLinkxPlacexHolderx_",
            "tags":   "_xTagxPlacexHolderx_"
        };
        App.globals.placeHolderChecks = {
            "auto":   /_xAutoxInsertxTextxPlacexHolder_/gi,
            "quote":  /_xBlockxQuotexPlacexHolderx_/gi,
            "inline": /_xCodexInlinexPlacexHolderx_/gi,
            "block":  /_xCodexBlockxPlacexHolderx_/gi,
            "lsec":   /_xLinkxSectionxPlacexHolderx_/gi,
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
            //        https://regex101.com/r/eC7mF7/2 code blocks and multiline inline code.
            "block":  /`[^`]+`|^(?:(?:[ ]{4}|[ ]{0,3}\t).+(?:[\r\n]?(?!\n\S)(?:[ ]+\n)*)+)+/gm,
            //        https://regex101.com/r/tZ4eY3/7 link-sections 
            "lsec":   /(?:  (?:\[\d\]): \w*:+\/\/.*\n*)+/g,
            //        https://regex101.com/r/tZ4eY3/20 links and pathnames
            "links":  /\[[^\]\n]+\](?:\([^\)\n]+\)|\[[^\]\n]+\])|(?:\/\w+\/|.:\\|\w*:\/\/|\.+\/[./\w\d]+|(?:\w+\.\w+){2,})[./\w\d:/?#\[\]@!$&'()*+,;=\-~%]*/g,
            //        https://regex101.com/r/bF0iQ0/1   tags and html comments 
            "tags":   /\<[\/a-z]+\>|\<\!\-\-[^>]+\-\-\>/g
        };
        App.globals.checksr = (function(o1){
            var o2 = {};
            var k= Object.keys(o1);
            for(var i = k.length-1; i >= 0; --i) o2[k[i]] = o1[k[i]];
            return o2;
        })(App.globals.checks);

        // Assign modules here
        App.pipeMods = {};

        // Define order in which mods affect  here
        App.globals.order = ["omit", "codefix", "edit", "diff", "replace", "output"];
        
        // Define reason constant strings
        App.consts.reasons = {
            legalSO:       "'Stack Overflow' is the legal name",
            legalSE:       "'Stack Exchange' is the legal name",
            tidyTitle:     "tidied title",
            trademark:     "trademark capitalization",
            acronym:       "acronym capitalization",
            spelling:      "spelling",
            grammar:       "grammar",
            noise:         "noise reduction",
            punctuation:   "punctuation",
            layout:        "layout",
            silent:        "",                              // Unreported / uncounted
            titleSaysAll:  "replicated title in body"
        };

        
        // Get the original post tags
        App.globals.taglist = [];
        $('a.post-tag').each( function(){
            var newtag = $(this).text();
            if (App.globals.taglist.indexOf(newtag) === -1) {
                App.globals.taglist.push(newtag);                
            }
        });

        // Define edit rules
        App.edits = {
            // Tidy the title
            noneedtoyell: {
                expr: /^((?=.*[A-Z])[^a-z]*)$/g,
                replacement: function(input) {
                    return input.trim().substr(0, 1).toUpperCase() + input.trim().substr(1).toLowerCase();
                },
                reason: App.consts.reasons.tidyTitle
            },
            taglist: {  // https://regex101.com/r/wH4oA3/18
                expr: new RegExp(  "(?:^(?:[(]?(?:_xTagsx_)(?:and|[ ,.&+/-])*)+[:. \)-]*|(?:[:. \(-]|in|with|using|by)*(?:(?:_xTagsx_)(?:and|[ ,&+/)-])*)+([?.! ]*)$)"
                                 .replace(/_xTagsx_/g,App.globals.taglist.map(escapeTag).join("|")),
                                 //.replace(/\\(?=[bsSdDwW])/g,"\\"), // https://regex101.com/r/pY1hI2/1 - WBN to figure this out.
                                 'gi'),
                replacement: "$1",
                debug: false,
                reason: App.consts.reasons.tidyTitle
            },
            so: {
                expr: /\bstack\s*overflow\b/gi,
                replacement: "Stack Overflow",
                reason: App.consts.reasons.legalSO
            },
            se: {
                expr: /\bstack\s*exchange\b/gi,
                replacement: "Stack Exchange",
                reason: App.consts.reasons.legalSE
            },
            expansionSO: {
                expr: /([^\b\w.]|^)SO\b/g,
                replacement: "$1Stack Overflow",
                reason: App.consts.reasons.legalSO
            },
            expansionSE: {
                expr: /([^\b\w.]|^)SE\b/g,
                replacement: "$1Stack Exchange",
                reason: App.consts.reasons.legalSE
            },
            /*
            ** Trademark names
            **/
            jsfiddle: {
                expr: /\bjs ?fiddle\b/gi,
                replacement: "JSFiddle",
                reason: App.consts.reasons.trademark
            },
            meteor: {  // must appear before "javascript"
                expr: /([^\b\w.]|^)meteor *(js)?\b/gi,
                replacement: function (str,pre,uppercase) {
                    var fixed = pre + "Meteor" + (uppercase ? uppercase.toUpperCase() : '');
                    return fixed;
                },
                reason: App.consts.reasons.trademark
            },
            knockout_js: {  // must appear before "javascript"
                expr: /\bknockout[. ]?js\b/gi,
                replacement: "Knockout.js",
                reason: App.consts.reasons.trademark
            },
            javascript: {
                expr: /([^\b\w.]|^)(java?scr?ipt?|js|java script?)\b/gi,
                replacement: "$1JavaScript",
                reason: App.consts.reasons.trademark
            },
            jquery: {
                expr: /\bjque?rr?y\b/gi,  // jqury, jquerry, jqurry... ~600 spelling mistakes
                replacement: "jQuery",
                reason: App.consts.reasons.trademark
            },
            angular: {
                expr: /\bangular(?:js)?\b/gi,
                replacement: "AngularJS",
                reason: App.consts.reasons.trademark
            },
            php: {
                expr: /(?:[^\b\w.]|^)php[\d]?\b(?!\.ini)/gi,
                replacement: function (match) { return match.toUpperCase(); },
                reason: App.consts.reasons.trademark
            },
            c: {
                expr: /(?:[^\b\w.]|^)c\b(?:#|\+\+)?/gi,
                replacement: function (match) { return match.toUpperCase(); },
                reason: App.consts.reasons.trademark
            },
            java: {
                expr: /([^\b\w.]|^)java\b/gi,
                replacement: "$1Java",
                reason: App.consts.reasons.trademark
            },
            sqlite: {
                expr: /\bsqlite(\s*[0-9]*)\b/gi,
                replacement: "SQLite$1",
                reason: App.consts.reasons.trademark
            },
            android: {
                expr: /\bandroid\b/gi,
                replacement: "Android",
                reason: App.consts.reasons.trademark
            },
            oracle: {
                expr: /\boracle\b/gi,
                replacement: "Oracle",
                reason: App.consts.reasons.trademark
            },
            windows: {
                // https://regex101.com/r/jF9zK1/8
                expr: /\b(?:win(?=(?:\s+(?:2k|[0-9.]+|ce|me|nt|xp|vista|server)))|windows)(?:\s+(2k|[0-9.]+|ce|me|nt|xp|vista|server))?\b/gi,
                replacement: function(match, ver) {
                    ver = !ver ? '' : ' '+ver
                    .replace(/ce/i, 'CE')
                    .replace(/me/i, 'ME')
                    .replace(/nt/i, 'NT')
                    .replace(/xp/i, 'XP')
                    .replace(/2k/i, '2000')
                    .replace(/vista/i, 'Vista')
                    .replace(/server/i, 'Server');
                    return 'Windows' + ver;
                },
                reason: App.consts.reasons.trademark
            },
            linux: {
                expr: /\blinux\b/gi,
                replacement: "Linux",
                reason: App.consts.reasons.trademark
            },
            wordpress: {
                expr: /\bword ?press\b/gi,
                replacement: "WordPress",
                reason: App.consts.reasons.trademark
            },
            mysql: {
                expr: /\bmysql\b/gi,
                replacement: "MySQL",
                reason: App.consts.reasons.trademark
            },
            nodejs: {
                expr: /\bnode\.?js\b/gi,
                replacement: "Node.js",
                reason: App.consts.reasons.trademark
            },
            apache: {
                expr: /\bapache([\d])?\b/gi,
                replacement: "Apache$1",
                reason: App.consts.reasons.trademark
            },
            git: {
                expr: /([^\b\w.]|^)git\b/gi,
                replacement: "$1Git",
                reason: App.consts.reasons.trademark
            },
            github: {
                expr: /\bgithub\b/gi,
                replacement: "GitHub",
                reason: App.consts.reasons.trademark
            },
            facebook: {
                expr: /\bfacebook\b/gi,
                replacement: "Facebook",
                reason: App.consts.reasons.trademark
            },
            python: {
                expr: /\bpython\b/gi,
                replacement: "Python",
                reason: App.consts.reasons.trademark
            },
            ios: {
                expr: /\bios\b/gi,
                replacement: "iOS",
                reason: App.consts.reasons.trademark
            },
            iosnum: {
                expr: /\bios([0-9])\b/gi,
                replacement: "iOS $1",
                reason: App.consts.reasons.trademark
            },
            ubuntu: {  // https://regex101.com/r/sT8wV5/2
                expr: /\b[uoa]+n?b[uoa]*[tn][oua]*[tnu][oua]*\b/gi,
                replacement: "Ubuntu",
                reason: App.consts.reasons.trademark
            },
            vbnet: {  // https://regex101.com/r/bB9pP3/8
                expr: /(?:vb\.net|\bvb|(?:[^\b\w.]|^)\.net)\b(?:\s*[0-9]+)?\s*(?:framework|core)?/gi,
                replacement: function(str) {
                    return str.replace(/([^.])vb/i, '$1VB')
                    .replace(/([^.])asp/i, '$1ASP')
                    .replace(/net/i, 'NET')
                    .replace(/framework/i, 'Framework')
                    .replace(/core/i, 'Core');
                },
                reason: App.consts.reasons.trademark
            },
            vba_related: {
                expr: /(?:[^\b\w.]|^)(?:vba|vbs|vbc|evb|vbo|vbp|vbide)\b/gi,
                replacement: function (match) { return match.toUpperCase(); },
                reason: App.consts.reasons.trademark
            },
            vbscript: {
                expr: /\bvbscript/gi,
                replacement: "VBScript",
                reason: App.consts.reasons.trademark
            },
            regex: {
                expr: /\bregg?[ea]?x(p)?\b/gi,
                replacement: "RegEx$1",
                reason: App.consts.reasons.trademark
            },
            postgresql: {
                expr: /\bpost?gres*(q?l|s)?\b/gi,
                replacement: "PostgreSQL",
                reason: App.consts.reasons.trademark
            },
            paypal: {
                expr: /\bpaypal\b/gi,
                replacement: "PayPal",
                reason: App.consts.reasons.trademark
            },
            tomcat: {
                expr: /\btomcat([0-9.]*)/gi,
                replacement: "Tomcat$1",
                reason: App.consts.reasons.trademark
            },
            netbeans: {
                expr: /\b(?:netbean?|net-bean|net bean|netbeen)s?\b/gi,
                replacement: "NetBeans",
                reason: App.consts.reasons.trademark
            },
            nginx: {
                expr: /\bnginx\b/g,
                replacement: function (match) { return match.toUpperCase(); },
                reason: App.consts.reasons.trademark
            },
            firefox: {
                expr: /\bfire?fox\b/gi,
                replacement: "Firefox",
                reason: App.consts.reasons.trademark
            },
            safari: {
                expr: /\bsafari\b/gi,
                replacement: "Safari",
                reason: App.consts.reasons.trademark
            },
            chrome: {
                expr: /\bchrome\b/gi,
                replacement: "Chrome",
                reason: App.consts.reasons.trademark
            },
            gnu: {
                expr: /\bgnu\b/g,
                replacement: function (match) { return match.toUpperCase(); },
                reason: App.consts.reasons.trademark
            },
            gcc: {
                expr: /(?:[^\b\w.]|^)gcc\b/g,
                replacement: function (match) { return match.toUpperCase(); },
                reason: App.consts.reasons.trademark
            },
            maven: {
                expr: /\bmaven\b/gi,
                replacement: "Maven",
                reason: App.consts.reasons.trademark
            },
            youtube: {
                expr: /\byoutube\b/gi,
                replacement: "YouTube",
                reason: App.consts.reasons.trademark
            },
            amazon: {
                // https://regex101.com/r/dR0pJ7/1
                expr: /\b(amazon(?: )?(?:redshift|web services|cloudfront|console)?)((?: )?(?:ec2|aws|s3|rds|sqs|iam|elb|emr|vpc))?\b/gi,
                replacement: function(str,titlecase,uppercase) {
                    var fixed = titlecase.toTitleCase() + (uppercase ? uppercase.toUpperCase() : '');
                    return fixed;
                },
                reason: App.consts.reasons.trademark
            },
            zend: {
                expr: /\bzend((?: )?(?:framework|studio|guard))?\b/gi,
                //replacement: String.toTitleCase,  // Doesn't work like built-in toUpperCase, returns 'undefined'. Load order?
                replacement: function(str,prod) {
                    return str.toTitleCase();
                },
               reason: App.consts.reasons.trademark
            },
            twitter: {
                expr: /\btwitter\b/gi,
                replacement: "Twitter",
                reason: App.consts.reasons.trademark
            },
            bootstrap: {     // "bootstrap" is also a general computing term, so expect some false positives
                expr: /\bbootst?r?ap\b/gi,
                replacement: "Bootstrap",
                reason: App.consts.reasons.trademark
            },
            apple: {
                expr: /\bapple\b/g,
                replacement: "Apple",
                reason: App.consts.reasons.trademark
            },
            iphone: {
                expr: /\biph?one?\b/gi,
                replacement: "iPhone",
                reason: App.consts.reasons.trademark
            },
            google_verbed: {
                expr: /\bgoogl(?:ed|ing|er)\b/gi,
                replacement: function(str) {
                    return str.toTitleCase();
                },
                reason: App.consts.reasons.trademark
            },
            google: { // https://regex101.com/r/iS5fO1/1
                expr: /\bgoogle\b[ \t]*(?:maps?|sheets?|docs?|drive|sites?|forms?|documents?|spreadsheets?|images?|presentations?)?\b/gi,
                replacement: function(str) {
                    return str.toTitleCase();
                },
                reason: App.consts.reasons.trademark
            },
            google_apps_script: {
                expr: /\bgoogle[- ]?(?:apps?)?[- ]?script(?:ing|s)?\b/gi,
                replacement: "Google Apps Script",
                reason: App.consts.reasons.trademark
            },
            bluetooth: {
                expr: /\bbl(?:ue|oo)too?th?\b/gi,
                replacement: "Bluetooth",
                reason: App.consts.reasons.trademark
            },
            lenovo: {
                expr: /\bleno?vo\b/gi,
                replacement: "Lenovo",
                reason: App.consts.reasons.trademark
            },
            matlab: {
                expr: /([^\b\w.]|^)math?lab\b/gi,
                replacement: "$1MATLAB",
                reason: App.consts.reasons.trademark
            },
            internet: {
                expr: /\binternet\b/g,
                replacement: "Internet",
                reason: App.consts.reasons.trademark
            },
            oauth: {  // https://regex101.com/r/sA2cQ5/1
                expr: /\boauth(?:(?: )*(\d)(?!\.\d)|(?: )*([\d.]+))?\b/gi,
                replacement: "OAuth$1 $2",
                reason: App.consts.reasons.trademark
            },
            web_services: {
                expr: /\bweb services\b/g,
                replacement: "Web services",
                reason: App.consts.reasons.trademark
            },
            opencv: {
                expr: /\bopencv\b/gi,
                replacement: "OpenCV",
                reason: App.consts.reasons.trademark
            },
            ruby: {
                expr: /\bruby\b/g,
                replacement: "Ruby",
                reason: App.consts.reasons.trademark
            },
            rails: {
                expr: /\brails\b/g,
                replacement: "Rails",
                reason: App.consts.reasons.trademark
            },
            grails: {
                expr: /\bgrails\b/g,
                replacement: "Grails",
                reason: App.consts.reasons.trademark
            },
            subversion: {
                expr: /\bsubvers[io]*n\b/g,
                replacement: "Subversion",
                reason: App.consts.reasons.trademark
            },
            javafx: {
                expr: /\bjavafx\b/gi,
                replacement: "JavaFX",
                reason: App.consts.reasons.trademark
            },
            delphi: {
                expr: /\bdelphi\b/gi,
                replacement: "Delphi",
                reason: App.consts.reasons.trademark
            },
            dotnetnuke: {
                expr: /\bdotnetnuke\b/gi,
                replacement: "DotNetNuke",
                reason: App.consts.reasons.trademark
            },
            silverlight: {
                expr: /\bsilverl(?:ight|ite)\b/gi,
                replacement: "Silverlight",
                reason: App.consts.reasons.trademark
            },
            scipy: {
                expr: /([^\b\w.]|^)scipy\b/gi,
                replacement: "$1SciPy",
                reason: App.consts.reasons.trademark
            },
            numpy: {
                expr: /([^\b\w.]|^)numpy\b/gi,
                replacement: "$1NumPy",
                reason: App.consts.reasons.trademark
            },
            openssl: {
                expr: /([^\b\w.]|^)openssl\b/gi,
                replacement: "$1OpenSSL",
                reason: App.consts.reasons.trademark
            },
            drupal: {
                expr: /([^\b\w.]|^)drupal\b/gi,
                replacement: "$1Drupal",
                reason: App.consts.reasons.trademark
            },
            saas: {
                expr: /([^\b\w.]|^)saas\b/gi,
                replacement: "$1SaaS",
                reason: App.consts.reasons.trademark
            },
            gwt: {
                expr: /([^\b\w.]|^)gwt[- ](mosaic|designer)\b/gi,
                replacement: function (str,pre,titlecase) {
                    var fixed = pre + "GWT" + (titlecase? ' '+titlecase.toTitleCase() : '');
                    return fixed;
                },
                reason: App.consts.reasons.trademark
            },
            gmail: {
                expr: /([^\b\w.]|^)gmail(s)?\b/gi,
                replacement: "$1Gmail$2",
                reason: App.consts.reasons.trademark
            },
            xampp: {
                expr: /([^\b\w.]|^)xam+p+\b/gi,
                replacement: "$1XAMPP",
                reason: App.consts.reasons.trademark
            },
            galaxy: {
                expr: /([^\b\w.]|^)galaxy\b/gi,
                replacement: "$1Galaxy",
                reason: App.consts.reasons.trademark
            },
            mongo: {
                expr: /([^\b\w.]|^)mongo(?:\s?(db))?\b/gi,
                replacement: function(str,pre,uppercase) {
                    var fixed = pre + "Mongo" + (uppercase ? uppercase.toUpperCase() : '');
                    return fixed;
                },
                reason: App.consts.reasons.trademark
            },
            pymongo: {
                expr: /([^\b\w.]|^)pymongo\b/gi,
                replacement: "$1PyMongo",
                reason: App.consts.reasons.trademark
            },
            scala: {
                expr: /([^\b\w.]|^)scala\b/gi,
                replacement: "$1Scala",
                reason: App.consts.reasons.trademark
            },
            microsoft: { // https://regex101.com/r/dJ5tE3/1
                expr: /\b([mM]icrosoft?|[mM]ircosoft|M[Ss]oft)\b/g,
                replacement: "Microsoft",
                reason: App.consts.reasons.trademark
            },
            intellisense: {
                expr: /\bintell?isen[sc]e?\b/gi,
                replacement: "IntelliSense",
                reason: App.consts.reasons.trademark
            },
            sass: {  // Syntactically Awesome Style Sheets
                expr: /\bsass\b/gi,
                replacement: "Sass",
                reason: App.consts.reasons.trademark
            },
            heroku: {
                expr: /\bheroku\b/gi,
                replacement: "Heroku",
                reason: App.consts.reasons.trademark
            },
            os_x: {
                expr: /\bos ?x\b/gi,
                replacement: "OS X",
                reason: App.consts.reasons.trademark
            },
            el_capitan: {
                expr: /\bel ?capi?tan\b/gi,
                replacement: "El Capitan",
                reason: App.consts.reasons.trademark
            },
            hadoop: {
                expr: /\bhadoop\b/gi,
                replacement: "Hadoop",
                reason: App.consts.reasons.trademark
            },
            django: {
                expr: /\bdjango\b/gi,
                replacement: "Django",
                reason: App.consts.reasons.trademark
            },
            /*
            ** Acronyms - to be capitalized (except sometimes when part of a file name)
            **/
            x_html: {
                expr: /(?:[^\b\w.]|^)(:?g|ht|x|xht|sf|csht)ml[\d.]*\b/gi,
                replacement: function (match) { return match.toUpperCase(); },
                reason: App.consts.reasons.acronym
            },
            css: {
                expr: /(?:[^\b\w.]|^)s?css\b/gi,
                replacement: function (match) { return match.toUpperCase(); },
                reason: App.consts.reasons.acronym
            },
            json: {
                expr: /(?:[^\b\w.]|^)json\b/gi,
                replacement: function (match) { return match.toUpperCase(); },
                reason: App.consts.reasons.acronym
            },
            ajax: {
                expr: /\bajax\b/g,     // Leave "Ajax" alone. See https://github.com/AstroCB/Stack-Exchange-Editor-Toolkit/issues/45
                replacement: "AJAX",
                reason: App.consts.reasons.acronym
            },
            sql: {
                expr: /(?:[^\b\w.]|^)sql\b/gi,
                replacement: function (match) { return match.toUpperCase(); },
                reason: App.consts.reasons.acronym
            },
            urli: {
                expr: /\b(ur[li])(s)?\b/gi,
                replacement: function(match,upper,lower) { return upper.toUpperCase() + (lower?lower.toLowerCase():''); },
                reason: App.consts.reasons.acronym
            },
            asp: {
                expr: /([^\b\w.]|^)asp\b/gi,
                replacement: function (match) { return match.toUpperCase(); },
                reason: App.consts.reasons.acronym
            },
            pdf: {
                expr: /([^\b\w.]|^)pdf(s)?/gi,
                replacement: "$1PDF$2",
                reason: App.consts.reasons.acronym
            },
            api: {
                expr: /([^\b\w.]|^)api(s)?\b/gi,
                replacement: "$1API$2",
                reason: App.consts.reasons.acronym
            },
            ssl: {
                expr: /(?:[^\b\w.]|^)ssl\b/g,
                replacement: function (match) { return match.toUpperCase(); },
                reason: App.consts.reasons.acronym
            },
            npm: {
                expr: /\bnpm(s)?\b/g,
                replacement: "NPM$1",
                reason: App.consts.reasons.acronym
            },
            ftp: {
                expr: /(?:[^\b\w.]|^)[st]?ftps?\b/g,
                replacement: function (match) { return match.toUpperCase(); },
                reason: App.consts.reasons.acronym
            },
            ipa: {
                expr: /(?:[^\b\w.]|^)ipa\b/g,
                replacement: function (match) { return match.toUpperCase(); },
                reason: App.consts.reasons.acronym
            },
            avl: {
                expr: /(?:[^\b\w.]|^)avl\b/g,
                replacement: function (match) { return match.toUpperCase(); },
                reason: App.consts.reasons.acronym
            },
            cli_cgi: {
                expr: /(?:[^\b\w.]|^)c[lg]i\b/g,
                replacement: function (match) { return match.toUpperCase(); },
                reason: App.consts.reasons.acronym
            },
            dll: {
                expr: /(?:[^\b\w.]|^)dll\b/g,
                replacement: function (match) { return match.toUpperCase(); },
                reason: App.consts.reasons.acronym
            },
            mp3_mp4: {
                expr: /([^\b\w.]|^)mp(3|4)(s)?\b/gi,
                replacement: "$1MP$2$3",
                reason: App.consts.reasons.acronym
            },
            gui: {
                expr: /([^\b\w.]|^)gui(s)?\b/gi,
                replacement: "$1GUI$2",
                reason: App.consts.reasons.acronym
            },
            stp: {
                expr: /(?:[^\b\w.]|^)stp\b/gi,
                replacement: function (match) { return match.toUpperCase(); },
                reason: App.consts.reasons.acronym
            },
            tcp: {
                expr: /(?:[^\b\w.]|^)tcp\b/gi,
                replacement: function (match) { return match.toUpperCase(); },
                reason: App.consts.reasons.acronym
            },
            wpf: {
                expr: /(?:[^\b\w.]|^)wpf\b/gi,
                replacement: function (match) { return match.toUpperCase(); },
                reason: App.consts.reasons.acronym
            },
            http: {
                expr: /(?:[^\b\w.]|^)https?\b/gi,
                replacement: function (match) { return match.toUpperCase(); },
                reason: App.consts.reasons.acronym
            },
            woff: {
                expr: /(?:[^\b\w.]|^)woff\b/gi,
                replacement: function (match) { return match.toUpperCase(); },
                reason: App.consts.reasons.acronym
            },
            ttf: {
                expr: /(?:[^\b\w.]|^)ttf\b/gi,
                replacement: function (match) { return match.toUpperCase(); },
                reason: App.consts.reasons.acronym
            },
            ipv_n: {
                expr: /\bip(v[46])?\b/gi,
                replacement: "IP$1",
                reason: App.consts.reasons.acronym
            },
            fq_dn_s: {  // FQDN, DN, DNS
                expr: /(?:[^\b\w.]|^)(?:fq)?dns?\b/gi,
                replacement: function (match) { return match.toUpperCase(); },
                reason: App.consts.reasons.acronym
            },
            icmp: {
                expr: /\bicmp\b/gi,
                replacement: function (match) { return match.toUpperCase(); },
                reason: App.consts.reasons.acronym
            },
            rsvp: {
                expr: /\brsvp\b/gi,
                replacement: function (match) { return match.toUpperCase(); },
                reason: App.consts.reasons.acronym
            },
            snmp: {
                expr: /\bsnmp\b/gi,
                replacement: function (match) { return match.toUpperCase(); },
                reason: App.consts.reasons.acronym
            },
            cpu: {
                expr: /\bcpu(s)?\b/gi,
                replacement: "CPU$1",
                reason: App.consts.reasons.acronym
            },
            rss: {
                expr: /(?:[^\b\w.]|^)rss?\b/gi,
                replacement: function (match) { return match.toUpperCase(); },
                reason: App.consts.reasons.acronym
            },
            mvc: {
                expr: /(?:[^\b\w.]|^)mvc\b/gi,
                replacement: function (match) { return match.toUpperCase(); },
                reason: App.consts.reasons.acronym
            },
            mvn: {
                expr: /(?:[^\b\w.]|^)mvn\b/gi,
                replacement: function (match) { return match.toUpperCase(); },
                reason: App.consts.reasons.acronym
            },
            ascii: {
                expr: /([^\b\w.]|^)ascc?ii?\b/gi,
                replacement: "$1ASCII",
                reason: App.consts.reasons.acronym
            },
            gsoap: {
                expr: /([^\b\w.]|^)gsoap\b/gi,
                replacement: "$1gSOAP",
                reason: App.consts.reasons.acronym
            },
            soap: {
                expr: /([^\b\w.]|^)soap\b/gi,
                replacement: function (match) { return match.toUpperCase(); },
                reason: App.consts.reasons.acronym
            },
            csv: {
                expr: /([^\b\w.]|^)csv\b/gi,
                replacement: function (match) { return match.toUpperCase(); },
                reason: App.consts.reasons.acronym
            },
            image_types: {
                expr: /([^\b\w.]|^)(gif|jpe?g|bmp|png)\b/gi,
                replacement: function (match) { return match.toUpperCase(); },
                reason: App.consts.reasons.acronym
            },
            yaml: {
                expr: /([^\b\w.]|^)yaml\b/gi,
                replacement: function (match) { return match.toUpperCase(); },
                reason: App.consts.reasons.acronym
            },
            smtp: {
                expr: /\bsmtp\b/gi,
                replacement: function (match) { return match.toUpperCase(); },
                reason: App.consts.reasons.acronym
            },
            phpmyadmin: {
                expr: /([^\b\w.]|^)phpmyadmin\b/gi,
                replacement: "$1phpMyAdmin",
                reason: App.consts.reasons.acronym
            },
            phpunit: {
                expr: /([^\b\w.]|^)phpunit\b/gi,
                replacement: "$1PHPUnit",
                reason: App.consts.reasons.acronym
            },
            mkl: {
                expr: /([^\b\w.]|^)mkl\b/gi,
                replacement: function (match) { return match.toUpperCase(); },
                reason: App.consts.reasons.acronym
            },
            xsl: {
                expr: /(?:[^\b\w.]|^)xslt?(?!:)\b/gi,
                replacement: function (match) { return match.toUpperCase(); },
                reason: App.consts.reasons.acronym
            },
            jpa: {
                expr: /(?:[^\b\w.]|^)jpa\b/gi,
                replacement: function (match) { return match.toUpperCase(); },
                reason: App.consts.reasons.acronym
            },
            jvm: {
                expr: /(?:[^\b\w.]|^)jvm\b/gi,
                replacement: function (match) { return match.toUpperCase(); },
                reason: App.consts.reasons.acronym
            },
            linq: {
                expr: /(?:[^\b\w.]|^)linq\b/gi,
                replacement: function (match) { return match.toUpperCase(); },
                reason: App.consts.reasons.acronym
            },
            md5: {
                expr: /(?:[^\b\w.]|^)md5\b/gi,
                replacement: function (match) { return match.toUpperCase(); },
                reason: App.consts.reasons.acronym
            },
            xfa: {  // XML Forms Architecture
                expr: /(?:[^\b\w.]|^)xfa\b/gi,
                replacement: function (match) { return match.toUpperCase(); },
                reason: App.consts.reasons.acronym
            },
            /*
            ** Spelling - Correct common spelling errors. (Including apostrophes, which are really grammar.)
            ** Acknowledgement: A subset of terms were adapted from Peter Mortensen's list
            ** (http://pvm-professionalengineering.blogspot.de/2011/04/word-list-for-editing-stack-exchange.html)
            **/
            voting: {
                expr: /\b(down|up)\Wvot/gi,
                replacement: "$1vote",
                reason: App.consts.reasons.spelling
            },
            succeed: {
                expr: /\b(s)uc[cs]?ee?d(ed|s)?\b/gi,
                replacement: "$1ucceed$2",
                reason: App.consts.reasons.spelling
            },
            source: {
                expr: /\b(s)orce(s|d)?\b/gi,
                replacement: "$1ource$2",
                reason: App.consts.reasons.spelling
            },
            standardize: {  // https://regex101.com/r/vN7pM0/1
                expr: /\b(s)tandari([sz](?:e|es|ed|ation))\b/gi,
                replacement: "$1tandardi$2",
                reason: App.consts.reasons.spelling
            },
            different: {  // https://regex101.com/r/xO8jU2/1
                expr: /\b(d)iff?e?re?n(t|ces?)\b/gi,
                replacement: "$1ifferen$2",
                reason: App.consts.reasons.spelling
            },
            personally: { // https://regex101.com/r/oL9aM1/2
                expr: /\b(p)erso(?:nl|nl|nal)(ly)?\b/gi,
                replacement: "$1ersonal$2",
                reason: App.consts.reasons.spelling
            },
            problem: { // https://regex101.com/r/yA8jM7/6
                expr: /\b(p)(?:or?|ro|rο|r0)b(?:le|el|e|re|l|[|]e)me?(s)?\b/gi,
                replacement: "$1roblem$2",
                reason: App.consts.reasons.spelling
            },
            written: {
                expr: /\b(w)riten\b/gi,
                replacement: "$1ritten",
                reason: App.consts.reasons.spelling
            },
            maybe: {
                expr: /\b(m)(?:aby|yabe)\b/gi,
                replacement: "$1aybe",
                reason: App.consts.reasons.spelling
            },
            pseudo: {
                expr: /\b(p)suedo\b/gi,
                replacement: "$1seudo",
                reason: App.consts.reasons.spelling
            },
            application: {
                expr: /\b(a)pp?l[ia]ca(?:ti|it)on\b/gi,
                replacement: "$1pplication",
                reason: App.consts.reasons.spelling
            },
            calendar: {
                expr: /\b(c)al[ea]nd[ae]r\b/gi,
                replacement: "$1alendar",
                reason: App.consts.reasons.spelling
            },
            commit: {  // https://regex101.com/r/kY6sN8/1
                expr: /\b(c)omm?it?(s|ted|ters?|ting)?\b/gi,
                replacement: "$1ommit$2",
                reason: App.consts.reasons.spelling
            },
            autocomplete: { // https://regex101.com/r/rZ9gW5/1
                expr: /\b(a)uto?[ -]?co?m?p?l?ete?(s)?\b/gi,
                replacement: "$1utocomplete$2",
                reason: App.consts.reasons.spelling
            },
            you: {
                expr: /\b(y)o+u?\b/gi,
                replacement: "$1ou",
                reason: App.consts.reasons.spelling
            },
            doesn_t: { // https://regex101.com/r/sL0uO9/3
                expr: /\b(d)(?:ose?[^\w]?n?.?t|oens.?t|oesn[^\w]t|oest)\b/gi,
                replacement: "$1oesn't",
                reason: App.consts.reasons.spelling
            },
            couldn_t_wouldn_t_shouldn_t: {
                expr: /\b(c|w|sh)o?ul?dn[ '`´]?t\b/gi,
                replacement: "$1ouldn't",
                reason: App.consts.reasons.spelling
            },
            didn_t: {
                expr: /\b(d)id[^\w]n?t\b/gi,
                replacement: "$1idn't",
                reason: App.consts.reasons.spelling
            },
            don_t: {
                expr: /\b(d)(?:on[^\w]no?t|ont?)\b/gi,
                replacement: "$1on't",
                reason: App.consts.reasons.spelling
            },
            haven_t: {
                expr: /\b(h)(?:avent|av[^\w]t|ave[^\w]t)\b/gi,
                replacement: "$1aven't",
                reason: App.consts.reasons.spelling
            },
            //apostrophe_d: {   // Too many false positives
            //    expr: /\b(he|she|who|you)[^\w]*(d)\b/gi,
            //    replacement: "$1'$2",
            //    reason: App.consts.reasons.spelling
            //},
            apostrophe_ll: {
                expr: /\b(they|what|who|you)[^\w]*(ll)\b/gi,
                replacement: "$1'$2",
                reason: App.consts.reasons.spelling
            },
            apostrophe_re: {
                expr: /\b(they|what|you)[^\w]*(re)\b/gi,
                replacement: "$1'$2",
                reason: App.consts.reasons.spelling
            },
            apostrophe_s: { // https://regex101.com/r/bN5pA3/1
                expr: /\b(he|she|that|there|what|where|here)[^\w]*(s)\b/gi,
                replacement: "$1'$2",
                reason: App.consts.reasons.spelling
            },
            it_s: {
                expr: /\b(it)[^\w](s)\b/gi,
                replacement: "$1'$2",
                reason: App.consts.reasons.spelling
            },
            apostrophe_t: {
                expr: /\b(aren|can|couldn|didn|doesn|don|hasn|haven|isn|mightn|mustn|shan|shouldn|won|wouldn)[^\w]*(t)(?:[^\w]t)*\b/gi,
                replacement: "$1'$2",
                reason: App.consts.reasons.spelling
            },
            apostrophe_nt: {
                expr: /['`´]nt\b/gi,
                replacement: "n't",
                reason: App.consts.reasons.spelling
            },
            doesn_t_work: {  // >4K instances of this (Oct 2015)
                expr: /\b(d)oesn[^\w]t (work|like|think|want|put|save|load|get|help|make)s\b/gi,
                replacement: "$1oesn't $2",
                reason: App.consts.reasons.spelling
            },
            probably: {  // https://regex101.com/r/zU3qZ0/1
                expr: /\b(p)r(?:oll?|obb?l|o?babl?|ababl)y\b/gi,
                replacement: "$1robably",
                reason: App.consts.reasons.spelling
            },
            keyboard: {
                expr: /\b(k)ey?boa?rd\b/gi,
                replacement: "$1eyboard",
                reason: App.consts.reasons.spelling
            },
            ur: {
                expr: /\bur\b/gi,
                replacement: "your", // May also be "you are", but less common on SO
                reason: App.consts.reasons.spelling
            },
            u: {
                expr: /\bu\b/gi,
                replacement: "you",
                reason: App.consts.reasons.spelling
            },
            gr8: {
                expr: /\bgr8\b/gi,
                replacement: "great",
                reason: App.consts.reasons.spelling
            },
            cuz: {
                expr: /\bcuz\b/gi,
                replacement: "because",
                reason: App.consts.reasons.spelling
            },
            ofc: {
                expr: /\b(o)fc\b/gi,
                replacement: "$1f course",
                reason: App.consts.reasons.spelling
            },
            nvm: {
                expr: /\b(n)vm\b/gi,
                replacement: "$1ever mind",
                reason: App.consts.reasons.spelling
            },
            btw: {
                expr: /\b(b)tw\b/gi,
                replacement: "$1y the way",
                reason: App.consts.reasons.spelling
            },
            sry: {
                expr: /\b(s)o?r+y\b/gi,
                replacement: "$1orry",
                reason: App.consts.reasons.spelling
            },
            allways: {
                expr: /\b(a)llways\b/gi,
                replacement: "$1lways",
                reason: App.consts.reasons.spelling
            },
            expect: {
                expr: /\b(e)spect(s)?\b/gi,
                replacement: "$1xpect$2",
                reason: App.consts.reasons.spelling
            },
            employee: {
                expr: /\b(e)mploye\b/gi,
                replacement: "$1mployee",
                reason: App.consts.reasons.spelling
            },
            retrieve: {
                expr: /\b(r)etreive(d)?\b/gi,
                replacement: "$1etrieve$2",
                reason: App.consts.reasons.spelling
            },
            success: { // https://regex101.com/r/hK2vG4/1
                expr: /\b(s)ucc?ess?(ful|fully)?l?\b/gi,
                replacement: "$1uccess$2",
                reason: App.consts.reasons.spelling
            },
            anyones: {
                expr: /\b(a)nyones\b/gi,
                replacement: "$1nyone's",
                reason: App.consts.reasons.spelling
            },
            length: {
                expr: /\b(l)en(?:gh?t|th)\b/gi,
                replacement: "$1ength",
                reason: App.consts.reasons.spelling
            },
            height: {
                expr: /\b(h)(?:ei|i|ie)(?:gt|th|ghth|gth)\b/gi,
                replacement: "$1eight",
                reason: App.consts.reasons.spelling
            },
            width: {
                expr: /\b(w)it?dh?t\b/gi,
                replacement: "$1idth",
                reason: App.consts.reasons.spelling
            },
            centered: {
                expr: /\b(c)ent(?:red|erd)\b/gi,
                replacement: "$1entered",
                reason: App.consts.reasons.spelling
            },
            center: {
                expr: /\b(c)entre\b/gi,    // "Centre" is a word, however in most cases on SO "center" is meant
                replacement: "$1enter",
                reason: App.consts.reasons.spelling
            },
            aint_isnt: {
                expr: /\bain'?t\b/gi,
                replacement: "isn't",
                reason: App.consts.reasons.spelling
            },
            coordinates: {
                expr: /\b(c)ordinate(s|d)?\b/gi,
                replacement: "$1oordinate$2",
                reason: App.consts.reasons.spelling
            },
            argument: {
                expr: /\b(a)rguement(s)?\b/gi,
                replacement: "$1rgument$2",
                reason: App.consts.reasons.spelling
            },
            iterate: { // https://regex101.com/r/iL6bV3/1
                expr: /\b(i)(?:tter|tar)at(e[ds]?|ing|ion|ions)\b/gi,
                replacement: "$1terat$2",
                reason: App.consts.reasons.spelling
            },
            below: {
                expr: /\b(b)ellow\b/gi,          // "Bellow" is a word, but extremely uncommon on StackOverflow.com.
                replacement: "$1elow",
                reason: App.consts.reasons.spelling
            },
            encrypt: {
                expr: /\b(en|de)cript(s|ing)?\b/gi,
                replacement: "$1crypt$2",
                reason: App.consts.reasons.spelling
            },
            formatting: {
                expr: /\b(f)ormating\b/gi,
                replacement: "$1ormatting",
                reason: App.consts.reasons.spelling
            },
            process: {
                expr: /\b(p)roces(es|ed)?\b/gi,
                replacement: "$1rocess$2",
                reason: App.consts.reasons.spelling
            },
            program: {
                expr: /\b(p)rogr?amm?e?\b/gi,
                replacement: "$1rogram",
                reason: App.consts.reasons.spelling
            },
            programming: {
                expr: /\b(p)rogram(ing|ed|er)\b/gi,
                replacement: "$1rogramm$2",
                reason: App.consts.reasons.spelling
            },
            bear_with_me: {
                expr: /\b(b)are (with me|it|in mind)\b/gi,
                replacement: "$1ear $2",
                reason: App.consts.reasons.spelling
            },
            weird: {
                expr: /\b(w)ierd(ness|ly)\b/gi,
                replacement: "$1eird$2",
                reason: App.consts.reasons.spelling
            },
            believe: {
                expr: /\b(b)eleive(r|s|d)?\b/gi,
                replacement: "$1elieve$2",
                reason: App.consts.reasons.spelling
            },
            piece: {
                expr: /\b(p)eice(s|d)?\b/gi,
                replacement: "$1iece$2",
                reason: App.consts.reasons.spelling
            },
            sample: {
                expr: /\b(s)maple(s|d)?\b/gi,
                replacement: "$1ample$2",
                reason: App.consts.reasons.spelling
            },
            really: {  // https://regex101.com/r/sO4zD9/1
                expr: /\b(r)(?:elly|ealy)\b/gi,
                replacement: "$1eally",
                reason: App.consts.reasons.spelling
            },
            finally_: {
                expr: /\b(f)inall?y\b/gi,
                replacement: "$1inally",
                reason: App.consts.reasons.spelling
            },
            behaviour: { // https://regex101.com/r/rU1eB7/1
                expr: /\b(b)eha?i?vi?o(r|ur|rs|urs)\b/gi,
                replacement: "$1ehavio$2",
                reason: App.consts.reasons.spelling
            },
            unfortunately: {
                expr: /\b(u)nfortu?na?tly\b/gi,
                replacement: "$1nfortunately",
                reason: App.consts.reasons.spelling
            },
            whether: {
                expr: /\b(w)h?eth?er\b/gi,
                replacement: "$1hether",
                reason: App.consts.reasons.spelling
            },
            through: {  // https://regex101.com/r/gQ0dZ1/4
                expr: /\b(t)(?:hru|rough|hroug)\b/gi,
                replacement: "$1hrough",
                reason: App.consts.reasons.spelling
            },
            throughout: {
                expr: /\b(t)(?:hruout|roughout)\b/gi,
                replacement: "$1hroughout",
                reason: App.consts.reasons.spelling
            },
            breakthrough: {
                expr: /\b(b)reak\s+through(s)?\b/gi,
                replacement: "$1reakthrough$2",
                reason: App.consts.reasons.spelling
            },
            though: {
                expr: /\b(t)(?:ho|hou|hogh)\b/gi,
                replacement: "$1hough",
                reason: App.consts.reasons.spelling
            },
            although: {
                expr: /\b(a)l(?:tho|thou|thogh|tough)\b/gi,
                replacement: "$1lthough",
                reason: App.consts.reasons.spelling
            },
            thought: {
                expr: /\b(t)r?ought(s)?\b/gi,
                replacement: "$1hough$2",
                reason: App.consts.reasons.spelling
            },
            throwing: {
                expr: /\b(t)hroughing\b/gi,       // Peter says this is "thoroughly", but a survey of SO questions indicates "throwing"
                replacement: "$1hrowing",
                reason: App.consts.reasons.spelling
            },
            a_lot: {
                expr: /\b(a)lot\b/gi,
                replacement: "$1 lot",
                reason: App.consts.reasons.spelling
            },
            one_r_two_r: {
                expr: /\b(refe|prefe|occu)r(ed|ing)\b/gi,
                replacement: "$1rr$2",
                reason: App.consts.reasons.spelling
            },
            occur: {
                expr: /\b(o)ccure(s)?\b/gi,
                replacement: "$1ccur$2",
                reason: App.consts.reasons.spelling
            },
            preferably: {
                expr: /\b(p)referrably\b/gi,
                replacement: "$1referably",
                reason: App.consts.reasons.spelling
            },
            command_line: {
                expr: /\b(c)(?:omm?andline|mdline?)\b/gi,
                replacement: "$1ommand-line",
                reason: App.consts.reasons.spelling
            },
            benefits: {
                expr: /\b(b)enifits\b/gi,
                replacement: "$1enefits",
                reason: App.consts.reasons.spelling
            },
            authorization: {
                expr: /\b(a)uth\b/gi,           // This may be too ambiguous, could also mean "authentication"
                replacement: "$1uthorization",
                reason: App.consts.reasons.spelling
            },
            persistent: {
                expr: /\b(p)ersistan(t|ce)\b/gi,
                replacement: "$1ersisten$2",
                reason: App.consts.reasons.spelling
            },
            access: {  // must come before _ibility to catch accessibility with spelling variations ** but does not fix acessability?
                expr: /\b(a)c+e+s+(.*)\b/gi,
                replacement: "$1ccess$2",
                reason: App.consts.reasons.spelling
            },
            _ible: {
                expr: /\b(compat|incompat|access)able\b/gi,
                replacement: "$1ible",
                reason: App.consts.reasons.spelling
            },
            _ibility: {
                expr: /\b(compat|incompat|access)abili?t(y|ies)\b/gi,
                replacement: "$1ibilit$2",
                reason: App.consts.reasons.spelling
            },
            separate: {
                expr: /\b(s)epe?rate?(d|ly|s)?\b/gi,
                replacement: "$1eparate$2",
                reason: App.consts.reasons.spelling
            },
            separation: {
                expr: /\b(s)eperation(s)?\b/gi,
                replacement: "$1eparation$2",
                reason: App.consts.reasons.spelling
            },
            definite: {
                expr: /\b(d)efin(?:ate?|ite?|al|te?|et)(ly)?\b/gi,  // Catches correct spelling, too.
                replacement: "$1efinite$2",
                reason: App.consts.reasons.spelling
            },
            definitive: {
                expr: /\b(d)efina?tive(ly)?\b/gi,
                replacement: "$1efinitive$2",
                reason: App.consts.reasons.spelling
            },
            independent: {
                expr: /\b(i)ndependant(ly)?\b/gi,
                replacement: "$1ndependent$2",
                reason: App.consts.reasons.spelling
            },
            recommend: { // https://regex101.com/r/pP9lB7/1
                expr: /\b(r)ecomm?[ao]nd(ation)?\b/gi,
                replacement: "$1ecommend$2",
                reason: App.consts.reasons.spelling
            },
            compatibility: {
                expr: /\b(c)ompatability\b/gi,
                replacement: "$1ompatibility$2",
                reason: App.consts.reasons.spelling
            },
            ps: {
                expr: /\bps\b/g,
                replacement: "PS",
                reason: App.consts.reasons.spelling
            },
            ok: {
                expr: /\bok\b/g,
                replacement: "OK",
                reason: App.consts.reasons.spelling
            },
            back_end: {  // Interesting fact: backend 3x more common than back-end
                expr: /\b(b)ackend\b/g,
                replacement: "$1ack-end",
                reason: App.consts.reasons.spelling
            },
            front_end: {
                expr: /\b(f)rontend\b/g,
                replacement: "$1ront-end",
                reason: App.consts.reasons.spelling
            },
            data_type: {
                expr: /\b(d)atatype\b/g,
                replacement: "$1ata type",
                reason: App.consts.reasons.spelling
            },
            allotted: {
                expr: /\b(a)l+ot+ed\b/g,
                replacement: "$1llotted",
                reason: App.consts.reasons.spelling
            },
            every_time: {
                expr: /\b(e)ve?rytime\b/g,
                replacement: "$1very time",
                reason: App.consts.reasons.spelling
            },
            straight: {
                expr: /\b(s)traig?h?t\b/g,
                replacement: "$1traight",
                reason: App.consts.reasons.spelling
            },
            straightforward: {
                expr: /\b(s)traig?h?t[ -]?for?ward\b/g,
                replacement: "$1traightforward",
                reason: App.consts.reasons.spelling
            },
            preceding: {
                expr: /\b(p)receeding\b/gi,
                replacement: "$1receding",
                reason: App.consts.reasons.spelling
            },
            no_one: {
                expr: /\b(n)o-?one\b/gi,
                replacement: "$1o one",
                reason: App.consts.reasons.spelling
            },
            de_facto: {
                expr: /\b(d)e-?facto\b/gi,
                replacement: "$1e facto",
                reason: App.consts.reasons.spelling
            },
            accommodate: { // https://regex101.com/r/cL3mD9/1
                expr: /\b(a)(?:c+om|com+)odate\b/gi,
                replacement: "$1ccommodate",
                reason: App.consts.reasons.spelling
            },
            kind_of: {
                expr: /\b(k)inda\b/gi,
                replacement: "$1ind of",
                reason: App.consts.reasons.spelling
            },
            want_to: {
                expr: /\b(w)ann?a\b/gi,
                replacement: "$1ant to",
                reason: App.consts.reasons.spelling
            },
            sort_of: {
                expr: /\b(s)orta\b/gi,
                replacement: "$1ort of",
                reason: App.consts.reasons.spelling
            },
            got_to: { // https://regex101.com/r/rK6xR5/1
                expr: /\b(have\s+)?(g)otta\b/gi,
                replacement: "$1$2ot to",
                reason: App.consts.reasons.spelling
            },
            dont_know: { // https://regex101.com/r/rK6xR5/1
                expr: /\b(d)[uo]nn?o\b/gi,
                replacement: "$1on't know",
                reason: App.consts.reasons.spelling
            },
            going_to: {
                expr: /\b(g)[ou]nn?a\b/gi,
                replacement: "$1oing to",
                reason: App.consts.reasons.spelling
            },
            crashes: {
                expr: /\b(c)rashs\b/gi,
                replacement: "$1rashes",
                reason: App.consts.reasons.spelling
            },
            pattern: {
                expr: /\b(p)at?(?:trn|tren|tern)(s)?\b/gi,
                replacement: "$1attern$2",
                reason: App.consts.reasons.spelling
            },
            function_: { // https://regex101.com/r/xF3jU3/1
                expr: /\b(f)u[ncti]+onn?(s|ing|ed|al)?\b/gi,
                replacement: "$1unction$2",
                reason: App.consts.reasons.spelling
            },
            syntax: {
                expr: /\b(s)[yi]nt[ae]?x\b/gi,
                replacement: "$1yntax",
                reason: App.consts.reasons.spelling
            },
            correct: {
                expr: /\b(c)orr?ec[ty]/gi,  // No \b at end, to include correction, correcting, corrected
                replacement: "$1orrect",
                reason: App.consts.reasons.spelling
            },
            correctly: {
                expr: /\b(c)orr?ec(?:lt?|t?l)y\b/ig,
                replacement: "$1orrectly",
                reason: App.consts.reasons.spelling
            },
            integer: {
                expr: /\b(i)nte?r?ger(s)?\b/gi,
                replacement: "$1nteger$2",
                reason: App.consts.reasons.spelling
            },
            several: {
                expr: /\b(s)er?v[ea]?r[ae]?l\b/gi,
                replacement: "$1everal",
                reason: App.consts.reasons.spelling
            },
            solution: {
                expr: /\b(s)ou?lu?ti?on\b/gi,
                replacement: "$1olution",
                reason: App.consts.reasons.spelling
            },
            somebody: {
                expr: /\b(s)ombody\b/gi,
                replacement: "$1omebody",
                reason: App.consts.reasons.spelling
            },
            everything: {
                expr: /\b(e)ve?r[yi]?thing\b/gi,
                replacement: "$1verything",
                reason: App.consts.reasons.spelling
            },
            button: {
                expr: /\b(b)[uo]+tt?[ou]n\b/gi,
                replacement: "$1utton",
                reason: App.consts.reasons.spelling
            },
            before: {
                expr: /\b(b)e?fo?re?\b/gi,
                replacement: "$1efore",
                reason: App.consts.reasons.spelling
            },
            example: { // https://regex101.com/r/uU4bH5/1
                expr: /\b(e)(?:xsample|xamle|x?amp[le]{1-2}|xemple)\b/gi,
                replacement: "$1xample",
                reason: App.consts.reasons.spelling
            },
            somewhere: {
                expr: /\b(s)ome ?wh?[ea]re?\b/gi,
                replacement: "$1omewhere",
                reason: App.consts.reasons.spelling
            },
            with: { // https://regex101.com/r/xO5dP3/2
                expr: /\b(w)(?:hith|iht)(?=(ou?t|in)?\b)/gi,
                replacement: "$1ith",
                reason: App.consts.reasons.spelling
            },
            without: {  // After 'with' rule, only need to check 'out'
                expr: /\b(w)ithou?t\b/gi,
                replacement: "$1ithout",
                reason: App.consts.reasons.spelling
            },
            reproducible: {
                expr: /\b(r)eproduct?[ia]ble\b/gi,
                replacement: "$1eproducible",
                reason: App.consts.reasons.spelling
            },
            unnecessary: {
                expr: /\b(u)nn?ecc?ess?ary\b/gi,
                replacement: "$1nnecessary",
                reason: App.consts.reasons.spelling
            },
            require: {  // https://regex101.com/r/nS6kM5/1
                expr: /\b(r)equie?re?(d|s|me?nts?)?\b/gi,
                replacement: "$1equire$2",
                reason: App.consts.reasons.spelling
            },
            address: {
                expr: /\b(a)dd?ress?(es|ed|ing)?e?\b/gi,
                replacement: "$1ddress$2",
                reason: App.consts.reasons.spelling
            },
            password: {
                expr: /\b(p)ass?wo?rd?(s)?\b/gi,
                replacement: "$1assword$2",
                reason: App.consts.reasons.spelling
            },
            method: {
                expr: /\b(m)e[th]+[oeu]+d(s)?\b/gi,
                replacement: "$1ethod$2",
                reason: App.consts.reasons.spelling
            },
            property: {
                expr: /\b(p)rope?rt[iey]?\b/gi,
                replacement: "$1roperty",
                reason: App.consts.reasons.spelling
            },
            properties: {
                expr: /\b(p)rope?rt[iey]+s\b/gi,
                replacement: "$1roperties",
                reason: App.consts.reasons.spelling
            },
            wireless: {
                expr: /\b(w)ire?le?ss?\b/gi,
                replacement: "$1ireless",
                reason: App.consts.reasons.spelling
            },
            possible: {
                expr: /\b(p)oss?[ai]?ble\b/gi,
                replacement: "$1ossible",
                reason: App.consts.reasons.spelling
            },
            fields_yields: {  // https://regex101.com/r/cJ8rM4/1
                expr: /\b(f|y)(?:ei?|ie?)l?d(s|ing|ed)?\b/gi,
                replacement: "$1ield$2",
                reason: App.consts.reasons.spelling
            },
            execute: {
                expr: /\b(e)x[ei]?cute(s|d)\b/gi,
                replacement: "$1xecute$2",
                reason: App.consts.reasons.spelling
            },
            algorithm: {
                expr: /\b(a)lgo?r[iy]?th?[iya]?m(s)?\b/gi,
                replacement: "$1lgorithm$2",
                reason: App.consts.reasons.spelling
            },
            version: { // https://regex101.com/r/wE8uD0/1
                expr: /\b(v)er(?:s[io]*|io)n(s|ing|ed)?\b/gi,
                replacement: "$1ersion$2",
                reason: App.consts.reasons.spelling
            },
            which: {  // 22,772 of these as of 12-Nov-2015!
                expr: /\b(w)(?:ich|hic)\b/gi,
                replacement: "$1hich",
                reason: App.consts.reasons.spelling
            },
            disappear: {
                expr: /\b(d)isapea?r(ing|ed|s)?\b/gi,
                replacement: "$1isappear$2",
                reason: App.consts.reasons.spelling
            },
            because: {
                expr: /\b(b)ec[ao]u?se?\b/gi,
                replacement: "$1ecause",
                reason: App.consts.reasons.spelling
            },
            should: {
                expr: /\b(s)(?:hold|houd|huld|hud|ould)\b/gi,
                replacement: "$1hould",
                reason: App.consts.reasons.spelling
            },
            totally: {
                expr: /\b(t)ota?ll?y\b/gi,
                replacement: "$1otally",
                reason: App.consts.reasons.spelling
            },
            lambda: {
                expr: /\b(l)am[bd]+a\b/gi,
                replacement: "$1ambda",
                reason: App.consts.reasons.spelling
            },
            command: {
                expr: /\b(c)om(?:m?ad|and|mnd)(ed|s|ing|ers?|o)?\b/gi,
                replacement: "$1ommand$2",
                reason: App.consts.reasons.spelling
            },
            therefore: {
                expr: /\b(t)here?fore?\b/gi,
                replacement: "$1herefore",
                reason: App.consts.reasons.spelling
            },
            parameter: {
                expr: /\b(p)ara?m[ea]n?ter(s)?\b/gi,
                replacement: "$1arameter$2",
                reason: App.consts.reasons.spelling
            },
            just: {
                expr: /\b(j)(?:uste|us)\b/gi,
                replacement: "$1ust",
                reason: App.consts.reasons.spelling
            },
            fulfill: {
                expr: /\b(f)ull?\s?fill\b/gi,
                replacement: "$1ulfill",
                reason: App.consts.reasons.spelling
            },
            coming: {
                expr: /\b(c)omming\b/gi,
                replacement: "$1oming",
                reason: App.consts.reasons.spelling
            },
            tried: {  // 8,540 of these!
                expr: /\b(t)rye(d|s)\b/gi,
                replacement: "$1rie$2",
                reason: App.consts.reasons.spelling
            },
            basically: {  // 7,924 of these!
                expr: /\b(b)asica?l+y\b/gi,
                replacement: "$1asically",
                reason: App.consts.reasons.spelling
            },
            completely: {  // 4,793 examples!   https://regex101.com/r/oG7nH6/2
                expr: /\b(c)ompl?ete?l?e?y\b/gi,
                replacement: "$1ompletely",
                reason: App.consts.reasons.spelling
            },
            misread: {
                expr: /\b(m)is+[ -]?rea?d\b/gi,
                replacement: "$1isread",
                reason: App.consts.reasons.spelling
            },
            database: {
                expr: /\b(d)atabaes?\b/gi,
                replacement: "$1atabase",
                reason: App.consts.reasons.spelling
            },
            output: {  //6,594 "out put"
                expr: /\b(o)ut put\b/gi,
                replacement: "$1utput",
                reason: App.consts.reasons.spelling
            },
            useful: {  // 11,542  "usefull"
                expr: /\b(u)se(?:full| ful)\b/gi,
                replacement: "$1seful",
                reason: App.consts.reasons.spelling
            },
            classes: {
                expr: /\b(c)la(se|ss)s\b/gi,
                replacement: "$1lasses",
                reason: App.consts.reasons.spelling
            },
            english: {
                expr: /\benglisc?h?\b/gi,
                replacement: "English",
                reason: App.consts.reasons.spelling
            },
            inheritance: {  // 1700 x inheritence
                expr: /\b(i)nherit[ae]n[cs]e?\b/gi,
                replacement: "$1nheritance",
                reason: App.consts.reasons.spelling
            },
            advice: {  // 9000 x advices
                expr: /\b(a)dvices\b/gi,
                replacement: "$1dvice",
                reason: App.consts.reasons.spelling
            },
            when: {
                expr: /\b(w)h[ea]ne?\b/gi,
                replacement: "$1hen",
                reason: App.consts.reasons.spelling
            },
            and_then: {   // 16K instances of this!
                expr: /\b(a)nd,? tha?n\b/gi,
                replacement: "$1nd then",
                reason: App.consts.reasons.spelling
            },
            un_initialize: { // >4K instances https://regex101.com/r/lY2hY1/1
                expr: /\b((?:un-?|re-?)?i)n?i?t[ia]+li?[zs](e|ed|[eo]r|es|ing)\b/gi,
                replacement: function(match, prefix, suffix) {
                    return (prefix+'nitializ'+suffix).replace("-","");
                },
                reason: App.consts.reasons.spelling
            },
            character: { // 3500+ instances, https://regex101.com/r/lG1qH0/1
                expr: /\b(c)(?:har|h?arac?h?ter)(s|istics?|i[zs]e)?\b/gi,
                replacement: "$1haracter$2",
                reason: App.consts.reasons.spelling
            },
            found: {
                expr: /\b(f)inded\b/gi,
                replacement: "$1ound",
                reason: App.consts.reasons.spelling
            },
            tuple: {  // https://regex101.com/r/zP7zM2/1
                expr: /\b(t)o?up+e?le?(s)?\b/gi,
                replacement: "$1uple$2",
                reason: App.consts.reasons.spelling
            },
            /*
            ** Grammar - Correct common grammatical errors.
            **/
            start_with_so: {
                expr: /^so[,-\s]+/gi,
                replacement: "",
                reason: App.consts.reasons.grammar
            },
            a_vs_an: {  // See http://stackoverflow.com/q/34440307/1677912
                expr: /\b(a|an) ([\(\"'“‘-]*\w*)\b/gim,   // https://regex101.com/r/nE1yA4/4
                replacement: function( match, article, following ) {
                    var input = following.replace(/^[\s\(\"'“‘-]+|\s+$/g, "");//strip initial punctuation symbols
                    var res = AvsAnOverride_(input) || AvsAnSimple.query(input);
                    var newArticle = res;
                    return newArticle+' '+following;
                    
                    // Hack alert: Due to the technical nature of SO subjects, many common terms
                    // are not well-represented in the data used by AvsAnSimple, so we need to
                    // provide a way to override it.
                    function AvsAnOverride_(fword) {
                        var exeptionsA_ = /^(?:uis?)/i;
                        var exeptionsAn_ = /(?:^[lr]value)/i;
                        return (exeptionsA_.test(fword) ? "a" :
                                exeptionsAn_.test(fword) ? "an" : false);
                    }
                },
                reason: App.consts.reasons.grammar
            },
            firstcaps: {
                //    https://regex101.com/r/qR5fO9/19
                // This doesn't work quite right, because is finds all sentences, not just ones needing caps.
                //expr: /(?:(?!\n\n)[^\s.!?]+[ ]*)+([.!?])*[ ]*/g, 
                expr: /((?!\n\n)[A-z](?:(?!\n\n)[^?.!])+(?:\.[A-z\d)][^?.!A-Z]+)*([?.!])*)/gm, 
                replacement: function(str, endpunc) { 
                    if (str === "undefined") return str;  // MUST match str, or gets counted as a change.
                    //                 https://regex101.com/r/bL9xD7/3 find and capitalize first letter
                    return str.replace(/^(\W*)*(([a-zA-Z])[\w\d]*(?:[._\-]+[\w\d]+)?)(.*)/g, function(sentence, pre, fWord, fLetter, post) {
                        if (!pre) pre = '';
                        if (!post) post = '';
                        if (!fWord) fWord = '';
                        var fWordChars = fWord.split('');
                        // Leave some words alone: filenames, camelCase
                        for (var i=0; i<fWordChars.length; i++) {
                            if (fWordChars[i] == '.' ||
                                fWordChars[i] == fWordChars[i].toUpperCase())
                                return sentence;
                        }
                        var update = pre + fLetter.toUpperCase() + fWord.slice(1) + post; // + (!endpunc && /\w/.test(post.substr(-1)) ? '.' : '');
                        return update;
                    });
                },
                reason: App.consts.reasons.grammar
            },
            i: { // https://regex101.com/r/uO7qG0/2
                expr: /\bi\b(?!\.e\.)/g,  // i but not i.e.
                replacement: "I",
                reason: App.consts.reasons.grammar
            },
            i_apostrophe: {
                expr: /\bi['`´]/gi,  // i-apostrophe only
                replacement: "I'",
                reason: App.consts.reasons.grammar
            },
            i_ll: {  // Must NOT convert ill to I'll
                expr: /\bi ll\b/gi,
                replacement: "I'll",
                reason: App.consts.reasons.grammar
            },
            im: {
                expr: /\b(?:i *m(?: am)?|i'am|iam)\b/gi,
                replacement: "I'm",
                reason: App.consts.reasons.grammar
            },
            ive: {
                expr: /\bi['`´]*v['`´]*e\b/gi,
                replacement: "I've",
                reason: App.consts.reasons.grammar
            },
            ie: {  // http://english.stackexchange.com/questions/30106/can-i-start-a-sentence-with-i-e
                expr: /\b(i|I)e[.\s]+/g,   // Careful here; IE is Internet Explorer
                replacement: "$1.e. ",
                reason: App.consts.reasons.grammar
            },
            eg: { // https://regex101.com/r/qH2oT0/7
                expr: /\b(e)\.?g[.,; :]+/gi,
                replacement: "$1.g. ",
                reason: App.consts.reasons.grammar
            },
            etc: {  // https://regex101.com/r/dE7cV1/4
                expr: /\betc(?:\.+)?/g,
                replacement: "etc.",
                reason: App.consts.reasons.grammar
            },
            multiplesymbols: {  //    https://regex101.com/r/bE9zM6/2
                expr: /([^\w\s*#.\-_+:])\1{1,}/g,
                replacement: "$1",
                reason: App.consts.reasons.grammar
            },
            i_want: { //https://regex101.com/r/iD2tU0/1
                expr: /\bI['a ]*m wanting\b/gi,
                replacement: "I want",
                reason: App.consts.reasons.grammar
            },
            oxford_comma: { // https://regex101.com/r/xN0mF6/6
                expr: /((?:[\w'-]+,\s+)+(?:[\w'-]+\s){0,2}[\w'-]+)(\s+(and|or)\s+[\w'-]+)/g,
                replacement: "$1,$2",
                reason: App.consts.reasons.grammar
            },
            i_have_find: {
                expr: /\b(I|you) have find\b(?![(]|\.\w)/gi,
                replacement: "$1 have found",
                reason: App.consts.reasons.grammar
            },
            /*
            ** Noise reduction - Remove fluff that adds nothing of technical value to posts.
            **/
            help: {
                expr: /\b(h)(?:[ea]l?p)(?![-])\b/gi,
                replacement: "$1elp",
                reason: App.consts.reasons.silent
            },
            thanks: {
                expr: /\b(t)(?:anks|hx|anx)\b/gi,
                replacement: "$1hanks",
                reason: App.consts.reasons.silent
            },
            tia: {  // common acronym; should only remove "thanks in advance" at end of post
                expr: /\btia$/gi,
                replacement: "",
                reason: App.consts.reasons.noise
            },
            please: {
                expr: /\b(p)(?:lz|lse?|l?ease?)\b/gi,
                replacement: "$1lease",
                reason: App.consts.reasons.silent
            },
            editupdate: {
                // https://regex101.com/r/tT2pK6/9
                expr: /([-_*]+[\t ]*\b(edit|update)\b([\t ]*#?[0-9]+)?[\t ]*:*[\t ]*[-_*]+:*|[\t ]*\b(edit|update)\b([\t ]*#?[0-9]+)?\s*:+[\t ]*)/gi,
                replacement: "",
                reason: App.consts.reasons.noise
            },
            // http://meta.stackexchange.com/questions/2950/should-hi-thanks-taglines-and-salutations-be-removed-from-posts/93989#93989
            salutation: { // https://regex101.com/r/yS9lN8/5
                expr: /^\s*(?:dear\b.*$|(?:hi(?:ya)*|hel+o+|heya?|hai|g'?day|good\s?(?:evening|morning|day|afternoon))[,\s]*(?:\s+(?:all|guys|folks|friends?|there|everyone|people|mates?|bud+(y|ies))*))(?:[,.!?: ]*|$)/gmi,
                replacement: "",
                reason: App.consts.reasons.noise
            },
            badphrases: { // https://regex101.com/r/gE2hH6/13
                expr: /[^\n.!?:]*(?:thanks|thank[ -]you|please|help|suggest(?:ions))\b(?:[ .?!]*$|[^\n.!?:]*\b(?:help|ap+reciat\w*|me|advan\w*|a ?lot)\b[^\n.!?:]*)[.!?_*]*[ ]*/gim,
                replacement: "",
                reason: App.consts.reasons.noise
            },
            imnew: {
                expr: /(?! )[\w\s]*\bi[' ]?a?m +(?:kinda|really) *new\w* +(?:to|in) *\w* *(?:and|[;,.!?])? */gi,
                replacement: "",
                reason: App.consts.reasons.noise
            },
            complimentaryClose: {  // https://regex101.com/r/hL3kT5/2
                expr: /^\s*(?:(?:kind(?:est)* )*regards?|cheers?|greetings?|thanks)\b,?[\t\f ]*[\r\n]*.*(?:[.!?: ]*|$)/gim,
                replacement: "",
                reason: App.consts.reasons.noise
            },
            sorry4english: { // https://regex101.com/r/pG3oD6/7
                expr: /[^\n.!?]*((sorry|ap+olog.*)\b[^.!?:\n\r]+\b((bad|my|poor) english)|(english[^.!?:\n\r]+)\b(tongue|language))\b[^.!?:\n\r]*(?:[.!?:_*])*/gi,
                replacement: "",
                reason: App.consts.reasons.noise
            },
            hope_this_helps: {  // https://regex101.com/r/yF1uY0/1
                expr: /^\s*i? ?\bhope\b[^\n.!?:]*helps?[^\n.!?:]*[,.!?: ()^-]*$/gmi,
                replacement: "",
                reason: App.consts.reasons.noise
            },
            enter_code_here: {
                expr: /\benter (?:code|image description|link description) here\b/gi,
                replacement: "",
                reason: App.consts.reasons.noise
            },
            /*
            ** Layout  - Minimize whitespace (which is compressed by markup).
            **           Must follow noise reduction.
            **           Leading and trailing spaces are part of Markdown formatting; leave them.
            **/
            space_then_symbol: {  // https://regex101.com/r/fN6lL7/4
                expr: /(?!^|[ \t]+)([(])/gm,
                replacement: " $1",
                debug: false,
                reason: App.consts.reasons.layout
            },
            symbol_then_space: {  // https://regex101.com/r/iD9aS1/4
                expr: /(?:\b| +)([,?!:)]+)(?: |\b|$)(?![\d])/gm,
                replacement: "$1 ",
                debug: false,
                reason: App.consts.reasons.layout
            },
            space_symbol_space: {
                expr: /(?:\b| +)([&])(?: |\b)(?![\d])/g,
                replacement: " $1 ",
                debug: false,
                reason: App.consts.reasons.layout
            },
            multiplespaces: { // https://regex101.com/r/hY9hQ3/3
                expr: /(?!^)[ ]{2,}(?! ?$)/gm,
                replacement: " ",
                debug: false,
                reason: App.consts.reasons.layout
            },
            blanklines: {  // https://regex101.com/r/eA5hA2/1
                expr: /(?:^(?:\s*[\n\r])*|(?:\s*[\r\n])(?=(?:\s*[\r\n]|$){2}))/g,
                replacement: "",
                reason: App.consts.reasons.layout
            },
            trailing_space: {  // https://regex101.com/r/iQ0yR8/1
                expr: /([^ ])[ ]{1}$/gm,
                replacement: "$1",
                debug: false,
                reason: App.consts.reasons.silent
            },
            // The title says it all
            thetitlesaysitall: {
                // https://regex101.com/r/bX1qB4/3
                expr: /(?:the )?title says (?:it all|everything)[.?!]*/gi,
                replacement: function(){
                    return App.selections.title.val().replace(/[.?!]*$/,"? \n\n");
                },
                reason: App.consts.reasons.titleSaysAll
            }
        };

        // This is where the magic happens: this function takes a few pieces of information and applies edits to the post
        App.funcs.fixIt = function(input, edit) {
            var expression = edit.expr;
            var replacement = edit.replacement;
            var reasoning = edit.reason;
            var debug = edit.debug;
            
            if (debug) {
                console.log(input);
                console.log(expression.toString());
                console.log("replacement: '"+replacement+"'");
            }
            // If there is nothing to search, exit
            if (!input) return false;
            // Scan the post text using the expression to see if there are any matches
            var matches = input.match(expression);
            if (debug) console.log(matches, expression.exec(input));
            if (!matches) return false;
            var count = 0;  // # replacements to do
            input = input.replace(expression, function(before){ 
                var after = before.replace(expression, replacement);
                if(after !== before) ++count; 
                if (debug) console.log(before, after, after !== before, count);
                return after;
            });
            if (!count) {
                // Seems like no replacements, check.
                // In some cases, the expression matches on the initial input, but
                // fails to on the individual matches. In that case, we can't count
                // the total changes accurately, but we can still complete the
                // replacement on the initial input.
                var after = input.replace(expression, replacement);
                if(after !== input) {
                    ++count; 
                    input = after;
                }
            }
            return count > 0 ? {
                reason: reasoning,
                fixed: String(input),
                count: count
            } : false;
        };

        // Populate or refresh DOM selections
        App.funcs.popSelections = function() {
            App.selections.redoButton     = App.globals.root.find('[id^="wmd-redo-button"]');
            App.selections.body           = App.globals.root.find('[id^="wmd-input"]');
            App.selections.title          = App.globals.root.find('[class*="title-field"]');
            App.selections.summary        = App.globals.root.find('[id^="edit-comment"], .edit-comment');
            App.selections.tagField       = App.globals.root.find(".tag-editor");
            App.selections.submitButton   = App.globals.root.find('[id^="submit-button"]');
            App.selections.helpButton     = App.globals.root.find('[id^="wmd-help-button"]');
            App.selections.editor         = App.globals.root.find('.post-editor');
            App.selections.preview        = App.globals.root.find('.wmd-preview');
            App.selections.previewMenu    = App.globals.root.find('.preview-options').append('&nbsp;&nbsp;');
            if(!App.selections.previewMenu.length) {
                App.selections.previewMenu   = $('<div class="preview-options post-menu" style="margin-top:5px;margin-bottom:8px;"/>').insertBefore(App.selections.preview);
                var previewToggleText = App.selections.preview.is(':visible') ? 'hide preview' : 'show preview';
                App.selections.previewToggle = $('<a href="javascript:void(0)" class="hide-preview" style="margin-left:-2px;">' + previewToggleText + '</a>').click(App.funcs.togglePreview).appendTo(App.selections.previewMenu);
                App.selections.previewMenu.append('&nbsp;&nbsp;');
            } else {
                App.selections.previewToggle  = App.globals.root.find('.hide-preview').off('click').attr('href','javascript:void(0)').click(App.funcs.togglePreview);
            }
            App.selections.diffToggle     = $('<a href="javascript:void(0)" class="hide-preview" style="margin-left:-2px;">show diff</a>').click(App.funcs.toggleDiff).appendTo(App.selections.previewMenu);
            App.selections.diff           = $('<div class="wmd-preview"/>').hide().appendTo(App.selections.editor);
        };

        App.funcs.showPreview = function() {
            App.selections.diff.hide();
            App.selections.diffToggle.text('show diff');
            App.selections.preview.show();
            App.selections.previewToggle.text('hide preview');
        }
        
        App.funcs.showDiff = function() {
            App.selections.preview.hide();
            App.selections.previewToggle.text('show preview');
            App.selections.diff.show();
            App.selections.diffToggle.text('hide diff');
        }
        
        App.funcs.togglePreview = function() {
            App.selections.diff.hide();
            App.selections.diffToggle.text('show diff');
            if(/hide/.test(App.selections.previewToggle.text())) return App.selections.previewToggle.text('show preview'), App.selections.preview.toggle(), true;
            if(/show/.test(App.selections.previewToggle.text())) return App.selections.previewToggle.text('hide preview'), App.selections.preview.toggle(), true;
        }
        
        App.funcs.toggleDiff = function() {
            App.selections.preview.hide();
            App.selections.previewToggle.text('show preview');
            if(/hide/.test(App.selections.diffToggle.text())) return App.selections.diffToggle.text('show diff'), App.selections.diff.toggle(), true;
            if(/show/.test(App.selections.diffToggle.text())) return App.selections.diffToggle.text('hide diff'), App.selections.diff.toggle(), true;
        }
        
        // Populate edit item sets from DOM selections
        App.funcs.popItems = function() {
            var i = App.items, s = App.selections;
            ['title', 'body', 'summary'].forEach(function(v) {
                i[v] = s[v].length ? s[v].val() : '';
            });
        };

        // Populate original item sets from edit items for the diff
        App.funcs.popOriginals = function() {
            var i = App.originals, s = App.items;
            ['title', 'body', 'summary'].forEach(function(v) {
                i[v] = s[v];
            });
        }
        
        // Insert editing button
        App.funcs.createButton = function() {
            if (!App.selections.redoButton.length) return false;

            App.selections.buttonWrapper = $('<li class="wmd-magic-edit"/>');
            App.selections.buttonFix = $('<img src="//i.stack.imgur.com/Om5pL.png" class="wmd-button ToolkitFix" title="Fix the content!" />');
            App.selections.buttonInfo = $('<div class="ToolkitInfo">');

            // Build the button
            App.selections.buttonWrapper.append(App.selections.buttonFix);
            App.selections.buttonWrapper.append(App.selections.buttonInfo);

            // Insert button
            App.selections.redoButton.after(App.selections.buttonWrapper);

            // Attach the event listener to the button
            App.selections.buttonFix.click(App.funcs.fixEvent);
            
            App.selections.buttonWrapper.css({
                'position': 'relative',
                'left': '410px',
                'display': 'inline-block',
                'overflow': 'visible',
                'height': '55%',
                'white-space': 'nowrap'
            });
            App.selections.buttonFix.css({
                'position': 'static',
                'display': 'inline-block',
                'width': 'auto',
                'height': '100%'
            });
            App.selections.buttonInfo.css({
                'position': 'static',
                'display': 'inline-block',
                'vertical-align': 'bottom',
                'margin-left': '5px',
                'font-size': '12px',
                'color': '#424242',
                'background': '#eee',
                'border-radius': '3px',
                'padding': '3px 6px'
            }).hide();
        };

        App.funcs.fixEvent = function() {
            return App.funcs.popItems(), App.pipe(App.items, App.pipeMods, App.globals.order), false;
        };

        App.funcs.diff = function(a1, a2) {
            var strings = [];
            function maakRij(type, rij) {
                if (!type) return strings.push(rij.replace(/\</g, '&lt;')), true;
                if (type === '+') return strings.push('<span class="add">' + rij.replace(/\</g, '&lt;').replace(/(?=\n)/g,'↵') + '</span>'), true;
                if (type === '-') return strings.push('<span class="del">' + rij.replace(/\</g, '&lt;').replace(/(?=\n)/g,'↵') + '</span>'), true;
            }

            function getDiff(matrix, a1, a2, x, y) {
                if (x > 0 && y > 0 && a1[y - 1] === a2[x - 1]) {
                    getDiff(matrix, a1, a2, x - 1, y - 1);
                    maakRij(false, a1[y - 1]);
                } else {
                    if (x > 0 && (y === 0 || matrix[y][x - 1] >= matrix[y - 1][x])) {
                        getDiff(matrix, a1, a2, x - 1, y);
                        maakRij('+', a2[x - 1]);
                    } else if (y > 0 && (x === 0 || matrix[y][x - 1] < matrix[y - 1][x])) {
                        getDiff(matrix, a1, a2, x, y - 1);
                        maakRij('-', a1[y - 1]);
                    } else {
                        return;
                    }
                }
            }
            
            a1 = a1.split(/(?=\b|\W|_)/g);
            a2 = a2.split(/(?=\b|\W|_)/g);

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
                return strings.join('');
            } catch (e) {
                console.log(e);
            }
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
        };

        App.pipeMods.omit = function(data) {
            if (!data.body) return false;
            for (var type in App.globals.checks) {
                data.body = data.body.replace(App.globals.checks[type], function(match) {
                    App.globals.replacedStrings[type].push(match);
                    return App.globals.placeHolders[type];
                });
            }
            return data;
        };

        App.pipeMods.codefix = function() {
            var replaced = App.globals.replacedStrings.block, str;
            for (var i in replaced) {
                // https://regex101.com/r/tX9pM3/1              https://regex101.com/r/tX9pM3/2                 https://regex101.com/r/tX9pM3/3
                if (/^`[^]+`$/.test(replaced[i])) replaced[i] = '\n\n' + /(?!`)((?!`)[^])+/.exec(replaced[i])[0].replace(/(.+)/g, '    $1');
            }
        };

        App.pipeMods.edit = function(data) {
            App.funcs.popOriginals();

            // Visually confirm edit - SE makes it easy because the jQuery color animation plugin seems to be there by default
            App.selections.body.animate({ backgroundColor: '#c8ffa7' }, 10);
            App.selections.body.animate({ backgroundColor: '#fff' }, 1000);

            // List of fields to be edited
            var fields = {body:'body',title:'title'};
            
            // Loop through all editing rules
            for (var j in App.edits) for (var field in fields) {
                if (App.consts.reasons.tidyTitle == App.edits[j].reason && 'title' !== field)
                    continue;  // Skip title-only edits if not editing title.
                var fix = App.funcs.fixIt(data[field], App.edits[j]);
                if (!fix) continue;
                if (fix.reason in App.globals.reasons) App.globals.reasons[fix.reason].count += fix.count;
                else App.globals.reasons[fix.reason] = { reason:fix.reason, editId:j, count:fix.count };
                data[field] = fix.fixed;
                App.edits[j].fixed = true;
            }
            
            // Remove silent change reason
            delete App.globals.reasons[App.consts.reasons.silent];
            
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
                             + (App.globals.showCounts ? ((App.globals.reasons[z].count > 1) ? ' ('+App.globals.reasons[z].count+')' : '') : '') );
                App.globals.changes += App.globals.reasons[z].count;
            }

            var reasonStr = reasons.length ? reasons.join('; ')+'.' : '';  // Unique reasons separated by ; and terminated by .

            if (!data.hasOwnProperty('summaryOrig')) data.summaryOrig = data.summary.trim() // Remember original summary
                                                                            .replace(/([^;])[.?!:]?$/,"$1;");
            if (data.summaryOrig.length)
                data.summaryOrig = data.summaryOrig + ' ';
            else
                reasonStr = reasonStr.charAt(0).toUpperCase() + reasonStr.slice(1);  // Cap first letter.

            data.summary = data.summaryOrig + reasonStr;
            // Limit summary to 300 chars
            if (data.summary.length > 300) data.summary = data.summary.substr(0,300-3) + '...';

            return data;
        };   
        
        // Populate the diff
        App.pipeMods.diff = function() {
            App.selections.diff.empty().append('<div class="difftitle">' + App.funcs.diff(App.originals.title, App.items.title, true) + '</div>' +
                                               '<div class="diffbody">' + App.pipeMods.replace({body:App.funcs.diff(App.originals.body, App.items.body)}, true).body + '</div>');
            App.funcs.showDiff();
        }

        // Replace the previously omitted code
        App.pipeMods.replace = function(data, literal) {
            if (!data.body) return false;
            for (var type in App.globals.checksr) {
                var i = 0;
                data.body = data.body.replace(App.globals.placeHolderChecks[type], function(match) {
                    var replace = App.globals.replacedStrings[type][i++];
                    if(literal && /block|lsec/.test(type)) { 
                        var after = replace.replace(/^\n\n/,'');
                        var prepend = after !== replace ? '<span class="add">\n\n</span><span class="del">`</span>' : '';
                        var append  = after !== replace ? '<span class="del">`</span>' : '';
                        var klass   = /lsec/.test(type) ? ' class="lang-none prettyprint prettyprinted"' : '';
                        return prepend + '<pre' + klass + '><code>' + after.replace(/</g,'&lt;').replace(/^    /gm,'') + '</code></pre>' + append;
                    }
                    if(literal && /quote/.test(type)) return '<blockquote>' + replace.replace(/</g,'&lt;').replace(/^>/gm,'') + '</blockquote>';
                    if(literal) return '<code>' + replace.replace(/</g,'&lt;').replace(/(?:^`|`$)/g,'') + '</code>';
                    return replace;
                });
            }
            return data;
        };
        
        // Handle pipe output
        App.pipeMods.output = function(data) {
            App.selections.title.val(data.title);
            App.selections.body.val(data.body.replace(/\n{3,}/,'\n\n'));
            App.selections.summary.val(data.summary);
            App.globals.root.find('.actual-edit-overlay').remove();
            App.selections.summary.css({opacity:1});
            App.selections.buttonInfo.text(App.globals.changes).show();
            StackExchange.MarkdownEditor.refreshAllPreviews();
        };

        // Init app
        App.init = function() {
            var count = 0;
            var toolbarchk = setInterval(function(){
                if(++count === 10) clearInterval(toolbarchk);
                if(!App.globals.root.find('.wmd-button-row').length) return;
                clearInterval(toolbarchk);
                App.funcs.popSelections();
                App.funcs.createButton();
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
                test = arguments[2].url.match(/review.inline-edit-post/);
                if(!test) return;
                test = arguments[2].data.match(/id=(\d+)/);
                if(!test) return;
            }
            extendEditor($('form[action^="/posts/' + test[1] + '"]'));
        });
        if($('#post-form').length) $('#post-form').each(function(){ extendEditor($(this)); });
        // This is the styling for the diff output.
        $('body').append('<style>' +
                         '.difftitle {' +
                         '    color: rgb(34, 34, 34);' +
                         '    font-size: 24px;' +
                         '    font-weight: normal;' +
                         '    line-height: 36px;' +
                         '    margin-bottom: 12px;' +
                         '}' +
                         '.diffbody {' +
                         '    white-space: pre-wrap;' +
                         '    font-family: "courier new", "lucida sans typewriter", mono, monospace' + 
                         '}' +
                         '.add {' +
                         '    background: #CFC;' +
                         '}' +
                         '.del {' +
                         '    background: #FCC;' +
                         '}' +
                         '</style>');
    } catch (e) {
        console.log(e);
    }
})();

/* 
  * To Title Case 2.1 – http://individed.com/code/to-title-case/
  * Copyright © 2008–2013 David Gouch. Licensed under the MIT License.
 */

String.prototype.toTitleCase = function(){
  var smallWords = /^(a|an|and|as|at|but|by|en|for|if|in|nor|of|on|or|per|the|to|vs?\.?|via)$/i;

  return this.replace(/[A-Za-z0-9\u00C0-\u00FF]+[^\s-]*/g, function(match, index, title){
    if (index > 0 && index + match.length !== title.length &&
      match.search(smallWords) > -1 && title.charAt(index - 2) !== ":" &&
      (title.charAt(index + match.length) !== '-' || title.charAt(index - 1) === '-') &&
      title.charAt(index - 1).search(/[^\s-]/) < 0) {
      return match.toLowerCase();
    }

    if (match.substr(1).search(/[A-Z]|\../) > -1) {
      return match;
    }

    return match.charAt(0).toUpperCase() + match.substr(1);
  });
};

// From https://github.com/EamonNerbonne/a-vs-an
var AvsAnSimple=function(n){function i(n){var r=parseInt(t,36)||0,f=r&&r.toString(36).length,u,e;for(n.article=t[f]=="."?"a":"an",t=t.substr(1+f),u=0;u<r;u++)e=n[t[0]]={},t=t.substr(1),i(e)}var t="2h.#2.a;i;&1.N;*4.a;e;i;o;/9.a;e;h1.o.i;l1./;n1.o.o;r1.e.s1./;01.8;12.1a;01.0;12.8;9;2.31.7;4.5.6.7.8.9.8a;0a.0;1;2;3;4;5;6;7;8;9;11; .22; .–.31; .42; .–.55; .,.h.k.m.62; .k.72; .–.82; .,.92; .–.8;<2.m1.d;o;=1.=1.E;@;A6;A1;A1.S;i1;r1;o.m1;a1;r1; .n1;d1;a1;l1;u1;c1.i1.a1.n;s1;t1;u1;r1;i1;a1;s.t1;h1;l1;e1;t1;e1.s;B2.h2.a1.i1;r1;a.á;o1.r1.d1. ;C3.a1.i1.s1.s.h4.a2.i1.s1;e.o1.i;l1.á;r1.o1.í;u2.i;r1.r1.a;o1.n1.g1.j;D7.a1.o1.q;i2.n1.a1.s;o1.t;u1.a1.l1.c;á1. ;ò;ù;ư;E7;U1;R.b1;o1;l1;i.m1;p1;e1;z.n1;a1;m.s1;p5.a1.c;e;h;o;r;u1.l1;o.w1;i.F11. ;,;.;/;0;1;2;3;4;5;6;71.0.8;9;Ae;B.C.D.F.I2.L.R.K.L.M.N.P.Q.R.S.T.B;C1;M.D;E2.C;I;F1;r.H;I3.A1;T.R1. ;U;J;L3.C;N;P;M;O1. ;P1;..R2.A1. ;S;S;T1;S.U2.,;.;X;Y1;V.c;f1.o.h;σ;G7.e1.r1.n1.e;h1.a3.e;i;o;i1.a1.n1.g;o2.f1. ;t1.t1. ;r1.i1.a;w1.a1.r1.r;ú;Hs. ;&;,;.2;A.I.1;2;3;5;7;B1;P.C;D;F;G;H1;I.I6;C.G.N.P.S1.D;T.K1.9;L;M1;..N;O2. ;V;P;R1;T.S1.F.T;V;e2.i1.r;r1.r1.n;o2.n6;d.e1.s;g.k.o2;l.r1;i1.f;v.u1.r;I3;I2;*.I.n1;d1;e1;p1;e1;n1;d2;e1;n1;c1;i.ê.s1;l1;a1;n1;d1;s.J1.i1.a1.o;Ly. ;,;.;1;2;3;4;8;A3. ;P;X;B;C;D;E2. ;D;F1;T.G;H1.D.I1.R;L;M;N;P;R;S1;m.T;U1. ;V1;C.W1.T;Z;^;a1.o1.i1.g;o1.c1.h1.a1;b.p;u1.s1.h1;o.ộ;M15. ;&;,;.1;A1;.1;S./;1;2;3;4;5;6;7;8;Ai;B.C.D.F.G.J.L.M.N.P.R.S.T.V.W.X.Y.Z.B1;S1;T.C;D;E3.P1;S.W;n;F;G;H;I4. ;5;6;T1;M.K;L;M;N;O1.U;P;Q;R;S;T1;R.U2. ;V;V;X;b1.u1.m;f;h;o2.D1.e.U1;..p1.3;s1.c;Ny. ;+;.1.E.4;7;8;:;A3.A1;F.I;S1.L;B;C;D;E3.A;H;S1. ;F1;U.G;H;I7.C.D1. ;K.L.N.O.S.K;L;M1;M.N2.R;T;P1.O1.V1./1.B;R2;J.T.S1;W.T1;L1.D.U1.S;V;W2.A;O1.H;X;Y3.C1.L;P;U;a1.s1.a1.n;t1.h;v;²;×;O5;N1;E.l1;v.n2;c1.e.e1.i;o1;p.u1;i.P1.h2.i1.a;o2.b2;i.o.i;Q1.i1.n1.g1.x;Rz. ;&;,;.1;J./;1;4;6;A3. ;.;F1;T.B1;R.C;D;E3. ;S1.P;U;F;G;H1.S;I2.A;C1. ;J;K;L1;P.M5;1.2.3.5.6.N;O2.H;T2;A.O.P;Q;R1;F.S4;,...?.T.T;U4;B.M.N.S.V;X;c;f1;M1...h2.A;B;ò;S11. ;&;,;.4.E;M;O;T1..3.B;D;M;1;3;4;5;6;8;9;A3. ;8;S2;E.I.B;C3.A1. ;R2.A.U.T;D;E6. ;5;C3;A.O.R.I1.F.O;U;F3;&.H.O1.S.G1;D.H3.2;3;L;I2. ;S1.O.K2.I.Y.L3;A2. ;.;I1. ;O.M3;A1. ;I.U1.R.N5.A.C3.A.B.C.E.F.O.O5. ;A1.I;E;S1;U.V;P7;A7;A.C.D.M.N.R.S.E1. ;I4;C.D.N.R.L1;O.O.U.Y.Q1. ;R;S1;W.T9.A1. ;C;D;F;I;L;M;S;V;U7.B.L.M.N.P.R.S.V;W1.R;X1.M;h1.i1.g1.a1.o;p1.i1.o1;n.t2.B;i1.c1.i;T4.a2.i2.g1.a.s1.c;v1.e1.s;e1.a1.m1.p;u1.i2.l;r;à;Um..1.N1..1.C;/1.1;11. .21.1;L1.T;M1.N;N4.C1.L;D2. .P.K;R1. .a;b2;a.i.d;g1.l;i1.g.l2;i.y.m;no. ;a1.n.b;c;d;e1;s.f;g;h;i2.d;n;j;k;l;m;n;o;p;q;r;s;t;u;v;w;p;r3;a.e.u1.k;s3. ;h;t1;r.t4.h;n;r;t;x;z;í;W2.P1.:4.A1.F;I2.B;N1.H.O1.V;R1.F1.C2.N.U.i1.k1.i1.E1.l1.i;X7;a.e.h.i.o.u.y.Y3.e1.t1.h;p;s;[5.A;E;I;a;e;_2._1.i;e;`3.a;e;i;a7; .m1;a1;r1. .n1;d2; .ě.p1;r1;t.r1;t1;í.u1;s1;s1;i1. .v1;u1;t.d3.a1.s1. ;e2.m1. ;r1. ;i2.c1.h1. ;e1.s1.e2.m;r;e8;c1;o1;n1;o1;m1;i1;a.e1;w.l1;i1;t1;e1;i.m1;p1;e1;z.n1;t1;e1;n1;d.s2;a1. .t4;a1; .e1; .i1;m1;a1;r.r1;u1.t.u1.p1. ;w.f3. ;M;y1.i;h9. ;,;.;C;a1.u1.t1;b.e2.i1.r1;a.r1.m1.a1.n;o4.m2.a1; .m;n8; .b.d.e3; .d.y.g.i.k.v.r1.s1. ;u1.r;r1. ;t1;t1;p1;:.i6;b1;n.e1;r.n2;f2;l1;u1;ê.o1;a.s1;t1;a1;l1;a.r1; .s1; .u.k1.u1. ;l3.c1.d;s1. ;v1.a;ma. ;,;R;b1.a.e1.i1.n;f;p;t1.a.u1.l1.t1.i1.c1.a1.m1.p1.i;×;n6. ;V;W;d1; .t;×;o8;c2;h1;o.u1;p.d1;d1;y.f1; .g1;g1;i.no. ;';,;/;a;b;c1.o;d;e2.i;r;f;g;i;l;m;n;o;r;s;t;u;w;y;z;–;r1;i1;g1;e.t1;r1.s;u1;i.r3. ;&;f;s9.,;?;R;f2.e.o.i1.c1.h;l1. ;p2.3;i1. ;r1.g;v3.a.e.i.t2.A;S;uc; ...b2.e;l;f.k2.a;i;m1;a1. .n3;a3; .n5.a;c;n;s;t;r1;y.e2; .i.i8.c2.o1.r1.p;u1.m;d1;i1.o;g1.n;l1.l;m1;o.n;s1.s;v1.o1;c.r5;a.e.i.l.o.s3. ;h;u1.r2;e.p3;a.e.i.t2.m;t;v.w1.a;xb. ;';,;.;8;b;k;l;m1;a.t;y1. ;y1.l;{1.a;|1.a;£1.8;À;Á;Ä;Å;Æ;É;Ò;Ó;Ö;Ü;à;á;æ;è;é1;t3.a;o;u;í;ö;ü1; .Ā;ā;ī;İ;Ō;ō;œ;Ω;α;ε;ω;ϵ;е;–2.e;i;ℓ;";return i(n),{raw:n,query:function(t){var i=n,f=0,u,r;do r=t[f++];while("\"‘’“”$'".indexOf(r)>=0);for(;;){if(u=i.article||u,i=i[r],!i)return u;r=t[f++]||" "}}}}({})

// Adapted from http://stackoverflow.com/a/6969486/1677912
function escapeTag(tag) {
    // See https://regex101.com/r/yW9cD4/1
    var retag = tag.replace(/(?:(\-)|([+.#]))/g,
                     function (match, hyphen, other) {
                         var escaped = (hyphen) ? "[ \\-]" : "\\"+match;
                         return escaped;
                     });
    return "(?:\\s|\\b|$)" + retag + "(?:\\s|\\b|$)";  // hack - enclose tag in regexp boundary checks. WBN to do this in the taglist regexp.
}
