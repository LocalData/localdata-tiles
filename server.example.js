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
    ShpSource = nodetiles.datasources.Shp,
    Projector = nodetiles.projector;

var tileJson = require(__dirname + '/map/tile');

var map = new nodetiles.Map();
map.assetsPath = path.join(__dirname, "map", "theme");

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

/*
map.addData(new ShpSource({
  name: "world",
  path: "/path/to/shapefile_base_name"
}));
*/

map.addStyle(fs.readFileSync('./map/theme/style.mss','utf8'));

// Wire up the URL routing
app.use('/tiles', nodetiles.route.tilePng({ map: map })); // tile.png
app.use('/utfgrids', nodetiles.route.utfGrid({ map: map })); // utfgrids
// tile.json: use app.get for the tile.json since we're serving a file, not a directory
app.get('/tile.json', nodetiles.route.tileJson({ path: __dirname + '/map/tile.json' }));


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
    
app.listen(PORT);
console.log("Express server listening on port %d in %s mode", PORT, app.settings.env);
