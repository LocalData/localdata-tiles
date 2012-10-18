/**
 * 
 *
 *
 * EXAMPLE SERVER
 * (this server is unnecessary if you are using the `nodetiles` command line tool)
 *
 * You can run this server using `node server`
 * (be sure you run `npm install` first to install dependencies)
 *
 *
 *
 */

// Basic configuration
var PORT = process.env.PORT || process.argv[2] || 3000;
var DEBUG = true;

var path = require('path'),
    express = require('express'),
    app = module.exports = express(),
    fs = require('fs');

//
// Setup the map
//
var nodetiles = require('nodetiles-core'),
    GeoJsonSource = nodetiles.datasources.GeoJson,
    PostGISSource = nodetiles.datasources.PostGIS,
    Projector = nodetiles.projector;

var tileJson = require(__dirname + '/map/tile');

// examples:
//var map = new nodetiles.Map({projection: "+proj=lcc +lat_1=-14.26666666666667 +lat_0=-14.26666666666667 +lon_0=-170 +k_0=1 +x_0=152400.3048006096 +y_0=0 +ellps=clrk66 +towgs84=-115,118,426,0,0,0,0 +to_meter=0.3048006096012192 +no_defs"});
//var map = new nodetiles.Map({projection: 4326});
var map = new nodetiles.Map();

map.addData(new GeoJsonSource({ 
  name: "world",
  path: __dirname + '/map/data/countries.geojson', 
  projection: "EPSG:900913"
}));
map.addData(new GeoJsonSource({ 
  name: "example",
  path: __dirname + '/map/data/example.geojson', 
  projection: "EPSG:4326"
}));

// PostGIS:
// map.addData(newPostGISSource({
//   connectionString: "tcp://postgres@localhost/postgis", // required
//   tableName: "ogrgeojson",                              // required
//   geomField: "wkb_geometry",                            // required
//   fields: "map_park_n, ogc_fid",                        // optional, speeds things up
//   name: "sf_parks",                                     // optional, uses table name otherwise
//   projection: 900913,                                   // optional, defaults to 4326
//});

map.addStyle(fs.readFileSync('./map/theme/style.mss','utf8'));






//
// Configure Express routes
// 
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


// 1. Serve Index.html
app.get('/', function(req, res) {
  res.sendfile(__dirname + '/index.html');
});

// 2. Serve the tile.jsonp
app.get('/tile.:format', function(req, res) {
  if (req.params.format === 'json' || req.params.format === 'jsonp' ) {
    return res.jsonp(tileJson);
  }
  else {
    return req.next();
  }
});

// 3. Serve the tiles
app.get('/tiles/:zoom/:col/:row.png', function tile(req, res) {
  var tileCoordinate, bounds;
  
  // verify arguments
  var tileCoordinate = [req.params.zoom, req.params.col, req.params.row].map(Number);
  if (!tileCoordinate || tileCoordinate.length != 3) {
    res.send(404, req.url + 'not a coordinate, match =' + tileCoordinate);
    return;
  }
  // set the bounds and render
  bounds = Projector.util.tileToMeters(tileCoordinate[1], tileCoordinate[2], tileCoordinate[0]);
  map.render(bounds[0], bounds[1], bounds[2], bounds[3], 256, 256, function(error, canvas) {
    var stream = canvas.createPNGStream();
    stream.pipe(res);
  });
});
    
// 4. Serve the utfgrid
app.get('/utfgrids/:zoom/:col/:row.:format?', function utfgrid(req, res) {
  var tileCoordinate, respondWithImage, renderHandler, bounds;
      
  // verify arguments
  var tileCoordinate = [req.params.zoom, req.params.col, req.params.row].map(Number);
  if (!tileCoordinate || tileCoordinate.length != 3) {
      res.send(404, req.url + 'not a coordinate, match =' + tileCoordinate);
      return;
  }
    
  respondWithImage = req.params.format === 'png';
  if (respondWithImage) {
    renderHandler = function(err, canvas) {
      var stream = canvas.createPNGStream();
      stream.pipe(res);
    };
  }
  else {
    renderHandler = function(err, grid) {
      res.jsonp(grid);
    };
  }
  bounds = Projector.util.tileToMeters(tileCoordinate[1], tileCoordinate[2], tileCoordinate[0], 64); // 
  map.renderGrid(bounds[0], bounds[1], bounds[2], bounds[3], 64, 64, respondWithImage, renderHandler);
});
    
app.listen(PORT);
console.log("Express server listening on port %d in %s mode", PORT, app.settings.env);
