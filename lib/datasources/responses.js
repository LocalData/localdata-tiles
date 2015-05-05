'use strict';

var stream = require('stream');
var util = require('util');

var _ = require('lodash');
var projector = require('nodetiles-core').projector;

var metrics = require('../metrics/pipeline');
var Response = require('../models/Response');
var settings = require('../settings');

var maxResponseCount = settings.maxResponseCount;

var FEATURE = 'Feature';

function ToFeatures(options) {
  // Start and pause the timer here, in case we encounter 0 documents in the
  // stream and _transform never gets called.
  options.procTimer.start();
  stream.Transform.call(this, {
    objectMode: true
  });
  this.grid = options.grid;
  this.project = options.project;
  this.procTimer = options.procTimer;
  this.procTimer.pause();
}

util.inherits(ToFeatures, stream.Transform);

ToFeatures.prototype._transform = function transform(item, encoding, done) {
  this.procTimer.start();

  item.type = FEATURE;


  if (!item.properties) {
    item.properties = {};
  }

  // Copy all the relevant data items to the properties field.
  var entries = item.entries;
  if (entries) {
    item.entries = undefined;
    _.assign(item.properties, entries[entries.length - 1]);
  }

  if (this.project) {
    item = this.project(item);
  }

  this.push(item);
  this.procTimer.pause();
  done();
};


exports.create = function create(options) {
  var select = options.select;
  var baseQuery = options.query;
  var projection = projector.util.cleanProjString(options.projection || 'EPSG:4326');
  var grid = options.grid;

  function getShapes(minX, minY, maxX, maxY, mapProjection, done) {
    var sw = [minX, minY];
    var ne = [maxX, maxY];

    var finish = _.once(done);

    // project request coordinates into data coordinates
    if (mapProjection !== projection) {
      sw = projector.project.Point(mapProjection, projection, sw);
      ne = projector.project.Point(mapProjection, projection, ne);
    }

    var query = _.clone(baseQuery);

    var west = sw[0];
    var south = sw[1];
    var east = ne[0];
    var north = ne[1];
    var boundingCoordinates = [ [ [west, south], [west, north], [east, north], [east, south], [west, south] ] ];

    query.indexedGeometry = {
      $geoIntersects: {
        $geometry: {
          type: 'Polygon',
          coordinates: boundingCoordinates
        }
      }
    };

    var dbTimer = metrics.dbTimer();
    var procTimer = metrics.processingTimer();

    var project;
    if (projection !== mapProjection) {
      project = function (feature) {
        return projector.project.Feature(projection, mapProjection, feature);
      };
    }

    var toFeatures = new ToFeatures({
      grid: grid,
      project: project,
      procTimer: procTimer
    });

    dbTimer.start();
    var docStream = Response.find(query)
    .select(select)
    .lean()
    .limit(maxResponseCount)
    .stream()
    .on('error', function (error) {
      finish(error);
    })
    .on('close', function () {
      dbTimer.pause();
    });

    var features = [];
    var len = features.length;

    var featureStream = docStream.pipe(toFeatures)
    .on('readable', function () {
      features[len] = featureStream.read();
      len += 1;
    })
    .on('end', function () {
      dbTimer.stop();
      procTimer.stop();

      finish(null, {
        type: 'FeatureCollection',
        features: features
      });
    })
    .on('error', function (error) {
      finish(error);
    });
  }

  return {
    sourceName: options.name || 'localdata',
    getShapes: getShapes
  };
};
