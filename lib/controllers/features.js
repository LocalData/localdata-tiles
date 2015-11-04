'use strict';

var path = require('path');
var stream = require('stream');

var _ = require('lodash');
var nodetiles = require('nodetiles-core');
var Promise = require('bluebird');

var CacheItem = require('../models/CacheItem');

var metrics = require('../metrics/pipeline');
var layer = require('../layer.js');
var featuresDS = require('../datasources/features');
var settings = require('../settings.js');
var util = require('./util.js');


Promise.promisifyAll(CacheItem);


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
    boundsBuffer = settings.defaultBuffer;
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
    buffer = settings.defaultBuffer;
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
      res.sendStatus(500);
      return;
    }
    res.send(data);
  }

  layer.getDefinition({
    layerId: layerId
  }).then(function (layerDef) {
    if (!layerDef) {
      res.sendStatus(404);
      return;
    }

    options.query = layerDef.query;
    options.select = layerDef.select;
    options.styles = layerDef.styles;
    return getMap(options).then(function (map) {
      util.bufferStream(util.createRenderStream(map, tile), handleData);
    });
  }).catch(function (error) {
    console.log('Error generating tile', error);
    console.log(error.stack);
    res.sendStatus(500);
  });
};

function selectFields(item, select) {
    var ret = {};
    Object.keys(item).forEach(function (field) {
      if (field === 'object_id' || !!select[field]) {
        if (typeof select[field] === 'object') {
          ret[field] = selectFields(item[field], select[field]);
        } else {
          ret[field] = item[field];
        }
      }
    });
    return ret;
}

function stripGridFields(grid, select) {
  var stripped = {};
  Object.keys(grid.data).forEach(function (key) {
    stripped[key] = selectFields(grid.data[key], select);
  });
  return {
    grid: grid.grid,
    keys: grid.keys,
    data: stripped
  };
}

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
      res.sendStatus(500);
      return;
    }
    res.send(data);
  };

  layer.getDefinition({
    layerId: layerId,
    grid: true
  }).then(function (layerDef) {
    if (!layerDef) {
      res.sendStatus(404);
      return;
    }

    options.query = layerDef.query;
    options.select = layerDef.select;
    options.styles = layerDef.styles;
    return getMap(options)
    .then(function (map) {
      if (format === 'png') {
        return Promise.promisify(util.createGrid)(map, tile, { drawImage: true })
        .then(function (canvas) {
          var passThrough = new stream.PassThrough();
          canvas.createPNGStream().pipe(passThrough);
          util.bufferStream(passThrough, handleData);
        });
      }

      var stopTimer = metrics.gridTimer();
      return Promise.promisify(util.createGrid)(map, tile)
      .finally(function () {
        // Stop the metric timer whether or not this succeeded.
        stopTimer();
      }).then(function (grid) {
        res.jsonp(stripGridFields(grid, options.select));
      });
    });
  }).catch(function (error) {
    console.log('Error generating grid', error);
    console.log(error.stack);
    res.sendStatus(500);
  });
};
