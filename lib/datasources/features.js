'use strict';

var stream = require('stream');
var util = require('util');

var _ = require('lodash');
var knex = require('knex');
var projector = require('nodetiles-core').projector;

var metrics = require('../metrics/pipeline');
var settings = require('../settings');

var maxResponseCount = settings.maxResponseCount;

var FEATURE = 'Feature';

var pg = require('knex')({
  client: 'pg',
  connection: settings.psqlConnectionString
});

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

  // TODO
  // We can probably find a much faster way to do this than using omit.
  if (!item.properties) {
    item.properties = _.omit(item, 'geometry');
  }

  item.geometry = JSON.parse(item.geometry);

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
    var finish = _.once(done);

    // Set up the coordinates we need.
    var sw = [minX, minY];
    var ne = [maxX, maxY];

    // project request coordinates into data coordinates
    if (mapProjection !== projection) {
      sw = projector.project.Point(mapProjection, projection, sw);
      ne = projector.project.Point(mapProjection, projection, ne);
    }

    //  Make them more readable later
    var west = sw[0];
    var south = sw[1];
    var east = ne[0];
    var north = ne[1];

    var dbTimer = metrics.dbTimer();
    var procTimer = metrics.processingTimer();

    var project;
    if (projection !== mapProjection) {
      project = function (feature) {
        return projector.project.Feature(projection, mapProjection, feature);
      };
    }

    var k = pg.select(knex.raw('ST_AsGeoJson(geom) as geometry, id, source, type, object_id, short_name, long_name, info, timestamp'))
              // We use knex.raw because ST_AsGeoJson gets interpreted wrong
              // without it.
              // TODO: Use the "select" value to only get the fields we need
              .from(settings.featuresTable)
              .where(knex.raw('geom && ST_MakeEnvelope(?, ?, ?, ?)', [west, south, east, north]))
              .andWhere(baseQuery);

    dbTimer.start();
    var docStream = k.stream();
    var features = [];
    var len = features.length;

    var toFeatures = new ToFeatures({
      grid: grid,
      project: project,
      procTimer: procTimer
    });

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
        });
  }

  return {
    sourceName: options.name || 'localdata',
    getShapes: getShapes
  };
};
