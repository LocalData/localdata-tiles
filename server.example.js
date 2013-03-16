/**
 * Sample tileserver for LocalData
 */

// Basic configuration
var PORT = process.env.PORT || process.argv[2] || 3001;
var DATA_SOURCE_BASE = process.env.DATA_SOURCE_BASE || 'http://localhost:3000/api';
var DEBUG = true;

var path = require('path'),
    express = require('express'),
    app = module.exports = express(),
    fs = require('fs');


// Todo:
// - load from a template
// - use a sensible center
// - better attribution etc. (use survey data)
var tileJsonForSurvey = function(surveyId, host) {
  return {
    "basename" : "sf_tile.bentiles",
    "bounds" : [-180, -85.05112877980659, 180, 85.05112877980659],
    "center" : [0, 0, 2],
    "description" : "Lovingly crafted with Node and node-canvas.",
    "attribution" : "LocalData",
    "grids"       : ['//' + host + '/' + surveyId + "/utfgrids/{z}/{x}/{y}.json"],
    "id"          : "map",
    "legend"      : "<div style=\"text-align:center;\"><div style=\"font:12pt/16pt Georgia,serif;\">San Francisco</div><div style=\"font:italic 10pt/16pt Georgia,serif;\">by Ben and Rob</div></div>",
    "maxzoom"     : 30,
    "minzoom"     : 2,
    "name"        : "San Francisco",
    "scheme"      : "xyz",
    "template"    : '',
    "tiles"       : ['//' + host + '/' + surveyId + "/tiles/{z}/{x}/{y}.png"],
    "version"     : "1.0.0",
    "webpage"     : "http://github.com/codeforamerica/nodetiles-init"
  };
};

// Get our requirements
var nodetiles = require('nodetiles-core'),
    RemoteGeoJsonSource = nodetiles.datasources.RemoteGeoJson,
    PostGISSource = nodetiles.datasources.PostGIS;

// var tileJson = require(__dirname + '/map/tile');

// Keep track of the different surveys we have maps for
var mapForSurvey = {};

var getOrCreateMapForSurveyId = function(surveyId) {

  // Check if we've already created a map with this datasource
  // TODO
  // Refresh / reload the datsource when it's updated
  if (mapForSurvey[surveyId] !== undefined) {
    return mapForSurvey[surveyId];
  }

  console.log("Setting up new map");

  // Set up the map
  var map = new nodetiles.Map();
  map.assetsPath = path.join(__dirname, "map", "theme");

  // Create the geoJSON path:
  var dataPath = DATA_SOURCE_BASE + '/surveys/' + surveyId + '/responses/in/';

  // Add the remote datasource
  map.addData(new RemoteGeoJsonSource({
    name: 'localdata',
    path: dataPath,
    projection: 'EPSG:4326'
  }));

  // map.addData(new PostGISSource({
  //   connectionString: "tcp://matth@localhost/test",   // required
  //   tableName: "responses",                           // required
  //   geomField: "the_geom",                            // required
  //   // fields: "map_park_n, ogc_fid",                        // optional, speeds things up
  //   name: "localdata",                                     // optional, uses table name otherwise
  //   projection: "EPSG:4326"                                   // optional, defaults to 4326
  // }));

  // Add basic styles
  // TODO
  // Generate dynamic styles
  // Eg, based on filters
  map.addStyle(fs.readFileSync('./map/theme/style.mss','utf8'));

  // Store and return the map
  mapForSurvey[surveyId] = map;
  return map;
};

// Handle a request for tiles at a specific survey
// Hopefully this is generic enough...
app.get('/:surveyId/tiles*', function(req, res, next){
  var surveyId = req.params.surveyId;
  var map = getOrCreateMapForSurveyId(surveyId);
  var route = nodetiles.route.tilePng({ map: map });
  route(req, res, next);
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

  
// Old routes ...........................................................
//
// Generic UTF Grids
// TODO: serve per survey
// app.use('/utfgrids', nodetiles.route.utfGrid({ map: map }));

// tile.json
// use app.get for the tile.json since we're serving a file, not a directory
// TODO: serve per survey
// app.get('/tile.json', nodetiles.route.tileJson({ path: __dirname + '/map/tile.json' }));

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
  app.use('/assets/js/libs', express.static(__dirname + '/dist/release'));
  app.use('/assets/css', express.static(__dirname + '/dist/release'));
  app.use(express.static(__dirname + '/public'));
});


// Serve index.html
app.get('/', function(req, res) {
  res.sendfile(__dirname + '/index.html');
});
    
app.listen(PORT);
console.log("Express server listening on port %d in %s mode", PORT, app.settings.env);
