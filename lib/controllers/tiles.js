'use strict';

var fs = require('fs');
var path = require('path');
var stream = require('stream');

var __ = require('lodash');
var Form = require('../models/Form');
var MongoDataSource = require('nodetiles-mongodb');
var mongoose = require('mongoose');
var nodetiles = require('nodetiles-core');

var metrics = require('../metrics/pipeline');
var settings = require('../settings');
var themes = require('../themes');

var NOANSWER = settings.noAnswer;

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
    callback: function(err, canvas) {
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
    db: mongoose.connection,
    collectionName: 'responseCollection',
    projection: 'EPSG:4326',
    key: 'geo_info.centroid',
    query: query,
    select: select
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

  // If we're just rendering grids, we don't need to do anything with styles.
  if(options.type === 'grid') {
    callback(null, map);
    return;
  }

  // Add basic styles
  if(options.key === undefined) {
    map.addStyle(themes.coverage);
  }

  // Dynamically generate styles for a filter
  // Actually, we need to get the stats here.
  if(options.key !== undefined) {

    var form = Form.getLatest(surveyId, function (error, form) {
      if (error) {
        console.log('Error: could not retrieve the latest form for survey ' + surveyId);
        console.log(error);
        callback(error);
        return;
      }
      var questions;
      if (form) {
        questions = form.getKeyValues();
      } else {
        questions = {};
      }

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

      var answers = questions[options.key];
      var styles = [];
      for (i = 0; i < answers.length; i += 1) {
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

      // Render the filter style template
      map.addStyle(themes.render.filter({ options: styles }));
      map.addData(datasource);
      callback(null, map);
    });
  } else {

    // Create a map with the generic template
    // No filter involved
    map.addStyle(themes.coverage);
    map.addData(datasource);
    callback(null, map);
  }
}

/**
 * Render a tile using a map that we create or an existing cached map.
 */
exports.render = function render(req, res, next) {
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

  var handleData = function(error, data) {
    if (error) {
      console.log('Error generating tile', error);
      res.send(500);
      return;
    }
    res.send(data);
  };

  var respondUsingMap = function(error, map) {
    if (error) {
      handleData(error);
      return;
    }

    bufferStream(createRenderStream(map, tile), handleData);
  };

  getOrCreateMapForSurveyId(surveyId, respondUsingMap, options);
};

// TODO: handle the routing/http stuff ourselves and just use nodetiles as a
// renderer, like with the PNG tiles
exports.renderGrids = function renderGrids(req, res, next) {
  var surveyId = req.params.surveyId;
  var key = req.params.key;
  var val = req.params.val;
  var format = req.params.format;
  var tile = res.locals.tile;

  // Set up the filter path
  var filter = 'filter/' + key;
  if(val !== undefined) {
    filter = filter + '/' + val;
  }

  // We'll use these options to create the map
  var options = { };
  if (key !== undefined) {
    options.key = key;
    options.type = 'grid';
  }
  if (val !== undefined) {
    options.val = val;
  }

  var handleData = function (error, data) {
    if (error) {
      console.log(error);
      res.send(500);
      return;
    }
    res.send(data);
  };

  var respondUsingMap = function (error, map) {
    if (error) {
      console.log('Error generating a UTFGrid', error);
      res.send(500);
      return;
    }

    if (format === 'png') {
      createGrid(map, tile, { drawImage: true }, function (error, canvas) {
        if (error) {
          console.log('Error creating UTFGrid debug PNG', error);
          res.send(500);
          return;
        }

        var passThrough = new stream.PassThrough();
        canvas.createPNGStream().pipe(passThrough);
        bufferStream(passThrough, handleData);
      });
      return;
    }

    var stopTimer = metrics.gridTimer();
    createGrid(map, tile, function (error, grid) {
      stopTimer();
      if (error) {
        console.log('Error creating UTFGrid', error);
        res.send(500);
        return;
      }
      res.jsonp(grid);
    });
  };

  getOrCreateMapForSurveyId(surveyId, respondUsingMap, options);
};
