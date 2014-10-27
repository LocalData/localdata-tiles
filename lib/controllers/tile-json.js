'use strict';

var querystring = require('querystring');
var settings = require('../settings');

function pathPrefix(req) {
  if (!settings.prefix) {
    return 'https://' + req.headers.host + '/' + req.params.surveyId;
  }

  return settings.prefix + '/' + req.params.surveyId;
}

// Generate tilejson
function tileJsonForSurvey(options) {
  var path = options.path;

  // The tile path changes if we are adding data filters
  if (options.filterPath) {
    path = path + '/' + options.filterPath;
  }

  // Construct the URLs for the UTF grids and the tiles.
  var grid = path + "/utfgrids/{z}/{x}/{y}.json?callback={cb}";
  var tiles = path + "/tiles/{z}/{x}/{y}.png";

  // Add on any filters or other parameters. Right now, this just handles dates,
  // but will at some point also have the filters.
  if (options.query) {
    var query = querystring.stringify(options.query);
    tiles = tiles + '?' + query;
    grid = grid + '&' + query;
  }

  var tilejson = {
    "basename" : "localdata.tiles",
    "bounds" : [-180, -85.05112877980659, 180, 85.05112877980659],
    "center" : [0, 0, 2],
    "description" : "Lovingly crafted with Node and node-canvas.",
    "attribution" : "LocalData",
    "grids"       : [grid],
    "id"          : "map",
    "legend"      : "",
    "maxzoom"     : 30,
    "minzoom"     : 2,
    "name"        : '',
    "scheme"      : 'xyz',
    "template"    : '',
    "tiles"       : [tiles],
    "version"     : "1.0.0",
    "webpage"     : "http://localdata.com"
  };

  return tilejson;
}

exports.get = function get(req, res, next) {
  delete req.query._; // don't pass on jsonp function names

  var tileJson = tileJsonForSurvey({
    path: pathPrefix(req),
    query: req.query
  });
  res.jsonp(tileJson);
};

exports.getFilteredKey = function getFilteredKey(req, res, next) {
  delete req.query._; // don't pass on jsonp function names

  var key = req.params.key;
  var filterPath = 'filter/' + key;
  var tileJson = tileJsonForSurvey({
    path: pathPrefix(req),
    filterPath: filterPath,
    query: req.query
  });
  res.jsonp(tileJson);
};

exports.getFilteredKeyValue = function getFilteredKey(req, res, next) {
  delete req.query._; // don't pass on jsonp function names

  var filterPath = 'filter/' + req.params.key + '/' + req.params.val;
  var tileJson = tileJsonForSurvey({
    path: pathPrefix(req),
    filterPath: filterPath,
    query: req.query
  });
  res.jsonp(tileJson);
};
