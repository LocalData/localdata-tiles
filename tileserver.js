/**
 * Sample tileserver for LocalData
 *
 * LD internal testing notes:
 * Small survey:
 * (master)nt$ time curl -L --compressed http://localhost:3001/ed6138d0-8a98-11e2-88bd-475906fdae2b/tiles/17/35287/48473.png > file.png
 *
 *  Huge survey:
 *  e9bbcfc0-8cc2-11e2-82e5-ab06ad9f5ce0
 */
'use strict';

// var agent = require('webkit-devtools-agent');

if (process.env.NODEFLY_KEY) {
  var NAME = process.env.NAME || 'local';
  require('nodefly').profile(
    process.env.NODEFLY_KEY,
    ['localdata-tiles', NAME]
  );
}

var ejs = require('ejs');
var express = require('express');
var fs = require('fs');
var http = require('http');
var memwatch = require('memwatch');
var mongoose = require('mongoose');
var path = require('path');
var stream = require('stream');
var app = module.exports = express();
var db = null;

memwatch.on('leak', function(info) {
  console.log("LEAK!", info);
});


memwatch.on('stats', function(stats) {
  // console.log('stats', stats);
});

var nodetiles = require('nodetiles-core');
//var MongoDataSource = require('../nodetiles-mongodb/MongoDB.js');
var MongoDataSource = require('nodetiles-mongodb');

// Basic configuration
var PORT = process.env.PORT || process.argv[2] || 3001;
var MONGO = process.env.MONGO || 'mongodb://localhost:27017/localdata_production';


// Database options
var connectionParams = {
  uri: MONGO,
  opts: {
    db: {
      w: 1,
      safe: true,
      native_parser: true
    }
  }
};

app.use(express.logger());

// Generate tilejson
var tileJsonForSurvey = function(surveyId, host, filterPath) {
  var path = surveyId;

  // The tile path changes if we are adding data filters
  if (filterPath) {
    path = path + '/' + filterPath;
  }

  return {
    "basename" : "localdata.tiles",
    "bounds" : [-180, -85.05112877980659, 180, 85.05112877980659],
    "center" : [0, 0, 2],
    "description" : "Lovingly crafted with Node and node-canvas.",
    "attribution" : "LocalData",
    "grids"       : ['//' + host + '/' + path + "/utfgrids/{z}/{x}/{y}.json?callback={cb}"],
    "id"          : "map",
    "legend"      : "",
    "maxzoom"     : 30,
    "minzoom"     : 2,
    "name"        : '',
    "scheme"      : 'xyz',
    "template"    : '',
    "tiles"       : ['//' + host + '/' + path + "/tiles/{z}/{x}/{y}.png"], // FILTER HERE
    "version"     : "1.0.0",
    "webpage"     : "http://localdata.com"
  };
};


// Keep track of the different surveys we have maps for
// TODO: use a fixed-size LRU cache, so this doesn't grow without bounds.
var mapForSurvey = {};

/**
 * Create a Nodetiles map object for a given survet
 * @param  {Strign}   surveyId Id of the survey
 * @param  {Function} callback Callback, param (map)
 * @param  {Object}   filter   Optional filter
 *                             Will color the map based on the filter
 */
var getOrCreateMapForSurveyId = function(surveyId, callback, filter) {
  // TODO: cache the result of this, so we don't have to create a new datasource for every tile.

  // Set up the map
  var map = new nodetiles.Map();

  // Path to the stylesheets
  map.assetsPath = path.join(__dirname, "map", "theme");

  // Add the filter, if there is one.
  if(filter !== undefined) {
    // mongooseParams.filter = filter;
  }

  var datasource = new MongoDataSource({
    db: db,
    collectionName: 'responseCollection',
    projection: 'EPSG:4326',
    key: 'geo_info.centroid',
    query: {
      survey: surveyId
    },
    select: {
      'geo_info.geometry': 1,
      'geo_info.humanReadableName': 1
      // if there's a filter
      // selectConditions['responses.' + this.filter.key] = 1;
    }
  });


  // Add basic styles
  if(filter === undefined) {
    map.addStyle(fs.readFileSync('./map/theme/style.mss','utf8'));
  }

  // If there is a filter, we need to generate styles.
  if(filter !== undefined) {
    // Get the form!!
    var form = datasource.getForm(surveyId, function(form, error) {
      // console.log("ERROR???", error);
      var i;

      var colors = [
          "#000000",
          "#ce40bf",
          "#404ecd",
          "#40cd98",
          "#d4e647",
          "#ee6d4a"
      ];

      // generate options
      var options = [];

      var question;
      for (i = 0; i < form.length; i++) {
        if(form[i].name === filter.key) {
          question = form[i];
          break;
        }
      }

      // question.answers = [{value: 'undefined', text: 'No answer'}].push(question.answers);
      // Use the first color for undefined answers
      question.answers.unshift({value: 'undefined', text: 'No answer'});

      for (i = 0; i < question.answers.length; i++) {
        var s = {
          key: filter.key,
          value: question.answers[i].value,
          color: colors[i]
        };
        options.push(s);
      }

      fs.readFile('./map/theme/filter.mss.template','utf8', function(error, styleTemplate) {
        var style = ejs.render(styleTemplate, {options: options});
        // console.log("STYLE: ", style);
        console.log("Adding style");
        map.addStyle(style);

        map.addData(datasource);

        callback(map);
      }.bind(this));

    }.bind(this));
  }else {

    // Create a map with the generic template
    // No filter involved
    var readFileCB = function readFileCB(error, style) {
      map.addStyle(style);
      map.addData(datasource);
      callback(map);
    };

    fs.readFile('./map/theme/style.mss','utf8', readFileCB);
  }
};


