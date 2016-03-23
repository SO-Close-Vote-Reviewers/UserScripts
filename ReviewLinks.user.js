// ==UserScript==
// @name         Review links
// @namespace    https://github.com/Gothdo
// @version      1.0
// @description  If a question or an answer is currently in a review queue, adds a link to it.
// @author       Gothdo
// @match        http://stackoverflow.com/questions/*
// @grant        none
// ==/UserScript==

function addReviewLink(isQuestion, postId) {
  $.get(`http://stackoverflow.com/posts/${postId}/timeline`)
    .then(page=> {
      const $reviewLink = $(page).find(".event-type.review").parent().parent().find(".event-verb a")
      if ($reviewLink.length === 1) {
        const reviewURL = $reviewLink.attr("href")
             ,reviewName = $reviewLink.text()
             ,postMenuSelector = (isQuestion ? "#question" : `.answer[data-answerid=${postId}]`) + " .post-menu"
        $(postMenuSelector).append(`<span class="lsep">|</span><a href="${reviewURL}">${reviewName} review</a>`)
      }
    })
}

StackExchange.ready(()=> {
  addReviewLink(true, StackExchange.question.getQuestionId())
  $(".answer").each(function() {
    addReviewLink(false, $(this).attr("data-answerid"))
  })
})
