// ==UserScript==
// @name         @Closey command auto complete
// @namespace    https://github.com/SO-Close-Vote-Reviewers/UserScripts
// @version      0.3
// @description  command completion for bot commands
// @author       rene
// @match        *://chat.stackoverflow.com/rooms/41570/so-close-vote-reviewers
// @grant        none
// ==/UserScript==

/*global $:false, document:false, console:false */
function startAutoComplete(jquery) {
  "use strict";
    if (!String.prototype.startsWith) {
        Object.defineProperty(String.prototype, 'startsWith', {
            enumerable: false,
            configurable: false,
            writable: false,   
            value: function (searchString, position) {
                position = position || 0;
                return this.lastIndexOf(searchString, position) === position;
            }
        });
    }

    var $ = jquery,
        inp = $('#input'),  // where we type messages
        parse = /(@closey\s+)([\w|\W]+)/i, // //parse botname and commands
        cmds = [
             // Public
            'add',                    // [user id] to [group name] - Manually adds a user to the given permission group.
            'alive',                  // A simple ping command to test if the bot is running.
            'approve request',        // [#] - Approves a pending permission request.
            'commands',               // Shows most commands.
            'commands full',          // Shows all commands, broken down by category.
            'help',                   // Prints info about this software.
            'membership',             // Shows a list of all permission groups, and the members in those permission groups.
            'my membership',          // Shows the permission groups you are a part of.
            'reject request',         // [#] - Rejects a pending permission request.
            'remove',                 // [user id] from [group name] - Manually removes a user from the given permission group.
            'request permission to',  // [group name] - Submits a request for the user to be added to a given permission group.
            'running commands',       // Displays a list of all commands that the chat bot is currently running.
            'status',                 // Tests if the chatbot is alive and shows simple info about it.
            'view requests',          // Shows all pending permission requests.
             // Reviewer
            'audit stats',            // Shows stats about your recorded audits.
            'current tag',            // Get the tag that has the most amount of manageable close queue items from the SEDE query.
            'next',                   // [#] tags - Displays the first X tags from the SEDE query to focus on.
            'opt in',                 // Tells the bot to resume tracking your close vote reviewing.
            'opt out',                // Tells the bot to stop tracking your close vote reviewing.
            'refresh tags',           // Forces a refresh of the tags obtained from the SEDE query.
            'reviews today',          // Shows stats about your reviews completed today. Or, if requesting a full data dump ("reviews today details"), prints a table of the reviews items you've done today.
            'reviews today details',  // <...Or, if requesting a full data dump ("reviews today details"), prints a table of the reviews items you've done today.
            'room effectiveness',     // Shows stats about how effective the room is at processing close vote review items.
            'stats',                  // Shows the stats at the top of the /review/close/stats page.
            'total reviews today',    // Shows summary information and a table of the people who have completed reviews today.
            // BotOwner
//          'add review',             // [review id] [user id] - Manually adds a review to a user. Should only be used for testing.
            'ping reviewers',         // <message> - The bot will send a message with an @reply to all users that have done reviews recently.
            'start event',            // Shows the current stats from the /review/close/stats page and the next 3 tags to work on.
            'stop bot'                // - The bot will leave the chat room and quit the running application.
        ]; // all known commands
    // clear all hints and remove click handlers
    function clearHints() {
        $('#closey').find('li').each(function () { $(this).off('click'); });
        $('#closey').remove();
    }

    // put the choose hint in the chat message text area
    function complete(bot, command) {
        return function () {
            inp.val(bot + command);
            clearHints();
        };
    }

    // build on single le that holds the hint
    function buildHint(value, bot) {
        var li = $('<li></li>')
            .css('display', 'inline-block')
            .css('margin-left', '3px')
            .css('margin-right', '3px')
            .css('padding', '2px')
            .css('border', 'solid 1px blue')
            .text(value);
        li.on('click', complete(bot, value));
        return li;
    }

    function highlight(li) {
        li.addClass('tab');
        li.css('background-color', 'yellow');
        return li.text();
    }
    function highlightNextHint() {
        var setnext = false,
            lif,
            selected;
        $('#closey').find('li').each(function () {
            var li = $(this);
            if (li.hasClass('tab')) {
                setnext = true;
                li.removeClass('tab');
                li.css('background-color', 'white');
            } else {
                if (setnext) {
                    selected = highlight(li);
                    return false;
                }
            }
        });
        if (!setnext) {
            lif = $('#closey').find('li');
            if (lif.length > 0) {
                selected = highlight($(lif[0]));
                setnext = true;
            }
        }
        return selected;
    }

    function handleKey(cmd, bot) {
        var botcmd,
            c,
            container;

        clearHints();
        container = $('<ul id="closey"></ul>').css('text-align', 'left');
        for (c = 0; c < cmds.length; c = c + 1) {
            botcmd = cmds[c];
            if (botcmd.startsWith(cmd) && botcmd !== cmd) {
                container.append(buildHint(botcmd, bot));
            }
        }
        $('#tabcomplete-container').append(container);
    }

    $(document).on('keydown', function (k) {
        var BOT = 1,
            COMMAND = 2,
            result = parse.exec(inp.val()),
            selected;

        if (result !== null &&
                result.length > COMMAND &&
                k.keyCode === 9) {
            selected = highlightNextHint();
            if (selected !== undefined) {
                k.preventDefault();
                k.stopPropagation();
                inp.val(result[BOT] + selected);
                return true;
            }
        }
    });

    inp.on('keyup', function (e) {
        var BOT = 1,
            COMMAND = 2,
            result = parse.exec(e.result);
        console.log(e);
        console.log(result);
        if (e.keyCode !== 9) {
            if (result !== null &&
                    result.length > COMMAND) {
                handleKey(result[COMMAND], result[BOT]);
            } else {
                clearHints();
            }
        }
    });
}

function getJquery() {
  "use strict";
    return $ || unsafeWindow.jQuery;
}

window.addEventListener('load',
    function() {
        startAutoComplete(getJquery());
    });
