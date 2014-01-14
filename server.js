/**
 * LocalData Tileserver
 *
 * LD internal testing notes:
 * Nortown:
 * $ time curl -L --compressed http://localhost:3001/dbcb3590-0f59-11e2-81e6-bffd22dee0ec/filter/condition/tiles/14/4411/6055.png > file.png
 *
 * http://localhost:3001/dbcb3590-0f59-11e2-81e6-bffd22dee0ec/utfgrids/14/4411/6055.json > grid.txt
 * http://localhost:3001/dbcb3590-0f59-11e2-81e6-bffd22dee0ec/utfgrids/14/4412/6055.json > grid.txt
 and the PNG: http://localhost:3001/dbcb3590-0f59-11e2-81e6-bffd22dee0ec/tiles/14/4412/6055.png
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
var knox = require('knox');

var mongoose = require('mongoose');
var nodetiles = require('nodetiles-core');
var path = require('path');
var stream = require('stream');
var __ = require('lodash');

var etagCache = require('./lib/etag-cache');
var s3Cache = require('./lib/s3-cache');

var app = module.exports = express();
var db = null;

var MongoDataSource = require('nodetiles-mongodb');
var Form = require('./lib/models/Form');
var Response = require('./lib/models/Response');
var s3client;

if(process.env.S3_KEY !== undefined) {
  console.log("Using s3");
  var s3client = knox.createClient({
    key: process.env.S3_KEY,
    secret: process.env.S3_SECRET,
    bucket: process.env.S3_BUCKET
  });
}

// Basic configuration
var PORT = process.env.PORT || process.argv[2] || 3001;
var MONGO = process.env.MONGO || 'mongodb://localhost:27017/localdata_production';
var PREFIX = process.env.PREFIX || '/tiles';
var NOANSWER = "no response";

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

function allowCrossDomain(req, res, next) {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET');
    res.header('Access-Control-Allow-Headers', 'Content-Type');
    next();
}

app.use(express.logger());
app.use(allowCrossDomain);

var useEtagCache = etagCache({
  db: mongoose.connection,
  collection: 'responseCollection',
  geoField: 'geo_info.centroid',
  timeField: 'created'
});

var useS3Cache = s3Cache({
  db: mongoose.connection,
  collection: 'responseCollection',
  geoField: 'geo_info.centroid',
  timeField: 'created',
  s3client: s3client
});


// Generate tilejson
var tileJsonForSurvey = function(surveyId, host, filterPath) {
  var path = PREFIX + '/' + surveyId;

  if (!process.env.PREFIX) {
    path = 'https://' + host + path;
  }

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

var statsBySurvey = {};
var getStats = function(surveyId, callback) {
  if (statsBySurvey[surveyId] !== undefined) {
    callback(statsBySurvey[surveyId]);
    return;
  }

  Response.find({ survey: surveyId }, function(error, responses){
    console.log("STATS CACHE MISS");
    var stats = {};
    var i,
        key;

    for (i = 0; i < responses.length; i++) {
      var r = responses[i].responses;
      for (key in r) {
        if (__.has(r, key)) {
          var val = r[key];

          if(__.has(stats, key)) {
            if(__.has(stats[key], r[key])){
              stats[key][val] += 1;
            }else {
              stats[key][val] = 1;
            }
          }else {
            stats[key] = {};
            stats[key][val] = 1;
          }
        }
      }
    }

    // Calculate "no answer" responses
    var summer = function(memo, num) {
      return memo + num;
    };

    for (key in stats) {
      if(__.has(stats, key)) {
        var sum = __.reduce(stats[key], summer, 0);
        var remainder = responses.length - sum;

        stats[key]['no response'] = remainder;
      }
    }

    statsBySurvey[surveyId] = stats;
    callback(stats);
  });
};


// Keep track of the different surveys we have maps for
// TODO: use a fixed-size LRU cache, so this doesn't grow without bounds.

/**
 * Create a Nodetiles map object for a given survet
 * @param  {String}   surveyId Id of the survey
 * @param  {Function} callback Callback, param (map)
 * @param  {Object}   filter   Optional filter
 *                             Will color the map based on the filter
 */
