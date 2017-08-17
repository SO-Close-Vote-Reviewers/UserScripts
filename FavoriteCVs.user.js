// ==UserScript==
// @name         FavoriteCVs
// @namespace    
// @version      0.1
// @description  A script to show all active(latest 100), open, yet to vote CV requests which belong to the set of user's favorite tags
// @author       @AjayBrahmakshatriya
// @match        https://chat.stackoverflow.com/rooms/41570/so-close-vote-reviewers*
// @require      https://code.jquery.com/jquery-2.1.4.min.js
// @connect      stackoverflow.com
// @grant        GM_xmlhttpRequest
// ==/UserScript==




(function() {
    'use strict';

    if(!localStorage.getItem("favorite_cvs-cv-ignore-list"))
        localStorage.setItem("favorite_cvs-cv-ignore-list", JSON.stringify([]));
    if(!localStorage.getItem("favorite_cvs-already-voted"))
        localStorage.setItem("favorite_cvs-already-voted", JSON.stringify([]));



    $("body").append($(
        '<div id="favorite_cvs-fav-cvs" style="bottom:100px;left:-1000px">'
        +'    <div id="favorite_cvs-btn-quickrefresh"></div>'
        +'    <div id="favorite_cvs-important_cvs">'
        +'        <div id="favorite_cvs-important_cvs_content"></div>'
        +'    </div>'
        +'    <center><img src="//cdn-chat.sstatic.net/chat/img/ajax-loader.gif" id="favorite_cvs-loader-animation"/></center>'
        +'</div>'
    ));
    var favorite_cvs_main_box = $("#favorite_cvs-fav-cvs");
    var favorite_cvs_holder = $($("#favorite_cvs-important_cvs_content")[0]);
    var favorite_cvs_loader_animation = $("#favorite_cvs-loader-animation");
    var favorite_cvs_refresh_button = $("#favorite_cvs-btn-quickrefresh");
    var favorite_cvs_auto_reloader = 0;
    $("head").append($( '<style>'
                       +'    .favorite_cvs-fav-ignore:hover{'
                       +'        background-color:#ff7b18;'
                       +'     }'
                       +'    .favorite_cvs-fav-ignore{'
                       +'        margin-right:5px;'
                       +'        cursor:pointer;'
                       +'        color:white;'
                       +'        font-weight:bold;'
                       +'        background-color:#ccc;'
                       +'        line-height:10px;'
                       +'        border-radius:10px;'
                       +'        -webkit-border-radius:10px;'
                       +'        -moz-border-radius:10px;'
                       +'        display:inline-block;'
                       +'        font-size:8px;'
                       +'        padding:2px 4px;'
                       +'    }'
                       +'    #favorite_cvs-fav-cvs{'
                       +'        position:fixed;'
                       +'        min-height:100px;'
                       +'        max-height:80%;'
                       +'        z-index:50;'
                       +'        padding:10px;'
                       +'        border:1px solid #aaa;'
                       +'        width:300px;'
                       +'        font-size:11px;'
                       +'        color:#222;'
                       +'        -moz-border-radius:5px;'
                       +'        -webkit-border-radius:5px;'
                       +'        border-radius:5px;'
                       +'        background:rgba(255, 255, 255, 0.95);'
                       +'        filter:alpha(opacity=95);'
                       +'        -webkit-box-shadow:0 1px 15px #9c9c9c;'
                       +'        -moz-box-shadow:0 1px 15px #9c9c9c;'
                       +'        box-shadoe:0 1px 15px #9c9c9c;'
                       +'        overflow-y:auto;'
                       +'    }'
                       +'    #favorite_cvs-btn-quickrefresh{'
                       +'        background-position:-10px -275px;'
                       +'        height:12px;'
                       +'        width:20px;'
                       +'        background-image:url(https://cdn-chat.sstatic.net/chat/Img/sprites.png);'
                       +'        background-repeat:no-repeat;'
                       +'        display:inline-block;'
                       +'        cursor:pointer;'
                       +'        margin-bottom:10px;'
                       +'    }'
                       +'</style>'
                      ));
    $("#chat-buttons").append($('<button class="button" id="favorite_cvs-fav-cv-show">open-cvs</button>'));

    $(document).click(function(){
        favorite_cvs_main_box.hide();
    });
    $("#favorite_cvs-fav-cv-show").click(function(event){
        favorite_cvs_main_box.css("left", event.clientX).show();
        event.stopPropagation();
    });

    favorite_cvs_main_box.click(function(event){
        event.stopPropagation();
    });
    function cv_ignore_click(event){
        var q_id = $(this).parent().attr("id");
        q_id = q_id.split("favorite_cvs-fav-wrapper-")[1];
        var ignore_list = JSON.parse(localStorage.getItem("favorite_cvs-cv-ignore-list"));
        if(ignore_list.indexOf(q_id) === -1)
            ignore_list.push(q_id);
        localStorage.setItem("favorite_cvs-cv-ignore-list", JSON.stringify(ignore_list));
        $(this).parent().remove();
    }
    function insert_close_status(q_id, title) {
        GM_xmlhttpRequest({
            method: 'GET',
            url: 'https://stackoverflow.com/questions/'+q_id,
            onload: function(content) {
                if (content.status !== 200)
                    return;
                var vote_status = $(".close-question-link", content.responseText);
                if(vote_status.length > 0 && $(vote_status[0]).html().startsWith("close")){
                    if($(vote_status[0]).attr("title").indexOf("You voted to close") === -1 ){
                        favorite_cvs_holder.append($( '<div class="favorite_cvs-fav-wrapper" id="favorite_cvs-fav-wrapper-'+q_id+'">'
                                                     +'    <div class="favorite_cvs-fav-ignore">X</div>'
                                                     +'    <a class="message" href="https://stackoverflow.com/q/'+q_id+'/">'+title+'</a>'
                                                     +'    <br><br>'
                                                     +'</div>'
                                                    ));
                        $("#favorite_cvs-fav-wrapper-"+q_id).children(".favorite_cvs-fav-ignore").click(cv_ignore_click);
                    }else{
                        var already_voted = JSON.parse(localStorage.getItem("favorite_cvs-already-voted"));
                        already_voted.push(q_id);
                        localStorage.setItem("favorite_cvs-already-voted", JSON.stringify(already_voted));
                    }
                }
            }
        });
    }

    function fetch_imp_cvs() {
        clearInterval(favorite_cvs_auto_reloader);
        favorite_cvs_loader_animation.show();
        favorite_cvs_refresh_button.hide();
        $(".favorite_cvs-fav-wrapper").remove();
        var fav_tags = [];
        GM_xmlhttpRequest({
            method: 'GET',
            url: 'https://stackoverflow.com/',
            synchronous: true,
            onload: function(content) {
                if (content.status !== 200)
                    return;
                var tags = $("#interestingTags > .post-tag", content.responseText);
                for (var i=0; i< tags.length; i++)
                    fav_tags.push(tags[i].textContent);
                get_cvs_for_tags(fav_tags);
            }
        });
    }

    function throttle_and_send(delay, request_ids) {
        if (request_ids.length === 0){
            favorite_cvs_loader_animation.hide();
            favorite_cvs_refresh_button.show();
            favorite_cvs_auto_reloader=setInterval(function(){fetch_imp_cvs();}, 60*1000);
            return;
        }
        var send_now = request_ids.pop();
        insert_close_status(send_now[0], send_now[1]);
        setTimeout(function(){throttle_and_send(delay, request_ids);}, delay);
    }
    function get_cvs_for_tags(fav_tags) {
        var processed_q=[];

        $.get("https://chat.stackoverflow.com/search?q=tagged%2Fcv&Room=41570&page=1&pagesize=100&sort=newest").done(function(content){
            var messages = $(".message", content);
            var ignore_list = JSON.parse(localStorage.getItem("favorite_cvs-cv-ignore-list"));
            var already_voted = JSON.parse(localStorage.getItem("favorite_cvs-already-voted"));
            var new_already_voted = [];
            var new_ignore_list = [];
            var requests_to_send = [];
            for (var i=0;i<messages.length;i++){
                content = $(messages[i]).children(".content");
                if (content.length === 0)
                    continue;
                var message = $(content[0]);
                var tags = content.find(".ob-post-tag");
                var is_cv_pls = false;
                var is_in_fav_tags = false;
                for (var j=0; j <tags.length; j++) {
                    var tag_text = tags[j].textContent;
                    if(fav_tags.indexOf(tag_text) > -1)
                        is_in_fav_tags = true;
                    if (tag_text === "cv-pls"){
                        is_cv_pls = true;
                    }
                }
                if(is_cv_pls && is_in_fav_tags){
                    var links = message.find("a");
                    for(var l = 0; l<links.length;l++){
                        var link_to_question = links[l].href;
                        var title = links[2].textContent;
                        var id_regex = /(?:https?:)?\/\/stackoverflow\.com\/q(?:uestions)?\/([0-9]+)/;
                        var matches =  link_to_question.match(id_regex);
                        if(!matches)
                            continue;
                        var q_id = matches[1];
                        if(q_id && processed_q.indexOf(q_id)===-1){
                            if(ignore_list.indexOf(q_id) === -1 ){
                                if(already_voted.indexOf(q_id) === -1)
                                    requests_to_send.push([q_id, title]);
                                else
                                    new_already_voted.push(q_id);
                            }else{
                                new_ignore_list.push(q_id);
                            }
                            processed_q.push(q_id);
                        }
                        break;
                    }
                }
            }
            localStorage.setItem("favorite_cvs-cv-ignore-list", JSON.stringify(new_ignore_list));
            localStorage.setItem("favorite_cvs-already-voted", JSON.stringify(new_already_voted));
            throttle_and_send(1000, requests_to_send);
        });
    }
    $("#favorite_cvs-btn-quickrefresh").click(fetch_imp_cvs);
    favorite_cvs_auto_reloader=setInterval(function(){fetch_imp_cvs();}, 60*1000);
    fetch_imp_cvs();
})();