function createRenderStream(map, tile) {
  var passThrough = new stream.PassThrough();
  var bounds = nodetiles.projector.util.tileToMeters(tile[1], tile[2], tile[0]);
  map.render({
    bounds: {minX: bounds[0], minY: bounds[1], maxX: bounds[2], maxY: bounds[3]},
    width: 256,
    height: 256,
    zoom: tile[0],
    callback: function(err, canvas) {
      // TODO: handle the error
      canvas.createPNGStream().pipe(passThrough);
    }
  });
  return passThrough;
}

function tilePng(req, res, next){
  var tileCoordinate, bounds;

  var start = Date.now();

  // verify arguments
  tileCoordinate = req.path.match(/(\d+)\/(\d+)\/(\d+)\.png$/);
  if (!tileCoordinate) {
    return next();
  }
  // slice the regexp down to usable size
  tileCoordinate = tileCoordinate.slice(1,4).map(Number);

  // set the bounds and render
}


/**
 * Set up a map for rendering
 */
function renderTile(req, res, next) {
  var key = req.params.key;
  var surveyId = req.params.surveyId;
  var tile = [];

  try {
    tile[0] = parseInt(req.params.zoom, 10);
    tile[1] = parseInt(req.params.x, 10);
    tile[2] = parseInt(req.params.y, 10);
  } catch (e) {
    console.log(e);
    res.send(500, 'Error parsing tile URL');
    return;
  }

  function respondUsingMap(map) {
    createRenderStream(map, tile).pipe(res);
  }

  if (key) {
    // Filter!
    getOrCreateMapForSurveyId(surveyId, respondUsingMap, {
      key: key
    });
  } else {
    getOrCreateMapForSurveyId(surveyId, respondUsingMap);
  }
}


/**
 * Handle requests for tiles
 */
// Get a tile for a survey
app.get('/:surveyId/tiles/:zoom/:x/:y.png', renderTile);

// Get tile for a specific survey with a filter
app.get('/:surveyId/filter/:key/tiles/:zoom/:x/:y.png', renderTile);

// FILTER: tile.json
app.get('/:surveyId/filter/:key/tile.json', function(req, res, next){
  var surveyId = req.params.surveyId;
  var key = req.params.key;
  var filter = 'filter/' + key;
  // We don't need the filter in this situation
  // var map = getOrCreateMapForSurveyId(surveyId);
  var tileJson = tileJsonForSurvey(surveyId, req.headers.host, filter);
  res.jsonp(tileJson);
});

// Serve the UTF grids for a filter
// TODO: handle the routing/http stuff ourselves and just use nodetiles as a
// renderer, like with the PNG tiles
app.get('/:surveyId/filter/:key/utfgrids*', function(req, res, next){
  var surveyId = req.params.surveyId;
  var key = req.params.key;
  var filter = 'filter/' + key;
  var map = getOrCreateMapForSurveyId(surveyId, function(map){
    var route = nodetiles.route.utfGrid({ map: map });
    route(req, res, next);
  }.bind(this), filter);
});

// Serve the UTF grids
app.get('/:surveyId/utfgrids*', function(req, res, next){
  var surveyId = req.params.surveyId;
  getOrCreateMapForSurveyId(surveyId, function(map) {
    var route = nodetiles.route.utfGrid({ map: map });
    route(req, res, next);
  }.bind(this));
});

// tile.json
app.get('/:surveyId/tile.json', function(req, res, next){
  var surveyId = req.params.surveyId;
  // var map = getOrCreateMapForSurveyId(surveyId);
  var tileJson = tileJsonForSurvey(surveyId, req.headers.host);
  res.jsonp(tileJson);
});

// Configure Express routes
app.configure('development', function(){
  app.use(express.errorHandler({ dumpExceptions: true, showStack: true }));
});

app.configure('production', function(){
  app.use(express.errorHandler());
  io.set('log level', 1); // reduce logging
});


// Connect to the database and start the servert
mongoose.connect(connectionParams.uri);
db = mongoose.connection;

db.on('error', function (err) {
  console.log('Error connecting to database', err);
  process.exit(1);
});

db.once('open', function () {
  var server = http.createServer(app);

  server.listen(PORT, function (error) {
    console.log('Express server listening on port %d in %s mode', PORT, app.settings.env);
  });
});