function getOrCreateMapForSurveyId(surveyId, callback, options) {
  // Cache the result of this, so we don't have to create a new datasource for every tile.
  if (!options) {
    options = {};
  }

  // Set up the map
  var map = new nodetiles.Map();

  // Path to the stylesheets
  map.assetsPath = path.join(__dirname, "map", "theme");

  var query = {
    survey: surveyId
  };

  var select = {
    'geo_info.geometry': 1,
    'geo_info.humanReadableName': 1,
    'object_id': 1
  };

  // Add fields based on datasource
  if(options.key !== undefined) {
    select['responses.' + options.key] = 1;

    if(options.val !== undefined) {
      query['responses.' + options.key] = options.val;

      if (options.val === NOANSWER) {
        query['responses.' + options.key] = { "$exists": false };
      }
    }
  }

  // https://localhost:3443/tiles/59faaef0-811a-11e2-86a3-530027a69dba/filter/condition/no%20response/tiles/18/66195/97045.png

  var datasource = new MongoDataSource({
    db: db,
    collectionName: 'responseCollection',
    projection: 'EPSG:4326',
    key: 'geo_info.centroid',
    query: query,
    select: select
  });

  // If we're just rendering grids, we don't need to do anything with styles.
  if(options.type === 'grid') {
    callback(map);
    return;
  }

  // Add basic styles
  if(options.key === undefined) {
    map.addStyle(fs.readFileSync('./map/theme/style.mss','utf8'));
  }

  // Dynamically generate styles for a filter
  // Actually, we need to get the stats here.
  if(options.key !== undefined) {

    // var form = Form.getFlattenedForm(surveyId, function(error, form) {
    getStats(surveyId, function(stats) {
      var i;
      var colors = [
        "#b7aba5", // First color used for blank entries
                   // Actually set in the style template
        "#a743c3",
        "#f15a24",
        "#58aeff",
        "#00ad00",
        "#ffad00"
      ];

      var answers = __.keys(stats[options.key]);
      var styles = [];
      for (i = 0; i < answers.length; i++) {
        var s = {
          key: options.key,
          value: answers[i],
          color: colors[i + 1]
        };

        if (answers[i] === 'no response') {
          s.color = colors[0];
        }

        styles.push(s);
      }

      // Load and render the style template
      fs.readFile('./map/theme/filter.mss.template','utf8', function(error, styleTemplate) {
        var style = ejs.render(styleTemplate, {options: styles});
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
}

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
  // console.log("Setting res.locals.tile", res.locals.tile);
  next();
}

/**
 * Render a tile using a map that we create or an existing cached map.
 */
function renderTile(req, res, next) {
  var key = req.params.key;
  var val = req.params.val;
  var surveyId = req.params.surveyId;
  var tile = res.locals.tile;

  res.set('Content-Type', 'image/png');

  var options = {};
  if (key) {
    options.key = key;
  }
  if (val) {
    options.val = val;
  }

  var handleStream = function(error, data) {
    if (error) {
      console.log(error);
      res.send(500);
      return;
    }
    res.send(data);
  };

  var respondUsingMap = function(map) {
    bufferStream(createRenderStream(map, tile), handleStream);
  };

  getOrCreateMapForSurveyId(surveyId, respondUsingMap, options);
}


/**
 * Handle requests for tiles
 */
// Get a tile for a survey
app.get('/:surveyId/tiles/:zoom/:x/:y.png', parseTileName, useEtagCache, useS3Cache, renderTile);

// Get tile for a specific survey with a filter
app.get('/:surveyId/filter/:key/:val/tiles/:zoom/:x/:y.png', parseTileName, useEtagCache, useS3Cache, renderTile);
app.get('/:surveyId/filter/:key/tiles/:zoom/:x/:y.png', parseTileName, useEtagCache, useS3Cache, renderTile);

// FILTER: tile.json
app.get('/:surveyId/filter/:key/tile.json', function(req, res, next){
  var surveyId = req.params.surveyId;
  var key = req.params.key;
  var filter = 'filter/' + key;
  var tileJson = tileJsonForSurvey(surveyId, req.headers.host, filter);
  res.jsonp(tileJson);
});

// FILTER: tile.json
app.get('/:surveyId/filter/:key/:val/tile.json', function(req, res, next){
  var surveyId = req.params.surveyId;
  var filterPath = 'filter/' + req.params.key + '/' + req.params.val;
  var tileJson = tileJsonForSurvey(surveyId, req.headers.host, filterPath);
  res.jsonp(tileJson);
});


var renderGrids = function(req, res, next) {
  var surveyId = req.params.surveyId;
  var key = req.params.key;
  var val = req.params.val;

  // Set up the filter path
  var filter = 'filter/' + key;
  if(val !== undefined) {
    filter = filter + '/' + val;
  }

  // We'll use these options to create the map
  var options = { };
  options.type = 'grid';
  if (key !== undefined) {
    options.key = key;
  }
  if (val !== undefined) {
    options.val = val;
  }

  var map = getOrCreateMapForSurveyId(surveyId, function(map){
    var route = nodetiles.route.utfGrid({ map: map });
    route(req, res, next);
  }, options);
};

// Serve the UTF grids for a filter
// TODO: handle the routing/http stuff ourselves and just use nodetiles as a
// renderer, like with the PNG tiles
app.get('/:surveyId/filter/:key/:val/utfgrids*', renderGrids);
app.get('/:surveyId/filter/:key/utfgrids*', renderGrids);

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
  var tileJson = tileJsonForSurvey(surveyId, req.headers.host);
  res.jsonp(tileJson);
});

// Configure Express routes
app.configure('development', function(){
  app.use(express.errorHandler({ dumpExceptions: true, showStack: true }));
});

app.configure('production', function(){
  app.use(express.errorHandler());

  // TODO
  // Requires socket.io
  // io.set('log level', 1); // reduce logging
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
