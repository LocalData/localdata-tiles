'use strict';

var stream = require('stream');
var util = require('util');

var _ = require('lodash');
var projector = require('nodetiles-core').projector;

var metrics = require('./metrics/pipeline');
var settings = require('./settings');

var maxResponseCount = settings.maxResponseCount;

var FEATURE = 'Feature';

var pg = require('knex')({
  client: 'pg',
  connection: settings.psqlConnectionString
});

// function ToFeature(options) {
//
//   return function toFeature(data) {
//     var item = {
//       type: FEATURE,
//       geometry: JSON.parse(data.geometry),
//       properties: {
//         id: data.id,
//         source: data.source,
//         type: data.type,
//         object_id: data.object_id,
//         short_name: data.short_name,
//         long_name: data.long_name,
//         info: data.info,
//         timestamp: data.timestamp
//       }
//     };
//
//     if (options.project) {
//       item = options.project(item);
//     }
//
//     return item;
//   };
// }


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

  item.geometry = JSON.parse(item.geometry);

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

    // var toFeatures = new ToFeatures({
    //   grid: grid,
    //   project: project,
    //   procTimer: procTimer
    // });

    // TODO-- use knex niceness
    // var k = pg.select('ST_AsGeoJson(geom)')
    //           .as('geometry')
    //                     , '*')
    //           .from(settings.featuresTable)
    //           .whereRaw('ST_MakeEnvelope(?, ?, ?, ?)', [west, south, east, north]);


    var qs = 'select ST_AsGeoJson(geom) as geometry, * from ';
        qs += settings.featuresTable + ' ';
        qs += 'where geom && ';
        qs += 'ST_MakeEnvelope(?, ?, ?, ?)';
        // TODO knex inserts the numbers as strings so we need "as double precision"
        // Maybe I'm just applying them wrong?
    var k = pg.raw(qs, [west, south, east, north]);

    // console.log("Debugging query", k.toString());

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

    //docStream.on('data', function (d) {
    //    // console.log("Got feature");
    //    features.push(toFeatures(d));
    //    len += 1;
    //  })
    //  .on('end', function () {
    //    dbTimer.stop();
    //    procTimer.stop();
//
    //    finish(null, {
    //      type: 'FeatureCollection',
    //      features: features
    //    });
    //  })
    //  .on('error', function (error){
    //    console.log("ERROR streaming parcels", error); // XXX
    //    finish(error);
    //  });
  }

  return {
    sourceName: options.name || 'localdata',
    getShapes: getShapes
  };
};
