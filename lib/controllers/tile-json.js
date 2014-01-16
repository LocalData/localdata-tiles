'use strict';

var settings = require('../settings');

function pathPrefix(req) {
  if (!settings.prefix) {
    return 'https://' + req.headers.host + '/' + req.params.surveyId;
  }

  return settings.prefix + '/' + req.params.surveyId;
}

// Generate tilejson
function tileJsonForSurvey(path, filterPath) {
  // The tile path changes if we are adding data filters
  if (filterPath) {
    path = path + '/' + filterPath;
  }

  var tilejson = {
    "basename" : "localdata.tiles",
    "bounds" : [-180, -85.05112877980659, 180, 85.05112877980659],
    "center" : [0, 0, 2],
    "description" : "Lovingly crafted with Node and node-canvas.",
    "attribution" : "LocalData",
    "grids"       : [path + "/utfgrids/{z}/{x}/{y}.json?callback={cb}"],
    "id"          : "map",
    "legend"      : "",
    "maxzoom"     : 30,
    "minzoom"     : 2,
    "name"        : '',
    "scheme"      : 'xyz',
    "template"    : '',
    "tiles"       : [path + "/tiles/{z}/{x}/{y}.png"], // FILTER HERE
    "version"     : "1.0.0",
    "webpage"     : "http://localdata.com"
  };

  return tilejson;
}

exports.get = function get(req, res, next) {
  var tileJson = tileJsonForSurvey(pathPrefix(req));
  res.jsonp(tileJson);
};

exports.getFilteredKey = function getFilteredKey(req, res, next) {
  var key = req.params.key;
  var filter = 'filter/' + key;
  var tileJson = tileJsonForSurvey(pathPrefix(req), filter);
  res.jsonp(tileJson);
};

exports.getFilteredKeyValue = function getFilteredKey(req, res, next) {
  var filterPath = 'filter/' + req.params.key + '/' + req.params.val;
  var tileJson = tileJsonForSurvey(pathPrefix(req), filterPath);
  res.jsonp(tileJson);
};
