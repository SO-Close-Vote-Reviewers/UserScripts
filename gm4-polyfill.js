/*
This is a fork of https://github.com/greasemonkey/gm4-polyfill
At the time this was created 2017-11-14, that project was unstable and had merged obviously
broken code.  While it will probably be stable in the future, it's not at the moment.
See gm4-polyfill-LICENSE for licensing information.
*/

/*
This helper script bridges compatibility between the Greasemonkey 4 APIs and
existing/legacy APIs.  Say for example your user script includes

    // @grant GM_getValue

And you'd like to be compatible with both Greasemonkey 3 and Greasemonkey 4
(and for that matter all versions of Violentmonkey, Tampermonkey, and any other
user script engine).  Add:

    // @grant GM.getValue
    // @require https://greasemonkey.github.io/gm4-polyfill/gm4-polyfill.js

And switch to the new (GM-dot) APIs, which return promises.  If your script
is running in an engine that does not provide the new asynchronous APIs, this
helper will add them, based on the old APIs.

If you use `await` at the top level, you'll need to wrap your script in an
`async` function to be compatible with any user script engine besides
Greasemonkey 4.

    (async () => {
    let x = await GM.getValue('x');
    })();
*/

if (typeof GM === 'undefined') {
  GM = {};
}


if (typeof GM_addStyle === 'undefined') {
  this.GM_addStyle = (aCss) => {
    'use strict';
    let head = document.getElementsByTagName('head')[0];
    if (head) {
      let style = document.createElement('style');
      style.setAttribute('type', 'text/css');
      style.textContent = aCss;
      head.appendChild(style);
      return style;
    }
    return null;
  };
}


if (typeof GM_registerMenuCommand === 'undefined') {
  this.GM_registerMenuCommand = (caption, commandFunc, accessKey) => {
    if (!document.body) {
      console.error('GM_registerMenuCommand got no body.');
      return;
    }
    let contextMenu = document.body.getAttribute('contextmenu');
    let menu = (contextMenu ? document.querySelector('menu#' + contextMenu) : null);
    if (!menu) {
      menu = document.createElement('menu')
      menu.setAttribute('id', 'gm-registered-menu');
      menu.setAttribute('type', 'context');
      document.body.appendChild(menu);
      document.body.setAttribute('contextmenu', 'gm-registered-menu');
    }
    let menuItem = document.createElement('menuitem');
    menuItem.textContent = caption;
    menuItem.addEventListener('click', commandFunc, true);
    menu.appendChild(menuItem);
  };
}


Object.entries({
  'log': console.log,
  'info': GM_info,
}).forEach(([newKey, old]) => {
  if (old && (typeof GM[newKey] === 'undefined')) {
    GM[newKey] = old;
  }
});


Object.entries({
  'GM_addStyle': 'addStyle',
  'GM_deleteValue': 'deleteValue',
  'GM_getResourceURL': 'getResourceUrl',
  'GM_getValue': 'getValue',
  'GM_listValues': 'listValues',
  'GM_notification': 'notification',
  'GM_openInTab': 'openInTab',
  'GM_registerMenuCommand': 'registerMenuCommand',
  'GM_setClipboard': 'setClipboard',
  'GM_setValue': 'setValue',
  'GM_xmlhttpRequest': 'xmlHttpRequest',
}).forEach(([oldKey, newKey]) => {
  let old = this[oldKey];
  if (old && (typeof GM[newKey] === 'undefined')) {
    GM[newKey] = function() {
      return new Promise((resolve, reject) => {
        try {
          resolve(old.apply(this, arguments));
        } catch (e) {
          reject(e);
        }
      });
    };
  }
});
