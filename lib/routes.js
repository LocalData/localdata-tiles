'use strict';

var knox = require('knox');

var settings = require('./settings');
var useEtagCache = require('./etag-cache')();
var s3Cache = require('./s3-cache');

var tiles = require('./controllers/tiles');
var tileJson = require('./controllers/tile-json');

var useS3Cache;
var s3client;

if (settings.s3Key !== undefined) {
  console.log('Using S3 to cache generated tiles. Bucket: ' + settings.s3Bucket);
  useS3Cache = s3Cache({
    s3client: knox.createClient({
      key: settings.s3Key,
      secret: settings.s3Secret,
      bucket: settings.s3Bucket
    })
  });
} else {
  useS3Cache = function (req, res, next) {
    next();
  };
}

// Parse the tilename parameters from the URL and store as a res.locals.tile
// array.
function parseTileName(req, res, next) {
  var tile = [0,0,0];
  tile[0] = parseInt(req.params.zoom, 10);
  tile[1] = parseInt(req.params.x, 10);
  tile[2] = parseInt(req.params.y, 10);

  if (isNaN(tile[0]) || isNaN(tile[1]) || isNaN(tile[2])) {
    console.log('Error parsing tile URL params: ' + JSON.stringify(req.params));
    res.send(400, 'Error parsing tile URL');
    return;
  }

  res.locals.tile = tile;

  next();
}

exports.setup = function setup(app) {
  // Get a tile for a survey
  app.get('/:surveyId/tiles/:zoom/:x/:y.png', parseTileName, useEtagCache, useS3Cache, tiles.render);

  // Get tile for a specific survey with a filter
  app.get('/:surveyId/filter/:key/:val/tiles/:zoom/:x/:y.png', parseTileName, useEtagCache, useS3Cache, tiles.render);
  app.get('/:surveyId/filter/:key/tiles/:zoom/:x/:y.png', parseTileName, useEtagCache, useS3Cache, tiles.render);

  // tile.json
  app.get('/:surveyId/tile.json', tileJson.get);

  // tile.json with a filter
  app.get('/:surveyId/filter/:key/tile.json', tileJson.getFilteredKey);
  app.get('/:surveyId/filter/:key/:val/tile.json', tileJson.getFilteredKeyValue);

  // Serve the UTF grids
  app.get('/:surveyId/utfgrids/:zoom/:x/:y.:format', parseTileName, useS3Cache, tiles.renderGrids);

  // Serve the UTF grids for a filter
  app.get('/:surveyId/filter/:key/:val/utfgrids/:zoom/:x/:y.:format', parseTileName, useS3Cache, tiles.renderGrids);
  app.get('/:surveyId/filter/:key/utfgrids/:zoom/:x/:y.:format', parseTileName, useS3Cache, tiles.renderGrids);
};
