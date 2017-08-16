// ==UserScript==
// @name         Important CVs
// @namespace    
// @version      0.1
// @description  A script to show all open, yet to vote cv requests which belong to a set of favorite tags from the day.
// @author       @AjayBrahmakshatriya
// @match        https://chat.stackoverflow.com/rooms/41570/so-close-vote-reviewers*
// @require        https://code.jquery.com/jquery-2.1.4.min.js
// @connect      stackoverflow.com
// @grant        GM_xmlhttpRequest
// ==/UserScript==

(function() {
    'use strict';
    
    if(!localStorage.getItem("cv-ignore-list"))
        localStorage.setItem("cv-ignore-list", JSON.stringify([]));
    
    
    $("body").append($('<div class="" id="fav-cvs" style="min-height:100px;bottom:100px;left:-1000px"><div id="btn-quickrefresh"></div><div id="important_cvs"><div id="important_cvs_content"></div></div></div>'));
    $("#fav-cvs").css({
        "position":"fixed",
        "z-index":50,
        "padding":"10px",
        "border":"1px solid #aaa",
        "width":"300px",
        "font-size":"11px",
        "color":"#222",
        "-moz-border-radius":"5px",
        "-webkit-border-radius":"5px",
        "border-radius":"5px",
        "background":"rgba(255, 255, 255, 0.95",
        "filter":"alpha(opacity=95)",
        "-webkit-box-shadow":"0 1px 15px #9c9c9c",
        "-moz-box-shadow":"0 1px 15px #9c9c9c",
        "box-shadoe":"0 1px 15px #9c9c9c",
        "overflow":"hidden"
    });
    $("#btn-quickrefresh").css({
        "background-position":"-10px -275px",
        "height":"12px",
        "width":"20px",
        "background-image":"url(https://cdn-chat.sstatic.net/chat/Img/sprites.png)",
        "background-repeat":"no-repeat",
        "display":"inline-block",
        "cursor":"pointer",
        "margin-bottom":"10px",
    });
    $("head").append($('<style>.fav-ignore:hover{background-color:#ff7b18;} .fav-ignore{margin-right:5px;cursor:pointer;color:white;font-weight:bold;background-color:#ccc;line-height:10px;border-radius:10px;-webkit-border-radius:10px;-moz-border-radius:10px;display:inline-block;font-size:8px;padding:2px 4px;}</style>'));
    $("#chat-buttons").append($('<button class="button" id="fav-cv-show">open-cvs</button>'));
    
    $(document).click(function(){
        $("#fav-cvs").hide();
    });
    $("#fav-cv-show").click(function(event){
        $("#fav-cvs").css("left", event.clientX).show();
        event.stopPropagation();
    });
    
    $("#fav-cvs").click(function(event){
        event.stopPropagation();
    });
    function cv_ignore_click(event){
        var q_id = $(this).parent().attr("id");
        q_id = q_id.split("fav-wrapper-")[1];
        console.log("Ignoring - ", q_id);
        var ignore_list = JSON.parse(localStorage.getItem("cv-ignore-list"));
        if(ignore_list.indexOf(q_id) == -1)
            ignore_list.push(q_id);
        localStorage.setItem("cv-ignore-list", JSON.stringify(ignore_list));
        $(this).parent().remove();
    }
    function insert_close_status(q_id, title) {
        var close_status = true;
        GM_xmlhttpRequest({
            method: 'GET',
            url: 'https://stackoverflow.com/questions/'+q_id,
            onload: function(content) {
                if (content.status != 200)
                    return;
                var status_text = $(".question-status", content.responseText);
                if (!(status_text.length > 0 && status_text[0].innerHTML.indexOf("put on hold") > -1)){
                    var vote_status = $(".close-question-link", content.responseText);
                    if(vote_status.length > 0 && $(vote_status[0]).html().startsWith("close") && $(vote_status[0]).attr("title").indexOf("You voted to close") == -1 ){
                        var disp_text = "";
                        disp_text = "<div class=\"fav-wrapper\" id=\"fav-wrapper-"+q_id+"\"><div class=\"fav-ignore\">X</div><a class=\"message\" href=\"https://stackoverflow.com/q/"+q_id+"/\">"+title+"</a><br><br></div>";
                        $($("#important_cvs_content")[0]).append($(disp_text));
                        $("#fav-wrapper-"+q_id).children(".fav-ignore").click(cv_ignore_click);
                    }
                }
            }
        });
        return close_status;
    }

    function fetch_imp_cvs() {
        var fav_tags = [];
        GM_xmlhttpRequest({
            method: 'GET',
            url: 'https://stackoverflow.com/',
            synchronous: true,
            onload: function(content) {
                if (content.status != 200)
                    return;
                var tags = $("#interestingTags > .post-tag", content.responseText);
                for (var i=0; i< tags.length; i++)
                    fav_tags.push(tags[i].innerHTML);
                get_cvs_for_tags(fav_tags);
            }
        });
    }
    function get_cvs_for_tags(fav_tags) {
        var processed_q=[];
        $(".fav-wrapper").remove();
        $.get("https://chat.stackoverflow.com/transcript/41570").done(function(content){
            var messages = $(".message", content);
            var ignore_list = JSON.parse(localStorage.getItem("cv-ignore-list"));
            var new_ignore_list = [];
            for (var i=0;i<messages.length;i++){
                content = $(messages[i]).children(".content");
                if (content.length === 0)
                    continue;
                var message = $(content[0]);
                var tags = message.find(".ob-post-tag");
                var is_cv_pls = false;
                var is_in_fav_tags = false;
                for (var j=0; j <tags.length; j++) {
                    var tag_text = tags[j].innerHTML;
                    if(fav_tags.indexOf(tag_text) > -1)
                        is_in_fav_tags = true;
                    if (tag_text == "cv-pls"){
                        is_cv_pls = true;
                    }
                }
                if(is_cv_pls && is_in_fav_tags){
                    var links = message.find("a");
                    for(var l = 0; l<links.length;l++){
                        var link_to_question = links[l].href;
                        var title = links[2].innerHTML;
                        var id_regex = /(?:https?:)?\/\/stackoverflow\.com\/q(?:uestions)?\/([0-9]+)/;
                        var matches =  link_to_question.match(id_regex);
                        if(!matches)
                            continue;
                        var q_id = matches[1];
                        if(q_id && processed_q.indexOf(q_id)==-1){
                            if(ignore_list.indexOf(q_id) == -1){
                               insert_close_status(q_id, title);
                            }else{
                                new_ignore_list.push(q_id);
                            }
                            processed_q.push(q_id);
                        }
                    }
                }
                localStorage.setItem("cv-ignore-list", JSON.stringify(new_ignore_list));
            }
        });
    }
    $("#btn-quickrefresh").click(fetch_imp_cvs);
    setInterval(function(){fetch_imp_cvs();}, 60*1000);
    fetch_imp_cvs();
})();
