'use strict';

var fs = require('fs');
var path = require('path');
var stream = require('stream');

var __ = require('lodash');
var Form = require('../models/Form');
var mongoose = require('mongoose');
var nodetiles = require('nodetiles-core');

var metrics = require('../metrics/pipeline');
var responsesDS = require('../ds-responses');
var settings = require('../settings');
var themes = require('../themes');

var NOANSWER = settings.noAnswer;
var ANSWER = settings.unstructuredAnswer;

var DEFAULT_BUFFER = 0.05;

var colors = [
  "#b7aba5", // First color used for blank entries
             // Actually set in the style template
  "#a743c3",
  "#f15a24",
  "#58aeff",
  "#00ad00",
  "#ffad00"
];


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
function getOrCreateMapForSurveyId(surveyId, callback, options) {
  // Cache the result of this, so we don't have to create a new datasource for every tile.
  if (!options) {
    options = {};
  }

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

  var query = {
    'properties.survey': surveyId
  };

  var select = {
    'geometry': 1,
    'properties.object_id': 1
  };

  if (grid) {
    select['properties.humanReadableName'] = 1;
  }

  // Date filters
  if (options.until || options.after) {
    query['entries.created'] = {};

    if (options.until) {
      var until = new Date(parseInt(options.until, 10));
      query['entries.created'].$lte = new Date(until);
    }

    if (options.after) {
      var after = new Date(parseInt(options.after, 10));
      query['entries.created'].$gt = new Date(after);
    }
  }

  var filterKey = options.key;
  var filterValue = options.val;

  function setupDatasource(options) {
    if (!options) {
      options = {};
    }

    var datasource = responsesDS.create({
      projection: 'EPSG:4326',
      query: query,
      select: select,
      grid: grid,
      path: options.path,
      type: options.type
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
    callback(null, map);
  }

  if (grid) {
    map.addStyle(themes.coverage);
  }

  // Based on the filter coloration/restriction, determine what we need from the database and how we style the map.
  if (filterKey === undefined) {
    // Don't restrict the results, and just style based on coverage.
    map.addStyle(themes.coverage);
    // Set up the datasource
    setupDatasource();
  } else if (filterKey === 'Collector') {
    // If the key is 'Collector', we assume we are dealing with collector names
    // and not a question/response.
    // TODO: Get the list of collectors and style the map appropriately.
    map.addStyle(themes.render.filter({ options: [] }));
    // Set up the datasource
    setupDatasource({
      path: 'entries.source.collector'
    });
  } else {
    // We need to get the form, so we know how to interpret the filter key/value.
    Form.getLatest(surveyId, function (error, form) {
      if (error) {
        console.log('Error: could not retrieve the latest form for survey ' + surveyId);
        console.log(error);
        callback(error);
        return;
      }

      var questions;
      if (form) {
        questions = form.flatten();
      } else {
        questions = {};
      }

      // Support reviewed questions
      // A question's review status is not explicitly part of the form,
      // but the field is stored as though it's a regular response
      questions.reviewed = {
        answers: ['flagged', 'accepted', 'no response']
      };

      var type;

      if (questions[filterKey] !== undefined) {
        type = questions[filterKey].type;
      }

      var answers;
      var styles;

      var path;
      if (type === 'file') {
        // Use the 'file' field instead of the 'responses' field.
        select['entries.files'] = 1;
        if (filterValue === ANSWER) {
          query['entries.files.0'] = { $exists: true };
        } else if (filterValue === NOANSWER) {
          query['entries.files.0'] = { $exists: false };
        }

        // If we're just rendering grids, we don't need to do anything with styles.
        if (!grid) {
          // Color based on "yes there's a file" vs "no there isn't".
          styles = [{
            key: 'files',
            value: ANSWER,
            color: colors[1]
          }, {
            key: 'files',
            value: NOANSWER,
            color: colors[0]
          }];

          // Render the filter style template
          map.addStyle(themes.render.filter({ options: styles }));
        }

        // Set up the datasource
        setupDatasource({
          path: 'entries.files',
          type: 'arrayPresence'
        });

      } else if (type === 'text') {
        // Check for text responses.
        path = 'entries.responses.' + filterKey;
        select[path] = 1;
        if (filterValue === ANSWER) {
          query[path] = { $exists: true };
        } else if (filterValue === NOANSWER) {
          query[path] = { $exists: false };
        }

        // If we're just rendering grids, we don't need to do anything with styles.
        if (!grid) {
          // Color based on "yes there's a text response" vs "no there isn't".
          styles = [{
            key: filterKey,
            value: ANSWER,
            color: colors[1]
          }, {
            key: filterKey,
            value: NOANSWER,
            color: colors[0]
          }];

          // Render the filter style template
          map.addStyle(themes.render.filter({ options: styles }));
        }

        // Set up the datasource
        setupDatasource({
          path: 'entries.responses',
          type: 'textPresence'
        });

      } else {
        path = 'entries.responses.' + filterKey;
        select[path] = 1;
        if (filterValue !== undefined) {
          query[path] = filterValue;
          if (filterValue === NOANSWER) {
            query[path] = { $exists: false };
          }
        }

        // If we're just rendering grids, we don't need to do anything with styles.
        if (!grid) {
          // If we're asked to filter on questions that don't exist, handle it
          // gracefully.
          if (questions[filterKey] === undefined) {
            answers = [];
          } else {
            answers = questions[filterKey].answers;
          }

          if (!answers) {
            answers = [NOANSWER];
          }

          styles = [];
          var i;
          for (i = 0; i < answers.length; i += 1) {
            var s = {
              key: options.key,
              value: answers[i],
              color: colors[i + 1]
            };

            if (answers[i] === NOANSWER) {
              s.color = colors[0];
            }
            styles.push(s);
          }

          // Render the filter style template
          map.addStyle(themes.render.filter({ options: styles }));
        }

        // Set up the datasource
        setupDatasource({
          path: 'entries.responses'
        });
      }

    });
  }
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
  var key = req.params.key;
  var val = req.params.val;
  var surveyId = req.params.surveyId;
  var tile = res.locals.tile;

  var after = req.query.after; // date in milliseconds since jan 1 1970 (eg 1401628391446)
  var until = req.query.until; // date in milliseconds since jan 1 1970 (eg 1401628391446)

  res.set('Content-Type', 'image/png');

  var options = {
    boundsBuffer: smartBuffer
  };

  if (key) {
    options.key = key;
  }
  if (val) {
    options.val = val;
  }
  if (until) {
    options.until = until;
  }
  if (after) {
    options.after = after;
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

  var after = req.query.after; // date in milliseconds since jan 1 1970 (eg 1401628391446)
  var until = req.query.until; // date in milliseconds since jan 1 1970 (eg 1401628391446)

  // Set up the filter path
  var filter = 'filter/' + key;
  if(val !== undefined) {
    filter = filter + '/' + val;
  }

  // We'll use these options to create the map
  var options = {
    type: 'grid'
  };
  if (key !== undefined) {
    options.key = key;
  }
  if (val !== undefined) {
    options.val = val;
  }
  if (until) {
    options.until = until;
  }
  if (after) {
    options.after = after;
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
