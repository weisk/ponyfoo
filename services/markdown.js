'use strict';

var ultramarked = require('ultramarked');

ultramarked.setOptions({
  smartLists: true,
  ultralight: true,
  ultrasanitize: true
});

module.exports = {
  compile: function (text) {
    return ultramarked(text);
  }
};
