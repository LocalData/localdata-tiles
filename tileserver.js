//var agent = require('webkit-devtools-agent');
/**
 * Sample tileserver for LocalData
 */

/**
 * Small survey:
 * (master)nt$ time curl -L --compressed http://localhost:3001/ed6138d0-8a98-11e2-88bd-475906fdae2b/tiles/17/35287/48473.png > file.png
 *
 *  Huge survey:
 *  e9bbcfc0-8cc2-11e2-82e5-ab06ad9f5ce0
 */

// Basic configuration
var PORT = process.env.PORT || process.argv[2] || 3001;
var MONGO = process.env.MONGO || 'mongodb://localhost:27017/localdata_production';
var DEBUG = true;


// Libraries
var ejs = require('ejs');
var express = require('express');
var fs = require('fs');
var mongo = require('mongodb');
var MongoClient = require('mongodb').MongoClient;
var mongoose = require('mongoose');
var path = require('path');
var app = module.exports = express();

// Local imports
var nodetiles = require('nodetiles-core');
var RemoteGeoJsonSource = nodetiles.datasources.RemoteGeoJson;
var MongooseDataSource = nodetiles.datasources.Mongoose;
var MongoDataSource = nodetiles.datasources.Mongo;
var PostGISSource = nodetiles.datasources.PostGIS;

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

// Generate tilejson
// Todo:
// - load from a template
// - use a sensible center
// - better attribution etc. (use survey data)
var tileJsonForSurvey = function(surveyId, host, filterPath) {
  var path = surveyId;
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
var mapForSurvey = {};

/**
 * Create a Nodetiles map object for a given survet
 * @param  {Strign}   surveyId Id of the survey
 * @param  {Function} callback Callback, param (map)
 * @param  {Object}   filter   Optional filter
 *                             Will color the map based on the filter
 */
var getOrCreateMapForSurveyId = function(surveyId, callback, filter) {
  // Set up the map
  var map = new nodetiles.Map();

  // Path to the stylesheets
  map.assetsPath = path.join(__dirname, "map", "theme");

  // Mongoose connection parameeters
  var mongooseParams = {
    name: 'localdata',
    projection: 'EPSG:4326',
    surveyId: surveyId,
    db: app.db
  };

  // Add the filter, if there is one.
  if(filter !== undefined) {
    mongooseParams.filter = filter;
  }
  var datasource = new MongoDataSource(mongooseParams);

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
        mapForSurvey[surveyId] = map;

        callback(map);
      }.bind(this));

    }.bind(this));
  }else {
    // Create a map with the generic template

    fs.readFile('./map/theme/style.mss','utf8', function(error, style) {
      console.log("Got this far", style);
      map.addStyle(style);
      map.addData(datasource);
      mapForSurvey[surveyId] = map;
      callback(map);
    }.bind(this));
  }
};


// Get tile for a specific survey
app.get('/:surveyId/tiles*', function(req, res, next){
  console.log(req.url);
  var surveyId = req.params.surveyId;
  var map = getOrCreateMapForSurveyId(surveyId, function(map){
    var route = nodetiles.route.tilePng({ map: map });
    route(req, res, next);
  }.bind(this));
});

// Get tile for a specific survey with a filter
app.get('/:surveyId/filter/:key/tiles*', function(req, res, next){
  console.log(req.url);
  var surveyId = req.params.surveyId;
  var key = req.params.key;

  var filter = {
    key: key
  };
  var map = getOrCreateMapForSurveyId(surveyId, function(map){
    var route = nodetiles.route.tilePng({ map: map, filter: filter });
    route(req, res, next);
  }.bind(this), filter);
});

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
  var map = getOrCreateMapForSurveyId(surveyId);
  var route = nodetiles.route.utfGrid({ map: map });
  route(req, res, next);
});

// tile.json
app.get('/:surveyId/tile.json', function(req, res, next){
  var surveyId = req.params.surveyId;
  var map = getOrCreateMapForSurveyId(surveyId);
  var tileJson = tileJsonForSurvey(surveyId, req.headers.host);
  res.jsonp(tileJson);
});


// Configure Express routes
app.configure('development', function(){
  app.use(express.errorHandler({ dumpExceptions: true, showStack: true }));

  // Backbone routing
  app.use('/assets', express.static(__dirname + '/assets'));
});

app.configure('production', function(){
  app.use(express.errorHandler());
  io.set('log level', 1); // reduce logging

  // Backbone routing: compilation step is included in `npm install` script
  app.use('/app', express.static(__dirname + '/dist/release'));
  app.use(express.static(__dirname + '/public'));
});


// Serve index.html
app.get('/', function(req, res) {
  res.sendfile(__dirname + '/index.html');
});


// Connect to the DB & run the app
// mongoose.connect(connectionParams.uri, connectionParams.opts); //, connectionParams.opts
// app.db = mongoose.connection;
//
// app.db.once('open', function () {
//   app.listen(PORT);
//   console.log("Express server listening on port %d in %s mode", PORT, app.settings.env);
// });

// For use with mongodb-native
MongoClient.connect(connectionParams.uri, function(err, db) {
  app.db = db;
  app.listen(PORT);
  console.log("Express server listening on port %d in %s mode", PORT, app.settings.env);
});




