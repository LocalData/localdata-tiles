'use strict';

var querystring = require('querystring');

var layer = require('../layer');
var settings = require('../settings');

function pathPrefix(req) {
  if (!settings.prefix) {
    return ['https://' + req.headers.host];
  }
  
  return settings.prefix;
}

function surveyPaths(req) {
  return pathPrefix(req).map(function (path) {
    return path + '/' + req.params.surveyId;
  });
}

// Generate tilejson
function generateTileJSON(options) {
  var paths = options.paths;

  var grids = [];
  var tiles = [];
  
  var filterPath;
  var tileQuery;
  var gridQuery;

  // The tile path changes if we are adding data filters
  if (options.filterPath) {
    filterPath = '/' + options.filterPath;
  } else {
    filterPath = '';
  }

  // Add on any filters or other parameters. Right now, this just handles dates,
  // but will at some point also have the filters.
  if (options.query) {
    var query = querystring.stringify(options.query);
    tileQuery = '?' + query;
    gridQuery = '&' + query;
  } else {
    tileQuery = '';
    gridQuery = '';
  }

  paths.forEach(function (path) {
    // Construct the URLs for the UTF grids and the tiles.
    grids.push(path + filterPath + '/utfgrids/{z}/{x}/{y}.json?callback={cb}' + gridQuery);
    tiles.push(path + filterPath + '/tiles/{z}/{x}/{y}.png' + tileQuery);
  });


  var tilejson = {
    "basename" : "localdata.tiles",
    "bounds" : [-180, -85.05112877980659, 180, 85.05112877980659],
    "center" : [0, 0, 2],
    "description" : "Lovingly crafted with Node and node-canvas.",
    "attribution" : "LocalData",
    "grids"       : grids,
    "id"          : "map",
    "legend"      : "",
    "maxzoom"     : 30,
    "minzoom"     : 2,
    "name"        : '',
    "scheme"      : 'xyz',
    "template"    : '',
    "tiles"       : tiles,
    "version"     : "1.0.0",
    "webpage"     : "http://localdata.com"
  };

  return tilejson;
}

exports.get = function get(req, res, next) {
  delete req.query._; // don't pass on jsonp function names

  var surveyId = req.params.surveyId;

  if (req.query.layerDefinition) {
    var layerId = res.locals.layerId;
    var data;
    try {
      data = JSON.parse(req.query.layerDefinition);
    } catch (e) {
      console.log(e);
      console.log(e.stack);
      res.send(400);
      return;
    }

    delete req.query.layerDefinition;

    layer.saveDefinition(layerId, data)
    .then(function () {
      var paths = pathPrefix(req).map(function (path) {
        if (surveyId) {
          return path + '/surveys/' + surveyId + '/layers/' + layerId;
        }
        // This is a feature layer request
        return path + '/features/layers/' + layerId;
      });

      var tileJson = generateTileJSON({
        paths: paths,
        query: req.query
      });
      res.jsonp(tileJson);
    }).catch(function (error) {
      console.log(error);
      console.log(error.stack);
      res.send(500);
    });
  } else {
    // No layer definition, so we fall back to the legacy URLs
    var tileJson = generateTileJSON({
      paths: surveyPaths(req),
      query: req.query
    });
    res.jsonp(tileJson);
  }
};

exports.post = function post(req, res) {
  delete req.query._; // don't pass on jsonp function names

  var layerId = res.locals.layerId;
  var surveyId = req.params.surveyId;

  layer.saveDefinition(layerId, req.body)
  .then(function () {

    // Set up the correct base path
    var paths = pathPrefix(req).map(function (path) {
      if (surveyId) {
        return path + '/surveys/' + surveyId + '/layers/' + layerId;
      }
      // This is a feature layer request
      return path + '/features/layers/' + layerId;
    });

    // Create the tileJSON
    var tileJson = generateTileJSON({
      paths: paths,
      query: req.query
    });
    res.jsonp(tileJson);
  });
};

exports.getLayerDef = function getLayerDef(req, res) {
  layer.getDefinition({
    layerId: req.params.layerId
  }).then(function (data) {
    if (!data) {
      res.send(404);
      return;
    }
    res.json(200, data);
  }).catch(function (error) {
    console.log(error);
    console.log(error.stack);
    res.send(500);
  });
};


exports.getFilteredKey = function getFilteredKey(req, res, next) {
  delete req.query._; // don't pass on jsonp function names

  var key = req.params.key;
  var filterPath = 'filter/' + key;
  var tileJson = generateTileJSON({
    paths: surveyPaths(req),
    filterPath: filterPath,
    query: req.query
  });
  res.jsonp(tileJson);
};

exports.getFilteredKeyValue = function getFilteredKey(req, res, next) {
  delete req.query._; // don't pass on jsonp function names

  var filterPath = 'filter/' + req.params.key + '/' + req.params.val;
  var tileJson = generateTileJSON({
    paths: surveyPaths(req),
    filterPath: filterPath,
    query: req.query
  });
  res.jsonp(tileJson);
};
