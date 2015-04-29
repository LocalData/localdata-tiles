'use strict';

var crypto = require('crypto');

var bodyParser = require('body-parser');
var knox = require('knox');

var features = require('./controllers/features');
var mongoCache = require('./cache/mongo-cache');
var s3Cache = require('./cache/s3-cache');
var s3CacheFeatures = require('./cache/s3-cache-features');
var settings = require('./settings');
var tiles = require('./controllers/tiles');
var tileJson = require('./controllers/tile-json');
var useEtagCache = require('./etag-cache')();

var useCache, useCacheFeatures;

function noOp(req, res, next) {
  next();
}

if (settings.cacheMethod === 'mongo') {
  useCache = mongoCache;
  useCacheFeatures = noOp;
} else if (settings.nocache || !settings.s3Key || settings.cacheMethod === 'none') {
  useCache = noOp;
  useCacheFeatures = noOp;
} else {
  console.log('Using S3 to cache generated tiles. Bucket: ' + settings.s3Bucket);

  var knoxClient = knox.createClient({
    key: settings.s3Key,
    secret: settings.s3Secret,
    bucket: settings.s3Bucket
  });

  useCache = s3Cache({
    s3client: knoxClient
  });

  useCacheFeatures = s3CacheFeatures({
    s3client: knoxClient
  });
}


if (settings.nocache) {
  useEtagCache = noOp;
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

function makePostDigester(field) {
  return function digest(req, res, next) {
    var shasum = crypto.createHash('sha1');

    req.on('data', function (data) {
      shasum.update(data);
    });
    req.on('end', function () {
      res.locals[field] = shasum.digest('hex');
    });
    next();
  };
}

function makeQueryDigester(param, field) {
  return function digest(req, res, next) {
    var shasum = crypto.createHash('sha1');
    var data = req.query[param] || '';
    shasum.update(data);
    res.locals[field] = shasum.digest('hex');
    next();
  };
}

exports.setup = function setup(app) {
  // Feature tile routes -------------------------------------------------------

  // Create layer definition
  app.post(
    '/features/tile.json',
    makePostDigester('layerId'),
    bodyParser.json(),
    tileJson.post
  );

  app.get(
    '/features/tile.json',
    makeQueryDigester('layerDefinition', 'layerId'),
    tileJson.get
  );

  app.get('/features/layers/:layerId', tileJson.getLayerDef);

  app.get(
    '/features/layers/:layerId/tiles/:zoom/:x/:y.png',
    parseTileName,
    // useEtagCache,
    useCacheFeatures,
    features.render
  );

  app.get(
    '/features/layers/:layerId/utfgrids/:zoom/:x/:y.:format',
    parseTileName,
    // useEtagCache,
    useCacheFeatures,
    features.renderGrids
  );

  // Getting features without a layer definition

  // Get a PNG tile for features
  app.get(
    '/features/tiles/:zoom/:x/:y.png',
    parseTileName,
    // useEtagCache,
    // useCache,
    features.render
  );

  // Get a grid tile for features
  app.get(
    '/features/utfgrids/:zoom/:x/:y.:format',
    parseTileName,
    // useEtagCache,
    // useCache,
    features.renderGrids
  );


  // Survey tile routes --------------------------------------------------------

  // Create layer definition/get tile.json
  app.post(
    '/surveys/:surveyId/tile.json',
    makePostDigester('layerId'),
    bodyParser.json(),
    tileJson.post
  );

  app.get(
    '/surveys/:surveyId/tile.json',
    makeQueryDigester('layerDefinition', 'layerId'),
    tileJson.get
  );

  // Get a layer definition
  app.get('/surveys/:surveyId/layers/:layerId', tileJson.getLayerDef);

  // Get a PNG tile for a survey
  app.get(
    '/surveys/:surveyId/layers/:layerId/tiles/:zoom/:x/:y.png',
    parseTileName,
    useEtagCache,
    useCache,
    tiles.render
  );

  // Get UTF grid tile for a survey
  app.get(
    '/surveys/:surveyId/layers/:layerId/utfgrids/:zoom/:x/:y.:format',
    parseTileName,
    useEtagCache,
    useCache,
    tiles.renderGrids
  );


  // Legacy survey tile routes -------------------------------------------------

  // Get a tile for a survey
  app.get('/:surveyId/tiles/:zoom/:x/:y.png', parseTileName, useEtagCache, useCache, tiles.render);

  // Get tile for a specific survey with a filter
  app.get('/:surveyId/filter/:key/:val/tiles/:zoom/:x/:y.png', parseTileName, useEtagCache, useCache, tiles.render);
  app.get('/:surveyId/filter/:key/tiles/:zoom/:x/:y.png', parseTileName, useEtagCache, useCache, tiles.render);

  // tile.json
  app.get('/:surveyId/tile.json', tileJson.get);
  app.post('/:surveyId/tile.json', bodyParser.text({
    type: '*'
  }), tileJson.post);

  // tile.json with a filter
  app.get('/:surveyId/filter/:key/tile.json', tileJson.getFilteredKey);
  app.get('/:surveyId/filter/:key/:val/tile.json', tileJson.getFilteredKeyValue);

  // Serve the UTF grids
  app.get('/:surveyId/utfgrids/:zoom/:x/:y.:format', parseTileName, useCache, tiles.renderGrids);

  // Serve the UTF grids for a filter
  app.get('/:surveyId/filter/:key/:val/utfgrids/:zoom/:x/:y.:format', parseTileName, useCache, tiles.renderGrids);
  app.get('/:surveyId/filter/:key/utfgrids/:zoom/:x/:y.:format', parseTileName, useCache, tiles.renderGrids);
};
