// ==UserScript==
// @name         CV Request Archiver
// @namespace    https://github.com/SO-Close-Vote-Reviewers/
// @version      3.3.0
// @description  Scans the chat transcript and checks all cv+delete+undelete+reopen+dupe requests and SD, FireAlarm, Queen, etc. reports for status, then moves the completed or expired ones.
// @author       @TinyGiant @rene @Tunaki @Makyen
// @updateURL    https://github.com/SO-Close-Vote-Reviewers/UserScripts/raw/master/CVRequestArchiver.user.js
// @downloadURL  https://github.com/SO-Close-Vote-Reviewers/UserScripts/raw/master/CVRequestArchiver.user.js
// @include      /https?:\/\/chat(\.meta)?\.stack(overflow|exchange).com\/(rooms|search|transcript|users)(\/|\?).*/
// @grant        none
// ==/UserScript==
/* jshint -W097 */
/* jshint jquery:    true */
/* jshint forin:     false */
/* jshint curly:     false */
/* jshint browser:   true */
/* jshint devel:     true */
/* jshint esversion: 6 */
/* jshint esnext: true */
/* globals CHAT, $, jQuery */ //eslint-disable-line no-redeclare

(function() {
    'use strict';

    const lsPrefix = 'SOCVR-Archiver-'; //prefix to avoid clashes in localStorage
    const getStorage = (key) => localStorage[lsPrefix + key];
    const setStorage = (key, val) => (localStorage[lsPrefix + key] = val);
    const setStorageJSON = (key, val) => (localStorage[lsPrefix + key] = JSON.stringify(val));

    function getStorageJSON(key) {
        const storageValue = getStorage(key);
        try {
            return JSON.parse(storageValue);
        } catch (e) {
            //Storage is not valid JSON
            return null;
        }
    }
    //Don't run in iframes
    if (window !== window.top) {
        return false;
    }
    let room;
    let me;
    let isChat = false;
    const isSearch = /^\/+search/.test(window.location.pathname);
    const isTranscript = /^\/+transcript\//.test(window.location.pathname);
    const isUsersPage = /^\/+users\//.test(window.location.pathname);
    const fkey = getFkey();

    function getFkey() {
        const fkeyFromFunction = window.fkey()?.fkey;
        if (fkeyFromFunction && typeof fkeyFromFunction === 'string') {
            return fkeyFromFunction;
        } //else

        //Try to get the fkey from the HTML. If not available, then get it from storage.
        const $fkey = $('#fkey');
        let alternateFkey = null;
        if (isSearch || isUsersPage) {
            //#fkey is not available in search and user pages, but is returned as a property value from window.fkey().
            alternateFkey = getStorage('fkey');
        } else {
            if (!$fkey.length) {
                return null;
            }
            alternateFkey = $fkey.val();
        }
        if (!alternateFkey) {
            return null;
        }
        return alternateFkey;
    }
    setStorage('fkey', fkey);

    function startup() {
        if (typeof $ !== 'function') {
            //jQuery doesn't exist yet. Try again later.
            //Should put a limit on the number of times this is retried.
            setTimeout(startup, 250);
            return;
        }
        room = (/(?:chat(?:\.meta)?\.stack(?:overflow|exchange).com)\/rooms\/(\d+)/.exec(window.location.href) || [false, false])[1];
        isChat = !!room;
        if (isSearch) {
            room = (/^.*\broom=(\d+)\b.*$/i.exec(window.location.search) || [false, false])[1];
        }
        if (isTranscript) {
            const roomNameLink = $('#sidebar-content .room-mini .room-mini-header .room-name a');
            if (roomNameLink.length) {
                room = (/^(?:https?:)?(?:\/\/chat(?:\.meta)?\.stack(?:overflow|exchange)\.com)?\/rooms\/(\d+)/.exec(roomNameLink[0].href) || [false, false])[1];
            }
        }
        room = +room;
        if (!room && !isUsersPage && !isSearch) {
            return false;
        }

        me = (/\d+/.exec($('#active-user').attr('class')) || [false])[0];
        //Get me from localStorage. (transcript doesn't contain who you are).
        me = me ? me : getStorage('me');
        if (!me) {
            return false;
        }
        //Save me in localStorage.
        setStorage('me', me);

        if (isUsersPage || (isSearch && !room)) {
            //On user pages, we don't test for being the RO/mod.
            cvRequestArchiver();
            return;
        }

        getUserInfoInRoom(room, me).done(cvRequestArchiver);
    }

    function getUserInfoInRoom(inRoom, user) {
        return $.ajax({
            type: 'POST',
            url: '/user/info?ids=' + user + '&roomId=' + inRoom,
        });
    }

    function cvRequestArchiver(info) {
        const roRooms = getStorageJSON('roRooms') || {};
        let isModerator = false;
        setIsModeratorRoRoomsByInfo(room, info);
        if (!(isUsersPage || (isSearch && !room)) && !info.users[0].is_owner && !info.users[0].is_moderator) {
            return false;
        }

        let totalEventsToFetch = 0;
        let requests = [];
        let messagesToMove = [];
        let events = [];
        let eventsByNum = {};
        //A location to store the last room in which a message was which was added to the manual move list.
        //  This is really a hack that will work most of the time. What should really be done here is record
        //  the room that each message is in and move them separately by room.
        //  Looks like if they are not all from the same room, but at least one is in the declared move-from room
        //  then it will move the ones that are in the declared room and silently fail on those that are in any
        //  other rooms.
        let roomForMostRecentlyAddedManualMove = getStorage('roomForMostRecentlyAddedManualMove') || 0;

        const nodes = {};
        let avatarList = getStorageJSON('avatarList') || {};
        const $body = $(document.body);
        const nKButtonEntriesToScan = 3000;
        const soChat = 'chat.stackoverflow.com';
        const seChat = 'chat.stackexchange.com';
        const mseChat = 'chat.meta.stackexchange.com';
        //User ID's are different on the 3 separate Chat servers.
        //  If a user ID is not defined here for a particular server, then the RequestTypes which use it will not perform that portion of the testing for that
        //  request type. This could result in erroneous operation.
        const knownUserIdsByChatSite = {
            [soChat]: {
                fireAlarm: 6373379,
                smokeDetector: 3735529,
                queen: 6294609,
                fox9000: 3671802,
                yam: 5285668,
                panta: 1413395,
            },
            [seChat]: {
                fireAlarm: 212669,
                smokeDetector: 120914,
                queen: null, //No account found
                fox9000: 118010,
                yam: 323209,
                panta: 141258,
            },
            [mseChat]: {
                fireAlarm: 330041,
                smokeDetector: 266345,
                queen: null, //No account found
                fox9000: 261079,
                yam: 278816,
                panta: 186472,
            },
        };
        const parser = new DOMParser();
        let replyNode = $();

        //Define Target Room Sets

        //const trashcanEmoji = String.fromCodePoint(0x1F5D1) + String.fromCodePoint(0xFE0F);
        const trashcanEmoji = String.fromCodePoint(0x1F5D1);
        function TargetRoom(_roomNumber, _chatServer, _fullName, _shortName, _displayed, _classInfo, _options) {
            //A class for target rooms.
            _options = (typeof _options === 'object' && _options !== null) ? _options : {};
            this.roomNumber = _roomNumber;
            this.chatServer = _chatServer;
            this.fullName = _fullName;
            this.shortName = _shortName;
            this.displayed = _displayed;
            this.classInfo = _classInfo;
            this.showAsTarget = _options.showAsTarget;
            this.showMeta = _options.showMeta;
            this.showDeleted = _options.showDeleted;
            this.showUI = _options.showUI;
        }

        function makeRoomsByNumberObject(roomArray) {
            return roomArray.reduce((obj, roomObj) => {
                obj[roomObj.roomNumber] = roomObj;
                return obj;
            }, {});
        }

        const commonRoomOptions = {
            allTrue: {showAsTarget: true, showMeta: true, showDeleted: true, showUI: true},
            notTarget: {showAsTarget: false, showMeta: true, showDeleted: true, showUI: true},
            targetAndDeleted: {showAsTarget: true, showMeta: false, showDeleted: true, showUI: false},
            noUI: {showAsTarget: true, showMeta: true, showDeleted: true, showUI: false},
            onlyDeleted: {showAsTarget: false, showMeta: false, showDeleted: true, showUI: false},
        };
        const soChatScanning = {
            //On Chat.SO the following are the same for all room sets.
            //The following properties are needed to have the archiver semi-automatically scan for messages to archive.
            mainSite: 'stackoverflow.com',
            mainSiteSEApiParam: 'stackoverflow', //How to identify the main site to the SE API.
            mainSiteRegExpText: 'stackoverflow\\.com',
            regExp: {
                //Various other RegExp are constructed and added to this list.
                //chatMetaElimiation is used to remove chat and meta from detection by the RegExp looking for links to the main site.
                //  The meta site is most important here. This is used due to the lack of look-behind in JavaScript RegExp.
                chatMetaElimiation: /(?:meta|chat)\.stackoverflow\.com\/?/g,
            },
        };
        const targetRoomSets = [

            //SO CHAT

            {//SOCVR
                name: 'SOCVR',
                primeRoom: 41570,
                chatServer: soChat,
                defaultTargetRoom: 90230,
                rooms: makeRoomsByNumberObject([
                    //SOCVR
                    new TargetRoom(41570, soChat, 'SOCVR', 'SOCVR', 'S', 'SOCVR', commonRoomOptions.allTrue),
                    //Graveyard
                    new TargetRoom(90230, soChat, 'SOCVR Request Graveyard', 'Graveyard', 'G', 'Grave', commonRoomOptions.allTrue),
                    //SOCVR /dev/null
                    new TargetRoom(126195, soChat, 'SOCVR /dev/null', 'Null', 'N', 'Null', commonRoomOptions.allTrue),
                    //Testing Facility
                    new TargetRoom(68414, soChat, 'SOCVR Testing Facility', 'Testing', 'Te', 'Test', commonRoomOptions.allTrue),
                    //The Ministry of Silly Hats
                    //The "М" in 'Мinistry' is not actual capital M to have the Ministry sorted to the end of the room order.
                    new TargetRoom(92764, soChat, 'The Ministry of Silly Hats', 'Мinistry', 'M', 'Minist', commonRoomOptions.noUI),
                    //Private for SD posts that have especially offensive content.
                    new TargetRoom(170175, soChat, 'Private Trash', 'Private', 'P', 'Private', commonRoomOptions.noUI),
                ]),
                //Semi-auto scanning:
                //On Chat.SO, many of the properties are common for all rooms. Those are in soChatScanning. However,
                //  includedRequestTypes and excludedRequestTypes may vary per room.
                //An optional list of RequestTypes keys (String). If it exists, only the listed RequestTypes are included.
                //includedRequestTypes: [],
                //An optional list of RequestTypes keys (String). If it exists, these are excluded from RequestTypes used.
                //  The exclusion happens after inclusion, so keys listed here will not be included even if in includedRequestTypes.
                excludedRequestTypes: [
                ],
                useCrudeRequestTypes: false,
            },
            {//SOBotics
                name: 'SOBotics',
                primeRoom: 111347,
                chatServer: soChat,
                defaultTargetRoom: 170175,
                rooms: makeRoomsByNumberObject([
                    //SOBotics
                    new TargetRoom(111347, soChat, 'SOBotics', 'Botics', 'B', 'Bot', commonRoomOptions.noUI),
                    //Private for SD posts that have especially offensive content.
                    new TargetRoom(170175, soChat, 'Private Trash', 'Private', 'P', 'Private', commonRoomOptions.noUI),
                    //Trash can
                    new TargetRoom(23262, soChat, 'Trash can', 'Trash', trashcanEmoji, 'Trash', commonRoomOptions.noUI),
                ]),
            },
            {//Python
                name: 'Python',
                primeRoom: 6,
                chatServer: soChat,
                defaultTargetRoom: 71097,
                rooms: makeRoomsByNumberObject([
                    //SOBotics
                    new TargetRoom(6, soChat, 'Python', 'Python', 'P', 'Py', commonRoomOptions.noUI),
                    //Python Ouroboros - The Rotating Knives: The Python room's default trash bin.
                    new TargetRoom(71097, soChat, 'Python Ouroboros - The Rotating Knives', 'Ouroboros', 'O', 'Ouroboros', commonRoomOptions.noUI),
                    //Private for SD posts that have especially offensive content.
                    new TargetRoom(170175, soChat, 'Private Trash', 'Private', 'T', 'Private', commonRoomOptions.noUI),
                    //Trash can
                    new TargetRoom(23262, soChat, 'Trash can', 'Trash', trashcanEmoji, 'Trash', commonRoomOptions.noUI),
                ]),
            },
            {//SO Chat Default
                name: 'SO Chat Default',
                primeRoom: 99999999,
                chatServer: soChat,
                isSiteDefault: true,
                defaultTargetRoom: 23262,
                rooms: makeRoomsByNumberObject([
                    //Trash can
                    new TargetRoom(23262, soChat, 'Trash can', 'Trash', trashcanEmoji, 'Trash', commonRoomOptions.noUI),
                    new TargetRoom(109494, soChat, 'friendly bin', 'friendly', 'f', 'friendly', commonRoomOptions.noUI),
                ]),
            },


            //SE CHAT

            {//Charcoal HQ
                name: 'Charcoal HQ',
                primeRoom: 11540,
                chatServer: seChat,
                defaultTargetRoom: 82806,
                rooms: makeRoomsByNumberObject([
                    //Charcoal HQ
                    new TargetRoom(11540, seChat, 'Charcoal HQ', 'Charcoal', 'C', 'CHQ', commonRoomOptions.noUI),
                    //Charcoal Test
                    new TargetRoom(65945, seChat, 'Charcoal Test', 'Test', 'CT', 'Test', commonRoomOptions.noUI),
                    //Trash
                    new TargetRoom(82806, seChat, 'Trash (room 82806)', 'Trash', 'Tr', 'Trash 82', commonRoomOptions.noUI),
                    //Trash
                    new TargetRoom(19718, seChat, 'Trash (room 19718: requires access)', 'Trash', 'T', 'Trash 19', commonRoomOptions.noUI),
                    //trash
                    //Room is frozen
                    //new TargetRoom(57121, seChat, 'trash (room 57121)', 'trash', 't', 'trash 57', commonRoomOptions.noUI),
                    //Private for SD posts that have especially offensive content.
                    new TargetRoom(658, seChat, 'Private Trash (Trashcan; mod-private; room 658)', 'Private', 'P', 'Private', commonRoomOptions.noUI),
                ]),
            },
            {//CRCQR
                name: 'CRCQR',
                primeRoom: 85306,
                chatServer: seChat,
                defaultTargetRoom: 86076,
                rooms: makeRoomsByNumberObject([
                    //CRCQR
                    new TargetRoom(85306, soChat, 'CRCQR', 'CRCQR', 'C', 'CRCQR', commonRoomOptions.allTrue),
                    //CRCQR Graveyard
                    new TargetRoom(86076, soChat, 'CRCQR Request Graveyard', 'Graveyard', 'G', 'Grave', commonRoomOptions.allTrue),
                    //CRCQR /dev/null
                    new TargetRoom(86077, soChat, 'CRCQR /dev/null', 'Null', 'N', 'Null', commonRoomOptions.allTrue),
                    //Private for SD posts that have especially offensive content.
                    new TargetRoom(658, seChat, 'Private Trash (Trashcan)', 'Private', 'P', 'Private', commonRoomOptions.noUI),
                ]),
                //Semi-auto scanning:
                //The following properties are needed to have the archiver semi-automatically scan for messages to archive.
                mainSite: 'codereview.stackexchange.com',
                mainSiteSEApiParam: 'codereview', //How to identify the main site to the SE API.
                mainSiteRegExpText: 'codereview\\.stackexchange\\.com',
                regExp: {
                    //Various other RegExp are constructed and added to this list.
                    //chatMetaElimiation is used to remove chat and meta from detection by the RegExp looking for links to the main site.
                    //  The meta site is most important here. This is used due to the lack of look-behind in JavaScript RegExp.
                    chatMetaElimiation: /meta\.codereview\.stackexchange\.com\/?/g, //This is the old meta domain, but is considered an alias by SE.
                },
                //An optional list of RequestTypes keys (String). If it exists, only the listed RequestTypes are included.
                //includedRequestTypes: [],
                //An optional list of RequestTypes keys (String). If it exists, these are excluded from RequestTypes used.
                //  The exclusion happens after inclusion, so keys listed here will not be included even if in includedRequestTypes.
                excludedRequestTypes: [
                ],
                useCrudeRequestTypes: false,
            },
            {//CRUDE
                name: 'CRUDE',
                primeRoom: 2165,
                chatServer: seChat,
                defaultTargetRoom: 88696,
                rooms: makeRoomsByNumberObject([
                    //CRUDE
                    new TargetRoom(2165, soChat, 'CRUDE', 'CRUDE', 'C', 'CRUDE', commonRoomOptions.allTrue),
                    //CRUDE Archive
                    new TargetRoom(88696, soChat, 'CRUDE Archive', 'Archive', 'A', 'Archive', commonRoomOptions.allTrue),
                    //Trash
                    new TargetRoom(82806, seChat, 'Trash (room 82806)', 'Trash', 'Tr', 'Trash 82', commonRoomOptions.noUI),
                    //Private for SD posts that have especially offensive content.
                    new TargetRoom(658, seChat, 'Private Trash (Trashcan)', 'Private', 'P', 'Private', commonRoomOptions.noUI),
                ]),
                //Semi-auto scanning:
                //The following properties are needed to have the archiver semi-automatically scan for messages to archive.
                mainSite: 'math.stackexchange.com',
                mainSiteSEApiParam: 'math', //How to identify the main site to the SE API.
                mainSiteRegExpText: 'math\\.stackexchange\\.com',
                regExp: {
                    //Various other RegExp are constructed and added to this list.
                    //chatMetaElimiation is used to remove chat and meta from detection by the RegExp looking for links to the main site.
                    //  The meta site is most important here. This is used due to the lack of look-behind in JavaScript RegExp.
                    chatMetaElimiation: /meta\.math\.stackexchange\.com\/?/g, //This is the old meta domain, but is considered an alias by SE.
                },
                //An optional list of RequestTypes keys (String). If it exists, only the listed RequestTypes are included.
                //includedRequestTypes: [],
                //An optional list of RequestTypes keys (String). If it exists, these are excluded from RequestTypes used.
                //  The exclusion happens after inclusion, so keys listed here will not be included even if in includedRequestTypes.
                excludedRequestTypes: [
                ],
                useCrudeRequestTypes: true,
            },
            {//SE Chat Default
                name: 'SE Chat Default',
                primeRoom: 99999999,
                chatServer: seChat,
                isSiteDefault: true,
                defaultTargetRoom: 19718,
                rooms: makeRoomsByNumberObject([
                    //Trash
                    new TargetRoom(19718, soChat, 'Trash (room 19718: requires access)', 'Trash', trashcanEmoji, 'Trash', commonRoomOptions.noUI), //User must have access.
                    //Trash
                    new TargetRoom(82806, seChat, 'Trash (room 82806)', 'Trash', 'Tr', 'Trash 82', commonRoomOptions.noUI),
                    //Private trash.
                    new TargetRoom(658, seChat, 'Private Trash (Trashcan; mod-private; room 658)', 'Private', 'P', 'Private', commonRoomOptions.noUI),
                ]),
            },

            //MSE CHAT

            {//Tavern on the Meta
                name: 'Tavern on the Meta',
                primeRoom: 89,
                chatServer: mseChat,
                defaultTargetRoom: 1037,
                rooms: makeRoomsByNumberObject([
                    //Tavern on the Meta
                    new TargetRoom(89, mseChat, 'Tavern on the Meta', 'Tavern', 'Ta', 'Tavern', commonRoomOptions.allTrue),
                    //Chimney
                    new TargetRoom(1037, mseChat, 'Chimney', 'Chimney', 'C', 'Chimney', commonRoomOptions.allTrue),
                    //Sandbox/Trash Bin/Something
                    new TargetRoom(1196, mseChat, 'Sandbox/Trash Bin/Something', 'Something', 'S', 'Something', commonRoomOptions.noUI),
                    //Trashcan
                    new TargetRoom(1251, mseChat, 'Trashcan', 'Trashcan', 'Tr', 'Trashcan', commonRoomOptions.noUI),
                ]),
                //Semi-auto scanning:
                //The following properties are needed to have the archiver semi-automatically scan for messages to archive.
                mainSite: 'meta.stackexchange.com',
                mainSiteSEApiParam: 'meta', //How to identify the main site to the SE API.
                mainSiteRegExpText: 'meta\\.stackexchange\\.com',
                regExp: {
                    //Various other RegExp are constructed and added to this list.
                    //chatMetaElimiation is used to remove chat and meta from detection by the RegExp looking for links to the main site.
                    //  This is used due to the lack of look-behind in JavaScript RegExp.
                    chatMetaElimiation: /chat\.meta\.stackexchange\.com\/?/g, //This is the chat domain.
                },
                //An optional list of RequestTypes keys (String). If it exists, only the listed RequestTypes are included.
                //includedRequestTypes: [],
                //An optional list of RequestTypes keys (String). If it exists, these are excluded from RequestTypes used.
                //  The exclusion happens after inclusion, so keys listed here will not be included even if in includedRequestTypes.
                excludedRequestTypes: [
                ],
                useCrudeRequestTypes: false,
            },
            {//Meta SE Chat Default
                name: 'Meta SE Chat Default',
                primeRoom: 99999999,
                chatServer: mseChat,
                isSiteDefault: true,
                defaultTargetRoom: 19718,
                rooms: makeRoomsByNumberObject([
                    //Sandbox/Trash Bin/Something
                    new TargetRoom(1196, mseChat, 'Sandbox/Trash Bin/Something', 'Something', trashcanEmoji, 'Something', commonRoomOptions.noUI),
                ]),
            },
        ];
        targetRoomSets.forEach((roomSet) => {
            if (roomSet.chatServer === soChat) {
                Object.assign(roomSet, soChatScanning);
            }
        });
        const defaultDisabledTargetRoomSet = {
            primeRoom: 999999998,
            chatServer: window.location.hostname,
            defaultTargetRoom: 999999999,
            rooms: makeRoomsByNumberObject([
                //Nowhere
                new TargetRoom(999999998, window.location.hostname, 'Disabled', 'Disabled', 'D', 'Disabled', commonRoomOptions.onlyDeleted),
                new TargetRoom(999999999, window.location.hostname, 'Disabled', 'Disabled', 'D', 'Disabled', commonRoomOptions.onlyDeleted),
            ]),
        };
        const siteTargetRoomSets = targetRoomSets.filter(({chatServer}) => chatServer === window.location.hostname);

        // Determine the set of target rooms to use.
        const targetRoomSet = (siteTargetRoomSets.find((roomSet) => roomSet.rooms[room]) || siteTargetRoomSets.find(({isSiteDefault}) => isSiteDefault) || defaultDisabledTargetRoomSet);
        const defaultTargetRoom = targetRoomSet.defaultTargetRoom;
        const siteAllRooms = {};
        //Reversing the order here gives priority to sets listed first, due to potentially overwriting an entry in siteAllRooms.
        siteTargetRoomSets.reverse().forEach((roomSet) => {
            roomSet.roomsOrder = Object.keys(roomSet.rooms).sort((a, b) => roomSet.rooms[a].shortName > roomSet.rooms[b].shortName);
            const setRoomsOrder = roomSet.roomsOrder;
            const setRoomsOrderOnlyTargets = setRoomsOrder.filter((key) => roomSet.rooms[key].showAsTarget);
            setRoomsOrder.forEach((roomTarget) => {
                const roomOrderWithoutCurrent = setRoomsOrderOnlyTargets.filter((key) => +key !== +roomTarget);
                roomSet.rooms[roomTarget].metaHTML = makeMetaRoomTargetsHtmlByOrderAndRooms(roomOrderWithoutCurrent, roomSet.rooms);
                siteAllRooms[roomTarget] = roomSet.rooms[roomTarget];
            });
        });
        //Undo in-place reversal.
        siteTargetRoomSets.reverse();

        //Save the default target prior to it, potentially, being deleted.
        const targetRoomsByRoomNumber = (isUsersPage || (isSearch && !room)) ? siteAllRooms : targetRoomSet.rooms;
        const defaultTargetRoomObject = targetRoomsByRoomNumber[defaultTargetRoom];
        //Save the current room prior to deleting it as a target.
        const currentRoomTargetInfo = targetRoomsByRoomNumber[room] || new TargetRoom(room, window.location.hostname, 'Default', 'Default', 'D', 'Default', commonRoomOptions.noUI);
        //The current room is not a valid room target.
        delete targetRoomsByRoomNumber[room];
        //Remove any group rooms which are not to be used as a target.
        Object.keys(targetRoomsByRoomNumber).forEach((key) => {
            if (!targetRoomsByRoomNumber[key].showAsTarget) {
                delete targetRoomsByRoomNumber[key];
            }
        });
        //The order in which we want to display the controls. As it happens, an alpha-sort based on shortName works well.
        const targetRoomsByRoomNumberOrder = Object.keys(targetRoomsByRoomNumber).sort((a, b) => targetRoomsByRoomNumber[a].shortName > targetRoomsByRoomNumber[b].shortName);
        const knownUserIds = knownUserIdsByChatSite[targetRoomSet.chatServer];
        if (targetRoomSet.regExp) {
            //Match and capture the ID for questions, answers, and posts URLs.
            //e.g. /stackoverflow\.com\/(?:q[^\/]*|posts|a[^\/]*)\/+(\d+)/g
            targetRoomSet.regExp.questionAnswerPostsId = new RegExp(`${targetRoomSet.mainSiteRegExpText}/(?:q[^/]*|posts|a[^/]*)/+(\\d+)`, 'g');
            //The above will preferentially obtain questions over some answer URL formats: e.g.
            //    https://stackoverflow.com/questions/7654321/foo-my-baz/1234567#1234567
            //  That's good for cv-pls/reopen-pls, but for other types of requests we should be considering the answer instead, if the URL is the alternate answer URL.
            //e.g. /(?:^|[\s"'])(?:(?:https?:)?(?:(?:\/\/)?(?:www\.|\/\/)?stackoverflow\.com\/))(?:q[^\/]*|posts)[^\s#]*#(\d+)(?:$|[\s"'])/g
            targetRoomSet.regExp.answerIdFromQuestionUrl = new RegExp(`(?:^|[\\s\"\'])(?:(?:https?:)?(?:(?://)?(?:www\\.|//)?${targetRoomSet.mainSiteRegExpText}/))(?:q[^/]*|posts)[^\\s#]*#(\\d+)(?:$|[\\s"'])`, 'g'); // eslint-disable-line no-useless-escape
            //Detect a comment URL
            //e.g. /(?:^|[\s"'])(?:(?:https?:)?(?:(?:\/\/)?(?:www\.|\/\/)?stackoverflow\.com\/))(?:q[^\/]*|posts|a)[^\s#]*#comment(\d+)(?:$|[\s"'_])/g
            targetRoomSet.regExp.commentIdFromUrl = new RegExp(`(?:^|[\\s\"\'])(?:(?:https?:)?(?:(?://)?(?:www\\.|//)?${targetRoomSet.mainSiteRegExpText}/))(?:q[^/]*|posts|a)[^\\s#]*#comment(\\d+)(?:$|[\\s\"\'_])`, 'g'); // eslint-disable-line no-useless-escape
        }

        //The UI doesn't currently function on sites other than chat.SO.
        const roomGroupStringPropertyKeysRequiredForUI = [
            'mainSite',
            'mainSiteSEApiParam',
            'mainSiteRegExpText',
        ];
        const roomGroupRegExpPropertyKeysRequiredForUI = [
            'chatMetaElimiation',
            'questionAnswerPostsId',
            'answerIdFromQuestionUrl',
            'commentIdFromUrl',
        ];
        //Only show the UI if the target room specifies it, it's chat and enough information exists and is minimally valid.
        const showUI = currentRoomTargetInfo.showUI && isChat && targetRoomSet.regExp &&
            roomGroupStringPropertyKeysRequiredForUI.every((key) => typeof targetRoomSet[key] === 'string') &&
            roomGroupRegExpPropertyKeysRequiredForUI.every((key) => targetRoomSet.regExp[key] instanceof RegExp);
        const showDeleted = currentRoomTargetInfo.showDeleted;
        const showMeta = currentRoomTargetInfo.showMeta || isUsersPage || (isSearch && !room);
        const addedMetaHtml = makeMetaRoomTargetsHtml();
        if (isUsersPage || (isSearch && !room)) {
            //There is no set room, so want to make sure we have user info for at least all the
            //  rooms for which we have in a room target set for this chatServer.
            const additionalUserInfoFetches = [];
            Object.keys(siteAllRooms).forEach((roomId, index) => {
                if (typeof roRooms[roomId] !== 'boolean') {
                    additionalUserInfoFetches.push(delay(index * 500).then(() => getUserInfoInRoom(roomId, me)).then((userInfo) => {
                        setIsModeratorRoRoomsByInfo(roomId, userInfo, true);
                    }));
                }
            });
            if (additionalUserInfoFetches.length) {
                //jQuery.when is broken and does not work here. It immediately resolves,
                //  not waiting for the for the Promises to resolve.
                //jQuery.when.apply(jQuery, additionalUserInfoFetches).then(() => {
                Promise.all(additionalUserInfoFetches).then(() => {
                    addMoveToInMeta();
                });
            }
        }

        const SECONDS_IN_MINUTE = 60;
        const SECONDS_IN_HOUR = 60 * SECONDS_IN_MINUTE;
        const SECONDS_IN_DAY = 24 * SECONDS_IN_HOUR;
        const timezoneOffsetMs = (new Date()).getTimezoneOffset() * SECONDS_IN_MINUTE * 1000;
        //The SE Chat endpoint supports movePosts with up to 2048 messages.
        //  However, when the chunk size is larger than 100 it causes the chat interface to not properly
        //  delete moved messages from the chat display. Thus, the chunk size is kept at < 100 for moves of displayed messages.
        //  The size used is 100 for messages which would be  still visible in the most recent chat instance for the user,
        //  then 2048 for the rest. The minimal number of moves is performed.
        //  Some messages are not moved (those without a user_id), as they cause an API error.
        const bigChunkSize = 2048; //CHAT API movePosts maximum is 2048, higher numbers result in "Internal Server Error".
        const smallChunkSize = 100;
        const unclosedRequestReviewerButtons = $('.urrs-requests-button');

        // REQUEST TYPES

        /* Example request text:
            <a href="//stackoverflow.com/questions/tagged/cv-pls"><span class="ob-post-tag" style="background-color: #E0EAF1; color: #3E6D8E; border-color: #3E6D8E; border-style: solid;">cv-pls</span></a> <a href="//stackoverflow.com/questions/tagged/entity-framework"><span class="ob-post-tag" style="background-color: #E0EAF1; color: #3E6D8E; border-color: #3E6D8E; border-style: solid;">entity-framework</span></a> Unclear (&quot;I get error&quot;-type of question) https://stackoverflow.com/q/46022628/861716
         */
        //People can really mangle the -pls portion of the request. The RegExp has a known terminating character for the tag:
        // " for matching the href URL and ] for plain text.
        //Match if they get at least 2 characters of pls, just pl, or 1 extra character
        const please = '(?:pl(?:ease|s|z)|p.?[sz]|.l[sz]|pl.?|.pl[sz]|p.l[sz]|pl.[sz]|pl[sz].)';
        const hrefUrlTag = '(?:tagged\\/';
        const endHrefToPlainText = '"|\\[(?:(?:meta-)?tag\\W?)?';

        const endPlainTextToEndWithQuestion = `\\]).*?${targetRoomSet.mainSiteRegExpText}\\/(?:[qa][^\\/]*|posts)\\/+(\\d+)`;
        const questionUrlToHrefTag = `${targetRoomSet.mainSiteRegExpText}\\/(?:[qa][^\\/]*|posts)\\/+(\\d+).*(?:tagged\\/`;
        const endPlainTextToEndWithQuestionOrReview = `\\]).*?${targetRoomSet.mainSiteRegExpText}\\/(?:[qa][^\\/]*|posts|review\\/[\\w-]+)\\/+(\\d+)`;
        const questionOrReviewUrlToHrefTag = `${targetRoomSet.mainSiteRegExpText}\\/(?:[qa][^\\/]*|posts|review\\/[\\w-]+)\\/+(\\d+).*(?:tagged\\/`;

        const endPlainTextToEnd = '\\])';
        const endHrefPrefixToSpanText = '[^>]*><span[^>]*>';
        const endSpanTextToPlainText = '<\\/span>|\\[(?:(?:meta-)?tag\\W?)?';

        function makeTagRegExArray(prefix, additional, includeReviews) {
            prefix = typeof prefix === 'string' ? prefix : '';
            additional = typeof additional === 'string' ? additional : '';
            //We have multiple RegExp for each tag type. We are always checking all of them for any match. Thus, this is equivalent
            //  to using a single RegExp that is /(?:RegExp text1|RegExp text2|RegExp text3|RegExp text4)/. Testing against a single
            //  RegExp should be faster than 4.
            const regexText = '(?:' + ([
                //Tag before question
                (hrefUrlTag + prefix + additional + endHrefToPlainText + prefix + additional + (includeReviews ? endPlainTextToEndWithQuestionOrReview : endPlainTextToEndWithQuestion)),
                //Tag after question
                ((includeReviews ? questionOrReviewUrlToHrefTag : questionUrlToHrefTag) + prefix + additional + endHrefToPlainText + prefix + additional + endPlainTextToEnd),
                //Tag before question: match tag in the <span>, not in the href (which could be encoded)
                (hrefUrlTag + prefix + endHrefPrefixToSpanText + prefix + additional + endSpanTextToPlainText + prefix + additional + (includeReviews ? endPlainTextToEndWithQuestionOrReview : endPlainTextToEndWithQuestion)),
                //Tag after question: match tag in the <span>, not in the href (which could be encoded)
                ((includeReviews ? questionOrReviewUrlToHrefTag : questionUrlToHrefTag) + prefix + endHrefPrefixToSpanText + prefix + additional + endSpanTextToPlainText + prefix + additional + endPlainTextToEnd),
            ].join('|')) + ')';
            return [new RegExp(regexText, 'i')];
            //Example produced from cv-pls (excludes the dup request types added to cvRegexes):
            //2019-08-23: https://regex101.com/r/VbNPrg/1
            //(?:(?:tagged\/(?:cv|closev?)-?(?:pl(?:ease|s|z)|p.?[sz]|.l[sz]|pl.?|.pl[sz]|p.l[sz]|pl.[sz]|pl[sz].)"|\[(?:(?:meta-)?tag\W?)?(?:cv|closev?)-?(?:pl(?:ease|s|z)|p.?[sz]|.l[sz]|pl.?|.pl[sz]|p.l[sz]|pl.[sz]|pl[sz].)\]).*?stackoverflow\.com\/(?:[qa][^\/]*|posts)\/+(\d+)|stackoverflow\.com\/(?:[qa][^\/]*|posts)\/+(\d+).*(?:tagged\/(?:cv|closev?)-?(?:pl(?:ease|s|z)|p.?[sz]|.l[sz]|pl.?|.pl[sz]|p.l[sz]|pl.[sz]|pl[sz].)"|\[(?:(?:meta-)?tag\W?)?(?:cv|closev?)-?(?:pl(?:ease|s|z)|p.?[sz]|.l[sz]|pl.?|.pl[sz]|p.l[sz]|pl.[sz]|pl[sz].)\])|(?:tagged\/(?:cv|closev?)-?[^>]*><span[^>]*>(?:cv|closev?)-?(?:pl(?:ease|s|z)|p.?[sz]|.l[sz]|pl.?|.pl[sz]|p.l[sz]|pl.[sz]|pl[sz].)<\/span>|\[(?:(?:meta-)?tag\W?)?(?:cv|closev?)-?(?:pl(?:ease|s|z)|p.?[sz]|.l[sz]|pl.?|.pl[sz]|p.l[sz]|pl.[sz]|pl[sz].)\]).*?stackoverflow\.com\/(?:[qa][^\/]*|posts)\/+(\d+)|stackoverflow\.com\/(?:[qa][^\/]*|posts)\/+(\d+).*(?:tagged\/(?:cv|closev?)-?[^>]*><span[^>]*>(?:cv|closev?)-?(?:pl(?:ease|s|z)|p.?[sz]|.l[sz]|pl.?|.pl[sz]|p.l[sz]|pl.[sz]|pl[sz].)<\/span>|\[(?:(?:meta-)?tag\W?)?(?:cv|closev?)-?(?:pl(?:ease|s|z)|p.?[sz]|.l[sz]|pl.?|.pl[sz]|p.l[sz]|pl.[sz]|pl[sz].)\]))/i
        }

        function makeActualTagWithoutQuestionmarkRegExArray(prefix, additional) {
            prefix = typeof prefix === 'string' ? prefix : '';
            additional = typeof additional === 'string' ? additional : '';
            const regexText = '(?:' + ([
                //https://regex101.com/r/akgdVi/2
                '<span class="ob-post-tag"[^>]*>' + prefix + additional + '<\\/span><\\/a>\\s*(?![\\w ]*\\?)',
            ].join('|')) + ')';
            return [new RegExp(regexText, 'i')];
        }

        const cvRegexes = makeTagRegExArray('(?:cv|closev?)-?', please).concat(makeTagRegExArray('(?:dup(?:licate)?)-?', please), makeTagRegExArray('(?:dup(?:licate)?)-?'));
        const deleteRegexes = makeTagRegExArray('d(?:el(?:ete|etion)?)?(?:v)?-?(?:vote)?-?', please);
        const undeleteRegexes = makeTagRegExArray('un-?del(?:ete|etion)?(?:v)?-?(?:vote)?(?:-?answers?|-?questions?)?-?', please);
        const reopenRegexes = makeTagRegExArray('(?:re-?)?open-?', please);
        const duplicateRegexes = makeTagRegExArray('pos?sib(?:le|el)-dup(?:e|licate)?');
        const flagRegexes = makeTagRegExArray('(?:re-?)?flag-?', please);
        const flagAsTagRegexes = makeActualTagWithoutQuestionmarkRegExArray('(?:re-?)?flag-?', please);
        const spamRegexes = makeTagRegExArray('spam');
        const spamAsTagRegexes = makeActualTagWithoutQuestionmarkRegExArray('spam');
        const offensiveRegexes = makeTagRegExArray('(?:off?en[cs]ive|rude|abb?u[cs]ive)');
        const offensiveAsTagRegexes = makeActualTagWithoutQuestionmarkRegExArray('(?:off?en[cs]ive|rude|abb?u[cs]ive)');
        const approveRejectRegexes = makeTagRegExArray('(?:app?rove?|reject|rev[ie]+w)-?(?:edit-?)?', please, true);
        // FireAlarm reports
        const faRegexes = [
            /(?:\/\/stackapps\.com\/q\/7183\">FireAlarm(?:-Swift)?)/, // eslint-disable-line no-useless-escape
            /(?:\[ <a href="\/\/github\.com\/SOBotics\/FireAlarm\/tree\/swift" rel="nofollow noopener noreferrer">FireAlarm-Swift<\/a> \])/,
        ];
        //We need to choose if we want more SD commands to be archived.
        //We probably don't want to archive: (?!blame|lick|wut|coffee|tea|brownie)
        const sdBangBangCommandsRegEx = /^\s*!!\/(?:report|scan|feedback)/i;
        // https://regex101.com/r/3M6xoA/1/
        const sdFeedbacksRegEx = /^(?:@SmokeD?e?t?e?c?t?o?r?|\s*sd)(?:\s+\d*(?:k|v|n|naa|fp?|tp?|spam|rude|abus(?:iv)?e|offensive|v|vand|vandalism|notspam|true|false|ignore|del|delete|remove|gone|postgone|why\??|-)u?-?)+\s*.*$/i;
        const editMonitorRegEx = /bad edit/i;
        const crudeCloseRegexes = makeTagRegExArray('(?:cv|closev?)-?');
        const aHrefQAPRtag = `<a href=\"(?:https?:)?\/\/${targetRoomSet.mainSiteRegExpText}/(?:[qa][^/]*|posts|review/[\\w-]+)/+(\\d+)[^>]*>`;  // eslint-disable-line no-useless-escape
        const aHrefQAPRtagWithS = aHrefQAPRtag + '\\s*';
        const endOfCrudeXnRegex = '(?:\\d+|[a-z])(?:\\s*:\\s*</b>[^<]*)?</a>\\W*(?:<br/?>)?\\W*)+$';
        //The CRUDE Xn regexes are based off of:
        //  https://regex101.com/r/GHYTaY/1
        const crudeCloseCnRegexes = [
            new RegExp(`^\\s*(?:for\\W*)?(?:close|closure)?\\W*(?:\\s*${aHrefQAPRtagWithS}(?:<b>)?\\s*(?:c(?:lose)?)${endOfCrudeXnRegex}`, 'i'),  // eslint-disable-line no-useless-escape
        ];
        const crudeReopenRegexes = makeTagRegExArray('re-?openv?-?');
        const crudeReopenRnRegexes = [
            new RegExp(`^\\s*(?:for\\W*)?(?:reopen|unclose)?\\W*(?:\\s*${aHrefQAPRtagWithS}(?:<b>)?\\s*(?:r(?:eopen)?)${endOfCrudeXnRegex}`, 'i'),  // eslint-disable-line no-useless-escape
        ];
        const crudeDeleteRegexes = makeTagRegExArray('d(?:el(?:ete|etion)?)?(?:v)?-?(?:vote)?-?');
        const crudeDeleteDnRegexes = [
            new RegExp(`^\\s*(?:for\\W*)?(?:delete|deletion)?\\W*(?:\\s*${aHrefQAPRtagWithS}(?:<b>)?\\s*(?:d(?:el(?:ete)?)?)${endOfCrudeXnRegex}`, 'i'),  // eslint-disable-line no-useless-escape
        ];
        const crudeUndeleteRegexes = makeTagRegExArray('un?-?d(?:el(?:ete|etion)?)?(?:v)?-?(?:vote)?-?');
        const crudeUndeleteUnRegexes = [
            new RegExp(`^\\s*(?:for\\W*)?(?:undelete|undeletion)?\\W*(?:\\s*${aHrefQAPRtagWithS}(?:<b>)?\\s*(?:un?-?(?:del(?:ete)?)?)${endOfCrudeXnRegex}`, 'i'),  // eslint-disable-line no-useless-escape
        ];

        /* The RequestTypes Object contains definitions for the detections which are used to determine if a message should be archived.
           Each detection should be a separate key containing an Object which defines the detection. The keys within that Object define
           how messages are matched to the detection and what criteria must be met in order for the message to be archived.
           There are "primary" types of detections, which have some known criteria about the condition of the linked post/comment
           which must be met for them to be archived prior to their `alwaysArchiveAfterSeconds` time expiring. Those types are:
             DELETE: The post must be deleted (i.e. no data is received from the SE API).
             REOPEN: The question must be open.
             CLOSE: The question must be closed.
             UNDELETE: The post must not be deleted (i.e. we must get data from the SE API).
             FLAG_SPAM_OFFENSIVE
             APPROVE_REJECT
           Only primary types are permitted to be created by combining a reply with its parent.

           The available keys to describe a detection are:
                additionalRequestCompleteTests: Array of Function
                    An array of additional test functions which if any are passed, then the request is considered complete.
                alwaysArchiveAfterSeconds: Number
                    If the request was posted more than this many seconds ago, then it is considered complete. Very small fractional values can be used to always archive.
                andRegexes: Array of RegExp | RegExp
                    Additional RegExps which must also have a match. The RegExp are tested against the HTML with <code> removed.
                archiveParentWithThis: Boolean (truthy)
                    If true, then parents (messages to which these are a direct reply) are archived with the matching messages.
                archiveWithChildren: Boolean (truthy)
                    Archive this message when any direct response to it (it's children) are archived.
                archiveWithNextFromUserId: userId (Number)
                    Archive this message when the next message which was posted by a specified userId.
                archiveWithParent: Boolean (truthy)
                    Archive this message when the message to which it is a direct response (it's parent) is archived.
                archiveWithPreviousFromUserId: userId (Number)
                    Archive this message when the previous message which was posted by a specified userId.
                name: String
                    A human readable name for the type. This is not used in the code, but helps for debugging, as it's visible when viewing the type.
                noContent: Boolean (truthy)
                    Match if there is no content (i.e. post is deleted)
                onlyComments: Boolean (truthy)
                    The posts associated with this type can only point to comments.
                onlyQuestions: Boolean (truthy)
                    The posts associated with this type can only point to questions. Any URLs which include information about both the question
                    and an answer, a comment or an answer and a comment will be reduced the the question. This does not, currently, look for questions
                    associated with answers when only the answer is specified in the URL (e.g. //stackoverflow.com/a/123456)
                primary: Boolean (truthy)
                    This type is considered primary (not currently used, theses are manually defined, so there is a known order).
                regexes: Array of RegExp | RegExp
                    An Array of RegExp where at least one must match the HTML for the message content (as delivered by the API, but with text in <code> removed).
                replyToTypeKeys: Array of String
                    Matches if this is a reply to the specified type.
                textRegexes: Array of RegExp | RegExp
                    At least one of which must match the `.text()` content of the message with all <code> removed.
                underAgeTypeKey: String (a RequestTypes key)
                    When the message is under the "alwaysArchiveAfterSeconds", treat matching messages as if they were of the specified type.
                    The RequestTypes is specified as the type's key.
                userIdMatch: userId (Number)
                    Match if the message was posted by the specified userId.
         */
        const RequestTypes = {
            DELETE: {
                name: 'Delete',
                primary: true,
                regexes: deleteRegexes,
                alwaysArchiveAfterSeconds: 7 * SECONDS_IN_DAY, //7 days
            },
            REOPEN: {
                name: 'Reopen',
                primary: true,
                regexes: reopenRegexes,
                onlyQuestions: true,
                alwaysArchiveAfterSeconds: 3 * SECONDS_IN_DAY, //3 days
            },
            CLOSE: {
                name: 'Close',
                primary: true,
                regexes: cvRegexes,
                onlyQuestions: true,
                alwaysArchiveAfterSeconds: 3 * SECONDS_IN_DAY, //3 days
            },
            UNDELETE: {
                name: 'Undelete',
                primary: true,
                regexes: undeleteRegexes,
                alwaysArchiveAfterSeconds: 7 * SECONDS_IN_DAY, //7 days
            },
            FLAG_SPAM_OFFENSIVE: {
                name: 'Flag, Spam and Offensive',
                primary: true,
                regexes: flagRegexes.concat(spamRegexes, offensiveRegexes),
                //"spam" and "offensive" are too generic. We need to require that they are actually in tags.
                andRegexes: flagAsTagRegexes.concat(spamAsTagRegexes, offensiveAsTagRegexes),
                alwaysArchiveAfterSeconds: 2 * SECONDS_IN_HOUR, //2 hours
                underAgeTypeKey: 'DELETE',
            },
            APPROVE_REJECT: {
                name: 'Approve/Reject',
                primary: true,
                regexes: approveRejectRegexes,
                alwaysArchiveAfterSeconds: 2 * SECONDS_IN_HOUR, //2 hours
                //This really should have a separate call to the SE API to get review information, where possible.
                underAgeTypeKey: 'DELETE',
            },
            QUEEN_SOCVFINDER: {//QUEEN: SOCVFinder
                name: 'Queen: SOCVFinder',
                regexes: duplicateRegexes,
                alwaysArchiveAfterSeconds: 3 * SECONDS_IN_DAY, //3 days
                underAgeTypeKey: 'CLOSE',
            },
            FIREALARM: {
                name: 'FireAlarm',
                regexes: faRegexes,
                userIdMatch: knownUserIds.fireAlarm,
                alwaysArchiveAfterSeconds: 30 * SECONDS_IN_MINUTE, //30 minutes
                underAgeTypeKey: 'CLOSE',
                archiveParentWithThis: true,
            },
            QUEEN_HEAT: {
                name: 'Queen: HeatDetector',
                alwaysArchiveAfterSeconds: 30 * SECONDS_IN_MINUTE, //30 minutes
                userIdMatch: knownUserIds.queen,
                regexes: [
                    /Heat Detector/,
                ],
                underAgeTypeKey: 'DELETE',
                onlyComments: true,
            },
            EDITMONITOR: {// Monitors edits in the suggested edit queue
                name: 'Edit Monitor reports',
                userIdMatch: knownUserIds.fox9000,
                regexes: [editMonitorRegEx],
                alwaysArchiveAfterSeconds: 2 * SECONDS_IN_HOUR, //2 hours
                //This really should have a separate call to the SE API to get review information, where possible.
                underAgeTypeKey: 'DELETE',
            },
            YAM: {// Monitors cv-pls requests for edits above a threshold.
                name: 'Yam requested question change reports',
                userIdMatch: knownUserIds.yam,
                textRegexes: [/\d+%\s*changed\b/i],
                alwaysArchiveAfterSeconds: 4 * SECONDS_IN_HOUR, //4 hours
            },
            SMOKEDETECTOR: {
                name: 'SmokeDetector',
                userIdMatch: knownUserIds.smokeDetector,
                alwaysArchiveAfterSeconds: 4 * SECONDS_IN_HOUR, //4 hours
                underAgeTypeKey: 'DELETE',
                textRegexes: [
                    /\[\s*SmokeDetector\s*[|\]]/,
                ],
                additionalRequestCompleteTests: [
                    // Take advantage of AIM, if installed, to get number of FP feedbacks.
                    function(event) {
                        //Expires SD reports with >= 1 false positive feedbacks.
                        return $('#message-' + event.message_id + ' > .ai-information .ai-feedback-info-fp').first().text() >= 1;
                    },
                    //Relies on AIM.
                    function(event) {
                        //Expires SD reports marked with the ai-deleted class (i.e. AIM thinks it's deleted).
                        return !!$('#message-' + event.message_id + ' > .content.ai-deleted').length;
                    },
                    //Relies on both AIM and an updated version of the Unclosed Request Review Script
                    function(event) {
                        //Expires SD reports with >= 1 tp- feedbacks that have been edited since the message was posted.
                        //  e.g. a vandalism report that has been reverted.
                        const message = $('#message-' + event.message_id).first();
                        //Relies on an updated version of the Unclosed Request Generator
                        const requestInfo = $('.request-info a', message).first();
                        const aimHoverTpu = $('.meta .ai-information .ai-feedback-info-tpu', message);
                        if (!requestInfo.length || !aimHoverTpu.length) {
                            return false;
                        }
                        let lastEditDate = requestInfo[0].dataset.lastEditDate;
                        lastEditDate = lastEditDate ? +lastEditDate : 0;
                        const aimHoverTpuText = aimHoverTpu.text();
                        const aimHoverTpuTitle = aimHoverTpu.attr('title');
                        if (lastEditDate > event.time_stamp && aimHoverTpuText >= 1 && /^tp-?:/.test(aimHoverTpuTitle)) {
                            return true;
                        } // else
                        return false;
                    },
                    //NAA feedback is currently not considered, due to the MS API not raising NAA flags. Once FIRE does
                    //  do so through the SE API, it'd be reasonable to expire them if the current user has sent such
                    //  feedback through FIRE (implies that FIRE needs to indicate that).
                ],
            },
            SMOKEDETECTOR_NOCONTENT: {
                name: 'SmokeDetector no content',
                userIdMatch: knownUserIds.smokeDetector,
                alwaysArchiveAfterSeconds: 0.01, //Always archive
                noContent: true,
            },
            SMOKEDETECTOR_REPLYING: {
                name: 'SmokeDetector replying',
                userIdMatch: knownUserIds.smokeDetector,
                alwaysArchiveAfterSeconds: 4 * SECONDS_IN_HOUR, //4 hours
                replyToTypeKeys: [
                    'SMOKEDETECTOR_FEEDBACK',
                    'SMOKEDETECTOR_COMMAND',
                ],
                archiveWithParent: true,
            },
            SMOKEDETECTOR_FEEDBACK: {
                name: 'SmokeDetector feedback',
                regexes: [sdFeedbacksRegEx],
                alwaysArchiveAfterSeconds: 4 * SECONDS_IN_HOUR, //4 hours
                archiveWithParent: true,
                archiveWithPreviousFromUserId: knownUserIds.smokeDetector,
            },
            SMOKEDETECTOR_COMMAND: {
                name: 'SmokeDetector commands',
                regexes: [sdBangBangCommandsRegEx],
                alwaysArchiveAfterSeconds: 4 * SECONDS_IN_HOUR, //4 hours
                archiveWithNextFromUserId: knownUserIds.smokeDetector,
                archiveWithChildren: true,
                underAgeTypeKey: 'DELETE',
            },
            SMOKEDETECTOR_REPLY_TO_REPORT: {
                name: 'SmokeDetector reply to report',
                replyToTypeKeys: [
                    'SMOKEDETECTOR_NOCONTENT',
                    'SMOKEDETECTOR',
                ],
                archiveWithParent: true,
            },
            PANTA_SMOKEDETECTOR_FEEDBACK_TRAINING: {
                name: 'Panta SmokeDetector Training feedback',
                userIdMatch: knownUserIds.panta,
                regexes: [
                    //Regex modified from sdFeedbacksRegEx (above)
                    /^(?:\s*\d*(?:(?:k|v|n|naa|fp?|tp?|spam|rude|abus(?:iv)?e|offensive|v|vand|vandalism|notspam|true|false|ignore|del|delete|remove|gone|postgone|why))?u?-?)\s*(?:\s+\d*(?:(?:k|v|n|naa|fp?|tp?|spam|rude|abus(?:iv)?e|offensive|v|vand|vandalism|notspam|true|false|ignore|del|delete|remove|gone|postgone|why))?u?-?)*\s*$/i,
                ],
                alwaysArchiveAfterSeconds: 4 * SECONDS_IN_HOUR, //4 hours
                archiveWithParent: true,
                archiveWithPreviousFromUserId: knownUserIds.smokeDetector,
            },
            CRUDE_CLOSE: {
                name: 'CRUDE Close',
                regexes: crudeCloseRegexes,
                onlyQuestions: true,
                alwaysArchiveAfterSeconds: 3 * SECONDS_IN_DAY, //3 days
                underAgeTypeKey: 'CLOSE',
            },
            CRUDE_CLOSE_CN: {
                name: 'CRUDE Close CN',
                regexes: crudeCloseCnRegexes,
                onlyQuestions: true,
                alwaysArchiveAfterSeconds: 3 * SECONDS_IN_DAY, //3 days
                underAgeTypeKey: 'CLOSE',
            },
            CRUDE_REOPEN: {
                name: 'CRUDE Reopen',
                regexes: crudeReopenRegexes,
                onlyQuestions: true,
                alwaysArchiveAfterSeconds: 3 * SECONDS_IN_DAY, //3 days
                underAgeTypeKey: 'REOPEN',
            },
            CRUDE_REOPEN_RN: {
                name: 'CRUDE Reopen RN',
                regexes: crudeReopenRnRegexes,
                onlyQuestions: true,
                alwaysArchiveAfterSeconds: 3 * SECONDS_IN_DAY, //3 days
                underAgeTypeKey: 'REOPEN',
            },
            CRUDE_DELETE: {
                name: 'CRUDE Delete',
                regexes: crudeDeleteRegexes,
                alwaysArchiveAfterSeconds: 7 * SECONDS_IN_DAY, //7 days
                underAgeTypeKey: 'DELETE',
            },
            CRUDE_DELETE_DN: {
                name: 'CRUDE Delete DN',
                regexes: crudeDeleteDnRegexes,
                alwaysArchiveAfterSeconds: 7 * SECONDS_IN_DAY, //7 days
                underAgeTypeKey: 'DELETE',
            },
            CRUDE_UNDELETE: {
                name: 'CRUDE Undelete',
                regexes: crudeUndeleteRegexes,
                alwaysArchiveAfterSeconds: 7 * SECONDS_IN_DAY, //7 days
                underAgeTypeKey: 'UNDELETE',
            },
            CRUDE_UNDELETE_UN: {
                name: 'CRUDE Undelete UN',
                regexes: crudeUndeleteUnRegexes,
                alwaysArchiveAfterSeconds: 7 * SECONDS_IN_DAY, //7 days
                underAgeTypeKey: 'UNDELETE',
            },
        };
        //If the targetRoomSet has a includedRequestTypes list, limit the RequestTypes to that list.
        if (Array.isArray(targetRoomSet.includedRequestTypes)) {
            const includeList = targetRoomSet.includedRequestTypes;
            Object.keys(RequestTypes).forEach((typeKey) => {
                if (includeList.indexOf(typeKey) === -1 && !(targetRoomSet.useCrudeRequestTypes && typeKey.indexOf('CRUDE_') === 0)) {
                    //Keep it if it's in the include list, or using CRUDE RequestTypes and it is one.
                    delete RequestTypes[typeKey];
                }
            });
        }
        if (targetRoomSet.useCrudeRequestTypes === false) {
            Object.keys(RequestTypes).forEach((typeKey) => {
                if (typeKey.indexOf('CRUDE_') === 0) {
                    //If not using CRUDE RequestTypes and this one of them, then delete it.
                    delete RequestTypes[typeKey];
                }
            });
        }
        //If the targetRoomSet has a excludedRequestTypes list, remove those from the RequestTypes.
        if (Array.isArray(targetRoomSet.excludedRequestTypes)) {
            targetRoomSet.excludedRequestTypes.forEach((typeKey) => delete RequestTypes[typeKey]);
        }
        //Remove any RequestTypes with defined, but non-numeric, UserIds
        Object.keys(RequestTypes).forEach((typeKey) => {
            const requestType = RequestTypes[typeKey];
            [
                'userIdMatch',
                'archiveWithNextFromUserId',
                'archiveWithPreviousFromUserId',
            ].some((key) => {
                const type = typeof requestType[key];
                if (type !== 'undefined' && type !== 'number') {
                    delete RequestTypes[typeKey];
                    return true;
                }
                return false;
            });
        });
        const RequestTypeKeys = Object.keys(RequestTypes);
        //Add direct references to RequestTypes, which can't exist within the Object literal.
        RequestTypeKeys.forEach((key) => {
            if (RequestTypes[key].underAgeTypeKey) {
                RequestTypes[key].underAgeType = RequestTypes[RequestTypes[key].underAgeTypeKey];
            }
            if (RequestTypes[key].replyToTypeKeys) {
                RequestTypes[key].replyToTypes = RequestTypes[key].replyToTypeKeys.map((replyKey) => RequestTypes[replyKey]);
            }
        });
        const primaryRequestTypes = [
            //We want to find DELETE and REOPEN first.
            RequestTypes.DELETE,
            RequestTypes.REOPEN,
            RequestTypes.CLOSE,
            RequestTypes.UNDELETE,
            RequestTypes.FLAG_SPAM_OFFENSIVE,
            RequestTypes.APPROVE_REJECT,
        ].filter((type) => type);

        function populateRequestAges() {
            //Fill the alwaysArchiveAfterDateSeconds for each RequestTypes with a time in seconds from Epoch for each type's alwaysArchiveAfterSeconds.
            const now = Date.now() / 1000;
            Object.keys(RequestTypes).forEach((type) => {
                if (RequestTypes[type].alwaysArchiveAfterSeconds) {
                    RequestTypes[type].alwaysArchiveAfterDateSeconds = Math.floor(now - RequestTypes[type].alwaysArchiveAfterSeconds);
                }
            });
        }

        function setIsModeratorRoRoomsByInfo(forRoom, userInfo, saveFalse) {
            //false is not normally saved to the roRooms in order to keep it's length shorter.
            if (userInfo) {
                isModerator = userInfo.users[0].is_moderator;
                if (userInfo.users[0].is_owner) {
                    roRooms[forRoom] = true;
                    setStorageJSON('roRooms', roRooms);
                } else if (saveFalse) {
                    roRooms[forRoom] = false;
                    setStorageJSON('roRooms', roRooms);
                }
            } else {
                isModerator = getStorage('isModerator') === 'true';
            }
            setStorage('isModerator', isModerator);
        }

        function removeMessagesNotFromThisRoom() {
            //Look through the messages and remove those which are not from this room's transcript;
            //  The transcript/search will have some results which are not actually in the room being
            //  searched/displayed. This is indicated by the URL for the message directing to a different room.
            var currentRoomMatches = /\bRoom=(\d+)/i.exec(window.location.search);
            var currentRoom;
            if (currentRoomMatches) {
                currentRoom = currentRoomMatches[1];
            }
            if (currentRoom) {
                $('.message .action-link').each(function() {
                    var actionSpan = $(this);
                    var linkHref = actionSpan.parent()[0].href;
                    if (linkHref.indexOf('/' + currentRoom + '?') === -1) {
                        const message = actionSpan.closest('.message');
                        const matches = linkHref.match(/\/(\d+)\?/);
                        const actualRoomNumber = matches ? matches[1] : '';
                        const roomName = (actualRoomNumber && targetRoomsByRoomNumber[actualRoomNumber]) ? targetRoomsByRoomNumber[actualRoomNumber].fullName : '';
                        message.css({'background-color': '#ec6'})[0]
                            .title = 'This message is not in this room. ' + (roomName ? 'It\'s in ' + roomName : 'See message link for where it is' + (actualRoomNumber ? '(room #' + actualRoomNumber + ')' : '')) + '.';
                    }
                });
            }
        }

        if (isSearch) {
            removeMessagesNotFromThisRoom();
        }

        //Build the buttons and UI which is in the Chat input area.
        nodes.scope = document.querySelector('#chat-buttons');
        if (!showUI || !nodes.scope) {
            //Create a dummy element that is used to prevent the UI from being added to the page while still creating the structure and nodes Object.
            nodes.scope = document.createElement('div');
        }
        nodes.originalScope = nodes.scope;

        if (showUI && unclosedRequestReviewerButtons.length > 0) {
            //Temporarily adjust nodes.scope so that the buttons end up in locations compatible with the URRS.
            nodes.scope = document.createElement('span');
            unclosedRequestReviewerButtons.filter('#urrs-open-options-button').first().after(nodes.scope);
        }

        nodes.startbtn = document.createElement('button');
        nodes.startbtn.className = 'button archiver-startbtn cvra-archiver-button';
        nodes.startbtn.textContent = 'archiver';
        nodes.startbtn.title = 'Open the controls for the request archiver.';
        nodes.scope.appendChild(nodes.startbtn);

        nodes.scanNkbtn = document.createElement('button');
        nodes.scanNkbtn.className = 'button archiver-scanNk';
        nodes.scanNkbtn.textContent = 'scan ' + (nKButtonEntriesToScan / 1000) + 'k';
        nodes.scanNkbtn.title = 'Open the controls for the request archiver and scan ' + (nKButtonEntriesToScan / 1000) + 'k events.';
        nodes.scope.appendChild(nodes.scanNkbtn);

        //This is only needed with the URRS, but doesn't hurt at other times.
        nodes.scope = nodes.originalScope;

        nodes.form = document.createElement('form');
        nodes.form.className = 'archiver-form';
        nodes.scope.appendChild(nodes.form);

        nodes.count = document.createElement('input');
        nodes.count.className = 'button archiver-count';
        nodes.count.placeholder = '#';
        nodes.count.type = 'text';
        nodes.count.style.display = 'none';
        nodes.count.title = 'The number of "events" (messages) to scan for completed requests.';
        nodes.form.appendChild(nodes.count);

        nodes.gobtn = document.createElement('button');
        nodes.gobtn.className = 'button archiver-gobtn';
        nodes.gobtn.textContent = 'scan';
        nodes.gobtn.style.display = 'none';
        nodes.gobtn.title = 'Scan the events in this room for matching messages.';
        nodes.form.appendChild(nodes.gobtn);

        nodes.scope.appendChild(document.createTextNode(' '));

        nodes.cancel = document.createElement('button');
        nodes.cancel.className = 'button archiver-cancel';
        nodes.cancel.textContent = 'cancel';
        nodes.cancel.style.display = 'none';
        nodes.scope.appendChild(nodes.cancel);

        nodes.scandate = document.createElement('span');
        nodes.scandate.textContent = '';
        nodes.scandate.style.display = 'none';
        nodes.scope.appendChild(nodes.scandate);

        nodes.scope.appendChild(document.createElement('br'));

        nodes.indicator = document.createElement('input');
        nodes.indicator.className = 'button archiver-indicator';
        nodes.indicator.type = 'text';
        nodes.indicator.readOnly = true;
        nodes.indicator.style.display = 'none';
        nodes.scope.appendChild(nodes.indicator);

        nodes.scope.appendChild(document.createTextNode(' '));

        nodes.movebtn = document.createElement('button');
        nodes.movebtn.className = 'button archiver-movebtn';
        nodes.movebtn.textContent = 'move';
        nodes.movebtn.style.display = 'none';
        nodes.scope.appendChild(nodes.movebtn);

        nodes.progresswrp = document.createElement('div');
        nodes.progresswrp.className = 'archive-progresswrp';
        nodes.progresswrp.style.display = 'none';
        nodes.scope.appendChild(nodes.progresswrp);

        nodes.progress = document.createElement('div');
        nodes.progress.className = 'archive-progress';
        nodes.progresswrp.appendChild(nodes.progress);

        nodes.style = document.createElement('style');
        nodes.style.id = 'SOCVR-Archiver-generalCSS';
        nodes.style.type = 'text/css';
        //Ideally, the colors used for the MoveTo control hover would be adjusted in case the user has a non-stock theme installed.
        //  But, we can't get colors here because the messages may not exist in the page yet.
        nodes.style.textContent = [
            '#chat-buttons {',
            '    cursor: default;',
            '}',
            '#input-area .button {',
            '    margin: 1px !important;',
            '}',
            '#input-area button.button:disabled {',
            '    opacity: 0.8;',
            '}',
            '#input-area button.button:disabled:hover {',
            '   background: #ff7b18 !important;',
            '}',
            '#input-area .button:disabled {',
            '    cursor: default !important;',
            '}',
            '.archiver-count {',
            '    width: 78px;',
            '    border: 0px !important;',
            '    box-sizing: border-box;',
            '    margin-right: 0px !important;',
            '    border-top-right-radius: 0px;',
            '    border-bottom-right-radius: 0px;',
            '}',
            '.archiver-gobtn {',
            '    margin-left: 0px !important;',
            '    border-top-left-radius: 0px;',
            '    border-bottom-left-radius: 0px;',
            '}',
            '.archiver-count,',
            '.archiver-count:hover,',
            '.archiver-count:focus {',
            '    background: #eee;',
            '    outline: none;',
            '    color: #111;',
            '}',
            '.archiver-count:hover:not(:disabled),',
            '.archiver-count:focus:not(:disabled),',
            '.archiver-indicator:not(:disabled),',
            '.archiver-indicator:hover:not(:disabled),',
            '.archiver-indicator:focus:not(:disabled) {',
            '    color: #000;',
            '    outline: none;',
            '    background: #fff;',
            '    cursor: default;',
            '}',
            '.archiver-indicator {',
            '    border: 0px;',
            '    width: 230px;',
            '}',
            '.archiver-form {',
            '    display: inline-block;',
            '}',
            '.archive-progresswrp {',
            '    margin-top: 2px;',
            '    width: 253px;',
            '    background: #eee;',
            '    height: 5px;',
            '}',
            '.archive-progress {',
            '    width: 0%;',
            '    background: #ff7b18;',
            '    height: 100%;',
            '}',
            'body:not(.SOCVR-Archiver-alwaysShowDeleted) .SOCVR-Archiver-deleted-content {',
            '    display: none;',
            '    position: absolute;',
            '    background-color: white;',
            '    top: 77%;', //With meta-menu just obscuring the border.
            '    border: 2px solid;',
            '    box-shadow: 0px 0px 20px;',
            '    z-index: 2;',
            '}',
            'body:not(.SOCVR-Archiver-alwaysShowDeleted) .message:hover .SOCVR-Archiver-deleted-content,',
            'body:not(.SOCVR-Archiver-alwaysShowDeleted) .content .deleted:hover ~ .SOCVR-Archiver-deleted-content,',
            'body:not(.SOCVR-Archiver-alwaysShowDeleted) .content .deleted ~ .SOCVR-Archiver-deleted-content:hover {',
            '    display: block;',
            '}',
            '.SOCVR-Archiver-deleted-content-marker {',
            '    cursor: pointer;',
            '}',
            'body:not(.SOCVR-Archiver-alwaysShowDeleted) .content > .SOCVR-Archiver-deleted-content-marker {',
            '    display: none;',
            '}',
            'body.SOCVR-Archiver-alwaysShowDeleted .SOCVR-Archiver-contains-deleted-content .content .deleted {',
            '    display: none;',
            '}',
            'body.SOCVR-Archiver-alwaysShowDeleted .SOCVR-Archiver-contains-deleted-content:not(.reply-parent):not(.reply-child) {',
            '    background-color: #f4eaea;',
            '}',
            'body.SOCVR-Archiver-alwaysShowDeleted .SOCVR-Archiver-contains-deleted-content .SOCVR-Archiver-deleted-content  {',
            '    display: inline;',
            '}',
            'body:not(.SOCVR-Archiver-alwaysShowDeleted) .message.SOCVR-Archiver-contains-deleted-content .content {',
            '    overflow: unset;',
            '}',
            '.SOCVR-Archiver-hide-message-meta-menu .meta {',
            '    display: none !important;',
            '}',
            '.SOCVR-Archiver-in-message-move-button:first-of-type {',
            '    margin-left: 5px;',
            '}',
            '.SOCVR-Archiver-in-message-move-button {',
            '    cursor: pointer;',
            '    font-size: 11px;',
            '    margin-right: 5px;',
            '}',
            //Should adjust this based on the colors used (in case the user has a theme applied).
            '.SOCVR-Archiver-in-message-move-button:hover {',
            '    color: white;',
            '    background-color: black;',
            '}',
            '.message.reply-child.SOCVR-Archiver-multiMove-selected,',
            '.message.reply-parent.SOCVR-Archiver-multiMove-selected {',
            '    background-color: lightBlue !important;',
            '}',
            '.message.selected.SOCVR-Archiver-multiMove-selected .meta,',
            '.message.selected.SOCVR-Archiver-multiMove-selected {',
            '    background-color: #c8d8e4 !important;',
            '}',
            '.SOCVR-Archiver-multiMove-selected .meta,',
            '.SOCVR-Archiver-multiMove-selected {',
            '    background-color: LightSkyBlue !important;',
            '}',
            '.message.SOCVR-Archiver-multiMove-selected .SOCVR-Archiver-move-to-add-to-list {',
            '    display: none;',
            '}',
            '.message:not(.SOCVR-Archiver-multiMove-selected) .SOCVR-Archiver-move-to-remove-from-list {',
            '    display: none;',
            '}',
            //A general issue with these controls is that they can obscure content. For instance: https://chat.stackoverflow.com/transcript/message/39961248#39961248
            //  has a link which is not clickable due to the controls obscuring it.
            //  Now: Press & hold Caps-Lock to not show the meta controls.
            //Show the meta options for your own posts (have to be able to move them).
            '#chat-body .monologue.mine:hover .messages .timestamp:hover + div.message .meta,',
            '#chat-body .monologue.mine:hover .messages .message:hover .meta {',
            '    display: inline-block;',
            '}',
            //Float the meta controls outside the message (easier than Caps-Lock).
            'div.message .meta.meta {',
            '    position: absolute;',
            '    bottom: -17px;',
            '    border-bottom: 1px dotted;',
            '    border-left: 1px dotted;',
            '    border-right: 1px dotted;',
            '    right: -1px;',
            '}',
            '.message:hover > .ai-information {',
            '    display: none;',
            '}',
            'body:not(.SOCVR-Archiver-alwaysShowDeleted) .message.SOCVR-Archiver-contains-deleted-content:hover .meta {',
            '    top: -2px;',
            '    border-bottom: none;',
            '    border-top: 2px solid;',
            '    border-left: 2px solid;',
            '    border-right: 2px solid;',
            '    right: 0px;',
            '    background-color: #ffffff;',
            '}',
            'body.SOCVR-Archiver-alwaysShowDeleted .SOCVR-Archiver-contains-deleted-content:not(.reply-parent):not(.reply-child) .meta {',
            '    background-color: #f4eaea;',
            '}',
            'body:not(.SOCVR-Archiver-alwaysShowDeleted) .SOCVR-Archiver-contains-deleted-content .content {',
            '    position: relative;',
            '}',
            'body:not(.SOCVR-Archiver-alwaysShowDeleted) .SOCVR-Archiver-contains-deleted-content .SOCVR-Archiver-deleted-content {',
            '    width: calc(100% - 4px);',
            '}',
            '.meta .ai-information.inline {',
            '    padding-right: 5px;',
            '}',
            //Page JavaScript is not functional for these
            '#chat-body .monologue.mine:hover .messages .timestamp:hover + div.message .meta .vote-count-container,',
            '#chat-body .monologue.mine:hover .messages .message:hover .meta .vote-count-container {',
            '    display: none;',
            '}',
            (showMeta ? [
                'div.message .meta {',
                //A clearer indicator of separation between controls and message text.
                '    border-left: 1px solid;',
                '}',
            ].join('\n') : ''),
        ].join('\n');
        //Put the styles in the document (nodes.scope can be invalid).
        (document.head || document.documenetElement).appendChild(nodes.style);

        nodes.startbtn.addEventListener('click', function() {
            //Click the "archiver" button.
            nodes.startbtn.disabled = true;
            nodes.scanNkbtn.disabled = true;
            nodes.count.style.display = '';
            nodes.gobtn.style.display = '';
            nodes.cancel.style.display = '';
            nodes.scandate.style.display = '';
            nodes.count.focus();
        }, false);

        nodes.scanNkbtn.addEventListener('click', function() {
            //Click the "Scan Nk" button.
            nodes.startbtn.click();
            nodes.count.value = nKButtonEntriesToScan;
            nodes.gobtn.click();
        }, false);

        nodes.cancel.addEventListener('click', resetIfThisNotDisabled, false);

        nodes.form.addEventListener('submit', function(e) {
            //User entered a number of events to scan.
            e.preventDefault();
            nodes.cancel.disabled = true;
            const count = +nodes.count.value;
            totalEventsToFetch = count;
            nodes.count.disabled = true;
            nodes.gobtn.disabled = true;
            nodes.indicator.style.display = '';
            nodes.indicator.value = 'getting events... (0 / ' + count + ')';
            nodes.progresswrp.style.display = '';
            getEventsAndScan(count).then(() => {
                console.log('getEventsAndScan.then: JSON.parse(JSON.stringify(messagesToMove)):', JSON.parse(JSON.stringify(messagesToMove)));
            }).catch((error) => {
                console.error(error);
                alert('There was an error in getting and/or processing the messages. You will need to try again.\n\nMore information is available in the console.');
                nodes.cancel.disabled = false;
            });
        }, false);

        nodes.movebtn.addEventListener('click', saveMoveInformationAndMovePosts, false);

        function resetIfThisNotDisabled() {
            /* jshint -W040 */ //This is called as a jQuery event handler, which explicitly sets `this`.
            if (this.disabled) {
                return false;
            }
            /* jshint +W040 */
            reset();
        }

        function reset() {
            totalEventsToFetch = 0;
            requests = [];
            messagesToMove = [];
            eventsByNum = {};
            events = [];
            nodes.count.style.display = 'none';
            nodes.count.value = '';
            nodes.count.disabled = false;
            nodes.gobtn.style.display = 'none';
            nodes.gobtn.disabled = false;
            nodes.scanNkbtn.disabled = false;
            nodes.cancel.style.display = 'none';
            nodes.scandate.style.display = 'none';
            nodes.scandate.textContent = '';
            nodes.indicator.style.display = 'none';
            nodes.indicator.textContent = '';
            nodes.movebtn.style.display = 'none';
            nodes.startbtn.disabled = false;
            nodes.progresswrp.style.display = 'none';
            nodes.progress.style.width = '';
            removeShownToBeMoved();
        }

        function isEventByIdValid(eventId) {
            //Check if an event in the eventsByNum is valid (i.e. that we've actually fetched the event).
            return eventsByNum[eventId] && !!eventsByNum[eventId].message_id;
        }

        function addEventsToByNumber(eventsToAdd) {
            //Add some events to eventsByNum. Track parents and children.
            //  Add entries for parents and children for which we don't already have event data.
            eventsToAdd.forEach(function(event) {
                if (event.message_id && typeof event.user_id === 'undefined') {
                    //Remember that we can't move this message. (Moving events with no user_id results in an API error.)
                    addToLSnoUserIdList(event.message_id);
                }
                var parentId = event.parent_id;
                var children;
                //If there is a parent_id, then add the current message to the list of children for the parent.
                if (parentId) {
                    if (event.show_parent) {
                        //It's an actual :##### reply
                        if (typeof eventsByNum[parentId] !== 'object') {
                            eventsByNum[parentId] = {};
                        }
                        if (!Array.isArray(eventsByNum[parentId].children)) {
                            eventsByNum[parentId].children = [];
                        }
                        eventsByNum[parentId].children.push(event.message_id);
                    } else {
                        //In this case, the system has assumed that it's a reply, because the user @username'd someone.
                        //  The user did not click on "reply".
                        //  This is not something we consider a reply.
                        //console.log('Found event with parent_id, but not show_parent: event:', event);
                        //The gap between the message IDs can be a rough guide as to how associated they are.
                        //console.log('Found event with parent_id, but not show_parent: Gap:', event.message_id - parentId);
                    }
                }
                if (typeof eventsByNum[event.message_id] === 'object') {
                    //Remember any existing children
                    children = eventsByNum[event.message_id].children;
                }
                eventsByNum[event.message_id] = event;
                if (children) {
                    //If there were existing children re-add them to the event.
                    eventsByNum[event.message_id].children = children;
                }
            });
        }

        function Request(_event, _postId, _isComment) {
            //A request class. Used to indicate that an event should be moved, or that we need data.
            this.msg = _event.message_id;
            if (_postId) {
                this.post = _postId;
            }
            if (_isComment) {
                this.isComment = _isComment;
            }
            this.time = _event.time_stamp;
            this.type = _event.type;
            this.onlyQuestions = (_event.type && _event.type.onlyQuestions) || (Array.isArray(_event.underAgeTypes) && _event.underAgeTypes.some((underAgeType) => underAgeType.onlyQuestions));
            this.onlyComments = (_event.type && _event.type.onlyComments) || (Array.isArray(_event.underAgeTypes) && _event.underAgeTypes.some((underAgeType) => underAgeType.onlyComments));
            this.event = _event;
        }

        var nextBefore;

        function getEvents(roomNumber, userFkey, count, before) {
            if (count > 500 || count < 1) {
                return Promise.reject(new Error('Count not in range (500 >= n >= 1)'));
            } // else
            if (!roomNumber) {
                return Promise.reject(new Error('Invalid room'));
            } // else
            if (!fkey) {
                return Promise.reject(new Error('Invalid fkey'));
            } // else
            const data = {
                fkey: userFkey,
                msgCount: count,
                mode: 'Messages',
            };
            if (before) {
                data.before = before;
            }
            const ajaxOptions = {
                type: 'POST',
                url: '/chats/' + roomNumber + '/events',
                data: data,
            };
            return $.ajax(ajaxOptions);
        }

        function getEventsAndScan(count, before, promised, needParentList) {
            //Get events from Chat. Chat returns up to 500 events per call going backward from the indicated "before" message.
            //  These are directly placed in the events Array as a 2D array.
            // @promised is the tail of a Promise which contains the processing tasks.
            // @needParentList is the events which were not completely processed due to missing parents.
            return new Promise((resolve, reject) => {
                setProgress('getting events\u2009', totalEventsToFetch - count, totalEventsToFetch);
                promised = promised ? promised : Promise.resolve();
                needParentList = Array.isArray(needParentList) ? needParentList : [];
                if (count <= 0) {
                    //Done getting all requested events.
                    // Re-type those that need to have a parent found.
                    resolve(promised.then(() => delay(0, scanStageEventChunk, needParentList, assignEventBaseTypeAndContentWithoutCode, [], 'typing-needParentList', 0, needParentList.length)).then(() => delay(0, scanEvents)));
                    return false;
                }
                const msgCount = count > 500 ? 500 : count;
                getEvents(room, fkey, msgCount, before).then(function(response) {
                    var respEvents = response.events;
                    if (respEvents.length) {
                        respEvents.forEach(function(event) {
                            event.timeStampUTC = (new Date(event.time_stamp * 1000)).toJSON();
                        });
                    }
                    events.push(response.events);
                    //Adding 'reply-request' to this doesn't appear to help make the process significantly faster.
                    promised = promised
                        .then(() => delay(0, addEventsToByNumber, response.events, '', '', 'By Id'))
                        .then(() => delay(0, scanStageEventChunk, response.events, assignEventBaseTypeAndContentWithoutCode, needParentList, 'typing............', totalEventsToFetch - count, totalEventsToFetch));

                    if (!response.events[0]) {
                        // No more events in the transcript
                        // Re-type those that need to have a parent found.
                        resolve(promised.then(() => delay(0, scanStageEventChunk, needParentList, assignEventBaseTypeAndContentWithoutCode, [], 'typing-needParentList', 0, needParentList.length)).then(() => delay(0, scanEvents)));
                        return false;
                    }

                    nodes.scandate.textContent = new Date(1000 * response.events[0].time_stamp).toISOString();

                    nextBefore = response.events[0].message_id;
                    resolve(getEventsAndScan(count - 500, response.events[0].message_id, promised, needParentList));
                }, function(xhr, status, error) {
                    console.error(
                        'AJAX Error getting events:',
                        '\n::  xhr:', xhr,
                        '\n::  status:', status,
                        '\n::  error:', error,
                        '\n::  count:', count,
                        '\n::  before:', before
                    );
                    if (confirm('$.ajax encountered an error getting events. See console for data.' + (error && error.length < 100 ? ' error: ' + error : '') +
                            '\n\ncount:' + count + '::  before:' + before + '\n\nRetry fetching these?')) {
                        //Allow the user to retry.
                        resolve(getEventsAndScan(count, before, promised, needParentList));
                    } else {
                        reject(new Error('AJAX Error getting events: ' + error));
                    }
                });
            });
        }

        function delay(time, delayedFunction) {
            //Return a Promise which is resolved after the specified delay and any specified function is called.
            //  Any additional arguments are passed to the delayedFunction and the return value from that function
            //  is what this Promise resolves as. This can chain an additional Promise.
            var mainArgs = arguments; //Needed due to a bug in a browser, I don't remember which one. See the GM4 polyfill merged PRs.
            return new Promise((resolve) => {
                setTimeout(() => {
                    if (typeof delayedFunction === 'function') {
                        //Using .slice(), or other Array methods, on arguments prevents optimization.
                        var args = [];
                        for (var index = 2; index < mainArgs.length; index++) {
                            args.push(mainArgs[index]);
                        }
                        resolve(delayedFunction.apply(null, args));
                    } else {
                        resolve();
                    }
                }, (time ? time : 0));
            });
        }

        function setProgress(text, current, total) {
            //Set the progress indicator.
            nodes.indicator.value = text + '... (' + current + ' / ' + total + ')';
            nodes.progress.style.width = Math.ceil((current * 100) / total) + '%';
        }

        function scanStageEventChunk(chunk, action, needParentList, text, progress, total) {
            //Scans a chunk of events using the function (action) provided.
            setProgress(text, progress, total);
            chunk.forEach((event, eventIndex) => {
                action(event, eventIndex, chunk, needParentList);
            });
        }

        function getTotalLengthOfChunks(chunks) {
            //Count the total length of the arrays in a 2D array.
            return chunks.reduce((total, chunk) => total + chunk.length, 0);
        }

        function scanEvents() {
            //All events the user has told us to scan have been fetched.
            //  events is an array of event arrays.
            //  eventsByNum[] contains all events, with parent and children information.
            events.reverse(); //Always process events oldest to youngest.
            populateRequestAges();
            nodes.progress.style.width = '';
            //Check each event and produce an array of requests which include all messages about which we need further information, or might be archiving.
            const totalEvents = getTotalLengthOfChunks(events);
            const stages = [
                //['typing', assignEventBaseTypeAndContentWithoutCode], //This is now done in parallel with fetching data.
                ['reply-request', markReplyRequestEvent],
                ['checking', checkEvent],
            ];
            let mainPromise = Promise.resolve();
            for (const [text, action] of stages) {
                let progress = 0;
                const needParentList = [];
                for (const chunk of events) {
                    mainPromise = mainPromise.then(delay.bind(null, 0, scanStageEventChunk, chunk, action, needParentList, text, progress, totalEvents)); //Allow the tab's UI to remain active/update.
                    progress += chunk.length;
                }
                mainPromise = mainPromise.then(() => new Promise((resolve) => {
                    setProgress(text, totalEvents, totalEvents);
                    resolve();
                }));
            }
            //needParentList is just dropped. It could be used to fetch parent events from the Graveyard and/or the /dev/null.
            //  Alternately, we could just fetch events in those two rooms back to some point prior to where the main ones ended.
            mainPromise = mainPromise.then(() => {
                //All messages have been scanned. A list of posts for which we need data from the SE API has been created.
                //  We need the data in order to determine the post's current status and see if the request is fulfilled.
                nodes.progress.style.width = '';

                if (!requests.length) {
                    //There are no events for which we need to get information from the SE API.
                    if (messagesToMove.length) {
                        //No messages were found which should be moved.
                        return checkDone();
                    }
                    //There are messages which should be moved.
                    nodes.indicator.value = 'no ' + (messagesToMove.length > 0 ? 'additional ' : '') + 'messages found';
                    nodes.progresswrp.style.display = 'none';
                    nodes.progress.style.width = '';
                    nodes.cancel.disabled = false;
                    setShowToBeMovedScanCount();
                    return false;
                }

                nodes.indicator.value = 'chunking request array...';
                requests = chunkArray(requests, 100);
                return checkRequests();
            });
            return mainPromise;
        }

        function matchesRegex(text, regexes) {
            //Does the text match one of the RegExp in the provided array of RegExp.
            for (var regExType in regexes) {
                if (regexes[regExType].test(text)) {
                    return true;
                }
            }
            return false;
        }

        function addMessagesToAlsoArchive(event, messages) {
            //Add a list of messages to the event's list of messages to also archive when the event is archived.
            messages = Array.isArray(messages) ? messages : [messages];
            if (!Array.isArray(event.alsoArchive)) {
                event.alsoArchive = [];
            }
            Array.prototype.push.apply(event.alsoArchive, messages);
        }

        function doesEventMatchType(event, type, needParentList) {
            if (typeof type.userIdMatch === 'number' && type.userIdMatch !== event.user_id) {
                return false;
            } //else
            if (type.noContent && event.content) {
                //No content
                return false;
            } //else
            if (type.replyToTypes) {
                if (!event.show_parent || !event.parent_id) {
                    //Not a reply
                    return false;
                } //else
                //We should be checking, and a parent exists
                if (!isEventByIdValid(event.parent_id)) {
                    if (Array.isArray(needParentList)) {
                        //Add the event to those for which we need the parent.
                        needParentList.push(event);
                    }
                    return false;
                } //else
                //We have a valid record for the parent event.
                if (!type.replyToTypes.some((replyType) => eventsByNum[event.parent_id].type === replyType)) { // eslint-disable-line no-loop-func
                    //The parent's type doesn't matches any in the list.
                    return false;
                } //else
                //Passed type.replyToTypes
            }
            //RegExp are relatively slow, let the other criteria disqualify first.
            if (type.regexes && !matchesRegex(event.contentNoCode, type.regexes)) {
                //Use the RegExp array as one indicator of the type.
                return false;
            } //else
            if (type.andRegexes && !matchesRegex(event.contentNoCode, type.andRegexes)) {
                //Another RegExp array which must match.
                return false;
            } //else
            if (type.textRegexes && !matchesRegex(event.contentNoCodeText, type.textRegexes)) {
                //Existing text regexes didn't match.
                return false;
            } //else
            //All existing tests passed.
            return true;
        }

        function getHTMLTextAsDOM(htmlText) {
            //Converting HTML text into DOM nodes using jQuery causes any resources referenced by that
            //  HTML to be fetched by the browser (e.g. any <img src="foo"> will result in the image being fetched). This
            //  causes unwanted and unneeded network traffic.
            //  The resources are not fetched if jQuery just manipulates the elements once they are created.
            //This converts HTMLtext to DOM nodes wrapped in a <div> and returns that element.
            const asDOM = parser.parseFromString('<div>' + htmlText + '</div>', 'text/html');
            return asDOM.body.firstChild;
        }

        function assignEventBaseTypeAndContentWithoutCode(event, eventIndex, currentEvents, needParentList) {
            //First pass identifying request types. The type is added to the event Object, along with a version of the message without code
            //  in both HTML text, and just text content.
            const message = event.content;
            //Don't match things in code format, as those normally are used to explain, not as intended tags indicating a request.
            //The message content should really be converted to DOM and parsed from there.
            //Note that converting to DOM changes HTML entities into the represented characters.
            const messageAsDom = $(getHTMLTextAsDOM(message));
            //Remove any <code>
            messageAsDom.find('code').remove();
            const messageWithoutCode = messageAsDom.html();

            //Prevent matches of the meta and chat sites (e.g. meta.stackoverflow.com)
            targetRoomSet.regExp.chatMetaElimiation.lastIndex = 0;
            const messageWithoutCodeAndMeta = messageWithoutCode.replace(targetRoomSet.regExp.chatMetaElimiation, ' ');
            //Determine if it matches one of the RegExp.
            event.contentNoCode = messageWithoutCodeAndMeta;
            event.contentNoCodeText = messageAsDom.text();
            //Remove the text from links that are not tags (used to prevent detecting post URLs within link-text).
            messageAsDom.find('a').filter(function() {
                return !$(this).find('.ob-post-tag').length;
            }).text('');
            event.contentNoCodeNoNonTagLinkText = messageAsDom.html();
            event.type = null;

            RequestTypeKeys.some((typeKey) => {
                const type = RequestTypes[typeKey];
                if (doesEventMatchType(event, type, needParentList)) {
                    event.type = type;
                    return true;
                }
                return false;
            });
        }

        function markReplyRequestEvent(event, eventIndex, currentEvents, needParentList) {
            //Find replies which indicate the person replying is changing the parent message into a request.
            //  This is the case when the parent isn't a request of that type (or a competing request), but the
            //  combination of the non-code contents of the two messages makes for a request. For example, this
            //  could be that someone (e.g. FireAlarm) posts the URL for a question, while someone else replies to that
            //  message with a cv-pls tag. The opposite ordering (cv-pls then URL) is also possible, but the reply must have a tag in it.
            //If there is a '?' in the current event, then it's assumed to be a question, and not a reply indicating that it's a request.
            //event.show_parent indicates it's an actual reply, not just something that's been assumed to be a reply.
            if (!event.type && event.show_parent && event.contentNoCode && !/\?/.test(event.contentNoCodeText) && /"ob-post-tag"/.test(event.contentNoCode)) {
                //This event is a reply, there is non-code content which contained '"ob-post-tag"' (indicating a tag),
                //  and there's no "?" in the content (which is assumed to mean that it's a question, not an actual request.
                //  We really should be looking for actual tags, but that test should be sufficient.
                if (!isEventByIdValid(event.parent_id) || typeof eventsByNum[event.parent_id].type === 'undefined') {
                    //The parent we have isn't valid. Thus, we can't do anything about this.
                    needParentList.push(event);
                    return;
                } // else
                //We have the parent. We want to know if this message, combined with the message to which it's replying, makes a valid primary request.
                //We don't handle replies which change the direction a request is going (e.g. a reopen-pls reply to a close-pls);
                const parentEvent = eventsByNum[event.parent_id];
                if (parentEvent.type === RequestTypes.DELETE || parentEvent.type === RequestTypes.REOPEN) {
                    //The parent is already a primary request which doesn't have more stringent requirements.
                    return;
                }
                //Change the parentEvent's type, if the parent + the current match a request type, but the parent doesn't match on it's own.
                const combinedEvent = Object.assign({}, parentEvent);
                combinedEvent.content += ' ' + event.content;
                combinedEvent.contentNoCode += ' ' + event.contentNoCode;
                combinedEvent.contentNoCodeText += ' ' + event.contentNoCodeText;
                combinedEvent.type = null;
                const replyType = primaryRequestTypes.find((testType) => (doesEventMatchType(combinedEvent, testType) && !doesEventMatchType(parentEvent, testType)));
                if (replyType) {
                    if (!parentEvent.type || ((parentEvent.type !== replyType || (parentEvent.type === replyType && parentEvent.originalType !== replyType)) &&
                            (((replyType === RequestTypes.REOPEN || replyType === RequestTypes.UNDELETE) && parentEvent.type !== RequestTypes.CLOSE) ||
                                ((replyType === RequestTypes.CLOSE || replyType === RequestTypes.DELETE) && parentEvent.type !== RequestTypes.UNDELETE)))) {
                        //The reply type doesn't change the direction of an already existing type.
                        if (typeof parentEvent.originalType === 'undefined') {
                            //Save the original type, if it hasn't already been saved.
                            event.originalType = event.type;
                        }
                        parentEvent.type = replyType;
                        addMessagesToAlsoArchive(parentEvent, event.message_id);
                    }
                }
            }
        }

        function addEventToMessagesToMove(event) {
            //Directly add an event to the list of messages to move. The messagesToMove array actually contains request Objects.
            if (messagesToMove.every((moveItem) => event.message_id !== moveItem.msg)) {
                //Don't add duplicates.
                messagesToMove.push(new Request(event));
            }
        }

        function checkEvent(event, eventIndex, currentEvents, needParentList) {
            //Check an event to see if it directly qualifies to be archived, or if it needs further information about the post in order to determine its disposition.
            var type = event.type;
            if (!type) {
                return false;
            }

            //Direct replies archived with the parent
            if (type.archiveWithParent && event.show_parent && event.parent_id) {
                if (!isEventByIdValid(event.parent_id) || typeof eventsByNum[event.parent_id].type === 'undefined') {
                    //The parent we have isn't valid. Thus, we can't do anything about this.
                    needParentList.push(event);
                    return;
                } // else
                //Direct reply
                addMessagesToAlsoArchive(eventsByNum[event.parent_id], event.message_id);
            }

            //Direct replies archive the parent with this one.
            if (type.archiveParentWithThis && event.show_parent && event.parent_id) {
                if (!isEventByIdValid(event.parent_id) || typeof eventsByNum[event.parent_id].type === 'undefined') {
                    //The parent we have isn't valid. Thus, we can't do anything about this.
                    needParentList.push(event);
                    return;
                } // else
                //Direct reply
                addMessagesToAlsoArchive(event, event.parent_id);
            }

            //Archive with previous from an ID
            if (typeof type.archiveWithPreviousFromUserId === 'number') {
                //It's feedback like 'sd k', so search within the current batch to find the SD message to which it applies.
                //XXX This does not handle complex SD feedback (e.g. sd 2k). It just assumes the feedback applies to the first found.
                //XXX It doesn't test for SD messages which have already been moved.
                for (let feedbackToIndex = eventIndex - 1; feedbackToIndex >= 0; feedbackToIndex--) {
                    const testEvent = currentEvents[feedbackToIndex];
                    if (testEvent.user_id === type.archiveWithPreviousFromUserId) {
                        addMessagesToAlsoArchive(testEvent, event.message_id);
                        break;
                    }
                }
            }

            //Archive with next from an ID
            if (typeof type.archiveWithNextFromUserId === 'number') {
                for (let feedbackToIndex = eventIndex + 1; feedbackToIndex < currentEvents.length; feedbackToIndex++) {
                    const testEvent = currentEvents[feedbackToIndex];
                    if (testEvent.user_id === type.archiveWithNextFromUserId) {
                        addMessagesToAlsoArchive(testEvent, event.message_id);
                        break;
                    }
                }
            }

            //Archive with children
            if (type.archiveWithChildren) {
                if (Array.isArray(event.children)) {
                    event.children.forEach((childId) => {
                        addMessagesToAlsoArchive(eventsByNum[childId], event.message_id);
                    });
                }
            }

            //Archive children with this
            if (type.archiveChildrenWithThis) {
                if (Array.isArray(event.children)) {
                    event.children.forEach((childId) => {
                        addMessagesToAlsoArchive(event, childId);
                    });
                }
            }

            //Handle expired events.
            if (type.alwaysArchiveAfterDateSeconds && event.time_stamp < type.alwaysArchiveAfterDateSeconds) {
                addEventToMessagesToMove(event);
                //Replies are already handled.
                //Don't need to do anything else with this event.
                return true;
            }

            //Additional type specific tests
            if (type.additionalRequestCompleteTests && type.additionalRequestCompleteTests.some((test) => test(event))) {
                addEventToMessagesToMove(event);
                return true;
            }

            //Handle young events which need the event type changed.
            if (type.alwaysArchiveAfterDateSeconds && event.time_stamp > type.alwaysArchiveAfterDateSeconds && type.underAgeType) {
                //Remember the prior types.
                if (!Array.isArray(event.underAgeTypes)) {
                    event.underAgeTypes = [];
                }
                event.underAgeTypes.push(type);
                type = event.type = type.underAgeType;
                //Re-check with the new type. No attempt is made to make sure that there isn't a loop.
                checkEvent(event, eventIndex, currentEvents, needParentList);
                return true;
            }

            //At this point, everything should have been reduced to a primary type or already be added directly to the move list.
            if (primaryRequestTypes.indexOf(type) === -1) {
                return false;
            }

            event.onlyQuestions = (event.type && event.type.onlyQuestions) || (Array.isArray(event.underAgeTypes) && event.underAgeTypes.some((underAgeType) => underAgeType.onlyQuestions));
            event.onlyComments = (event.type && event.type.onlyComments) || (Array.isArray(event.underAgeTypes) && event.underAgeTypes.some((underAgeType) => underAgeType.onlyComments));

            // Handle non-expired primary requests, which require getting question/answer data.
            //  We really should do a full parse of the URL, including making a choice based on request type as to considering the question, answer, or comment
            //  for longer formats.
            targetRoomSet.regExp.questionAnswerPostsId.lastIndex = 0;
            var matches = event.contentNoCodeNoNonTagLinkText.match(targetRoomSet.regExp.questionAnswerPostsId);
            //For a cv-pls we assume it's the associated question when the URL is to an answer or to a comment.
            if (!event.onlyQuestions) {
                //The above will preferentially obtain questions over some answer URL formats: e.g.
                //    https://stackoverflow.com/questions/7654321/foo-my-baz/1234567#1234567
                //  That's good for cv-pls/reopen-pls, but for other types of requests we should be considering the answer instead, if the URL is the alternate answer URL.
                targetRoomSet.regExp.answerIdFromQuestionUrl.lastIndex = 0;
                const answerMatches = event.contentNoCodeNoNonTagLinkText.match(targetRoomSet.regExp.answerIdFromQuestionUrl);
                if (answerMatches) {
                    //Convert each one into a short answer URL so a single RegExp can be used below.
                    targetRoomSet.regExp.answerIdFromQuestionUrl.lastIndex = 0;
                    matches = answerMatches.map((match) => match.replace(targetRoomSet.regExp.answerIdFromQuestionUrl, `${targetRoomSet.mainSite}/a/$1`)); // eslint-disable-line no-useless-escape
                }
            }
            const isComment = event.onlyComments;
            if (matches !== null && isComment) {
                //There are URLs, but this type, or a type from which this was changed due to being too young is only comments
                targetRoomSet.regExp.commentIdFromUrl.lastIndex = 0;
                const commentMatches = event.contentNoCodeNoNonTagLinkText.match(targetRoomSet.regExp.commentIdFromUrl);
                if (commentMatches) {
                    //Convert each one into a short answer URL so a single RegExp can be used below to get the ID of the question/answer/post/comment, even though it's not an answer.
                    //  That it is a comment is tracked by isComment.
                    targetRoomSet.regExp.commentIdFromUrl.lastIndex = 0;
                    matches = commentMatches.map((match) => match.replace(targetRoomSet.regExp.commentIdFromUrl, `${targetRoomSet.mainSite}/a/$1`));
                } else {
                    matches = null;
                }
            }
            var posts = {};
            // matches will be null if an user screws up the formatting
            if (matches !== null) {
                for (const match of matches) {
                    targetRoomSet.regExp.questionAnswerPostsId.lastIndex = 0;
                    posts[targetRoomSet.regExp.questionAnswerPostsId.exec(match)[1]] = true; // eslint-disable-line no-useless-escape
                }
            }
            //Add one entry in the requests list per postId found above.
            Object.keys(posts).forEach((postId) => {
                requests.push(new Request(event, postId, isComment));
                if (!Array.isArray(event.requestedPosts)) {
                    event.requestedPosts = [];
                }
                //Not using the Request Object in order to not create a circular reference. Some testing code relies on being able to
                //  JSON.stringify events and/or requests, which would not be possible with circular references.
                event.requestedPosts.push({
                    postId,
                    isComment,
                });
            });
        }

        function checkRequests(totalRequests, questionBackoff, answerBackoff, commentBackoff) {
            //Each call to this checks one block of requests. It is looped through by being called at the end of the
            //  asynchronous operations in checkRequestsOthers.
            var remaining = getTotalLengthOfChunks(requests);
            totalRequests = typeof totalRequests !== 'number' ? remaining : totalRequests;
            var currentRequests = requests.pop();
            setProgress('checking requests', remaining, totalRequests);
            //All request types have been reduced to their primary type equivalent (cv, delv, reopen, undelete).
            //  Any reply that extends when the FireAlarm/Queen is valid has already been rolled up into the event being treated as a cv-pls.
            return checkRequestsOthers(currentRequests, totalRequests, questionBackoff, answerBackoff, commentBackoff);
        }

        function checkRequestsOthers(currentRequests, totalRequests, questionBackoff, answerBackoff, commentBackoff) {
            //The SE API is queried for each identified post, first as a question, then as an answer.
            //This could be more efficient. There is no need to request answer information when the data was returned as a question.
            //Further, it would be better to request everything as an answer first. This will give question information, which could be substituted
            //  into CLOSE/REOPEN requests which are inaccurately pointing at answers.
            //XXX This assumes that there is only one post per request. If the state of any associated post is such that the request
            //      is considered complete, then the request is listed for archiving. This should be updated to account for the possibility
            //      of having multiple posts in a request (which would also require accounting for things like a cv-pls dup with the dup-target
            //      in the request). Currently that situation is handled by the dup-question being closed qualifying the question for archiving.
            questionBackoff = questionBackoff ? questionBackoff : 0;
            answerBackoff = answerBackoff ? answerBackoff : 0;
            commentBackoff = commentBackoff ? commentBackoff : 0;

            function makeSEApiUrl(requestsForUrl, type) {
                var filters = {
                    comments: '!9Z(-x)zjA',
                    answers: '!.UDo6l2k)5RjcU7O',
                    //Add various additional fields that can affect question actionability (e.g. locked, type of closure, bounty, etc.)
                    //  We don't account for all of those, but we should add handling for them.
                    questions: '!)IMJPYyS5MRbtkRWem5RUmI*KeOh-.JZgOM2',
                };
                var filter = filters[type];
                if (typeof filter !== 'string') {
                    throw new Error('makeSEApiUrl: not a valid type:' + type);
                } //else
                return 'https://api.stackexchange.com/2.2/' + type + '/' + formatPosts(requestsForUrl) + '?' + [
                    'pagesize=100',
                    `site=${targetRoomSet.mainSiteSEApiParam}`,
                    'key=qhq7Mdy8)4lSXLCjrzQFaQ((',
                    'filter=' + filter,
                ].join('&');
            }

            function handleCompletedRequestForPost(request, responseItem) {
                //When called, it's assumed that the request is complete, for one reason or another.
                //  We remove the post from the list of posts in the event.
                //  If the post was closed as a duplicate, then we remove the duplicate post also (i.e. users often
                //    indicate both the post to close and the dup-target).
                //  If that leaves no remaining posts for that event (pointed to in the request), then the event/message
                //  is added to the list of those to archive. If not, then it's not added.
                function removePostFromEvent(event, thisPostId, thisIsComment) {
                    event.requestedPosts = event.requestedPosts.filter(({postId, isComment}) => !(+postId === +thisPostId && !!isComment === !!thisIsComment));
                }
                if (request.type === RequestTypes.CLOSE && responseItem && responseItem.closed_details && Array.isArray(responseItem.closed_details.original_questions)) {
                    //Remove the duplicate targets, if any of them exist in the message, but only for close requests.
                    responseItem.closed_details.original_questions.forEach(({question_id}) => { // eslint-disable-line camelcase
                        removePostFromEvent(request.event, question_id, false);
                    });
                }
                removePostFromEvent(request.event, request.post, request.isComment);
                //If the list of posts on the event is empty, then the event has had all of it's posts handled.
                if (request.event.requestedPosts.length === 0) {
                    addEventToMessagesToMove(request.event);
                    console.log('Message COMPLETE; it will be ARCHIVED: message_id:', request.event.message_id, '::  event:', request.event);                                                                                               //WinMerge ignore line
                } else {                                                                                                                                                                                                                    //WinMerge ignore line
                    console.log('Message NOT COMPLETE: remaining posts:', request.event.requestedPosts.length, ':: message_id:', request.event.message_id, '::  event:', request.event);                                                    //WinMerge ignore line
                }
            }

            function handleDeleteAndUndeleteWithValidData(items, requestsToHandle, itemIdPropKey) {
                //Look through the items received from the SE API and handle requests for DELETE and UNDELETE.
                const indexesToDelete = {};
                for (const item of items) {
                    requestsToHandle.forEach((currentRequest, requestIndex) => {
                        if (currentRequest.post == item[itemIdPropKey]) { // eslint-disable-line eqeqeq
                            if (item.locked_date) {
                                //The post is locked. We can't do anything. The request is thus "complete".
                                handleCompletedRequestForPost(currentRequest, item);
                                indexesToDelete[requestIndex] = true;
                                return true;
                            } // else
                            if (currentRequest.type === RequestTypes.DELETE) {
                                //Have data, so not deleted. Remove matching del-pls, as they are not fulfilled.
                                indexesToDelete[requestIndex] = true;
                                return true;
                            } // else
                            if (currentRequest.type === RequestTypes.UNDELETE) {
                                //Add matching undel-pls to move list, as they are fulfilled.
                                handleCompletedRequestForPost(currentRequest, item);
                                //No need to request the data again as an answer.
                                indexesToDelete[requestIndex] = true;
                                return true;
                            } // else
                        }
                    });
                }
                //Remove the handled requests, from the end of the array to the front (sort in reverse numerical order).
                Object.keys(indexesToDelete).sort((a, b) => b - a).forEach((index) => requestsToHandle.splice(index, 1));
            }

            function checkXhrStatus(responseData, textStatus, jqXHR) {
                return new Promise((resolve, reject) => {
                    //Reject if the status isn't 200.
                    if (jqXHR.status === 200) {
                        resolve(responseData);
                    } else {
                        reject(new Error(jqXHR));
                    }
                });
            }

            function handleQuestionResponse(responseData) {
                return new Promise((resolve) => {
                    //Deal with the SE API response for questions.
                    questionBackoff = responseData.backoff;
                    var items = responseData.items;
                    handleDeleteAndUndeleteWithValidData(items, currentRequests, 'question_id');
                    //Check for data returned for CLOSE and REOPEN
                    for (const item of items) {
                        currentRequests = currentRequests.filter((currentRequest) => {
                            if (currentRequest.post == item.question_id) { // eslint-disable-line eqeqeq
                                //Remove all matching open cv-pls, as they are not fulfilled.
                                if (item.closed_date) {
                                    //Item is closed.
                                    if (currentRequest.type === RequestTypes.CLOSE) {
                                        //CLOSE request is handled.
                                        handleCompletedRequestForPost(currentRequest, item);
                                        return false;
                                    }
                                    if (currentRequest.type === RequestTypes.REOPEN) {
                                        //REOPEN request is not handled, but we no longer need to consider it.
                                        return false;
                                    }
                                } else {
                                    //Item is open.
                                    if (currentRequest.type === RequestTypes.REOPEN) {
                                        //REOPEN request is handled.
                                        handleCompletedRequestForPost(currentRequest, item);
                                        return false;
                                    }
                                    if (currentRequest.type === RequestTypes.CLOSE) {
                                        //CLOSE request is not handled, but we no longer need to consider it.
                                        return false;
                                    }
                                }
                            }
                            return true;
                        });
                    }
                    resolve();
                });
            }

            function convertOnlyQuestionRequestsToQuestion(items, requestsToCheck, idProperty, questionIdProperty) {
                items.forEach((item) => {
                    requestsToCheck.forEach((request) => {
                        if (item[idProperty] == request.post && request.onlyQuestions) { // eslint-disable-line eqeqeq
                            //This is a request which is only about questions, but this post was identified as an answer.
                            //  Change the postId for the request to the question_id for this answer.
                            request.originalPostId = request.post;
                            request.post = item[questionIdProperty];
                            //Also change the postIds in the requestPost list;
                            request.event.requestedPosts.forEach((requestedPost) => {
                                requestedPost.originalPostId = requestedPost.postId;
                                requestedPost.postId = item[questionIdProperty];
                            });
                        }
                    });
                });
            }

            function handleAnswerResponse(responseData) {
                return new Promise((resolve) => {
                    //Deal with the SE API response for answers.
                    var answerItems = responseData.items;
                    answerBackoff = responseData.backoff;
                    handleDeleteAndUndeleteWithValidData(answerItems, currentRequests, 'answer_id');
                    //All requests which were about answers have been handled.
                    convertOnlyQuestionRequestsToQuestion(answerItems, currentRequests, 'answer_id', 'question_id');
                    resolve();
                });
            }

            function handleCommentResponse(responseData) {
                return new Promise((resolve) => {
                    var commentItems = responseData.items;
                    commentBackoff = responseData.backoff;
                    handleDeleteAndUndeleteWithValidData(commentItems, currentRequests, 'comment_id');
                    convertOnlyQuestionRequestsToQuestion(commentItems, currentRequests, 'comment_id', 'post_id');
                    resolve();
                });
            }

            function sendAjaxIfRequests(requestsToSend, endpoint) {
                //If there are requests, then send the $.ajax. If there aren't, then send an empty items.
                if (Array.isArray(requestsToSend) && requestsToSend.length) {
                    return $.ajax(makeSEApiUrl(requestsToSend, endpoint)).then(checkXhrStatus);
                } // else
                return Promise.resolve({items: []});
            }

            function getOnlyCommentRequests(requestsToFilter) {
                return requestsToFilter.filter((request) => request.isComment);
            }

            function getNonCommentRequests(requestsToFilter) {
                return requestsToFilter.filter((request) => !request.isComment);
            }

            //There should be a limit set here on the number which can be requested at a time. The SE API
            //  will consider 30 requests/s/IP "very abusive". However, it should take significantly longer
            //  for the round trip than the average 67ms which would be needed to launch 30 requests in 1s.
            //Send the request for comments, then answers, then questions (converting to questions at each earlier stage, when needed).
            return delay(commentBackoff * 1000)
                .then(() => sendAjaxIfRequests(getOnlyCommentRequests(currentRequests), 'comments'))
                .then(handleCommentResponse)
                //Send the request for answers
                .then(() => delay(answerBackoff * 1000))
                .then(() => sendAjaxIfRequests(getNonCommentRequests(currentRequests), 'answers'))
                .then(handleAnswerResponse)
                //Send the request for questions
                .then(() => delay(questionBackoff * 1000))
                .then(() => sendAjaxIfRequests(getNonCommentRequests(currentRequests), 'questions'))
                .then(handleQuestionResponse)
                .then(() => {
                    for (const request of currentRequests) {
                        if (request.type !== RequestTypes.UNDELETE) {
                            handleCompletedRequestForPost(request, null);
                        }
                    }
                    if (!requests.length) {
                        return checkDone();
                        //return false;
                    }
                    return checkRequests(totalRequests, questionBackoff, answerBackoff, commentBackoff);
                }).catch(function(xhr) {
                    nodes.cancel.disabled = false;
                    const jsonError = typeof xhr.responseJSON === 'object' ? `${xhr.responseJSON.error_id}: ${xhr.responseJSON.error_name}: ${xhr.responseJSON.error_message}` : '';
                    const errorText = `${(typeof xhr.statusText === 'string' ? `${xhr.statusText}: ` : '')}${jsonError}`;
                    console.error('Error getting data for comments, answers, and questions', '\n::  xhr:', xhr, '\n::  statusText:', xhr.statusText, '\n::  xhr.responseJSON:', xhr.responseJSON, '\n::  jsonError:', jsonError, '\n::  errorText:', errorText);
                    alert(`Something${((errorText && errorText.length < 300) ? ` (${errorText})` : '')} went wrong when trying to get data for comments, answers, and questions. Please try again.\nSee console for more information.`);
                });
        }

        function checkDone() {
            //Add any messages associated (i.e. that should be archived at the same time) with those to be archived.
            //  Non-duplicate messages are pushed onto the end of the array, and we process them. This results in
            //  recursively adding any associated with any new additions.
            return new Promise((resolve) => {
                for (let moveIndex = 0; moveIndex < messagesToMove.length; moveIndex++) {
                    const moveRequest = messagesToMove[moveIndex];
                    if (moveRequest.event.alsoArchive) {
                        moveRequest.event.alsoArchive.forEach((messageId) => { // eslint-disable-line no-loop-func
                            if (isEventByIdValid(messageId)) {
                                addEventToMessagesToMove(eventsByNum[messageId]);
                            }
                        });
                    }
                }

                if (!messagesToMove.length) {
                    nodes.indicator.value = 'no ' + (messagesToMove.length > 0 ? 'additional ' : '') + 'messages found';
                    nodes.progresswrp.style.display = 'none';
                    nodes.progress.style.width = '';
                    nodes.cancel.disabled = false;
                    setShowToBeMovedScanCount();
                    resolve();
                    return false;
                } // else
                //Remove any duplicates
                //Should really look into why we're getting duplicates. It looks like it's FireAlarm messages.
                var dupCheck = {};
                messagesToMove = messagesToMove.filter(function(message) {
                    if (dupCheck[message.msg]) {
                        return false;
                    } //else
                    dupCheck[message.msg] = true;
                    return true;
                }).sort((a, b) => a.event.message_id - b.event.message_id);
                setMessagesFound();
                nodes.movebtn.style.display = '';
                nodes.cancel.disabled = false;
                nodes.progresswrp.style.display = 'none';
                nodes.progress.style.width = '';
                showToBeMoved();
                resolve();
            });
        }

        function setMessagesFound() {
            //Set the indicator to the number of messages which were found.
            nodes.indicator.value = messagesToMove.length + ' request' + ['', 's'][+(messagesToMove.length > 1)] + ' found';
        }

        function saveMoveInformationAndMovePosts() {
            //Prior to moving posts, save the list of posts so we can undo a move by assigning those messages to the manual move list, if the user clicks 'U'.
            var ids = convertRequestsListToMessageIds(messagesToMove);
            setStorageJSON('previousMoveTo', {
                posts: ids,
                targetRoomId: defaultTargetRoom,
                //It would need to be tested to see if you really can only move from a single room, or if you can move from multiple rooms at a time.
                sourceRoomId: room,
            });
            //Use the global variables to call moveSomePosts();
            moveSomePosts(ids, defaultTargetRoom, () => {
                //All done
                nodes.progresswrp.style.display = 'none';
                nodes.progress.style.width = '';
                nodes.indicator.value = 'done';
                nodes.movebtn.style.display = 'none';
                removeShownToBeMoved();
                //Clear kept data
                reset();
            });
        }

        function formatPosts(postList) {
            //Format posts in a list of requests so they can be passed to the SE API.
            return postList.map((request) => request.post).join(';');
        }

        function convertRequestsListToMessageIds(messageList) {
            //Change the list of requests to just message Ids.
            return messageList.map((message) => message.msg);
        }

        function chunkArray(array, chunkSize) {
            //Chop a single array into an array of arrays. Each new array contains chunkSize number of
            //  elements, except the last one.
            var chunkedArray = [];
            var startIndex = 0;
            while (array.length > startIndex) {
                chunkedArray.push(array.slice(startIndex, startIndex + chunkSize));
                startIndex += chunkSize;
            }
            return chunkedArray;
        }


        // The Popup

        var shownToBeMoved;
        var priorMessagesShown = [];
        var manualMoveList = getLSManualMoveList();
        var noUserIdList = getLSnoUserIdList();
        var scanCountSpan;

        /* No longer needed. The transcript has been cleaned per current detections.
        function fillMoveListFromPopupTo100(priorManualMoveListLength) {
            if (manualMoveList.length < 100) {
                if (shownToBeMoved) {
                    addToLSManualMoveList($('.message:not(.SOCVR-Archiver-multiMove-selected)', shownToBeMoved).slice(manualMoveList.length - 100).map(function() {
                        return getMessageIdFromMessage(this);
                    }).get());
                }
            }
            const manualMoveListLengthPriorToGetMore = manualMoveList.length;
            if (priorManualMoveListLength === manualMoveListLengthPriorToGetMore) {
                //We've fetched more events, but found no new events to archive.
                setStorage('fillFromMessage-tentative', nextBefore);
                setStorage('fillFromMessage-tentative-check', Math.min.apply(null, manualMoveList));
            } else {
                if (!priorManualMoveListLength) {
                    setStorage('fillFromMessage-tentative', +getStorage('fillFromMessage'));
                }
                //Remember the youngest.
                setStorage('fillFromMessage-tentative-check', Math.min.apply(null, manualMoveList));
            }
            if (manualMoveListLengthPriorToGetMore < 100) {
                //XXX Need to handle getting to the end of the total events.
                //XXX Should track the last event added, so we can come back to it to short-circuit any large amount of scanning. However, this then means
                //      we need some way to clear that record when things break.
                var maxNextBefore = +getStorage('fillFromMessage');
                maxNextBefore = maxNextBefore > 0 ? maxNextBefore + 500 : 0;
                return getMoreEvents(5000, Math.min(nextBefore, maxNextBefore) || nextBefore).then(() => fillMoveListFromPopupTo100(priorManualMoveListLength ? priorManualMoveListLength : manualMoveListLengthPriorToGetMore));
            }
            return Promise.resolve();
        }
        */

        function getMoreEvents(moreCount, newNextBefore) {
            //Clear the requests and events, as there's no need to re-process what we've already done.
            requests = [];
            const originalEvents = events;
            events = [];
            var currentCount = +nodes.count.value;
            totalEventsToFetch = currentCount + moreCount;
            nodes.count.value = totalEventsToFetch;
            return getEventsAndScan(moreCount, typeof newNextBefore === 'number' ? newNextBefore : nextBefore).then((result) => {
                //Add the events we just fetched to the overall list
                events = originalEvents.concat(events);
                return result;
            });
        }

        function removeMessageIdFromPopupAndMoveList(messageId) {
            //Remove a message from the popup and move list.
            messagesToMove = messagesToMove.filter((message) => message.msg != messageId); // eslint-disable-line eqeqeq
            updateMessagesToMove();
            setMessagesFound();
            if (shownToBeMoved) {
                $('.SOCVR-Archiver-monologue-for-message-' + messageId, shownToBeMoved).first().remove();
            }
        }

        function setShowToBeMovedScanCount() {
            //Set the displayed number of events which have been scanned.
            if (scanCountSpan && scanCountSpan.length) {
                scanCountSpan.text(nodes.count.value);
            }
        }

        function updateMessagesToMove() {
            //Update the number of messages to move in the popup.
            $('.SOCVR-Archiver-moveCount', shownToBeMoved).first().text(messagesToMove.length + ' message' + (messagesToMove.length > 1 ? 's' : '') + ' to move');
        }

        function showToBeMoved() {
            //Create and show the archive preview.
            function moveMoveListAndResetOnSuccess(roomTarget, event) {
                moveMoveList(roomTarget, function(success) {
                    if (success) {
                        reset();
                    } else {
                        //XXX Should notify user of failure in some way.
                    }
                    event.target.blur();
                });
            }
            //The structure/CSS of this needs some more work.
            removeShownToBeMoved();
            shownToBeMoved = document.createElement('div');
            var inputHeight = $('#input-area').css('height');
            var mainHeight = /px$/.test(inputHeight) ? +inputHeight.replace(/px$/, '') + 75 : 150;
            $(shownToBeMoved).append([
                /* eslint-disable indent */
                '<div id="SOCVR-Archiver-messagesToMove-container">',
                '    <style>',
                '        #SOCVR-Archiver-messagesToMove-container {',
                '            display: block;',
                '            position: fixed;',
                '            top: 25px;',
                '            left: 2vw;',
                '            background-color: #fff;',
                '            width: calc(100% - 6.7vw);',
                '            height: calc(100% - ' + mainHeight + 'px);',
                '            z-index: 10000;',
                '            border: 2px solid;',
                '            box-shadow: 0px 0px 20px;',
                '            resize: both;',
                '            padding: 5px 5px 10px 5px;',
                ([
                    'color',
                    'image',
                    'repeat',
                    'attachment',
                    'clip',
                    'origin',
                    'position-x',
                    'position-y',
                    'size',
                ].reduce((sum, prop) => {
                    const fullProp = `background-${prop}`;
                    return `${(sum ? sum + '\n' : '')}${fullProp}: ${$body.css(fullProp)};`;
                }, '')),
                '        }',
                '        .SOCVR-Archiver-popup-button-separator,',
                '        .SOCVR-Archiver-popup-button-container {',
                '            display: inline-block;',
                '        }',
                '        .SOCVR-Archiver-button-container {',
                '            padding-left: 2vw;',
                '            padding-right: 2vw;',
                '        }',
                '        .SOCVR-Archiver-popup-button-container > div:first-of-type {',
                '            font-size: 120%;',
                '        }',
                '        .SOCVR-Archiver-popup-button-separator {',
                '            flex-grow: 100;',
                '        }',
                '        .SOCVR-Archiver-popup-button-separator.SOCVR-Archiver-popup-button-separator-after-move,',
                '        .SOCVR-Archiver-popup-button-separator.SOCVR-Archiver-popup-button-separator-before-cancel {',
                '            flex-grow: 200;',
                '        }',
                '        .SOCVR-Archiver-button-container {',
                '            text-align: center;',
                '            margin-top: .6em;',
                '            display: flex;',
                '        }',
                '        #SOCVR-Archiver-messagesToMove-container .SOCVR-Archiver-button-scanMore-container button,',
                '        #SOCVR-Archiver-messagesToMove-container .SOCVR-Archiver-button-moveList-container button {',
                '            margin: 0 0 0 .13vw;',
                '            padding-left: 3px;',
                '            padding-right: 3px;',
                '        }',
                '        #SOCVR-Archiver-messagesToMove-container button.SOCVR-Archiver-button-remove-from-move-list {',
                '            margin-right: 0.5vw;',
                '        }',
                '        #SOCVR-Archiver-messagesToMove-container .SOCVR-Archiver-button-scanMore-container,',
                '        #SOCVR-Archiver-messagesToMove-container .SOCVR-Archiver-button-moveList-container {',
                '            margin-right: 1.0vw;',
                '        }',
                '        #SOCVR-Archiver-messagesToMove-container .SOCVR-Archiver-button-scanMore-container,',
                '        #SOCVR-Archiver-messagesToMove-container .SOCVR-Archiver-button-moveList-container {',
                '            margin-left: 2.0vw;',
                '        }',
                '        #SOCVR-Archiver-messagesToMove-container .SOCVR-Archiver-button-cancel {',
                '            margin-left: 2.0vw;',
                '        }',
                '        #SOCVR-Archiver-messagesToMove-container button {',
                '            margin-left: 1vw;',
                '            margin-right: 1vw;',
                '        }',
                '        #SOCVR-Archiver-messagesToMove-container .monologue {',
                '            min-width: initial;',
                '            position: relative;',
                '        }',
                '        #SOCVR-Archiver-messagesToMove-container h1 {',
                '            text-align: center;',
                '        }',
                '        .SOCVR-Archiver-moveCount-container {',
                '            text-align: center;',
                '            margin-top: .6em;',
                '        }',
                '        .SOCVR-Archiver-moveCount-separator {',
                '            flex-grow: 100;',
                '        }',
                '        .SOCVR-Archiver-moveCount-container > span {',
                '            margin-left: 1.0vw;',
                '            margin-right: 1.0vw;',
                '            font-size: 120%;',
                '        }',
                '        #SOCVR-Archiver-messagesToMove-container .messages {',
                '            position: relative;',
                '        }',
                '        #SOCVR-Archiver-messagesToMove-container .messages .SOCVR-Archiver-close-icon {',
                '            top: 2px;',
                '        }',
                '        .SOCVR-Archiver-moveCount {',
                '            font-weight: bold;',
                '        }',
                '        .SOCVR-Archiver-latestDate {',
                '            font-size: 120%;',
                '        }',
                '        .SOCVR-Archiver-moveMessages-inner {',
                '            height: 100%;',
                '            position: relative;',
                '            display: flex;',
                '            flex-direction: column;',
                '        }',
                '        .SOCVR-Archiver-moveMessages-container {',
                '            width: 100%;',
                '            position: relative;',
                '            flex-grow: 100;',
                '            margin-top: 1em;',
                '        }',
                '        .SOCVR-Archiver-moveMessages {',
                '            margin: 0 auto;',
                '            display: block;',
                '            overflow-y: auto;',
                '            height: calc(100% - 1.5vh);',
                '            position: absolute;',
                //This padding and width assume that this is being used with the URRS. These should be normalized for use without the URRS
                //  and these in the CSS which the URRS adds to chat.
                '            padding: 5px 60px 0px 0px;',
                '            width: calc(100% - 60px);', //This is using box-sizing: content-box, so have to account for the 60px padding.
                '        }',
                '        .SOCVR-Archiver-important-display-block {',
                '            display: block !important;',
                '        }',
                // Close icon CSS is from the answer to "Pure css close button - Stack Overflow"
                // at https://stackoverflow.com/a/20139794, copyright 2013 by Craig Wayne,
                // licensed under CC BY-SA 3.0 (https://creativecommons.org/licenses/by-sa/3.0/).
                // Some modifications have been made.
                '        .SOCVR-Archiver-close-icon {',
                '            display: block;',
                '            box-sizing: border-box;',
                '            width: 20px;',
                '            height: 20px;',
                '            border-width: 1px;',
                '            border-style: solid;',
                '            border-color: #dd0000;',
                '            border-radius: 100%;',
                '            background: -webkit-linear-gradient(-45deg, transparent 0%, transparent 46%, white 46%,  white 56%,transparent 56%, transparent 100%), -webkit-linear-gradient(45deg, transparent 0%, transparent 46%, white 46%,  white 56%,transparent 56%, transparent 100%);',
                '            background-color: #dd0000;',
                '            box-shadow:0px 0px 1px 1px rgba(0,0,0,0.5);',
                '            cursor: pointer;',
                '            position: absolute;',
                '            top: 0px;',
                '            right: 0px;',
                '            z-index: 1000;',
                '            transform: translateX(50%) translateY(-50%) scale(0.8, 0.8);',
                '            -webkit-transform: translateX(50%) translateY(-50%) scale(0.8, 0.8);',
                '            -ms-transform: translateX(50%) translateY(-50%) scale(0.8, 0.8);',
                '        }',
                '        .SOCVR-Archiver-close-icon:hover {',
                '            border-color: #ff0000;',
                '            background-color: #ff0000;',
                '        }',
                '        #SOCVR-Archiver-messagesToMove-container > .SOCVR-Archiver-close-icon {',
                '            top: 0px;',
                '            right: 0px;',
                '        }',
                '    </style>',
                '    <div class="SOCVR-Archiver-close-icon" title="Cancel"></div>',
                '    <div class="SOCVR-Archiver-moveMessages-inner">',
                '        <div>',
                '            <h1>Move messages to ' + defaultTargetRoomObject.fullName + '</h1>',
                '        </div>',
                '        <div class="SOCVR-Archiver-moveCount-container">',
                '            <span class="SOCVR-Archiver-moveCount-separator"></span>',
                '            <span class="SOCVR-Archiver-scan-count-container">Scanned: ',
                '                <span class="SOCVR-Archiver-scan-count">' + nodes.count.value + '</span>',
                '            </span>',
                '            <span class="SOCVR-Archiver-latestDate">',
                '                from current back to ' + nodes.scandate.textContent.replace(/\.000/, '').replace(/T/, ' '),
                '            </span>',
                '        </div>',
                '        <div class="SOCVR-Archiver-button-container">',
                '            <div class="SOCVR-Archiver-popup-button-container">',
                '            <div class="SOCVR-Archiver-moveCount"></div>',
                '                <button class="SOCVR-Archiver-button-move" title="Move all of the messages listed in this popup to the ' + defaultTargetRoomObject.shortName + '">Move these to the ' + defaultTargetRoomObject.shortName + '</button>',
                '            </div>',
                '            <div class="SOCVR-Archiver-popup-button-separator SOCVR-Archiver-popup-button-separator-after-move"></div>',
                '            <div class="SOCVR-Archiver-popup-button-container SOCVR-Archiver-button-scanMore-container">',
                '                <div>Scan more:</div>',
                '                <div class="SOCVR-Archiver-button-row-container"><!--',
                '                 --><button class="SOCVR-Archiver-button-1kmore" title="Scan 1,000 more">1k</button><!--',
                '                 --><button class="SOCVR-Archiver-button-10kmore" title="Scan 10,000 more">10k</button><!--',
                '                 --><button class="SOCVR-Archiver-button-100kmore" title="Scan 100,000 more">100k</button><!--',
                '             --></div>',
                '            </div>',
                '            <div class="SOCVR-Archiver-popup-button-separator"></div>',
                '            <div class="SOCVR-Archiver-popup-button-container SOCVR-Archiver-button-moveList-container">',
                '                <div class="SOCVR-Archiver-moveList-container-text">Manual Move List (0):</div>',
                '                <div class="SOCVR-Archiver-button-row-container"><!--',
                '                 --><button class="SOCVR-Archiver-button-set-as-move-list" title="Set the Manual Move List to the messages shown in this popup.">Set</button><!--',
                '                 --><button class="SOCVR-Archiver-button-add-to-move-list" title="Add all messages shown in this popup to the Manual Move List.">Add</button><!--',
                '                 --><button class="SOCVR-Archiver-button-remove-from-move-list" title="Remove the messages shown in this popup from the Manual Move List.">Remove</button><!--',
                //'                <button class="SOCVR-Archiver-button-fill-move-list" title="Fill the Manual Move List to 100. If needed, additional events are fetched and classified.\nThe first time you click this, it will take a while for it to go through the events back to where the transcript has been cleaned out. If you then move those it finds, where you left off will be remembered.\nThis can be used to slowly clean out the transcript.\nHowever, the transcript could be cleaned out in bulk. Up to 2,048 messages can be moved in one move-message.\nIf you\'re moving messages which are currently displayed in chat, then the move containing those is limited to 100, due to a display bug in SE chat. If you try to move more than 100, then additional individual moves are made. If you\'re not moving any messages which are visible in chat, then the maximum is 2048.\nIf you select more than those numbers, then the messages will be grouped in chunks and multiple moves will be made.">Fill</button>',
                (targetRoomsByRoomNumberOrder.reduce((htmlText, key) => {
                    const current = targetRoomsByRoomNumber[key];
                    return htmlText + `--><button class="SOCVR-Archiver-move-list-button SOCVR-Archiver-button-${current.classInfo}-move-list" title="Move all messages on the Manual Move List to ${current.fullName}.">${current.classInfo}</button><!--`;
                }, '')),
                '             --></div>',
                '            </div>',
                '            <div class="SOCVR-Archiver-popup-button-separator SOCVR-Archiver-popup-button-separator-before-cancel"></div>',
                '            <div class="SOCVR-Archiver-popup-button-container">',
                '                <div>&nbsp;</div>',
                '                <button class="SOCVR-Archiver-button-cancel">Cancel</button>',
                '            </div>',
                '        </div>',
                '        <div class="SOCVR-Archiver-moveMessages-container">',
                '            <div class="SOCVR-Archiver-moveMessages">',
                '            </div>',
                '        </div>',
                '    </div>',
                '</div>',
                /* eslint-enable indent */
            ].join('\n'));
            var moveMessagesDiv = $('.SOCVR-Archiver-moveMessages', shownToBeMoved).first();
            scanCountSpan = $('.SOCVR-Archiver-scan-count', shownToBeMoved).first();
            //Build the HTML for all the messages and add them to the DOM.
            var messagesHtml = '';
            messagesToMove.sort((a, b) => a.event.message_id - b.event.message_id).forEach(function(message) {
                messagesHtml += makeMonologueHtml(message.event);
            });
            moveMessagesDiv[0].insertAdjacentHTML('beforeend', messagesHtml);
            //Events
            $('#SOCVR-Archiver-messagesToMove-container > .SOCVR-Archiver-close-icon', shownToBeMoved).on('click', resetIfThisNotDisabled);
            $('.SOCVR-Archiver-button-cancel', shownToBeMoved).first().on('click', resetIfThisNotDisabled);
            $('.SOCVR-Archiver-button-move', shownToBeMoved).first().on('click', saveMoveInformationAndMovePosts);
            $('.SOCVR-Archiver-button-1kmore', shownToBeMoved).first().on('click', getMoreEvents.bind(null, 1000));
            $('.SOCVR-Archiver-button-10kmore', shownToBeMoved).first().on('click', getMoreEvents.bind(null, 10000));
            $('.SOCVR-Archiver-button-100kmore', shownToBeMoved).first().on('click', getMoreEvents.bind(null, 100000));
            $('.SOCVR-Archiver-button-add-to-move-list', shownToBeMoved).first().on('click', function() {
                //Add those messages displayed in the popup to the manual move list.
                addToLSManualMoveList(convertRequestsListToMessageIds(messagesToMove));
                this.blur();
            });
            $('.SOCVR-Archiver-button-set-as-move-list', shownToBeMoved).first().on('click', function() {
                //Set the manual move list to those messages displayed in the popup.
                clearLSManualMoveList();
                addToLSManualMoveList(convertRequestsListToMessageIds(messagesToMove));
                this.blur();
            });
            $('.SOCVR-Archiver-button-remove-from-move-list', shownToBeMoved).first().on('click', function() {
                //Remove those messages displayed in the popup from the manual move list.
                removeFromLSManualMoveList(convertRequestsListToMessageIds(messagesToMove));
                this.blur();
            });
            /* The entirety of the transcript has been bulk archived. This is no longer needed.
            $('.SOCVR-Archiver-button-fill-move-list', shownToBeMoved).first().on('click', function() {
                //Remove those messages displayed in the popup from the manual move list.
                fillMoveListFromPopupTo100();
                //If fillMoveListFromPopupTo100() doesn't complete immediately, then the popup is destroyed and recreated, which means that blurring doesn't matter.
                this.blur();
            });
            */
            targetRoomsByRoomNumberOrder.forEach((key) => {
                const current = targetRoomsByRoomNumber[key];
                $(`.SOCVR-Archiver-button-${current.classInfo}-move-list`, shownToBeMoved).first().on('click', moveMoveListAndResetOnSuccess.bind(null, current.roomNumber));
            });
            moveMessagesDiv.on('click', function(event) {
                //A click somewhere in the messages div.
                var target = $(event.target);
                if (target.hasClass('SOCVR-Archiver-close-icon')) {
                    //Click is on a close/delete icon, so remove the message.
                    event.preventDefault();
                    event.stopPropagation();
                    const messageId = target.data('messageId');
                    removeMessageIdFromPopupAndMoveList(messageId);
                } else if (target.hasClass('newreply')) {
                    //Let the user reply to a message displayed in the popup.
                    event.preventDefault();
                    event.stopPropagation();
                    const message = target.closest('.message');
                    const messageId = getMessageIdFromMessage(message);
                    const input = $('#input');
                    const oldInputVal = input.val();
                    if (oldInputVal) {
                        input.val(oldInputVal.replace(/^(?::\d+ ?)?/, ':' + messageId + ' '));
                    } else {
                        input.val(':' + messageId + ' ');
                    }
                }
            });
            updateMessagesToMove();
            $(document.body).prepend(shownToBeMoved);
            doOncePerChatChangeAfterDOMUpdate();
            getReplyNode();
            moveMessagesDiv.find('.message .meta').filter(function() {
                return !$(this).children('.newreply').length;
            }).each(function() {
                $(this).append(replyNode.clone(false));
            });
            //Request that the unclosed request review script update request-info for the page, including the popup.
            var shownToBeMovedMessages = $(shownToBeMoved).find('.message');
            var eventToSend = (shownToBeMovedMessages.length === priorMessagesShown.length) ? 'urrs-Request-Info-update-desired' : 'urrs-Request-Info-update-immediate';
            //Send the event, but after we're done processing & the display updates.
            setTimeout(() => {
                window.dispatchEvent(new CustomEvent(eventToSend, {
                    bubbles: true,
                    cancelable: true,
                }));
            }, 0);
            priorMessagesShown = shownToBeMovedMessages;
            //Every once in a while the first .tiny-signature in the popup ends up with display:none;
            //This is a hack to try to eliminate the problem. The issue has not been reliably duplicated, so it's unclear if this will actually solve the issue.
            //It'd be better to find out what's causing the problem, but it looks like it's something in SE's code
            //  adding the style (probably a .hide() ) for some reason.
            //Temporarily do this again.  This should give enough time to notice that the problem exists and wasn't corrected by the first run one.
            //  Even with doing this at 50 and 5000, the problem still prevented the tiny-signature from showing.
            [50, 1000, 5000, 10000].forEach((time) => {
                setTimeout(() => {
                    if (moveMessagesDiv) {
                        $('.monologue .signature', moveMessagesDiv).each(function() {
                            const children = $(this).children();
                            if (children.length === 1) {
                                children.addClass('SOCVR-Archiver-important-display-block');
                            } else {
                                children.removeClass('SOCVR-Archiver-important-display-block');
                            }
                        });
                    }
                }, time);
            });
        }

        function removeShownToBeMoved() {
            //Remove the to-be-archived preview
            if (shownToBeMoved) {
                shownToBeMoved.remove();
                //Remove references to the popup so it can be garbage collected.
                shownToBeMoved = null;
                scanCountSpan = null;
            }
        }

        function activateMessageDropdownMenusOnAddedMessages() {
            //This can't just enable the menu on the archiver popup, because the functions in the menu rely on getting the message ID
            //  from the id attribute of the .message which is done with .replace("message-", "");
            const stockImg = $('.message:not(.SOCVR-Archiver-contains-deleted-content):not(.SOCVR-Archiver-added-message) .action-link').first();
            const addedMenus = $('.message.SOCVR-Archiver-added-message .action-link');
            addedMenus.replaceWith(() => stockImg.clone(true).removeClass('edits'));
        }

        function makeMonologueHtml(messageEvent, useUTC) {
            //Create the HTML for a monologue containing a single message.

            /* linkifyTextURLs was originally highlight text via RegExp
             * Copied by Makyen from his use of it in MagicTag2, which was copied from Makyen's
             * answer to: Highlight a word of text on the page using .replace() at:
             *     https://stackoverflow.com/a/40712458/3773011
             * and substantially rewritten here.
             */
            function linkifyTextURLs(element, useSpan) {
                //This changes bare http/https/ftp URLs into links with link-text a shortened version of the URL.
                //  If useSpan is truthy, then a span with the new elements replaces the text node.
                //  If useSpan is falsy, then the new nodes are added as children of the same element as the text node being replaced.
                //  The [\u200c\u200b] characters are added by SE chat to facilitate word-wrapping & should be removed from the URL.
                const urlSplitRegex = /((?:\b(?:https?|ftp):\/\/)(?:[\w.~:\/?#[\]@!$&'()*+,;=\u200c\u200b-]{2,}))/g; // eslint-disable-line no-useless-escape
                const urlRegex = /(?:\b(?:https?|ftp):\/\/)([\w.~:\/?#[\]@!$&'()*+,;=\u200c\u200b-]{2,})/g; // eslint-disable-line no-useless-escape
                if (!element) {
                    throw new Error('element is invalid');
                }

                function handleTextNode(textNode) {
                    const textNodeParent = textNode.parentNode;
                    if (textNode.nodeName !== '#text' ||
                        textNodeParent.nodeName === 'SCRIPT' ||
                        textNodeParent.nodeName === 'STYLE'
                    ) {
                        //Don't do anything except on text nodes, which are not children
                        //  of <script> or <style>.
                        return;
                    }
                    const origText = textNode.textContent;
                    urlSplitRegex.lastIndex = 0;
                    const splits = origText.split(urlSplitRegex);
                    //Only change the DOM if we detected a URL in the text
                    if (splits.length > 1) {
                        //Create a span to hold the new elements.
                        const newSpan = document.createElement('span');
                        splits.forEach((split) => {
                            if (!split) {
                                return;
                            } //else
                            urlRegex.lastIndex = 0;
                            //Remove the extra characters SE chat adds to long character sequences.
                            split = split.replace(/[\u200c\u200b]/g, '');
                            const newHtml = split.replace(urlRegex, (match, p1) => {
                                //Try to match what SE uses.
                                if (p1.length > 32) {
                                    //Reduce length & add ellipse.
                                    p1 = p1.split(/\//g).reduce((sum, part, index) => {
                                        if (sum[sum.length - 1] === '…' || sum.length >= 31) {
                                            //We've found all we want.
                                            return sum;
                                        }
                                        if (index === 0) {
                                            if (part.length > 31) {
                                                return part.slice(0, 29) + '…';
                                            }
                                            return part;
                                        }
                                        if ((sum.length + part.length) > 29) {
                                            return sum + '/…';
                                        }
                                        return sum + '/' + part;
                                    }, '');
                                }
                                return `<a href="${match}">${p1}</a>`;
                            });
                            //Compare the strings, as it should be faster than a second RegExp operation and
                            //  lets us use the RegExp in only one place.
                            if (newHtml !== split) {
                                newSpan.insertAdjacentHTML('beforeend', newHtml);
                            } else {
                                //No text replacement was made; just add a text node.
                                // These are placed as explicit text nodes because it's possible that the textContent could be valid HTML.
                                // e.g. what if we're replacing into "You want it to look like <b>https://example.com</b>", where that's
                                //  the <b> & </b> are actual text, not elements.
                                newSpan.appendChild(document.createTextNode(split));
                            }
                        });
                        //Replace the textNode with either the new span, or the new nodes.
                        if (useSpan) {
                            //Replace the textNode with the new span containing the link.
                            textNodeParent.replaceChild(newSpan, textNode);
                        } else {
                            const textNodeNextSibling = textNode.nextSibling;
                            while (newSpan.firstChild) {
                                textNodeParent.insertBefore(newSpan.firstChild, textNodeNextSibling);
                            }
                            textNode.remove();
                        }
                    }
                }
                const textNodes = [];
                //Create a NodeIterator to get the text nodes in the body of the document
                const nodeIter = document.createNodeIterator(element, NodeFilter.SHOW_TEXT);
                let currentNode = nodeIter.nextNode();
                //Add the text nodes found to the list of text nodes to process, if it's not a child of an <a>, <script>, or <style>.
                while (currentNode) {
                    let parent = currentNode.parentNode;
                    while (
                        parent && parent.nodeName !== 'A' &&
                        parent.nodeName !== 'SCRIPT' &&
                        parent.nodeName !== 'STYLE' &&
                        parent.nodeName !== 'CODE'
                    ) {
                        parent = parent.parentElement;
                    }
                    if (!parent && currentNode.textContent.length > 7) {
                        textNodes.push(currentNode);
                    }
                    currentNode = nodeIter.nextNode();
                }
                //Process each text node
                textNodes.forEach(function(el) {
                    handleTextNode(el);
                });
                return element;
            }

            const userId = messageEvent.user_id ? +messageEvent.user_id : '';
            let userAvatar16 = '';
            if (userId && avatarList[userId]) {
                userAvatar16 = avatarList[userId][16];
            }
            const userName = messageEvent.user_name;
            const messageId = messageEvent.message_id;
            let contentHtml = messageEvent.content ? messageEvent.content : '<span class="deleted">(removed)</span>';
            contentHtml = linkifyTextURLs(getHTMLTextAsDOM(contentHtml)).innerHTML;
            //Get a timestamp in the local time that's in the same format as .toJSON().
            const timestamp = (new Date((messageEvent.time_stamp * 1000) - (useUTC ? 0 : timezoneOffsetMs))).toJSON().replace(/T(\d\d:\d\d):\d\d\.\d{3}Z/, ' $1');
            return [
                //From transcript
                /* beautify preserve:start *//* eslint-disable indent */
                '<div class="monologue user-' + userId + (userId == me ? ' mine' : '') + ' SOCVR-Archiver-monologue-for-message-' + messageId + '">', // eslint-disable-line eqeqeq
                '    <div class="signature">',
                '        <div class="tiny-signature">',
                            (userAvatar16 ? '' +
                                '        <div class="avatar avatar-16">' +
                                '            <img src="' + userAvatar16 + '" alt="' + userName + '" width="16" height="16">' +
                                '        </div>' +
                                '' : ''),
                '            <div class="username"><a href="/users/' + userId + '/' + userName + '" title="' + userName + '">' + userName + '</a></div>',
                '        </div>',
                '    </div>',
                '    <div class="messages">',
                '        <div class="SOCVR-Archiver-close-icon" data-message-id="' + messageId + '" title="Don\'t move"></div>',
                '        <div class="message SOCVR-Archiver-added-message" id="SOCVR-Archiver-message-' + messageId + '">',
                '            <div class="timestamp">' + timestamp + '</div>',
                '            <a name="' + messageId + '" href="/transcript/' + room + '?m=' + messageId + '#' + messageId + '"><span style="display:inline-block;" class="action-link"><span class="img"> </span></span></a>',
                             (messageEvent.show_parent ? '<a class="reply-info" title="This is a reply to an earlier message" href="/transcript/message/' + messageEvent.parent_id + '#' + messageEvent.parent_id + '"></a>' : ''),
                '            <div class="content">' + contentHtml,
                '            </div>',
                '            <span class="flash">',
                '            </span>',
                '        </div>',
                '    </div>',
                '    <div class="clear-both" style="height:0">&nbsp;</div> ',
                '</div>',
                /* eslint-enable indent *//* beautify preserve:end */
            ].join('\n');
        }

        //CHAT listener

        var chatListenerAddMetaTimeout = 0;
        var debounceGetAvatars = 0;

        function doOncePerChatChangeAfterDOMUpdate(chatInfo) {
            //Things that we do to when the Chat changes to keep the page updated.
            addReplyToMine();
            addMoveToInMeta();
            recordOldestMessageInChat();
            if (!chatInfo || chatInfo.event_type === 10 || chatInfo.event_type === 20) {
                //This isn't called by a CHAT event, or a message was deleted (10) or moved-in (20) (which might already be deleted).
                addAllDeletedContent();
            }
            showAllManualMoveMessages(true);
            //There's no reason to do getAvatars rapidly.
            clearTimeout(debounceGetAvatars);
            debounceGetAvatars = setTimeout(getAvatars, 1000);
        }

        function listenToChat(chatInfo) {
            //Called when an event happens in chat. For add/delete this is called prior to the message being added or deleted.
            //Delay until after the content has been added. Only 0ms is required.
            //A delay of 100ms groups multiple CHAT events that happen at basically the same time.
            //  For showing deleted messages, it gives other implementations (e.g. non-privileged saving of deleted content) a chance to
            //  handle the deletion first.
            clearTimeout(chatListenerAddMetaTimeout);
            chatListenerAddMetaTimeout = setTimeout(doOncePerChatChangeAfterDOMUpdate, 100, chatInfo);
            if (chatInfo.event_type === 19) {
                //A message was moved out. We want to remove it from the moveList.
                //This tracks messages which other people move. The user's own moves should be handled elsewhere.
                //  This depends on having a tab open to chat.
                var movedMessageId = chatInfo.message_id;
                removeFromLSManualMoveList(movedMessageId);
                //Remove it from the popup
                removeMessageIdFromPopupAndMoveList(movedMessageId);
            }
        }
        if (CHAT && typeof CHAT.addEventHandlerHook === 'function') {
            CHAT.addEventHandlerHook(listenToChat);
        }

        //Add deleted content to be shown on hover.
        var deletedMessagesWithoutDeletedContent;
        var delayBetweenGettingDeletedContent = 500;
        var gettingDeletedContent = 0;

        function addAllDeletedContent() {
            //Go through the DOM and add the content back in for all deleted messages which don't already have it added back in.
            if (!showDeleted) {
                //Deleted messages are not to be shown here.
                return;
            }
            if (!gettingDeletedContent && (!deletedMessagesWithoutDeletedContent || !deletedMessagesWithoutDeletedContent.length)) {
                deletedMessagesWithoutDeletedContent = $('.content .deleted').parent().filter(function() {
                    return !$(this).children('.SOCVR-Archiver-deleted-content').length;
                }).closest('.message');
                if (deletedMessagesWithoutDeletedContent.length) {
                    addNextDeletedContent();
                }
            }
        }

        function addNextDeletedContent() {
            //Get the content for the next deleted message and insert it into the DOM.
            function doMoreDeletedContentIfNeeded(noDelay) {
                const delayToGetNextDeleted = noDelay ? 0 : delayBetweenGettingDeletedContent;
                if (deletedMessagesWithoutDeletedContent.length) {
                    gettingDeletedContent = setTimeout(addNextDeletedContent, delayToGetNextDeleted);
                } else {
                    gettingDeletedContent = 0;
                    setTimeout(addAllDeletedContent, delayToGetNextDeleted);
                }
            }
            gettingDeletedContent = 1;
            if (deletedMessagesWithoutDeletedContent.length) {
                const message = deletedMessagesWithoutDeletedContent.last();
                //Remove the message we're working on.
                deletedMessagesWithoutDeletedContent.splice(deletedMessagesWithoutDeletedContent.length - 1, 1);
                const isInProcessOrHasDeletedContent = message.hasClass('SOCVR-Archiver-deleted-content-in-process') || !!message.find('.SOCVR-Archiver-deleted-content').length;
                if (isInProcessOrHasDeletedContent) {
                    //Skip this message
                    doMoreDeletedContentIfNeeded(true);
                    return;
                }
                //Mark this message as in the process of being handled, so there isn't duplicate fetches of history, should another script be doing the same thing.
                message.addClass('SOCVR-Archiver-deleted-content-in-process');
                const messageId = getMessageIdFromMessage(message);
                getMessageMostRecentVersionFromHistory(messageId, function(deletedContent) {
                    message.removeClass('SOCVR-Archiver-deleted-content-in-process');
                    if (deletedContent) {
                        addDeletedContentToMessageId(message, deletedContent);
                    }
                    doMoreDeletedContentIfNeeded();
                });
            } else {
                gettingDeletedContent = 0;
                setTimeout(addAllDeletedContent, delayBetweenGettingDeletedContent);
            }
        }

        function addDeletedContentToMessageId(message, deletedContent) {
            //Actually add the deleted content to the message
            const newContent = $('.content', message);
            if (!newContent.find('.SOCVR-Archiver-deleted-content').length) {
                //Be sure to not double-add, as this can be called asynchronously after the prior check for the existence of the deleted content.
                deletedContent.removeClass('content').addClass('SOCVR-Archiver-deleted-content');
                newContent.append(deletedContent);
                //Indicate to the user that the content is available.
                const marker = $('<span class="SOCVR-Archiver-deleted-content-marker">&#128065;</span>');
                newContent.find('.deleted').append(' ').append(marker.attr('title', 'Click this icon to show all deleted messages.')).after(marker.clone().attr('title', 'This message was deleted. Click this icon to show deleted content only on hover.'));
                newContent.closest('.message').addClass('SOCVR-Archiver-contains-deleted-content');
            }
        }

        function fechHistoryForMessage(messageId, callback) {
            //Get the history page for a message.
            $.ajax({
                type: 'GET',
                url: 'https://' + window.location.hostname + '/messages/' + messageId + '/history',
                success: callback,
                error: function(xhr, status, error) {
                    console.error('AJAX error getting history', '\n::  xhr:', xhr, '\n::  status:', status, '\n::  error:', error, '\n::  room:', room, '\n::  fkey.length,:', fkey.length, '\n::  messageId:', messageId);
                },
            });
        }

        function getMessageMostRecentVersionFromHistory(messageId, callback) {
            //Get the last version of a message prior to it being deleted.
            fechHistoryForMessage(messageId, function(data) {
                var newDoc = jQuery.parseHTML(data);
                callback($('.message .content', newDoc).first());
            });
        }

        //Manual message MoveTo

        var priorSelectionMessageIds = [];

        function moveSomePostsWithConfirm(posts, targetRoomId, callback) {
            //Confirm that the user wants to move the files.
            var countPosts = 0;
            if (!Array.isArray(posts)) {
                countPosts = 1;
            } else {
                if (Array.isArray(posts[0])) {
                    //Already chunked
                    posts.forEach(function(chunk) {
                        countPosts += chunk.length;
                    });
                } else {
                    countPosts = posts.length;
                }
            }
            if (countPosts && window.confirm('Move ' + countPosts + ' message' + (countPosts === 1 ? '' : 's') + ' to ' + targetRoomsByRoomNumber[targetRoomId].fullName + '?')) {
                //Save a copy of the last information.
                setStorageJSON('previousMoveTo', {
                    posts: posts,
                    targetRoomId: targetRoomId,
                    //It would need to be tested to see if you really can only move from a single room, or if you can move from multiple rooms at a time.
                    sourceRoomId: room,
                });
                //Move the posts
                moveSomePosts(posts, targetRoomId, callback);
            } else {
                if (typeof callback === 'function') {
                    callback(false);
                }
            }
        }

        var moveSomePostsTotal = 0;

        function moveSomePosts(posts, targetRoomId, callback, postsWithoutUserId) {
            //Actually move some posts by sending a POST to the chat API.
            //posts can be an String/Number of postId, Array of posts, or already chunked Array of post Arrays.

            function doneMovingMessages() {
                //Tasks after the messages have been moved.
                setProgress('moving messages', moveSomePostsTotal, moveSomePostsTotal);
                moveSomePostsTotal = 0;
                //Done with messages. Normal completion.
                if (Array.isArray(postsWithoutUserId) && postsWithoutUserId.length) {
                    alert('The following messages don\'t have an identified "user_id". Trying to move them will result in an API error. Any other messages which were to be moved were moved. See the console for additional information.\n\n' + postsWithoutUserId.join(', '));
                }
                if (typeof callback === 'function') {
                    callback(true);
                }
            }
            if (!targetRoomId || +targetRoomId < 1 || !posts || (Array.isArray(posts) && posts.length === 0)) {
                //Something is wrong with the arguments.
                if (typeof callback === 'function') {
                    callback(false);
                }
                return false;
            }
            posts = Array.isArray(posts) ? posts : [posts];
            if (!Array.isArray(posts[0])) {
                //Chunk the array, if it's not already chunked
                //This works around a bug in Chat which causes user's chat room displays not to update if the move is larger than 100 messages and includes
                //  messages which are displayed in chat (i.e. that aren't old).
                recordOldestMessageInChat(); //If we're on a chat page, make sure we have the oldest.
                const oldestChatMessageId = getStorage('oldestChatMessageId-' + room);
                const postsNotInChat = [];
                postsWithoutUserId = [];
                //Separate out those displayed in chat and those not & those without a user_id, which cause errors when we try to move them.
                const postsInChat = posts.filter((post) => {
                    //Message ID's are in numeric order. If we find one that's > then the ID of the oldest on the
                    //  chat for the room, then it's visible.
                    if ((isEventByIdValid(post) && !eventsByNum[post].user_id) || noUserIdList.indexOf(post) > -1) {
                        postsWithoutUserId.push(post);
                        return false;
                    }
                    if (+post > +oldestChatMessageId) {
                        return true;
                    }
                    postsNotInChat.push(post);
                    return false;
                });
                if (postsWithoutUserId.length) {
                    console.log('The following messages do not have an identified "user_id". Trying to move them would result in an API error. postsWithoutUserId:', postsWithoutUserId);
                }
                const inChatChunked = chunkArray(postsInChat, smallChunkSize);
                const lastInChatChunked = inChatChunked[inChatChunked.length - 1]; //This will be undefined if there were no messages in postsInChat;
                const lastInChatChunkedLength = lastInChatChunked ? inChatChunked[inChatChunked.length - 1].length : 0;
                if (lastInChatChunked && ((lastInChatChunkedLength + postsNotInChat.length) <= smallChunkSize)) {
                    //The messages not displayed in chat will fit in the last request for displayed. Thus, there's no need for a separate chunk.
                    inChatChunked[inChatChunked.length - 1] = lastInChatChunked.concat(postsNotInChat);
                    posts = inChatChunked.concat(chunkArray(postsWithoutUserId, bigChunkSize));
                } else {
                    posts = inChatChunked.concat(chunkArray(postsNotInChat, bigChunkSize));
                }
            }
            var remaining = getTotalLengthOfChunks(posts);
            moveSomePostsTotal = Math.max(moveSomePostsTotal, remaining);

            var messagesBeingMoved = posts.shift();
            if (!messagesBeingMoved) {
                //If every message that's supposed to be moved is a no-userId messages, then messagesBeingMoved may be invalid.
                doneMovingMessages();
                return;
            } //else
            setProgress('moving messages', messagesBeingMoved.length + moveSomePostsTotal - remaining, moveSomePostsTotal);

            var ajaxInfo = {
                type: 'POST',
                data: {
                    ids: messagesBeingMoved.join(','),
                    to: targetRoomId + '',
                    fkey: fkey,
                },
                url: '/admin/movePosts/' + (room ? room : roomForMostRecentlyAddedManualMove),
                success: function() {
                    if (!posts.length) {
                        doneMovingMessages();
                        return false;
                    } //else
                    //More messages to move. Only issue one move every 5s.
                    setTimeout(moveSomePosts, 5000, posts, targetRoomId, callback, postsWithoutUserId);
                },
                error: function(xhr, status, error) {
                    console.error(
                        'AJAX Error moving some posts',
                        '\n::  xhr:', xhr,
                        '\n::  status:', status,
                        '\n::  error:', error,
                        '\n::  targetRoomId:', targetRoomId,
                        //The fkey is private, so its value should not be printed in something that might be copy-and-pasted to another person for debugging.
                        '\n::  fkey.length:', fkey.length, //should be 32;
                        '\n::  messagesBeingMoved.length:', messagesBeingMoved.length,
                        '\n::  messagesBeingMoved:', messagesBeingMoved,
                        '\n::  formatted messagesBeingMoved:', messagesBeingMoved.join(','),
                        '\n::  posts:', posts,
                        '\n::  callback:', callback,
                        '\n::  ajaxInfo:', ajaxInfo
                    );
                    alert('$.ajax encountered an error moving some posts. See console for details.' + (error && error.length < 100 ? ' error: ' + error : ''));
                    nodes.cancel.disabled = false;
                },
            };
            $.ajax(ajaxInfo);
        }

        function makeMetaRoomTargetsHtml() {
            //Create the HTML for the in-question moveTo controls for the default room.
            //  This is used for all pages where the messages should be in one room.
            //  It's insufficient for user pages and searches without restriction to a specific room.
            return makeMetaRoomTargetsHtmlByOrderAndRooms(targetRoomsByRoomNumberOrder, targetRoomsByRoomNumber);
        }

        function makeMetaRoomTargetsHtmlByOrderAndRooms(roomOrder, roomsByRoomNumber) {
            //Create the HTML for the in-question moveTo controls for rooms in an order and given rooms data.
            return roomOrder.reduce((htmlText, key) => {
                var targetRoom = roomsByRoomNumber[key];
                return htmlText + '<span class="SOCVR-Archiver-in-message-move-button SOCVR-Archiver-move-to-' +
                    targetRoom.shortName + '" title="Move this/selected message(s) (and any already in the list) to ' +
                    targetRoom.fullName + '." data-room-id="' +
                    targetRoom.roomNumber + '">' +
                    targetRoom.displayed + '</span>';
            }, '') + [
                //Add message
                '<span class="SOCVR-Archiver-in-message-move-button SOCVR-Archiver-move-to-add-to-list" title="Add this/selected message(s) to the list." data-room-id="add">+</span>',
                //remove message
                '<span class="SOCVR-Archiver-in-message-move-button SOCVR-Archiver-move-to-remove-from-list" title="Remove this/selected message(s) from the list." data-room-id="remove">-</span>',
                //clear list
                '<span class="SOCVR-Archiver-in-message-move-button SOCVR-Archiver-move-to-clear-list" title="Clear the list." data-room-id="clear">*</span>',
                //Undo/re-select the last moved list
                '<span class="SOCVR-Archiver-in-message-move-button SOCVR-Archiver-move-to-reselect" title="Re-select the messages which were last moved. This can be used to undo the last move by reselecting them (this control); going to the room they have been moved to; find one that\'s selected; then, manually moving them back by clicking on the control you want them moved to." data-room-id="reselect">U</span>',
            ].join('');
        }

        function getMessageRoomFromMessage($el) {
            return +($el.closest('.message').find('.action-link').first().closest('a').attr('href').match(/\/(\d+)/) || ['', ''])[1];
        }

        function addMoveToInMeta() {
            if (!showMeta) {
                //The meta-move UI elements are not to be shown in messages here.
                return;
            }
            //Brute force add movement to all messages meta
            const messages = $('.monologue .message');
            const messagesWithoutMeta = messages.filter(function() {
                return !$(this).children('.meta').length;
            });
            //Add meta to any messages which don't have it.
            messagesWithoutMeta.children('.request-info, .flash:not(.request-info ~ .flash)').before('<span class="meta"></span>');
            //On pages where a .meta doesn't normally exist, and if AIM has already added information to the message, then copy the
            //  AIM information into the newly created meta.
            messagesWithoutMeta.each(function() {
                const message = $(this);
                const nonMetaAiInfo = message.children('.ai-information');
                if (nonMetaAiInfo.length > 0) {
                    const meta = message.find('.meta');
                    const metaAiInfo = meta.find('.ai-information');
                    if (metaAiInfo.length === 0) {
                        meta.append(nonMetaAiInfo.clone(true).addClass('inline'));
                    }
                }
            });
            const messagesMetaWithoutAddedMeta = messages.find('.meta').filter(function() {
                return !$(this).children('.SOCVR-Archiver-in-message-move-button').length;
            });
            messagesMetaWithoutAddedMeta.each(function() {
                //Put the moveTo controls to the left of the normal controls. This leaves the normal controls where they usually are
                //  and places the reply-to control far away from lesser used controls.
                const $this = $(this);
                let toAdd = '';
                let doAdd = true;
                if (isUsersPage || (isSearch && !room)) {
                    const messageRoomNumber = getMessageRoomFromMessage($this);
                    toAdd = (siteAllRooms[messageRoomNumber] || {metaHTML: ''}).metaHTML;
                    if (!isModerator && !roRooms[messageRoomNumber]) {
                        doAdd = false;
                    }
                }
                if (!toAdd) {
                    toAdd = addedMetaHtml;
                }
                if (doAdd) {
                    $(this).prepend(toAdd);
                    //Add the moveList length to this message.
                    addManualMoveListLength(null, this);
                }
            });
            //Remove the meta we added from any of those which we didn't also add the moveToMeta
            messagesWithoutMeta.find('.meta').filter(function() {
                return !$(this).children('.SOCVR-Archiver-in-message-move-button').length;
            }).remove();
        }

        function getMessageIdFromMessage(message) {
            //Get the message ID from a message element or the first element in a jQuery Object.
            var el = (message instanceof jQuery) ? message[0] : message;
            if (message instanceof jQuery) {
                if (message.length) {
                    message = message[0];
                } else {
                    return 0;
                }
            }
            if (message) {
                return +el.id.replace(/(?:SOCVR-Archiver-)?message-/, '');
            } //else
            return 0;
        }

        function moveMoveList(roomId, callback) {
            //Set things up and actually move the messages on the manual move list.
            moveSomePostsWithConfirm(manualMoveList, roomId, function(moved) {
                // Should consider here if we really want to clear the list.
                // Not clearing it gives the user the opportunity to reverse the
                // move by going to the other room, where the messages will
                // already be selected.  Clearing it feels more like what people
                // would expect.
                if (moved) {
                    //The move was successful
                    const tentative = +getStorage('fillFromMessage-tentative');
                    const tentativeCheck = +getStorage('fillFromMessage-tentative-check');
                    if (manualMoveList.indexOf(tentativeCheck) !== -1) {
                        //This will be imperfect, but it should cover the case where the user hasn't adjusted which message is the the youngest
                        //  contained in the manual move list. Should really check the entirety of the list instead of just the youngest.
                        //XXX Given that this is imperfect, there needs to be some way to reset the number.
                        setStorage('fillFromMessage', tentative);
                    }
                    //Only get one chance to set fillFromMessage
                    setStorage('fillFromMessage-tentative', -1);
                    //Clear the list. Keep the list if it wasn't.
                    clearLSManualMoveList();
                    //Clear the list again, in case there's delays between tabs.
                    setTimeout(clearLSManualMoveList, 2000);
                }
                if (typeof callback === 'function') {
                    callback(moved);
                }
            });
        }

        function moveToInMetaHandler() {
            //Handle a click on the moveTo controls
            /* jshint -W040 */ //This is called as a jQuery event handler, which explicitly sets `this`.
            var $this = $(this);
            var roomId = this.dataset.roomId;
            /* jshint +W040 */
            var message = $this.closest('.message');
            if (message.length) {
                var messageId = getMessageIdFromMessage(message);
                if (messageId) {
                    if (roomId === 'add') {
                        addToLSManualMoveList(messageId);
                        addMessageToNoUserListIfMonologueIsNoUser(message);
                        addToLSManualMoveList(priorSelectionMessageIds);
                    } else if (roomId === 'remove') {
                        removeFromLSManualMoveList(messageId);
                        addMessageToNoUserListIfMonologueIsNoUser(message);
                        removeFromLSManualMoveList(priorSelectionMessageIds);
                    } else if (roomId === 'clear') {
                        clearLSManualMoveList();
                    } else if (roomId === 'reselect') {
                        reselectLastLSMoveList();
                    } else if (+roomId) {
                        addToLSManualMoveList(messageId);
                        addMessageToNoUserListIfMonologueIsNoUser(message);
                        addToLSManualMoveList(priorSelectionMessageIds);
                        moveMoveList(roomId);
                    }
                }
            }
            //Clear the selection
            priorSelectionMessageIds = [];
            window.getSelection().removeAllRanges();
        }

        /* Unused
        function addMessageIdToNoUserListIfMonologueIsNoUser(messageId) {
            var message = $('#message-' + messageId);
            if (message.length) {
                addMessageToNoUserListIfMonologueIsNoUser(message);
            }
        }
        */

        function addMessageToNoUserListIfMonologueIsNoUser(message) {
            //This would be better if we generated a list of messages to add all at once, but it should be very rare. Thus, one at a time shouldn't have much impact.
            if (message.first().closest('.monologue').hasClass('user-')) {
                const messageId = getMessageIdFromMessage(message);
                if (messageId) {
                    addToLSnoUserIdList(messageId);
                }
            }
        }

        function getMessagesInSelection() {
            //Convert the selection to a list of messageIds
            var messageIdsObject = {};

            function addMessageIdToSetAndCheckForNoUserId(message) {
                const messageId = getMessageIdFromMessage(message);
                if (messageId) {
                    messageIdsObject[messageId] = true;
                }
                addMessageToNoUserListIfMonologueIsNoUser(message);
            }
            var selection = window.getSelection();
            var selectionText = selection.toString();
            if (typeof selectionText === 'string' && selectionText.length) {
                //We don't want to use a selection the user can't see.
                //If we did, there are cases where the anchorNode and focusNode can be set from prior clicks.
                addMessageIdToSetAndCheckForNoUserId($(selection.anchorNode).closest('.message'));
                addMessageIdToSetAndCheckForNoUserId($(selection.focusNode).closest('.message'));
                //AIM (Charcoal HQ script) messes up just testing for the .message being part of the selection.
                //  With AIM running we need to check more than just the .message, which is several times as many elements to check.
                $('.message,.message *').each(function() {
                    if (selection.containsNode(this, false)) {
                        addMessageIdToSetAndCheckForNoUserId($(this).closest('.message'));
                    }
                });
            }
            return Object.keys(messageIdsObject);
        }

        $(document).on('mousedown', '.SOCVR-Archiver-in-message-move-button', function() {
            //Clicking on the control sets the selection to the current control. Thus, we need
            //  to get the selection on mousedown and save it. We have to convert to messageIds here
            //  because just saving the selection Object doesn't work (at least on FF56).
            priorSelectionMessageIds = getMessagesInSelection();
        });

        //Add to meta when the page announces it's ready. (This is supposed to work, but doesn't actually help).
        window.addEventListener('message', doOncePerChatChangeAfterDOMUpdate, true);
        //Accept notifications specific to this script that the page has changed.
        window.addEventListener('SOCVR-Archiver-Messages-Changed', doOncePerChatChangeAfterDOMUpdate, true);
        var ajaxCompleteTimer;
        //Global jQuery AJAX listener: Catches user requesting older chat messages
        $(document).ajaxComplete(function(event, jqXHR, ajaxSettings) {
            if (!/(?:messages\/\d+\/history)/i.test(ajaxSettings.url)) {
                clearTimeout(ajaxCompleteTimer);
                ajaxCompleteTimer = setTimeout(doOncePerChatChangeAfterDOMUpdate, 500);
            }
        });
        //Lazy way of adding moveInMeta after messages load
        $(document).on('click', '.SOCVR-Archiver-in-message-move-button', moveToInMetaHandler);
        //Add meta when room is ready
        if (CHAT && CHAT.Hub && CHAT.Hub.roomReady && typeof CHAT.Hub.roomReady.add === 'function') {
            if (CHAT.Hub.roomReady.fired()) {
                //The room is ready now.
                doOncePerChatChangeAfterDOMUpdate();
            } else {
                CHAT.Hub.roomReady.add(doOncePerChatChangeAfterDOMUpdate);
            }
        }

        //Keep various values stored in localStorage consistent with what's stored there.
        window.addEventListener('storage', function(event) {
            if (event.key.indexOf(lsPrefix) === 0) {
                if (event.key.indexOf('manualMoveList') > -1) {
                    getLSManualMoveList();
                    showAllManualMoveMessages();
                } else if (event.key.indexOf('noUserIdList') > -1) {
                    getLSnoUserIdList();
                }
            }
        });

        function recordOldestMessageInChat() {
            //Keep track of the oldest message displayed in chat.
            if (isChat) {
                //This is a chat page. We want to know if any manual move messages are visible in the chat.
                var firstChatMessage = document.querySelector('#chat .message');
                if (firstChatMessage) {
                    const firstId = getMessageIdFromMessage(firstChatMessage);
                    if (firstId) {
                        setStorage('oldestChatMessageId-' + room, firstId);
                    }
                }
            }
        }

        function getLSManualMoveList() {
            //Get the manual move list from localStorage.
            var list = getStorageJSON('manualMoveList');
            manualMoveList = list ? list : [];
            //Make sure the list is always numbers, not strings.
            manualMoveList = manualMoveList.map(function(value) {
                return +value;
            });
            return manualMoveList;
        }

        function setLSManualMoveList() {
            //Set the manual move list from localStorage.
            setStorageJSON('manualMoveList', manualMoveList);
        }

        function addToLSManualMoveList(values) {
            //Add a message number to the manual move list, making sure it doesn't duplicate any already existing in the list.
            //This assumes the list stored in memory is primary. i.e. a change that's occurred in localStorage, but which has not been
            //  read in yet will be overwritten.
            if (addNonDuplicateValuesToList(manualMoveList, values)) {
                values = Array.isArray(values) ? values : [values];
                const lastValue = values[values.length - 1];
                const lastHref = $(`#message-${lastValue} .action-link`).closest('a').attr('href');
                if (lastHref) {
                    roomForMostRecentlyAddedManualMove = (lastHref.match(/\/transcript\/(\d+)\?/) || [0, 0])[1];
                    setStorage('roomForMostRecentlyAddedManualMove', roomForMostRecentlyAddedManualMove);
                }
                setLSManualMoveList(manualMoveList);
                showAllManualMoveMessages();
            }
        }

        function removeFromLSManualMoveList(values) {
            //Remove all copies of a message number from the manual move list.
            //This assumes the list stored in memory is primary. i.e. a change that's occurred in localStorage, but which has not been
            //  read in yet will be overwritten.
            if (filterValuesFromList(manualMoveList, values)) {
                setLSManualMoveList(manualMoveList);
                showAllManualMoveMessages();
            }
        }

        function clearLSManualMoveList() {
            //Clear the manual move list
            manualMoveList = [];
            setLSManualMoveList(manualMoveList);
            //Clear the no-user list, as we only need to remember the ones which are also on the manualMoveList.
            //  This prevents it from growing without bound and any error which results in the list containing
            //  messages inaccurately to be cleared with clearing the manualMoveList.
            clearLSnoUserIdList();
            showAllManualMoveMessages();
        }

        function reselectLastLSMoveList() {
            //Restore the manual move list from the previous move. Used to implement "undo".
            var priorMove = getStorageJSON('previousMoveTo');
            manualMoveList = priorMove ? priorMove.posts : [];
            manualMoveList = priorMove.posts;
            setLSManualMoveList(manualMoveList);
            showAllManualMoveMessages();
        }

        var mostRecentMessageListCount;
        var messageListCountAddedFirstTime = false;

        function addManualMoveListLength(selector, element) {
            //Add/change all the tooltips showing the manual move list length.
            selector = selector ? selector : '.SOCVR-Archiver-in-message-move-button, .SOCVR-Archiver-button-moveList-container button';
            element = element ? element : document;
            var length = manualMoveList.length;
            var newText = '[List has ' + length + ' message' + (length === 1 ? '' : 's') + '.]';
            $(selector, element).each(function() {
                this.title = this.title.replace(/^((?:.(?!\[))+)(?:\s*\[List.*)?$/, '$1 ' + newText);
            });
            if (shownToBeMoved) {
                $('.SOCVR-Archiver-move-list-button', shownToBeMoved).prop('disabled', !length);
                $('.SOCVR-Archiver-button-remove-from-move-list', shownToBeMoved).first().prop('disabled', !length);
                const textEl = $('.SOCVR-Archiver-moveList-container-text', shownToBeMoved)[0];
                textEl.textContent = textEl.textContent.replace(/^([^():]+).*$/, '$1(' + length + '):');
            }
        }

        function showAllManualMoveMessages(forceLengthUpdate) {
            //Make sure any visible messages have, or don't have, the class indicating they are on the manual move list.
            $('.message').each(function() {
                const messageId = getMessageIdFromMessage(this);
                if (manualMoveList.indexOf(messageId) > -1) {
                    $(this).addClass('SOCVR-Archiver-multiMove-selected');
                } else {
                    $(this).removeClass('SOCVR-Archiver-multiMove-selected');
                }
            });
            //No need to change these, if the value didn't change.
            var length = manualMoveList.length;
            if (forceLengthUpdate || mostRecentMessageListCount !== length || !messageListCountAddedFirstTime) {
                messageListCountAddedFirstTime = true;
                addManualMoveListLength();
                mostRecentMessageListCount = length;
            }
            recordOldestMessageInChat();
        }

        //Add Deleted messages to transcript pages

        /* We get transcript events here and in other scripts (other scripts?). The "API" response data is shared, rather than get it twice.
         *   typeof window.transcriptChatEvents === 'undefined'
         *     No process has attempted to get the events.
         *   window.transcriptChatEvents = null
         *     A process is attempting to get the events.
         *   Array.isArray(window.transcriptChatEvents) === true
         *     Getting events is complete in a script.
         *   Array.isArray(window.transcriptChatEvents) === true && window.transcriptChatEvents.length > 0
         *     Events are valid on window.transcriptChatEvents
         *   CustomEvent 'transcript-events-received' is fired from the script which received the transcript events.
         *   CustomEvent 'transcript-events-received' is received in all scripts not doing the AJAX call to get the transcript events.
         */
        function getAndShareTranscriptEvents() {
            let gettingTranscriptEvents = false;
            //Get the events covering the time-frame shown in this transcript page.
            //  Currently this does not guarantee to get all messages that are in the time-frame
            //  of this transcript page. It normally will, but it's not checked for.
            // It's assumed that the following chatTranscriptEndMessagesOffset offset beyond the last shown in this
            // transcript page is sufficient, in total messages on the chat server, to get all deleted messages for this
            // room that are in the time-frame for this transcript page.  While this is often true, it is by no means
            // guaranteed.
            return new Promise((resolve, reject) => {
                function getTranscriptEvents() {
                    const chatTranscriptEndMessagesOffset = 15000;
                    return new Promise((getTranscriptEventsResolve, getTranscriptEventsReject) => {
                        //This should be based on the time we determine for the transcript, not just the IDs. This is so we
                        //  have enough messages to cover any ones which were deleted in the time-frame of the current transcript display.
                        let transcriptEvents = [];
                        const messages = $('#transcript .message, #conversation .message');
                        const firstMessage = messages.first();
                        const lastMessage = messages.last();
                        const firstMessageId = getMessageIdFromMessage(firstMessage);
                        const lastMessageId = getMessageIdFromMessage(lastMessage);

                        //Unfortunately, there doesn't appear to be an endpoint to get messages by date, only by message number.
                        //In order to get any deleted messages that are beyond the last one shown in the room, but still in the
                        //  time-frame of the current transcript page, we guess at a message ID which is hopefully somewhat beyond
                        //  the last message actually in the time-frame.
                        getEvents(room, fkey, 500, lastMessageId + chatTranscriptEndMessagesOffset).then((firstResponse) => {
                            transcriptEvents = firstResponse.events;
                            const firstEventId = transcriptEvents[0].message_id;
                            const lastEventId = transcriptEvents[transcriptEvents.length - 1].message_id;
                            if (firstEventId < firstMessageId) {
                                getTranscriptEventsResolve(transcriptEvents);
                                return;
                            } //else
                            //Currently, we only do one more getEvents. This should do more, if needed.
                            getEvents(room, fkey, 500, firstEventId).then((secondResponse) => {
                                transcriptEvents = secondResponse.events.concat(transcriptEvents);
                                const secondFirstEventId = transcriptEvents[0].message_id;
                                //This is just assumed to be enough.
                                getTranscriptEventsResolve(transcriptEvents);
                            }, (error) => {
                                getTranscriptEventsReject(error);
                            });
                        }, (error) => {
                            getTranscriptEventsReject(error);
                        });
                    });
                }

                function getAndShareTranscriptEventsProgress() {
                    if (typeof window.transcriptChatEvents === 'undefined') {
                        window.transcriptChatEvents = null; //Indicate that we are requesting the chat events.
                        gettingTranscriptEvents = true;
                        getTranscriptEvents().then((response) => {
                            window.transcriptChatEvents = response;
                            getAndShareTranscriptEventsProgress();
                        }, () => {
                            //We can continue upon failure.
                            console.error('Getting transcript events failed:');
                            window.transcriptChatEvents = [];
                            reject(new Error('Getting transcript events failed'));
                        });
                        return;
                    }
                    if (window.transcriptChatEvents === null) {
                        if (gettingTranscriptEvents) {
                            //We are currently getting the events & will be called when they are available.
                            return;
                        }
                        //Some other process is getting the events.
                        //  We wait to be informed that they are available.
                        window.addEventListener('transcript-events-received', getAndShareTranscriptEventsProgress);
                        return;
                    }
                    window.removeEventListener('transcript-events-received', getAndShareTranscriptEventsProgress);
                    if (gettingTranscriptEvents) {
                        window.dispatchEvent(new CustomEvent('transcript-events-received', {
                            bubbles: true,
                            cancelable: true,
                        }));
                    }
                    //Only respond to the event once after events are available.                                                                                                                                                                             //WinMerge ignore line
                    //The events are available.
                    resolve(window.transcriptChatEvents);
                }
                getAndShareTranscriptEventsProgress();
            });
        }

        function insertEventBeforeAfter(event, refEl, isAfter) {
            //This is not a full implementation. It is for "before", but not for after.
            //  The special cases of After:
            //    Where the message which should be inserted after is the middle of
            //      multiple messages in a monologue is not handled (the monologue would
            //      need to be split, as we do in the "before" case.
            //    Where the message which should be inserted after is after the current
            //      monologue, but could be inserted into the next monologue, due to
            //      being by the same author as the next monologue.
            //  After is really only tested for inserting after the last message in
            //    the transcript (i.e. appending to the current monologue, if the same
            //    user, or as a new monologue if a different user.
            const beforeAfter = isAfter ? 'after' : 'before';
            const nextMessageId = getMessageIdFromMessage(refEl);
            const nextMessage = $(refEl);
            const nextMessageMonologue = nextMessage.closest('.monologue');
            //For situations where the message is being added as a duplicate (e.g. a popup), the makeMonologueHtml()
            //  function creates the HTML with IDs in the format "SOCVR-Archiver-message-<ID#>".
            //  Here we're adding non-duplicated messages to the transcript, so we want the actual ID to be "message-<ID#>".
            const newMonologueText = makeMonologueHtml(event, true).replace('SOCVR-Archiver-message-', 'message-');
            const newMonologue = $('<div></div>)').append(newMonologueText).find('.monologue');
            const newMessage = newMonologue.find('.message');
            const monologueUserId = +nextMessageMonologue.attr('class').match(/\buser-(\d+)\b/)[1];
            if (monologueUserId === event.user_id) {
                //It's from the same user. Just add the message.
                nextMessage[beforeAfter](newMessage);
                return newMessage[0];
            }// else
            if (!isAfter && nextMessage.prev().is('.message')) {
                //The message is not the first one in the monologue.
                //We need to break the monologue into two.
                const dupMessageMonologue = nextMessageMonologue.clone(true);
                dupMessageMonologue.find('.message').filter(function() {
                    return nextMessageId <= getMessageIdFromMessage(this);
                }).remove();
                nextMessageMonologue.find('.message').filter(function() {
                    return nextMessageId > getMessageIdFromMessage(this);
                }).remove();
                nextMessageMonologue.find('.timestamp').remove();
                nextMessageMonologue.before(dupMessageMonologue);
                nextMessageMonologue.addClass('nextMessageMonologue');
            }
            const prevMonologue = nextMessageMonologue.prev();
            if (!isAfter && prevMonologue.is('.monologue')) {
                const prevMonologueUserId = +(prevMonologue.attr('class').match(/\buser-(\d+)\b/) || [null, null])[1];
                if (prevMonologueUserId !== null && prevMonologueUserId === event.user_id) {
                    //The previous monologue is from the same user. Just add the message.
                    //If we can't find the userId for the previous monologue, then we assume that
                    //  it's a different user.
                    prevMonologue.find('.message').last().after(newMessage);
                    return;
                }// else
            }
            //The message we're inserting before is (now) the first one in the monologue.
            //  Thus, we just need to insert the new monologue entry.
            nextMessageMonologue[beforeAfter](newMonologue);
            return newMessage[0];
        }

        function addDeletedEventsToTranscript(allEvents) {
            //This assumes that all transcript pages have < 500 messages, which in brief testing appears true.
            //It also assumes that adding 15000 to the last message number will result in both getting any messages
            //  which are after the last non-deleted one in the day and that it won't result in too few events at the
            //  beginning of the period. This really should be replaced with code that makes sure we obtain all
            //  the relevant events for the period covered by the transcript.
            const [transcriptDateStart, transcriptDateEnd] = getTranscriptDate();
            const transcriptStart = transcriptDateStart.getTime() / 1000;//SE Chat events are to the second, not millisecond.
            const transcriptEnd = transcriptDateEnd.getTime() / 1000;//SE Chat events are to the second, not millisecond.
            const messages = $('#transcript .message');
            //Get and array of the transcript events which are in the time-frame of this transcript page and are message-insert events (type 1).
            const transcriptEvents = allEvents.filter((event) => (event.event_type === 1 && event.time_stamp >= transcriptStart && event.time_stamp <= transcriptEnd));
            //We have two lists: a list of message elements and a list of events. The list of events should have more
            //  items than the list of message elements. Both lists are sorted in ascending order.
            //We're going to walk through the two lists, adding additional messages in where they don't exist.
            //  However, we don't want to consider any messages in the event list which are outside of the time-frame
            //  of this transcript.
            let eventIndex = 0;
            for (let messageIndex = 0; messageIndex < messages.length; messageIndex++) {
                //Loop through all the messages on the page from oldest to newest.
                const messageId = getMessageIdFromMessage(messages[messageIndex]);
                if (!transcriptEvents[eventIndex]) {
                    //Out of events, which means that for some reason we didn't start getting them at, or beyond, the events on the transcript page.
                    return;
                }
                if (transcriptEvents[eventIndex].message_id > messageId) {
                    //We don't have events covering the current message.
                    console.error('Too few events: event ID:' + transcriptEvents[eventIndex].message_id + ' > messageId: ' + messageId);
                    continue;
                }
                while (transcriptEvents[eventIndex].message_id < messageId) {
                    insertEventBeforeAfter(transcriptEvents[eventIndex], messages[messageIndex], false);
                    eventIndex++;
                } //else
                eventIndex++;
            }
            let lastMessageEl = messages[messages.length - 1];
            while (eventIndex < transcriptEvents.length) {
                //Add the events that are after the last message on the page
                lastMessageEl = insertEventBeforeAfter(transcriptEvents[eventIndex], lastMessageEl, true);
                eventIndex++;
            }
            //Let anything listening know that the transcript messages were updated.
            window.dispatchEvent(new CustomEvent('transcript-messages-updated', {
                bubbles: true,
                cancelable: true,
            }));
            activateMessageDropdownMenusOnAddedMessages();
            //We've potentially added messages to the transcript. Reposition the transcript to be at the same place
            //  it would be had all of the current content been in the page that was delivered by SE.
            const urlParams = new URLSearchParams(window.location.search);
            let urlMessageId = urlParams.get('m');
            urlMessageId = urlMessageId ? urlMessageId : (window.location.pathname.match(/\/message\/(\d+)$/) || [0, 0])[1];
            if (urlMessageId) {
                //We add the .highlight here, because the target message may be one that is deleted, which we've now added.
                const urlMessage = $(`#message-${urlMessageId}`).addClass('highlight');
                window.scrollTo(window.scrollX, urlMessage.offset().top - 100);
            }
            doOncePerChatChangeAfterDOMUpdate();
        }

        /*Copied from the Unclosed Request Review Script & modified to get start and end times.*/
        function getTranscriptDate() {
            //Get the date for the transcript
            const bodyDateStart = document.body.dataset.archiverTranscriptDateStart;
            const bodyDateEnd = document.body.dataset.archiverTranscriptDateEnd;
            if (bodyDateStart && bodyDateEnd) {
                return [new Date(bodyDateStart), new Date(bodyDateEnd)];
            }
            const months3charLowerCase = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
            const infoDiv = document.getElementById('info');
            const weekdaySpan = infoDiv.querySelector('.icon .calendar .weekday');
            const weekdayParsed = /(\w{3})\s*(?:'(\d{2}))?/.exec(weekdaySpan.textContent);
            const monthText = weekdayParsed[1].toLowerCase();
            const monthIndex = months3charLowerCase.indexOf(monthText);
            const year = weekdayParsed[2] ? +weekdayParsed[2] + 2000 : (new Date()).getUTCFullYear();
            const dayNumber = +weekdaySpan.nextSibling.textContent;
            const mainDiv = document.getElementById('main');
            const pageNumberSpan = mainDiv.querySelector('.page-numbers.current');
            const pageNumberParsed = pageNumberSpan ? /(\d{2})\s*:\s*(\d{2})\s*-\s*(\d{2})\s*:\s*(\d{2})\s*/.exec(pageNumberSpan.textContent) : [0, 0, 0, 0, 0];
            const hourStart = +pageNumberParsed[1];
            const minuteStart = +pageNumberParsed[2];
            const hourEnd = +pageNumberParsed[3];
            const minuteEnd = +pageNumberParsed[4];
            //Days are UTC days
            const transcriptDateStart = new Date(Date.UTC(year, monthIndex, dayNumber, hourStart, minuteStart));
            const transcriptDateEnd = new Date(Date.UTC(year, monthIndex, (dayNumber + ((hourEnd || minuteEnd) ? 0 : 1)), hourEnd, minuteEnd));
            if (transcriptDateStart.valueOf() > Date.now()) {
                //The transcript is for the prior year, but isn't indicating that in the date marker. This
                //  happens for months in the prior year that are ~2 months later in the year.
                const correctYear = transcriptDateStart.getUTCFullYear() - 1;
                transcriptDateStart.setUTCFullYear(correctYear);
                transcriptDateEnd.setUTCFullYear(correctYear);
            }
            //Store the date for the page, so we don't have to parse it more than once.
            document.body.dataset.archiverTranscriptDateStart = transcriptDateStart.toJSON();
            document.body.dataset.archiverTranscriptDateEnd = transcriptDateEnd.toJSON();
            return [transcriptDateStart, transcriptDateEnd];
        }

        //Handle lists

        function addNonDuplicateValuesToList(list, values) {
            //Generic add non-duplicates to an Array..
            const type = typeof values;
            const isArray = Array.isArray(values);
            if (type !== 'string' && type !== 'number' && !isArray) {
                return;
            }
            values = isArray ? values : [values];
            let didChange = false;
            values.forEach(function(value) {
                value = +value;
                if (list.indexOf(value) === -1) {
                    //Not a duplicate
                    list.push(value);
                    didChange = true;
                }
            });
            return didChange;
        }

        function filterValuesFromList(list, values) {
            //Removes, in-place, a list of values from an Array.
            const type = typeof values;
            const isArray = Array.isArray(values);
            if (type !== 'string' && type !== 'number' && !isArray) {
                return;
            }
            values = isArray ? values : [values];
            let didChange = false;
            //Modify list in-place & remove all duplicates.
            values.forEach(function(value) {
                //Convert value to number.
                value = +value;
                for (let index = list.length - 1; index >= 0; index--) {
                    if (value === +list[index]) {
                        list.splice(index, 1);
                        didChange = true;
                    }
                }
            });
            return didChange;
        }

        //noUserIdList: Stores a list of messages which are known to not have a user_id, and thus can't be moved w/o causing an error.
        function getLSnoUserIdList() {
            //Get the noUserIDList from localStorage.
            var list = getStorageJSON('noUserIdList');
            noUserIdList = list ? list : [];
            //Make sure the list is always numbers, not strings.
            noUserIdList = noUserIdList.map(function(value) {
                return +value;
            });
            return noUserIdList;
        }

        function setLSnoUserIdList() {
            //Store the noUserIDList in localStorage.
            setStorageJSON('noUserIdList', noUserIdList);
        }

        function addToLSnoUserIdList(values) {
            //Add a message to the noUserIDList, without adding duplicates.
            //This assumes the list stored in memory is primary. i.e. a change that's occurred in localStorage, but which has not been
            //  read in yet will be overwritten.
            if (addNonDuplicateValuesToList(noUserIdList, values)) {
                setLSnoUserIdList(noUserIdList);
            }
        }

        /* Unused
        function removeFromLSnoUserIdList(values) {
            //This assumes the list stored in memory is primary. i.e. a change that's occurred in localStorage, but which has not been
            //  read in yet will be overwritten.
            if (filterValuesFromList(noUserIdList, values)) {
                setLSnoUserIdList(noUserIdList);
            }
        }
        */

        function clearLSnoUserIdList() {
            //Clear the noUserIDList.
            noUserIdList = [];
            setLSnoUserIdList(noUserIdList);
        }

        function getAvatars() {
            //Collect the existing avatar information from localStorage and in the page.
            var listChanged = false;
            avatarList = getStorageJSON('avatarList') || {};
            $('.signature').each(function() {
                var $this = $(this);
                var userId = +$this.closest('.monologue')[0].className.replace(/.*\buser-(\d+)\b.*/, '$1');
                if (userId) {
                    if (!avatarList[userId]) {
                        avatarList[userId] = {};
                        listChanged = true;
                    }
                    var avatar16 = $this.find('.avatar-16 img').first();
                    if (avatar16.length) {
                        var avatar16src = avatar16[0].src;
                        if (avatar16src && avatarList[userId][16] !== avatar16src) {
                            avatarList[userId][16] = avatar16src;
                            listChanged = true;
                        }
                    }
                    var avatar32 = $this.find('.avatar-32 img').first();
                    if (avatar32.length) {
                        var avatar32src = avatar32[0].src;
                        if (avatar32src && avatarList[userId][32] !== avatar32src) {
                            avatarList[userId][32] = avatar32src;
                            listChanged = true;
                        }
                    }
                }
            });
            if (listChanged) {
                setStorageJSON('avatarList', avatarList);
            }
        }

        $(window).on('keydown', function(event) {
            //Don't show the meta-move UI when the Caps-Lock key is pressed.
            if (event.key === 'CapsLock') {
                $body.addClass('SOCVR-Archiver-hide-message-meta-menu');
            }
        });

        $(window).on('keyup', function(event) {
            //The Caps-Lock key is released, let the meta-move UI show.
            if (event.key === 'CapsLock') {
                $body.removeClass('SOCVR-Archiver-hide-message-meta-menu');
            }
        });
        $body.on('click', '.SOCVR-Archiver-deleted-content-marker', function(event) {
            if (!event.archiverAlreadyToggledDeleted) {
                $body.toggleClass('SOCVR-Archiver-alwaysShowDeleted');
                setStorage('alwaysShowDeleted', $body.hasClass('SOCVR-Archiver-alwaysShowDeleted'));
                event.archiverAlreadyToggledDeleted = true;
            }
        });
        $body.toggleClass('SOCVR-Archiver-alwaysShowDeleted', getStorage('alwaysShowDeleted') === 'true');

        if (isTranscript && showDeleted) {
            getAndShareTranscriptEvents().then(addDeletedEventsToTranscript);
        }
        doOncePerChatChangeAfterDOMUpdate();

        //Copied from my own (Makyen's) code on Charcoal's AIM
        function getEffectiveBackgroundColor(element, defaultColor) {
            element = element instanceof jQuery ? element : $(element);
            defaultColor = defaultColor ? defaultColor : 'rgb(255,255,255)';
            let testEl = element.first();
            const colors = [];
            do {
                try {
                    const current = testEl.css('background-color').replace(/\s+/g, '').toLowerCase();
                    if (current && current !== 'transparent' && current !== 'rgba(0,0,0,0)') {
                        colors.push(current);
                    }
                    if (current.indexOf('rgb(') === 0) {
                        // There's a color without transparency.
                        break;
                    }
                } catch (err) {
                    // This should always get pushed if we make it up to the document element.
                    colors.push(defaultColor);
                }
                testEl = testEl.parent();
            } while (testEl.length);
            return 'rgb(' + colors.reduceRight((sum, color) => {
                color = color.replace(/rgba?\((.*)\)/, '$1').split(/,/g);
                if (color.length < 4) {
                    // rgb, not rgba
                    return color;
                }
                if (color.length !== 4 || sum.length !== 3) {
                    throw new Error('Something went wrong getting the effective color');
                }
                for (let index = 0; index < 3; index++) {
                    const start = Number(sum[index]);
                    const end = Number(color[index]);
                    const distance = Number(color[3]);
                    sum[index] = start + ((end - start) * distance);
                }
                return sum;
            }, []).join(', ') + ')';
        }


        function getReplyNode() {
            if (!replyNode.length) {
                replyNode = $('.monologue:not(.mine) .message .newreply').first().clone(true);
            }
            return replyNode;
        }

        function addReplyToMine() {
            if (!replyNode.length && !getReplyNode().length) {
                //No reply node found.
                return;
            }
            $('.monologue.mine .message .meta').filter(function() {
                return !$(this).children('.newreply').length;
            }).each(function() {
                const newReply = replyNode.clone(true);
                const $this = $(this);
                const newBackground = getEffectiveBackgroundColor($this.closest('.messages').first());
                this.style.backgroundColor = newBackground;
                $(this).append(newReply);
            });
        }
    } //cvRequestArchiver()

    startup();
})();
