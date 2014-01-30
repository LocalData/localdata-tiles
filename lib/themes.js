'use strict';

/*
 * Provide access to static map styles and renderable style templates.
 *
 */

var fs = require('fs');

var ejs = require('ejs');

// The first time we load this module, we'll synchronously read a couple of
// files from disk. Nothing else interesting can really happen until we have
// those files, so this is probably OK for now.

// Load style files and style template files.
var coverage = fs.readFileSync('./map/theme/style.mss','utf8');
var filterTemplate = fs.readFileSync('./map/theme/filter.mss.template','utf8');

exports.coverage = coverage;

exports.render = {};

exports.render.filter = function filter(data) {
  return ejs.render(filterTemplate, data);
};
