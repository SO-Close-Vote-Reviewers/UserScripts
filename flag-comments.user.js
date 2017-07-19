// ==UserScript==
// @name         flag comment
// @namespace    http://stackoverflow.com/users/578411/rene
// @version      0.1
// @description  auto-comments for flags
// @author       rene
// @match        *://stackoverflow.com/questions/*
// @grant        none
// ==/UserScript==

(function() {
    'use strict';
    var reasons = [
        { title: "purge all", text: "All comments here are either too chatty or obsolete. Please purge them all." },
        { title: "debug session", text: "All comments here are a back and forth debug session with the outcome captured in the answer. The comments served their goal. Please purge them all." },
        { title: "resolved in edit", text: "All comments here are resolved in an edit of the answer. The comments are too chatty or obsolete. Please purge them all." },
        { title: "debug noise", text: "All comments here are an one sided debug attempt without resolution and is nothing more then noise. Please purge them all." }
    ];
     
    function createAnchor(i, ta) {
        var a = document.createElement('a'),
            text = reasons[i].text;
        a.textContent = reasons[i].title;
        a.href='#';
        a.addEventListener('click', function (e) {
            e.preventDefault();
            ta.value = text;    
            ta.focus();
        });
        return a;
    }
    
    function handleTextArea(ta) {
        var div, a, i, space;
        div = document.createElement('div');
        for(i = 0; i < reasons.length; i = i + 1) {
            if (i !== 0) {
                space = document.createElement('span');
                space.innerHTML = '&nbsp;|&nbsp;';
                div.appendChild(space);
            }
            div.appendChild(createAnchor(i, ta));
        }
        
        ta.parentElement.appendChild(div);
    }
    
    function handleForm(form) {
        var i;
        for(i = 0; i < form.elements.length; i = i + 1) {
            if (form.elements[i].type === 'textarea') {
                handleTextArea(form.elements[i]);
            }
        }
    }
    
    function flagdialog(mr, observer) {
        mr.forEach(function(rec) {
            if (rec.addedNodes && rec.addedNodes.length > 0 && rec.addedNodes[0].id  === 'popup-flag-post') {
                //console.log(rec.add);
                if (rec.addedNodes[0].children.length > 1) {
                  handleForm(rec.addedNodes[0].children[1]);
                }
            }
        });
    }
    
    var mutation = new MutationObserver(flagdialog);
    mutation.observe( document.getElementById('mainbar') , {childList: true, subtree: true});
    
})();
