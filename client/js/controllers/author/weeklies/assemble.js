'use strict';

var $ = require('dominus');
var raf = require('raf');
var series = require('contra/series');
var curry = require('contra/curry');
var sluggish = require('sluggish');
var dragula = require('dragula');
var taunus = require('taunus');
var debounce = require('lodash/function/debounce');
var textareas = require('../../../conventions/textareas');
var scrapeCompletionService = require('../../../services/scrapeCompletion');
var markdownService = require('../../../../../services/markdown');
var textService = require('../../../../../services/text');
var summaryService = require('../../../../../services/summary');
var loadScript = require('../../../lib/loadScript');
var rparagraph = /^<p>|<\/p>$/i;
var rdigits = /^\d+$/;

module.exports = controller;

function controller (viewModel, container, route) {
  series([
    curry(loadScript, '/js/stylus.js'),
    curry(loadScript, '/js/weekly-compiler.js')
  ], loaded);
  function loaded (err) {
    ready(viewModel, container, route);
  }
}

function ready (viewModel, container, route) {
  var weeklyCompilerService = global.weeklyCompiler;
  var weeklyIssue = viewModel.issue;
  var editing = viewModel.editing;
  var released = editing && weeklyIssue.status === 'released';
  var editor = $.findOne('.wa-editor', container);
  var toolbox = $.findOne('.wa-toolbox', container);
  var submissions = $.findOne('.wa-submissions', container);
  var tools = $('.wa-tool', toolbox);
  var slug = $('.wa-slug');
  var status = $('.wa-status');
  var summaryEditor = $.findOne('.wa-summary-editor', container);
  var summary = $('.wa-summary');
  var email = $('#wa-campaign-email');
  var tweet = $('#wa-campaign-tweet');
  var fb = $('#wa-campaign-fb');
  var echojs = $('#wa-campaign-echojs');
  var hn = $('#wa-campaign-hn');
  var lobsters = $('#wa-campaign-lobsters');
  var toggleSectionsButton = $('.wa-toggle-sections');
  var discardButton = $('.wa-discard');
  var saveButton = $('.wa-save');
  var preview = $('.wa-preview');
  var previewHtml = $('.wy-content', preview);
  var drakeTools = dragula([editor, toolbox], {
    moves: toolMoves,
    copy: true
  });
  var drakeSubmissions = dragula([editor, submissions], {
    moves: submissionMoves,
    copy: true
  });
  var drakeSort = dragula([editor], {
    moves: editorSectionMoves
  });
  var updatePreviewSlowly = raf.bind(null, debounce(updatePreview, 100));
  var scrapeLinkSlowly = debounce(scrapeLink, 500);
  var scraping = true;

  $(document.documentElement).on('keyup', cancellations);

  $(editor)
    .on('click', '.wa-section-remove', removeSection)
    .on('click', '.wa-section-toggle', toggleSection)
    .on('click', '.wa-section-clone', cloneSection)
    .on('change', '.wa-color-picker', pickedColor)
    .on('change', '.wa-link-subtype', pickedSubtype)
    .on('change', '.wa-header-background', updateLinkColors)
    .on('change keypress keydown paste input', '.wa-link-image', updateThumbnailImage)
    .on('change keypress keydown paste input', '.wa-link-href', function (e) {
      scrapeLinkSlowly(e.target);
    })
    .on('click', '.wa-link-toggle-tags', toggleTags)
    .and(summaryEditor)
      .on('change keypress keydown paste input', 'input,textarea,select', updatePreviewSlowly);

  drakeTools
    .on('cloned', clonedTool)
    .on('drop', droppedTool);

  drakeSubmissions
    .on('cloned', clonedTool)
    .on('drop', droppedSubmission);

  drakeSort.on('drop', updatePreviewSlowly);

  status.on('change', updatePublication);
  tools.on('click', pickedTool);
  discardButton.on('click', discard);
  saveButton.on('click', save);
  toggleSectionsButton.on('click', toggleSections);
  $('.wa-scraper').on('click', toggleScraping);
  updatePublication();
  updatePreview();

  function toggleSections () {
    var sections = $('.wa-section', editor).but('[data-tool="header"]');
    var contents = sections.find('.wa-section-contents');
    var hidden = contents.where('.uv-hidden');
    if (hidden.length === contents.length) {
      contents.removeClass('uv-hidden');
    } else {
      contents.addClass('uv-hidden');
    }
  }

  function updatePublication () {
    if (released) {
      saveButton.find('.bt-text').text('Save Changes');
      saveButton.parent().attr('aria-label', 'Make your modifications immediately accessible!');
      discardButton.text('Delete Issue');
      discardButton.attr('aria-label', 'Permanently delete this weekly issue');
      return;
    }
    var state = status.where(':checked').text();
    if (state === 'draft') {
      saveButton.find('.bt-text').text('Save Draft');
      saveButton.parent().attr('aria-label', 'You can access your drafts at any time');
      return;
    }
    if (state === 'ready') {
      saveButton.find('.bt-text').text('Save & Mark Ready');
      saveButton.parent().attr('aria-label', 'Schedule this weekly issue for publication next thursday!');
    }
  }

  function updatePreview () {
    var model = getModel();
    var slug = rdigits.test(model.slug) ? 'issue-' + model.slug : model.slug;
    var options = {
      markdown: markdownService,
      slug: slug
    };
    weeklyCompilerService.compile(model.sections, options, compiled);
    function compiled (err, html) {
      if (err) {
        html = textService.format('<pre class="wa-error">%s</pre>', err);
      }
      previewHtml.html(html);
      var previewSummary = $('.wy-section-summary', preview);
      var summaryHtml = markdownService.compile(summary.value());
      previewSummary.html(summaryHtml);
      updateLinkSections();
    }
  }

  function updateLinkSections () {
    $('.wa-section').where('[data-tool="link"]').forEach(function (el) {
      var $linkHeading = $('.wa-section-heading', el);
      var $linkPreview = $('.wa-link-preview', el);
      var $title = $('.wa-link-title', el);
      var title = markdownService.compile($title.value()).replace(rparagraph, '');
      var summaryLong = summaryService.summarize(title);
      var summaryShort = summaryService.summarize(title, 30);
      var summaryHtml = summaryShort.html.trim();
      var postfix = summaryHtml ? ' – ' + summaryHtml : '';

      $linkPreview.html(postfix);

      var summaryLabelText = summaryLong.text.trim();
      var summaryTitleText = summaryShort.text.trim();
      if (summaryTitleText.length >= summaryLabelText.length) {
        $linkHeading.attr('aria-label', null);
      } else {
        $linkHeading.attr('aria-label', summaryLabelText);
      }
    });
  }

  function updateLinkColors (e) {
    var $el = $(e.target);
    var $header = $el.parents('.wa-section');
    var color = $el.value();
    var $link = $header;

    do {
      $link = $link.next('[data-tool="link"]');
      $link.find('.wa-link-foreground').value(color);
    } while ($link.length);

    updatePreview();
  }

  function toolMoves (el, source) {
    return source === toolbox;
  }
  function submissionMoves (el, source) {
    return source === submissions;
  }
  function editorSectionMoves (el, source, handle) {
    var $handle = $(handle);
    return (
      $handle.hasClass('wa-section-header') ||
      $handle.hasClass('wa-section-heading') ||
      $handle.parents('.wa-section-heading').length > 0
    );
  }
  function removeSection (e) {
    $(e.target).parents('.wa-section').remove();
    updatePreviewSlowly();
  }
  function toggleSection (e) {
    var toggler = $(e.target);
    var content = toggler.parents('.wa-section').find('.wa-section-contents');
    toggleUsingButton(content, toggler, ['fa-compress', 'fa-expand']);
  }
  function toggleTags (e) {
    var toggler = $(e.target);
    var content = toggler.parents('.wa-section').find('.wa-link-tag-list');
    toggleUsingButton(content, toggler, ['fa-flip-horizontal', 'fa-rotate-90']);
  }
  function toggleUsingButton (content, button, classes) {
    if (content.hasClass('uv-hidden')) {
      content.removeClass('uv-hidden');
      button.removeClass(classes[1]);
      button.addClass(classes[0]);
    } else {
      content.addClass('uv-hidden');
      button.addClass(classes[1]);
      button.removeClass(classes[0]);
    }
  }
  function clonedTool (clone) {
    $(clone).addClass('wa-section-header');
  }
  function cancellations (e) {
    if (e.which === 27) {
      drakeTools.cancel(true);
      drakeSubmissions.cancel(true);
      drakeSort.cancel(true);
    }
  }
  function pickedColor (e) {
    var select = $(e.target);
    var color = select.value();
    select
      .parents('.wa-color-picker')
      .find(select.attr('data-target'))
      .css('color', color);
  }
  function pickedSubtype (e) {
    var select = $(e.target);
    var subtype = select.value();
    select
      .parents('.wa-section')
      .find('.wa-section-header')
      .removeClass('wa-link-header-original')
      .removeClass('wa-link-header-suggestion')
      .removeClass('wa-link-header-primary')
      .removeClass('wa-link-header-secondary')
      .removeClass('wa-link-header-job')
      .addClass('wa-link-header-' + subtype);
  }
  function droppedSubmission (el, target) {
    if (target !== editor) {
      return;
    }
    var tool = $(el);
    var toolId = tool.attr('data-id');
    var action = 'author/weeklies/tool-link';
    var section = findSubmissionSectionById(toolId);
    if (!section) {
      return;
    }
    insertingPartial(taunus.partial.replace(el, action, {
      knownTags: viewModel.knownTags,
      section: section
    }));
  }
  function findSubmissionSectionById (id) {
    var submissions = viewModel.submissions;
    for (var i = 0; i < submissions.length; i++) {
      if (submissions[i].id === id) {
        return submissions[i].section;
      }
    }
  }
  function droppedTool (el, target) {
    if (target !== editor) {
      return;
    }
    addSectionWithTool(el);
  }
  function pickedTool (e) {
    addSectionWithTool(e.target, true);
    e.preventDefault();
    e.stopPropagation();
  }
  function addSectionWithTool (el, append) {
    var tool = $(el);
    var toolName = tool.parents('.wa-tool').and(tool).attr('data-tool');
    var action = 'author/weeklies/tool-' + toolName;
    var model = {
      knownTags: viewModel.knownTags,
      section: getDefaultSectionModel(toolName)
    };
    var insertion;
    if (append) {
      insertion = taunus.partial.appendTo(editor, action, model);
    } else {
      insertion = taunus.partial.replace(el, action, model);
    }
    insertingPartial(insertion);
  }
  function getDefaultSectionModel (toolName) {
    if (toolName === 'link') {
      return {
        sourceHref: 'https://twitter.com/'
      };
    }
    return {};
  }
  function cloneSection (e) {
    var section = $(e.target).parents('.wa-section');
    var toolName = section.attr('data-tool');
    var action = 'author/weeklies/tool-' + toolName;
    var model = getSectionModel(section);
    insertingPartial(taunus.partial.afterOf(section[0], action, {
      knownTags: viewModel.knownTags,
      section: model
    }));
  }
  function insertingPartial (partial) {
    partial
      .on('render', displayDetails)
      .on('render', updatePreviewSlowly);
    function displayDetails (html, container) {
      displayLinkDetails(container);
    }
  }
  function displayLinkDetails (container) {
    $('.wa-section-contents', container).removeClass('uv-hidden');
  }
  function getSectionModel (section) {
    var mappers = {
      header: getHeaderSectionModel,
      markdown: getMarkdownSectionModel,
      link: getLinkSectionModel,
      styles: getStylesSectionModel
    };
    var type = $(section).attr('data-tool');
    return mappers[type](section);
  }
  function getHeaderSectionModel (section) {
    return {
      type: 'header',
      size: parseInt($('.wa-header-size', section).value(), 10),
      text: $('.wa-header-text', section).value(),
      foreground: $('.wa-header-foreground', section).value(),
      background: $('.wa-header-background', section).value()
    };
  }
  function getMarkdownSectionModel (section) {
    return {
      type: 'markdown',
      text: $('.wa-markdown-text', section).value()
    };
  }
  function getLinkSectionModel (section) {
    var unknownTags = textService.splitTags($('.wa-link-tags', section).value());
    var knownTags = $('.wa-link-tag', section).filter(byChecked).map(toValue).filter(unique);
    return {
      type: 'link',
      subtype: $('.wa-link-subtype', section).value() || 'original',
      title: $('.wa-link-title', section).value(),
      href: $('.wa-link-href', section).value(),
      foreground: $('.wa-link-foreground', section).value(),
      background: $('.wa-link-background', section).value(),
      source: $('.wa-link-source', section).value(),
      sourceHref: $('.wa-link-source-href', section).value(),
      image: $('.wa-link-image', section).value(),
      sponsored: $('.wa-link-sponsored', section).value(),
      tags: unknownTags.concat(knownTags),
      description: $('.wa-link-description', section).value()
    };
    function byChecked (el) {
      return $(el).value();
    }
    function toValue (el) {
      return $(el).text();
    }
    function unique (tag) {
      return unknownTags.indexOf(tag) === -1;
    }
  }
  function getStylesSectionModel (section) {
    return {
      type: 'styles',
      styles: $('.wa-styles-text', section).value()
    };
  }
  function getModel () {
    var state = released ? weeklyIssue.status : status.where(':checked').text();
    var data = {
      slug: sluggish(slug.value()),
      sections: $('.wa-section', editor).map(getSectionModel),
      status: state,
      summary: summary.value(),
      email: email.value(),
      tweet: tweet.value(),
      fb: fb.value(),
      echojs: echojs.value(),
      hn: hn.value(),
      lobsters: lobsters.value()
    };
    return data;
  }

  function toggleScraping (e) {
    scraping = !scraping;
    if (scraping) {
      $(e.target).removeClass('wa-toggler-off');
    } else {
      $(e.target).addClass('wa-toggler-off');
    }
  }

  function updateThumbnailImage (e) {
    var $container = $(e.target).parents('.wa-section-contents');
    scrapeCompletionService.updateThumbnail($container);
  }

  function scrapeLink (el) {
    if (scraping === false) {
      return;
    }
    var $el = $(el);
    scrapeCompletionService.scrape({
      source: el,
      url: $el.value(),
      container: $el.parents('.wa-section-contents'),
      updatePreview: updatePreview
    });
  }

  function save () {
    send({ json: getModel() });
  }

  function send (data) {
    var req;

    if (editing) {
      req = viewModel.measly.patch('/api/weeklies/' + route.params.slug, data);
    } else {
      req = viewModel.measly.put('/api/weeklies', data);
    }
    req.on('data', leave);
  }

  function discard () {
    var name = route.params.slug ? '/weeklies/' + route.params.slug : 'draft';
    var confirmation = confirm('About to discard ' + name + ', are you sure?');
    if (!confirmation) {
      return;
    }
    if (editing) {
      viewModel.measly.delete('/api/weeklies/' + route.params.slug).on('data', leave);
    } else {
      leave();
    }
  }

  function leave () {
    taunus.navigate('/weekly/review');
  }
}
