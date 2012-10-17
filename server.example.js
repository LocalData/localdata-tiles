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
var map = require('nodetiles-core'),
    GeoJsonSource = map.datasources.GeoJson,
    PostGISSource = map.datasources.PostGIS,
    Projector = map.projector;

var map = new map.Map();
var tileJson = require(__dirname + '/map/tile');

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
