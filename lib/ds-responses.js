'use strict';

var _ = require('lodash');
var projector = require('nodetiles-core').projector;

var metrics = require('./metrics/pipeline');
var Response = require('./models/Response');

function resultToGeoJSON(item) {
  item.type = 'Feature';

  // Get the geo info
  if (item.geo_info.geometry !== undefined) {
    item.id = item.object_id;
    item.geometry = item.geo_info.geometry;
  } else {
    // Or if there isn't one, use the centroid.
    item.id = item._id;
    item.geometry = {};
    item.geometry.type = 'Point';
    item.geometry.coordinates = item.geo_info.centroid;
  }

  // Fill out the properties.
  // These are used for UTF grids
  item.properties = {};

  // Copy all the responses
  _.extend(item.properties, item.responses);

  // Add the geometries to the properties for use in the UTF grids
  // We need to do a deep copy here, otherwise we'll get the reprojected
  // geometries later.
  // TODO: if we're  generating PNGs, we don't need to copy geometries.
  item.properties.geometry = _.cloneDeep(item.geo_info.geometry);
  item.properties.name = item.geo_info.humanReadableName;
  item.properties.object_id = item.object_id;

  // Clean up a bit
  delete item.geo_info.centroid;
  delete item.geo_info.geometry;
  delete item.responses;

  return item;
}

exports.create = function create(options) {
  var select = options.select;
  var baseQuery = options.query;
  var projection = projector.util.cleanProjString(options.projection || 'EPSG:4326');

  var maxZoom = options.zoom || 17;

  function fetch(query, mapProjection, done) {
    var limit = 5000;
    var result = [];

    function getChunk(skip) {
      Response.find(query)
      .lean()
      .limit(limit)
      .skip(skip)
      .exec(function (error, docs) {
        if (error) { return done(error); }

        if (!docs) {
          docs = [];
        }

        var finished = (docs.length !== limit);

        if (!finished) {
          getChunk(skip + limit);
        }

        var len = docs.length;
        var i;
        for (i = 0; i < len; i += 1) {
          docs[i] = resultToGeoJSON(docs[i]);
        }

        var fc = {
          type: 'FeatureCollection',
          features: docs
        };

        if (projection !== mapProjection) {
          fc = projector.project.FeatureCollection(projection, mapProjection, fc);
        }


        result = result.concat(fc.features);

        if (finished) {
          done(null, result);
        }
      });
    }

    getChunk(0);
  }

  function getShapes(minX, minY, maxX, maxY, mapProjection, done) {
    var sw = [minX, minY];
    var ne = [maxX, maxY];

    // project request coordinates into data coordinates
    if (mapProjection !== projection) {
      sw = projector.project.Point(mapProjection, projection, sw);
      ne = projector.project.Point(mapProjection, projection, ne);
    }

    var query = _.clone(baseQuery);
    var bbox = [[sw[0], sw[1]], [ne[0],  ne[1]]];
    query[options.key] = { '$within': { '$box': bbox} };

    var stopDbTimer = metrics.dbTimer();
    fetch(query, mapProjection, function (error, docs) {
      stopDbTimer();
      if (error) {
        console.log('Error fetching responses from the database');
        console.log(error);
        done(error);
        return;
      }

      var fc = {
        type: 'FeatureCollection',
        features: docs
      };

      done(null, fc);
    });


  }

  return {
    sourceName: options.name || 'localdata',
    getShapes: getShapes
  };
};
