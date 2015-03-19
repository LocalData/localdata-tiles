'use strict';

var path = require('path');
var stream = require('stream');

var _ = require('lodash');
var nodetiles = require('nodetiles-core');
var Promise = require('bluebird');

var CacheItem = require('../models/CacheItem');

var layer = require('../layer.js');
var metrics = require('../metrics/pipeline');
var featuresDS = require('../ds-features');

var DEFAULT_BUFFER = 0.05;

Promise.promisifyAll(CacheItem);

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

function createRenderStream(map, tile) {
  var passThrough = new stream.PassThrough();
  var bounds = nodetiles.projector.util.tileToMeters(tile[1], tile[2], tile[0]);

  // Start the timer.
  var stopMetric = metrics.renderTimer();

  map.render({
    bounds: {minX: bounds[0], minY: bounds[1], maxX: bounds[2], maxY: bounds[3]},
    width: 256,
    height: 256,
    zoom: tile[0],
    callback: function (error, canvas) {
      if (error) {
        passThrough.emit('error', error);
        return;
      }

      var stream = canvas.createPNGStream();

      // Stop the timer when the stream ends.
      stream.on('end', stopMetric);

      // TODO: handle the error
      stream.pipe(passThrough);
    }
  });

  return passThrough;
}

function createGrid(map, tile, options, done) {
  if (done === undefined) {
    done = options;
    options = {};
  }

  var drawImage = (options.drawImage === true);

  var bounds = nodetiles.projector.util.tileToMeters(tile[1], tile[2], tile[0]);
  map.renderGrid({
    bounds: {minX: bounds[0], minY: bounds[1], maxX: bounds[2], maxY: bounds[3]},
    width: 64,
    height: 64,
    zoom: tile[0],
    drawImage: drawImage,
    callback: done
  });
}

// Keep track of the different surveys we have maps for
// TODO: use a fixed-size LRU cache, so this doesn't grow without bounds.
/**
 * Create a Nodetiles map object for a given survet
 * @param  {String}   surveyId Id of the survey
 * @param  {Function} callback Callback, param (map)
 * @param  {Object}   filter   Optional filter
 *                             Will color the map based on the filter
 */
function getMap(options, callback) {

  var grid = (options.type === 'grid');

  var boundsBuffer = options.boundsBuffer;
  if (boundsBuffer === undefined) {
    boundsBuffer = DEFAULT_BUFFER;
  }

  // Set up the map
  var map = new nodetiles.Map({
    boundsBuffer: boundsBuffer
  });

  // Path to the stylesheets
  map.assetsPath = path.join(__dirname, "map", "theme");

  var query = _.defaults({
  }, options.query);

  var select = _.defaults({
    'geometry': 1
  }, options.select);

  map.addStyle(options.styles);

  var datasource = featuresDS.create({
    projection: 'EPSG:4326',
    query: query,
    select: select,
    grid: grid
  });

  // Wrap the datasource.getShapes call so we can measure its duration
  var getShapes = datasource.getShapes;
  datasource.getShapes = function getShapesTimed() {
    var stopTimer = metrics.datasourceTimer();
    // Get the actual callback
    var cb = arguments[arguments.length - 1];
    // Get the rest of the arguments
    var args = Array.prototype.slice.call(arguments, 0, arguments.length - 1);
    function done() {
      stopTimer();
      // Call the actual callback
      cb.apply(null, arguments);
    }
    // Call the original getShapes method
    args.push(done);
    getShapes.apply(datasource, args);
  };

  map.addData(datasource);

  // FIXME: This function is not actually async
  return Promise.resolve(map).nodeify(callback);
}

var world = nodetiles.projector.util.tileToMeters(0, 0, 0);

function smartBuffer(bounds, buffer) {
  if (buffer === undefined) {
    buffer = DEFAULT_BUFFER;
  }

  var amountX = (bounds.maxX - bounds.minX) * buffer;
  var amountY = (bounds.maxY - bounds.minY) * buffer;

  var minX = bounds.minX - amountX;
  var maxX = bounds.maxX + amountX;
  var minY = bounds.minY - amountY;
  var maxY = bounds.maxY + amountY;

  if (minX < world[0]) {
    minX = world[0];
  }

  if (maxX > world[2]) {
    maxX = world[2];
  }

  if (minY < world[1]) {
    minY = world[1];
  }

  if (maxY > world[3]) {
    maxY = world[3];
  }

  return {
    minX: minX,
    minY: minY,
    maxX: maxX,
    maxY: maxY
  };
}

/**
 * Render a tile using a map that we create or an existing cached map.
 */
exports.render = function render(req, res, next) {
  var tile = res.locals.tile;
  var layerId = req.params.layerId;

  res.set('Content-Type', 'image/png');

  var options = {
    boundsBuffer: smartBuffer
  };

  function handleData(error, data) {
    if (error) {
      console.log('Error generating tile', error);
      res.send(500);
      return;
    }
    res.send(data);
  }

  layer.getDefinition({
  }).then(function (layerDef) {
    if (!layerDef) {
      res.send(404);
      return;
    }

    options.query = layerDef.query;
    options.select = layerDef.select;
    options.styles = layerDef.styles;
    return getMap(options).then(function (map) {
      bufferStream(createRenderStream(map, tile), handleData);
    });
  }).catch(function (error) {
    console.log('Error generating tile', error);
    console.log(error.stack);
    res.send(500);
  });
};


// TODO: Support grids for features
// TODO: handle the routing/http stuff ourselves and just use nodetiles as a
// renderer, like with the PNG tiles
exports.renderGrids = function renderGrids(req, res, next) {
  var format = req.params.format;
  var tile = res.locals.tile;
  var layerId = req.params.layerId;

  // We'll use these options to create the map
  var options = {
    boundsBuffer: smartBuffer,
    type: 'grid'
  };

  var handleData = function (error, data) {
    if (error) {
      console.log(error);
      res.send(500);
      return;
    }
    res.send(data);
  };

  layer.getDefinition({
    layerId: layerId,
    grid: true
  }).then(function (layerDef) {
    if (!layerDef) {
      res.send(404);
      return;
    }

    options.query = layerDef.query;
    options.select = layerDef.select;
    options.styles = layerDef.styles;
    return getMap(options)
    .then(function (map) {
      if (format === 'png') {
        return Promise.promisify(createGrid)(map, tile, { drawImage: true })
        .then(function (canvas) {
          var passThrough = new stream.PassThrough();
          canvas.createPNGStream().pipe(passThrough);
          bufferStream(passThrough, handleData);
        });
      }

      var stopTimer = metrics.gridTimer();
      return Promise.promisify(createGrid)(map, tile)
      .finally(function () {
        // Stop the metric timer whether or not this succeeded.
        stopTimer();
      }).then(function (grid) {
        res.jsonp(grid);
      });
    });
  }).catch(function (error) {
    console.log('Error generating grid', error);
    console.log(error.stack);
    res.send(500);
  });
};
