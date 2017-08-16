// ==UserScript==
// @name         Important CVs
// @namespace    
// @version      0.1
// @description  A script to show all open, yet to vote cv requests which belong to a set of favorite tags from the day.
// @author       @AjayBrahmakshatriya
// @match        https://chat.stackoverflow.com/rooms/41570/so-close-vote-reviewers
// @require        https://code.jquery.com/jquery-2.1.4.min.js
// @connect      stackoverflow.com
// @grant        GM_xmlhttpRequest
// ==/UserScript==

(function() {
    'use strict';

	var fetch_button = $('<button class="button" id="imp-cvs">refresh imp-cvs</button>');
	$($('#widgets')[0]).append(fetch_button);
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
			if(vote_status.length > 0 && $(vote_status[0]).attr("title").indexOf("You voted to close") == -1){
			    var disp_text = "";
			    disp_text = "<a class=\"message\" href=\"https://stackoverflow.com/q/"+q_id+"/\">"+title+"</a>";
			    $($("#important_cvs_content")[0]).append($(disp_text+"<br><br>"));
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
		if($("#important_cvs").length>0)
			$("#important_cvs")[0].remove();
		$($("#widgets")[0]).append($("<div id=\"important_cvs\" class=\"sidebar-widget\"><div id=\"important_cvs_content\"></div></div>"));
		$.get("https://chat.stackoverflow.com/transcript/41570").done(function(content){
			var messages = $(".message", content);
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
					if (links.length >= 3){
						var link_to_question = links[2].href;
						var title = links[2].innerHTML;
						var id_regex = /https:\/\/stackoverflow.com\/q(uestions)?\/([0-9]*)\//;
						var matches =  link_to_question.match(id_regex);
						if(!matches){
							console.log(link_to_question);
							continue;
						}
						var q_id = matches[2];
						if(q_id && processed_q.indexOf(q_id)==-1){
							processed_q.push(q_id);
							insert_close_status(q_id, title);
						}
					}
		    }
			}
		});
	}
	$("#imp-cvs").click(fetch_imp_cvs);
	fetch_imp_cvs();
})();
