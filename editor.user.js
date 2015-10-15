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
// @version        1.5.2.31
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
            //        https://regex101.com/r/eC7mF7/1 code blocks and multiline inline code.
            "block":  /`[^`]+`|(?:(?:[ ]{4}|[ ]{0,3}\t).+(?:[\r\n]?(?!\n\S)(?:[ ]+\n)*)+)+/g,
            //        https://regex101.com/r/tZ4eY3/7 link-sections 
            "lsec":   /(?:  (?:\[\d\]): \w*:+\/\/.*\n*)+/g,
            //        https://regex101.com/r/tZ4eY3/19 links and pathnames
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
                expr: /([^\b\w.]|^)(javascript|js|java script)\b/gi,
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
            x_html: {
                expr: /(?:[^\b\w.]|^)(g|ht|x|xht)ml\b/gi,
                replacement: String.toUpperCase,
                reason: "trademark capitalization"
            },
            css: {
                expr: /(?:[^\b\w.]|^)css\b/gi,
                replacement: String.toUpperCase,
                reason: "trademark capitalization"
            },
            json: {
                expr: /(?:[^\b\w.]|^)json\b/gi,
                replacement: String.toUpperCase,
                reason: "acronym capitalization"
            },
            ajax: {
                expr: /\bajax\b/g,     // Leave "Ajax" alone. See https://github.com/AstroCB/Stack-Exchange-Editor-Toolkit/issues/45
                replacement: "AJAX",
                reason: "acronym capitalization"
            },
            php: {
                expr: /(?:[^\b\w.]|^)php\b/gi,
                replacement: String.toUpperCase,
                reason: "trademark capitalization"
            },
            voting: {
                expr: /\b(down|up)\Wvot/gi,
                replacement: "$1vote",
                reason: "the proper spelling (despite the tag name) is '$1vote' (one word)"
            },
            c: {
                expr: /(?:[^\b\w.]|^)c\b(?:#|\+\+)?/gi,
                replacement: String.toUpperCase,
                reason: "trademark capitalization"
            },
            java: {
                expr: /([^\b\w.]|^)java\b/gi,
                replacement: "$1Java",
                reason: "trademark capitalization"
            },
            sql: {
                expr: /(?:[^\b\w.]|^)sql\b/gi,
                replacement: String.toUpperCase,
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
                // https://regex101.com/r/jF9zK1/6
                expr: /\b(?:win|windows)(?:\s+(2k|[0-9.]+|ce|me|nt|xp|vista|server))?\b/gi,
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
            nodejs: {
                expr: /\bnode\.?js\b/gi,
                replacement: "Node.js",
                reason: "trademark capitalization"
            },
            apache: {
                expr: /\bapache\b/gi,
                replacement: "Apache",
                reason: "trademark capitalization"
            },
            git: {
                expr: /([^\b\w.]|^)git\b/gi,
                replacement: "$1Git",
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
                expr: /(?:vb|\s+)(?:\.net|\s*[0-9]+)\s*(?:framework|core)?/gi,
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
                expr: /([^\b\w.]|^)pdf(s)?/gi,
                replacement: "$1PDF$2",
                reason: "trademark capitalization"
            },
            api: {
                expr: /([^\b\w.]|^)api(s)?\b/gi,
                replacement: "$1API$2",
                reason: "acronym capitalization"
            },
            ssl: {
                expr: /(?:[^\b\w.]|^)ssl\b/g,
                replacement: String.toUpperCase,
                reason: "acronym capitalization"
            },
            tomcat: {
                expr: /\btomcat([0-9.]*)/gi,
                replacement: "Tomcat$1",
                reason: "trademark capitalization"
            },
            npm: {
                expr: /\bnpm(s)?\b/g,
                replacement: "NPM$1",
                reason: "acronym capitalization"
            },
            succeed: {
                expr: /\b(s)uc[cs]?ee?d(ed|s)?\b/gi,
                replacement: "$1ucceed$2",
                reason: "grammar and spelling"
            },
            ftp: {
                expr: /(?:[^\b\w.]|^)[st]?ftps?\b/g,
                replacement: String.toUpperCase,
                reason: "acronym capitalization"
            },
            ipa: {
                expr: /(?:[^\b\w.]|^)ipa\b/g,
                replacement: String.toUpperCase,
                reason: "acronym capitalization"
            },
            avl: {
                expr: /(?:[^\b\w.]|^)avl\b/g,
                replacement: String.toUpperCase,
                reason: "acronym capitalization"
            },
            netbeans: {
                expr: /\b(netbeans|net-beans|net beans)\b/gi,
                replacement: "NetBeans",
                reason: "trademark capitalization"
            },
            cli_cgi: {
                expr: /(?:[^\b\w.]|^)c[lg]i\b/g,
                replacement: String.toUpperCase,
                reason: "acronym capitalization"
            },
            nginx: {
                expr: /\bnginx\b/g,
                replacement: String.toUpperCase,
                reason: "trademark capitalization"
            },
            dll: {
                expr: /(?:[^\b\w.]|^)dll\b/g,
                replacement: String.toUpperCase,
                reason: "acronym capitalization"
            },
            source: {
                expr: /\b(s)orce(s|d)?\b/gi,
                replacement: "$1ource$2",
                reason: "grammar and spelling"
            },
            standardize: {  // https://regex101.com/r/vN7pM0/1
                expr: /\b(s)tandari([sz](?:e|es|ed|ation))\b/gi,
                replacement: "$1tandardi$2",
                reason: "grammar and spelling"
            },
            different: {  // https://regex101.com/r/vN7pM0/1
                expr: /\b(d)iff?e?ren(t|ce)\b/gi,
                replacement: "$1ifferen$2",
                reason: "grammar and spelling"
            },
            personally: { // https://regex101.com/r/oL9aM1/1
                expr: /\b(p)ersona?l?(ly)?\b/gi,
                replacement: "$1ersonal$2",
                reason: "grammar and spelling"
            },
            problem: {
                expr: /\b(p)orblem(s)?\b/gi,
                replacement: "$1roblem$2",
                reason: "grammar and spelling"
            },
            maybe: {
                expr: /\b(m)aby\b/gi,
                replacement: "$1aybe",
                reason: "grammar and spelling"
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
            doesn_t: {
                expr: /\b(d)ose?nt\b/gi,
                replacement: "$1oesn't",
                reason: "grammar and spelling"
            },
            prolly: {
                expr: /\b(p)roll?y\b/gi,
                replacement: "$1robably",
                reason: "grammar and spelling"
            },
            keyboard: {
                expr: /\b(k)ey?boa?rd\b/gi,
                replacement: "$1eyboard",
                reason: "grammar and spelling"
            },
            i: {
                expr: /\bi('|\b)/g,  // i or i-apostrophe
                replacement: "I",
                reason: "grammar and spelling"
            },
            im: {
                expr: /\bi ?m\b/gi,
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
            expect: {
                expr: /\b(e)spect(s)?\b/gi,
                replacement: "$1xpect$2",
                reason: "grammar and spelling"
            },
            employe: {
                expr: /\b(e)mploye\b/gi,
                replacement: "$1mployee",
                reason: "grammar and spelling"
            },
            retrieve: {
                expr: /\b(r)etreive(d)?\b/gi,
                replacement: "$1etrieve$2",
                reason: "grammar and spelling"
            },
            firefox: {
                expr: /\bfire?fox\b/gi,
                replacement: "Firefox",
                reason: "trademark capitalization"
            },
            success: { // https://regex101.com/r/hK2vG4/1
                expr: /\b(s)ucc?ess?(ful|fully)?l?\b/gi,
                replacement: "$1uccess$2",
                reason: "grammar and spelling"
            },
            safari: {
                expr: /\bsafari\b/gi,
                replacement: "Safari",
                reason: "trademark capitalization"
            },
            chrome: {
                expr: /\bchrome\b/gi,
                replacement: "Chrome",
                reason: "trademark capitalization"
            },
            anyones: {
                expr: /\b(a)nyones\b/gi,
                replacement: "$1nyone's",
                reason: "grammar and spelling"
            },
            length: {
                expr: /\b(l)en(?:gh?t|th)\b/gi,
                replacement: "$1ength",
                reason: "grammar and spelling"
            },
            height: {
                expr: /\b(h)(?:ei|i|ie)(?:gt|th|ghth|gth)\b/gi,
                replacement: "$1eight",
                reason: "grammar and spelling"
            },
            width: {
                expr: /\b(w)idh?t\b/gi,
                replacement: "$1idth",
                reason: "grammar and spelling"
            },
            centered: {
                expr: /\b(c)ent(?:red|erd)\b/gi,
                replacement: "$1entered",
                reason: "grammar and spelling"
            },
            center: {
                expr: /\b(c)entre\b/gi,    // "Centre" is a word, however in most cases on SO "center" is meant
                replacement: "$1enter",
                reason: "grammar and spelling"
            },
            aint_isnt: {
                expr: /\bain't\b/gi,
                replacement: "isn't",
                reason: "grammar and spelling"
            },
            coordinates: {
                expr: /\b(c)ordinate(s|d)?\b/gi,
                replacement: "$1oordinate$2",
                reason: "grammar and spelling"
            },
            argument: {
                expr: /\b(a)rguement(s)?\b/gi,
                replacement: "$1rgument$2",
                reason: "grammar and spelling"
            },
            gui: {
                expr: /([^\b\w.]|^)gui(s)?\b/gi,
                replacement: "$1GUI$2",
                reason: "acronym capitalization"
            },
            iterate: { // https://regex101.com/r/iL6bV3/1
                expr: /\b(i)(?:tter|tar)at(e[ds]?|ing|ion|ions)\b/gi,
                replacement: "$1terat$2",
                reason: "grammar and spelling"
            },
            below: {
                expr: /\b(b)ellow\b/gi,          // "Bellow" is a word, but extremely uncommon on StackOverflow.com.
                replacement: "$1elow",
                reason: "grammar and spelling"
            },
            encrypt: {
                expr: /\b(en|de)cript(s|ing)?\b/gi,
                replacement: "$1crypt$2",
                reason: "grammar and spelling"
            },
            gnu: {
                expr: /\bgnu\b/g,
                replacement: String.toUpperCase,
                reason: "trademark capitalization"
            },
            gcc: {
                expr: /(?:[^\b\w.]|^)gcc\b/g,
                replacement: String.toUpperCase,
                reason: "trademark capitalization"
            },
            stp: {
                expr: /(?:[^\b\w.]|^)stp\b/gi,
                replacement: String.toUpperCase,
                reason: "acronym capitalization"
            },
            tcp: {
                expr: /(?:[^\b\w.]|^)tcp\b/gi,
                replacement: String.toUpperCase,
                reason: "acronym capitalization"
            },
            ipv_n: {
                expr: /\bip(v[46])?\b/gi,
                replacement: "IP$1",
                reason: "acronym capitalization"
            },
            fq_dn_s: {  // FQDN, DN, DNS
                expr: /(?:[^\b\w.]|^)(?:fq)?dns?\b/gi,
                replacement: String.toUpperCase,
                reason: "acronym capitalization"
            },
            icmp: {
                expr: /\bicmp\b/gi,
                replacement: String.toUpperCase,
                reason: "acronym capitalization"
            },
            rsvp: {
                expr: /\brsvp\b/gi,
                replacement: String.toUpperCase,
                reason: "acronym capitalization"
            },
            snmp: {
                expr: /\bsnmp\b/gi,
                replacement: String.toUpperCase,
                reason: "acronym capitalization"
            },
            cpu: {
                expr: /\bcpu(s)?\b/gi,
                replacement: "CPU$1",
                reason: "acronym capitalization"
            },
            rss: {
                expr: /(?:[^\b\w.]|^)rss?\b/gi,
                replacement: String.toUpperCase,
                reason: "acronym capitalization"
            },
            mvc: {
                expr: /(?:[^\b\w.]|^)mvc\b/gi,
                replacement: String.toUpperCase,
                reason: "acronym capitalization"
            },
            mvn: {
                expr: /(?:[^\b\w.]|^)mvn\b/gi,
                replacement: String.toUpperCase,
                reason: "trademark capitalization"
            },
            ascii: {
                expr: /([^\b\w.]|^)ascii?\b/gi,
                replacement: "$1ASCII",
                reason: "acronym capitalization"
            },
            maven: {
                expr: /\bmaven\b/gi,
                replacement: "Maven",
                reason: "trademark capitalization"
            },
            youtube: {
                expr: /\byoutube\b/gi,
                replacement: "YouTube",
                reason: "trademark capitalization"
            },
            amazon: {
                // https://regex101.com/r/dR0pJ7/1
                expr: /\b(amazon(?: )?(?:redshift|web services|cloudfront|console)?)((?: )?(?:ec2|aws|s3|rds|sqs|iam|elb|emr|vpc))?\b/gi,
                replacement: function(str,titlecase,uppercase) {
                    var fixed = titlecase.toTitleCase() + (uppercase ? uppercase.toUpperCase() : '');
                    return fixed;
                },
                reason: "trademark capitalization"
            },
            zend: {
                expr: /\bzend((?: )?(?:framework|studio|guard))?\b/gi,
                //replacement: String.toTitleCase,  // Doesn't work like built-in toUpperCase, returns 'undefined'. Load order?
                replacement: function(str,prod) {
                    return str.toTitleCase();
                },
               reason: "trademark capitalization"
            },
            // From Peter Mortensen list (http://pvm-professionalengineering.blogspot.de/2011/04/word-list-for-editing-stack-exchange.html)
            ie: {  // http://english.stackexchange.com/questions/30106/can-i-start-a-sentence-with-i-e
                expr: /\b(i|I)e\b/g,   // Careful here; IE is Internet Explorer
                replacement: "$1.e.",
                reason: "grammar and spelling"
            },
            eg: {
                expr: /\b(e)g\b/gi,
                replacement: "$1.g.",
                reason: "grammar and spelling"
            },
            unfortunately: {
                expr: /\b(u)nfortu?na?tly\b/gi,
                replacement: "$1nfortunately",
                reason: "grammar and spelling"
            },
            whether: {
                expr: /\b(w)h?eth?er\b/gi,
                replacement: "$1hether",
                reason: "grammar and spelling"
            },
            through: {  // https://regex101.com/r/gQ0dZ1/4
                expr: /\b(t)(?:hru|rough|hroug)\b/gi,
                replacement: "$1hrough",
                reason: "grammar and spelling"
            },
            throughout: {
                expr: /\b(t)(?:hruout|roughout)\b/gi,
                replacement: "$1hroughout",
                reason: "grammar and spelling"
            },
            breakthrough: {
                expr: /\b(b)reak\s+through(s)?\b/gi,
                replacement: "$1reakthrough$2",
                reason: "grammar and spelling"
            },
            though: {
                expr: /\b(t)(?:ho|hou|hogh)\b/gi,
                replacement: "$1hough",
                reason: "grammar and spelling"
            },
            although: {
                expr: /\b(a)l(?:tho|thou|thogh|tough)\b/gi,
                replacement: "$1lthough",
                reason: "grammar and spelling"
            },
            thought: {
                expr: /\b(t)r?ought(s)?\b/gi,
                replacement: "$1hough$2",
                reason: "grammar and spelling"
            },
            throwing: {
                expr: /\b(t)hroughing\b/gi,       // Peter says this is "thoroughly", but a survey of SO questions indicates "throwing"
                replacement: "$1hrowing",
                reason: "grammar and spelling"
            },
            a_lot: {
                expr: /\b(a)lot\b/gi,
                replacement: "$1 lot",
                reason: "grammar and spelling"
            },
            one_r_two_r: {
                expr: /\b(refe|prefe|occu)r(ed|ing)\b/gi,
                replacement: "$1rr$2",
                reason: "grammar and spelling"
            },
            preferably: {
                expr: /\b(p)referrably\b/gi,
                replacement: "$1referably",
                reason: "grammar and spelling"
            },
            command_line: {
                expr: /\b(c)ommandline\b/gi,
                replacement: "$1ommand-line",
                reason: "grammar and spelling"
            },
            benefits: {
                expr: /\b(b)enifits\b/gi,
                replacement: "$1enefits",
                reason: "grammar and spelling"
            },
            authorization: {
                expr: /\b(a)uth\b/gi,           // This may be too ambiguous, could also mean "authentication"
                replacement: "$1uthorization",
                reason: "grammar and spelling"
            },
            persistent: {
                expr: /\b(p)ersistan(t|ce)\b/gi,
                replacement: "$1ersisten$2",
                reason: "grammar and spelling"
            },
            _ibility: {
                expr: /\b(comp|incomp|access)abilit(y|ies)\b/gi,
                replacement: "$1ibilit$2",
                reason: "grammar and spelling"
            },
            separate: {
                expr: /\b(s)epe?rate?(d|ly|s)?\b/gi,
                replacement: "$1eparate$2",
                reason: "grammar and spelling"
            },
            separation: {
                expr: /\b(s)eperation(s)?\b/gi,
                replacement: "$1eparation$2",
                reason: "grammar and spelling"
            },
            definite: {
                expr: /\b(d)efin(?:ate?|ite?|al|te?)(ly)?\b/gi,  // Catches correct spelling, too.
                replacement: "$1efinite$2",
                reason: "grammar and spelling"
            },
            definitive: {
                expr: /\b(d)efina?tive(ly)?\b/gi,
                replacement: "$1efinitive$2",
                reason: "grammar and spelling"
            },
            independent: {
                expr: /\b(i)ndependant(ly)?\b/gi,
                replacement: "$1ndependent$2",
                reason: "grammar and spelling"
            },
            recommend: {
                expr: /\b(r)ecomm?and(ation)?\b/gi,
                replacement: "$1ecommend$2",
                reason: "grammar and spelling"
            },
            compatibility: {
                expr: /\b(c)ompatability\b/gi,
                replacement: "$1ompatibility$2",
                reason: "grammar and spelling"
            },
            ps: {
                expr: /\bps\b/g,
                replacement: "PS",
                reason: "grammar and spelling"
            },
            ok: {
                expr: /\bok\b/g,
                replacement: "OK",
                reason: "grammar and spelling"
            },
            etc: {
                expr: /\betc\b/g,
                replacement: "etc.",
                reason: "grammar and spelling"
            },
            back_end: {  // Interesting fact: backend 3x more common than back-end
                expr: /\b(b)ackend\b/g,
                replacement: "$1ack-end",
                reason: "grammar and spelling"
            },
            front_end: {
                expr: /\b(f)rontend\b/g,
                replacement: "$1ront-end",
                reason: "grammar and spelling"
            },
            data_type: {
                expr: /\b(d)atatype\b/g,
                replacement: "$1ata type",
                reason: "grammar and spelling"
            },
            allotted: {
                expr: /\b(a)l+ot+ed\b/g,
                replacement: "$1llotted",
                reason: "grammar and spelling"
            },
            every_time: {
                expr: /\b(e)ve?rytime\b/g,
                replacement: "$1very time",
                reason: "grammar and spelling"
            },
            straightforward: {
                expr: /\b(s)traig?h?t[ -]forward\b/g,
                replacement: "$1traightforward",
                reason: "grammar and spelling"
            },
            preceding: {
                expr: /\b(p)receeding\b/gi,
                replacement: "$1receding",
                reason: "grammar and spelling"
            },
            no_one: {
                expr: /\b(n)o-?one\b/gi,
                replacement: "$1o one",
                reason: "grammar and spelling"
            },
            de_facto: {
                expr: /\b(d)e-?facto\b/gi,
                replacement: "$1e facto",
                reason: "grammar and spelling"
            },
            accommodate: { // https://regex101.com/r/cL3mD9/1
                expr: /\b(a)(?:c+om|com+)odate\b/gi,
                replacement: "$1ccommodate",
                reason: "grammar and spelling"
            },
            matlab: {
                expr: /([^\b\w.]|^)math?lab\b/gi,
                replacement: "$1MATLAB",
                reason: "trademark capitalization"
            },
            internet: {
                expr: /\binternet\b/g,
                replacement: "Internet",
                reason: "trademark capitalization"
            },
            web_services: {
                expr: /\bweb services\b/g,
                replacement: "Web services",
                reason: "trademark capitalization"
            },
            kind_of: {
                expr: /\b(k)inda\b/gi,
                replacement: "$1ind of",
                reason: "grammar and spelling"
            },
            want_to: {
                expr: /\b(w)ann?a\b/gi,
                replacement: "$1ant to",
                reason: "grammar and spelling"
            },
            sort_of: {
                expr: /\b(s)orta\b/gi,
                replacement: "$1ort of",
                reason: "grammar and spelling"
            },
            got_to: { // https://regex101.com/r/rK6xR5/1
                expr: /\b(have\s+)?(g)otta\b/gi,
                replacement: "$1$2ot to",
                reason: "grammar and spelling"
            },
            dont_know: { // https://regex101.com/r/rK6xR5/1
                expr: /\b(d)[uo]nn?o\b/gi,
                replacement: "$1on't know",
                reason: "grammar and spelling"
            },
            going_to: {
                expr: /\b(g)[ou]nn?a\b/gi,
                replacement: "$1oing to",
                reason: "grammar and spelling"
            },
            // Punctuation & Spacing come last
            firstcaps: {
                //    https://regex101.com/r/qR5fO9/14
                // This doesn't work quite right, because is finds all sentences, not just ones needing caps.
                //expr: /(?:(?!\n\n)[^\s.!?]+[ ]*)+([.!?])*[ ]*/g, 
                expr: /((?!\n\n)[A-z\d](?:(?!\n\n)[^?.!A-Z])+(?:\.[A-z\d][^?.!A-Z]+)?([?.!])?)/gm, 
                replacement: function(str, endpunc) { 
                    if (str === "undefined") return str;  // MUST match str, or gets counted as a change.
                    //                 https://regex101.com/r/bL9xD7/1 find and capitalize first letter
                    return str.replace(/^(\W*)([a-z])(.*)/g, function(sentence, pre, first, post) {
                        if (!pre) pre = '';
                        if (!post) post = '';
                        var update = pre + first.toUpperCase() + post; // + (!endpunc && /\w/.test(post.substr(-1)) ? '.' : '');
                        return update;
                    });
                },
                reason: "caps at start of sentences"
            },
            multiplesymbols: {
                //    https://regex101.com/r/bE9zM6/1
                expr: /([^\w\s*#.\-_+])\1{1,}/g,
                replacement: "$1",
                reason: "punctuation & spacing"
            },
            spacesbeforesymbols: {
                expr: /[ \t]*(?:([,!?;:](?!\)|\d)|[ \t](\.))(?=\s))[ \t]*/g,  // https://regex101.com/r/vS3dS3/6
                replacement: "$1 ",
                reason: "punctuation & spacing"
            },
            multiplespaces: {
                // https://regex101.com/r/hY9hQ3/1
                expr: /[ ]{2,}(?!\n)/g,
                replacement: " ",
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
            },
            // The title says it all
            thetitlesaysitall: {
                // https://regex101.com/r/bX1qB4/3
                expr: /(?:the )?title says it all/gi,
                replacement: function(){
                    return '"' + App.selections.title.val() + '" says it all';
                },
                reason: "the title says it all"
            }
        };

        // This is where the magic happens: this function takes a few pieces of information and applies edits to the post with a couple exceptions
        App.funcs.fixIt = function(input, expression, replacement, reasoning) {
            // If there is nothing to search, exit
            if (!input) return false;
            // Scan the post text using the expression to see if there are any matches
            var matches = input.match(expression);
            if (!matches) return false;
            var count = 0;  // # replacements to do
            input = input.replace(expression, function(before){ 
                var after = before.replace(expression, replacement);
                if(after !== before) ++count; 
                return after;
            });
            return count > 0 ? {
                reason: reasoning,
                fixed: String(input).trim(),
                count: count
            } : false;
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
                        App.funcs.fixEvent();
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
                i[v] = s[v].length ? s[v].val().trim() : '';
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

        App.funcs.fixEvent = function() {
            return App.funcs.popItems(), App.pipe(App.items, App.pipeMods, App.globals.order), false;
        };

        App.funcs.diff = function(a1, a2) {
            var strings = [];
            function maakRij(type, rij) {
                if (!type) return strings.push(rij.replace(/\</g, '&lt;')), true;
                if (type === '+') return strings.push('<span class="add">' + rij.replace(/\</g, '&lt;') + '</span>'), true;
                if (type === '-') return strings.push('<span class="del">' + rij.replace(/\</g, '&lt;') + '</span>'), true;
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
            
            a1 = a1.split(/(?=\b|\W)/g);
            a2 = a2.split(/(?=\b|\W)/g);

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
                var fix = App.funcs.fixIt(data[field], App.edits[j].expr, App.edits[j].replacement, App.edits[j].reason);
                if (!fix) continue;
                if (fix.reason in App.globals.reasons) App.globals.reasons[fix.reason].count += fix.count;
                else App.globals.reasons[fix.reason] = { reason:fix.reason, editId:j, count:fix.count };
                data[field] = fix.fixed;
                App.edits[j].fixed = true;
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

            if (!data.hasOwnProperty('summaryOrig')) data.summaryOrig = data.summary.trim(); // Remember original summary
            if (data.summaryOrig.length) data.summaryOrig = data.summaryOrig + ' ';

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
            App.selections.buttonInfo.text(App.globals.changes + (App.globals.changes != 1 ? ' changes' : ' change')+' made');
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
                App.funcs.applyListeners();
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
                         '    padding: 0 3px;' +
                         '    background: #CFC;' +
                         '}' +
                         '.del {' +
                         '    padding: 0 3px;' +
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
