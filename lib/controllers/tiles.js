'use strict';

var fs = require('fs');
var path = require('path');
var stream = require('stream');

var __ = require('lodash');
var ejs = require('ejs');
var MongoDataSource = require('nodetiles-mongodb');
var mongoose = require('mongoose');
var nodetiles = require('nodetiles-core');

var settings = require('../settings');
var surveyStats = require('../survey-stats');

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
  map.render({
    bounds: {minX: bounds[0], minY: bounds[1], maxX: bounds[2], maxY: bounds[3]},
    width: 256,
    height: 256,
    zoom: tile[0],
    callback: function(err, canvas) {
      // TODO: handle the error
      canvas.createPNGStream().pipe(passThrough);
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

  // If we're just rendering grids, we don't need to do anything with styles.
  if(options.type === 'grid') {
    callback(map);
    return;
  }

  // Add basic styles
  if(options.key === undefined) {
    map.addStyle(fs.readFileSync('./map/theme/style.mss','utf8'));
  }

  // Dynamically generate styles for a filter
  // Actually, we need to get the stats here.
  if(options.key !== undefined) {

    // var form = Form.getFlattenedForm(surveyId, function(error, form) {
    surveyStats.get(surveyId, function(stats) {
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

      var answers = __.keys(stats[options.key]);
      var styles = [];
      for (i = 0; i < answers.length; i++) {
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

      // Load and render the style template
      fs.readFile('./map/theme/filter.mss.template','utf8', function(error, styleTemplate) {
        var style = ejs.render(styleTemplate, {options: styles});
        map.addStyle(style);
        map.addData(datasource);
        callback(map);
      }.bind(this));

    }.bind(this));
  }else {

    // Create a map with the generic template
    // No filter involved
    var readFileCB = function readFileCB(error, style) {
      map.addStyle(style);
      map.addData(datasource);
      callback(map);
    };

    fs.readFile('./map/theme/style.mss','utf8', readFileCB);
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

  var handleStream = function(error, data) {
    if (error) {
      console.log(error);
      res.send(500);
      return;
    }
    res.send(data);
  };

  var respondUsingMap = function(map) {
    bufferStream(createRenderStream(map, tile), handleStream);
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

  var handleStream = function (error, data) {
    if (error) {
      console.log(error);
      res.send(500);
      return;
    }
    res.send(data);
  };

  var respondUsingMap = function (map) {
    if (format === 'png') {
      createGrid(map, tile, { drawImage: true }, function (error, canvas) {
        if (error) {
          console.log('Error creating UTFGrid debug PNG', error);
          res.send(500);
          return;
        }

        var passThrough = new stream.PassThrough();
        canvas.createPNGStream().pipe(passThrough);
        bufferStream(passThrough, handleStream);
      });
      return;
    }

    createGrid(map, tile, function (error, grid) {
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
