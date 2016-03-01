'use strict';

var _ = require('lodash');
var fs = require('fs');
var but = require('but');
var util = require('util');
var contra = require('contra');
var env = require('../lib/env');
var subscriberService = require('./subscriber');
var textService = require('./text');
var facebookService = require('./facebook');
var twitterService = require('./twitter');
var twitterEmojiService = require('./twitterEmoji');
var echojsService = require('./echojs');
var hackernewsService = require('./hackernews');
var lobstersService = require('./lobsters');
var markupService = require('./markup');
var weeklyService = require('./weekly');
var authority = env('AUTHORITY');
var card = env('TWITTER_CAMPAIGN_CARD_NEWSLETTER');
var css = fs.readFileSync('.bin/emails/newsletter.css', 'utf8');

function share (issue, done) {
  if (done === void 0) {
    done = noop;
  }
  contra.concurrent([
    curried('email', email),
    curried('tweet', tweet),
    curried('fb', facebook),
    curried('echojs', echojs),
    curried('hn', hackernews),
    curried('lobsters', lobsters)
  ], done);

  function curried (key, fn) {
    return function shareVia (next) {
      if (issue[key] === false) {
        next(); return;
      }
      fn(issue, {}, next);
    };
  }
}

function email (issue, options, done) {
  var relativePermalink = '/weekly/' + issue.slug;
  var issue = weeklyService.toView(issue, false);
  var model = {
    subject: issue.title,
    teaser: options.reshare ? 'You can’t miss this!' : 'Hot off the press!',
    issue: issue,
    css: css,
    linkedData: {
      '@context': 'http://schema.org',
      '@type': 'EmailMessage',
      potentialAction: {
        '@type': 'ViewAction',
        name: 'See issue #' + issue.slug,
        target:  authority + relativePermalink
      },
      description: 'See weekly newsletter issue #' + issue.slug
    }
  };
  subscriberService.send({
    topic: 'newsletter',
    template: 'newsletter-issue',
    model: model
  }, done);
}

function statusLink (issue) {
  return util.format('%s/weekly/%s', authority, issue.slug);
}

function randomHeadline (options) {
  return _.sample(options.reshare ? [
    'In case you missed it!',
    'Read this!',
    'Check this out!'
  ] : [
    'Just published!',
    'Fresh content!',
    'Crisp new words!',
    'Hot off the press!',
    'Extra! Extra!',
    'This just out!'
  ]);
}

function randomMailEmoji () {
  return _.sample(['✉️️', '💌', '📥', '📤', '📬', '📩', '📮', '📪', '📫', '📬', '📭']);
}

function tweet (issue, options, done) {
  var tagPair = '#' + issue.tags.slice(0, 2).join(' #');
  var tagText = textService.hyphenToCamel(tagPair);
  var headline = randomHeadline(options);
  var tweetLength = 0;
  var tweetLines = [];

  // sorted by importance: link, title, cta, headline, hashtag.
  add(3, randomMailEmoji() + ' ' + statusLink(issue), 2 + 24);
  add(1, randomMailEmoji() + ' ' + issue.title, 2 + issue.title.length);
  add(4, card, 25);
  add(0, randomMailEmoji() + ' ' + headline, 2 + headline.length);
  add(2, randomMailEmoji() + ' ' + '#ponyfooweekly', 2 + 14); // no extra new line here

  var status = tweetLines.filter(notEmpty).join('\n');

  twitterService.tweet(status, done);

  function add (i, contents, length) {
    if (tweetLength + length + 1 > 140) {
      return; // avoid going overboard
    }
    tweetLength += length + 1; // one for the next new line
    tweetLines[i] = contents;
  }
  function notEmpty (line) {
    return line;
  }
}

function facebook (issue, options, done) {
  facebookService.share(issue.title, statusLink(issue), done);
}

function echojs (issue, options, done) {
  var data = {
    title: issue.title,
    url: util.format('%s/weekly/%s', authority, issue.slug)
  };
  echojsService.submit(data, done);
}

function hackernews (issue, options, done) {
  var data = {
    title: issue.title,
    url: util.format('%s/weekly/%s', authority, issue.slug)
  };
  hackernewsService.submit(data, submitted);
  function submitted (err, res, body, discuss) {
    issue.hnDiscuss = discuss;
    issue.save(but(done));
  }
}

function lobsters (issue, options, done) {
  var data = {
    title: issue.title,
    url: util.format('%s/weekly/%s', authority, issue.slug)
  };
  lobstersService.submit(data, done);
}

module.exports = {
  share: share,
  email: email,
  twitter: tweet,
  facebook: facebook,
  echojs: echojs,
  hackernews: hackernews,
  lobsters: lobsters
};