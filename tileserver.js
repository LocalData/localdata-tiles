/**
 * LocalData Tileserver
 *
 * LD internal testing notes:
 * Nortown:
 * $ time curl -L --compressed http://localhost:3001/dbcb3590-0f59-11e2-81e6-bffd22dee0ec/filter/condition/tiles/14/4411/6055.png > file.png
 *
 * http://localhost:3001/dbcb3590-0f59-11e2-81e6-bffd22dee0ec/utfgrids/14/4411/6055.json > grid.txt
 * http://localhost:3001/dbcb3590-0f59-11e2-81e6-bffd22dee0ec/utfgrids/14/4412/6055.json > grid.txt
 */
//'use strict';

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
var nodetiles = require('nodetiles-core');
var path = require('path');
var stream = require('stream');

var etagCache = require('./lib/etag-cache');

var app = module.exports = express();
var db = null;

var MongoDataSource = require('nodetiles-mongodb');
var Forms = require('./lib/models/Form');

memwatch.on('leak', function(info) {
  console.log("LEAK!", info);
});

memwatch.on('stats', function(stats) {
  // console.log('stats', stats);
});


// Basic configuration
var PORT = process.env.PORT || process.argv[2] || 3001;
var MONGO = process.env.MONGO || 'mongodb://localhost:27017/localdata_production';
var PREFIX = process.env.PREFIX || '//localhost:3001';


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

var useEtagCache = etagCache({
  db: mongoose.connection,
  collection: 'responseCollection',
  geoField: 'geo_info.centroid',
  timeField: 'created'
});


// Generate tilejson
var tileJsonForSurvey = function(surveyId, host, filterPath) {
  var path = PREFIX + '/' + surveyId;

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
};


// Keep track of the different surveys we have maps for
// TODO: use a fixed-size LRU cache, so this doesn't grow without bounds.
var mapForSurvey = {};

/**
 * Create a Nodetiles map object for a given survet
 * @param  {String}   surveyId Id of the survey
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

  // Fields to select
  var select = {
    'geo_info.geometry': 1,
    'geo_info.humanReadableName': 1
  };

  // Add fields based on datasource
  if(filter !== undefined) {
    console.log("Filter select", filter);
    select['responses.' + filter.key] = 1;
  }

  var datasource = new MongoDataSource({
    db: db,
    collectionName: 'responseCollection',
    projection: 'EPSG:4326',
    key: 'geo_info.centroid',
    query: {
      survey: surveyId
    },
    select: select
  });

  // Add basic styles
  if(filter === undefined) {
    map.addStyle(fs.readFileSync('./map/theme/style.mss','utf8'));
  }

  // If there is a filter, we dynamically generate styles.
  if(filter !== undefined) {

    var form = Forms.getFlattenedForm(surveyId, function(error, form) {
      var i;
      var colors = [
          "#000000",
          "#ce40bf",
          "#404ecd",
          "#40cd98",
          "#d4e647",
          "#ee6d4a"
      ];

      // get the answers for a given quesiton
      var options = [];
      var question;
      for (i = 0; i < form.length; i++) {
        if(form[i].name === filter.key) {
          question = form[i];
          break;
        }
      }

      // Use the first color for undefined answers
      question.answers.unshift({value: 'undefined', text: 'No answer'});

      // Generate a style for each possible answer
      for (i = 0; i < question.answers.length; i++) {
        var s = {
          key: filter.key,
          value: question.answers[i].value,
          color: colors[i]
        };
        options.push(s);
      }

      // Load and render the style template
      fs.readFile('./map/theme/filter.mss.template','utf8', function(error, styleTemplate) {
        var style = ejs.render(styleTemplate, {options: options});
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


function bufferStream(stream, done) {
  var bufs = [];
  var length = 0;

  stream.on('readable', function () {
    var buf = stream.read();
    bufs.push(buf);
    length += buf.length;
  });

  stream.on('end', function () {
    done(null, Buffer.concat(bufs, length));
  });

  stream.on('error', function (error) {
    done(error);
  });
}

// Parse the tilename parameters from the URL and store as a res.locals.tile
// array.
function parseTileName(req, res, next) {
  var tile = [0,0,0];
  try {
    tile[0] = parseInt(req.params.zoom, 10);
    tile[1] = parseInt(req.params.x, 10);
    tile[2] = parseInt(req.params.y, 10);
  } catch (e) {
    console.log(e);
    res.send(400, 'Error parsing tile URL');
    return;
  }
  res.locals.tile = tile;
  next();
}

/**
 * Render a tile using a map that we create or an existing cached map.
 */
function renderTile(req, res, next) {
  var key = req.params.key;
  var surveyId = req.params.surveyId;
  var tile = res.locals.tile;

  res.set('Content-Type', 'image/png');

  function respondUsingMap(map) {
    bufferStream(createRenderStream(map, tile), function (error, data) {
      if (error) {
        console.log(error);
        res.send(500);
        return;
      }
      res.send(data);
    });
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
app.get('/:surveyId/tiles/:zoom/:x/:y.png', parseTileName, useEtagCache, renderTile);

// Get tile for a specific survey with a filter
app.get('/:surveyId/filter/:key/tiles/:zoom/:x/:y.png', parseTileName, useEtagCache, renderTile);

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


// Connect to the database and start the server
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
