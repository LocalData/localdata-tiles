'use strict';

var _ = require('lodash');
var projector = require('nodetiles-core').projector;

var metrics = require('./metrics/pipeline');
var Response = require('./models/Response');
var settings = require('./settings');

var QUERY_LIMIT = 5000;

var NOANSWER = settings.noAnswer;
var ANSWER = settings.unstructuredAnswer;

var FEATURE = 'Feature';
exports.create = function create(options) {
  var select = options.select;
  var baseQuery = options.query;
  var projection = projector.util.cleanProjString(options.projection || 'EPSG:4326');
  var grid = options.grid;

  var maxZoom = options.zoom || 17;

  var path = options.path;
  var type = options.type;

  // TODO: Support paths on the containing Response document and not just on the Entry sub-docs.
  var entryPath = 'responses';
  var fieldName;
  if (path) {
    var pathComponents = path.split('.');
    if (pathComponents[0] === 'entries') {
      entryPath = pathComponents.slice(1).join('.');
    }
    fieldName = pathComponents[pathComponents.length - 1];
  }

  // For free-form text or file uploads, we want to detect the presence of an
  // answer. We don't care about the specific response values.
  var convertAnswers;
  if (type === 'arrayPresence') {
    convertAnswers = function convertArrayAnswers(responses) {
      var ret = {};
      if (responses && responses.length > 0) {
        ret[fieldName] = ANSWER;
      } else {
        ret[fieldName] = NOANSWER;
      }
      return ret;
    };
  } else if (type === 'textPresence') {
    convertAnswers = function convertTextAnswers(responses) {
      return _.mapValues(responses, function (answer) {
        if (answer && answer.length > 0) {
          return ANSWER;
        }
        return NOANSWER;
      });
    };
  }

  function resultToGeoJSON(item) {
    item.type = FEATURE;

    // Copy all the relevant data items to the properties field.
    var entries = item.entries;
    if (entries) {
      delete item.entries;
      if (type) {
        _.assign(item.properties, convertAnswers(entries[entries.length - 1][entryPath]));
      } else {
        _.assign(item.properties, entries[entries.length - 1][entryPath]);
      }
    }

    // Add the geometries to the properties for use in the UTF grids
    // We need to do a deep copy here, otherwise we'll get the reprojected
    // geometries later.
    // TODO: we should investigate ways of progressively drawing the shape in the
    // dashboard, so we don't need to send the geometry at all.
    if (grid) {
      item.properties.geometry = _.cloneDeep(item.geometry);
      item.properties.name = item.properties.humanReadableName;
      delete item.properties.humanReadableName;
    }

    return item;
  }

  function fetch(query, mapProjection, done) {
    var limit = QUERY_LIMIT;
    var result = [];

    var dbTimer = metrics.dbTimer();
    var procTimer = metrics.processingTimer();

    function getChunk(skip) {
      dbTimer.start();
      Response.find(query)
      .select(select)
      .lean()
      .limit(limit)
      .skip(skip)
      .exec(function (error, docs) {
        dbTimer.pause();
        if (error) { return done(error); }

        if (!docs) {
          docs = [];
        }

        var finished = (docs.length !== limit);

        if (!finished) {
          getChunk(skip + limit);
        }

        procTimer.start();

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

        procTimer.pause();

        if (finished) {
          dbTimer.stop();
          procTimer.stop();
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

    fetch(query, mapProjection, function (error, docs) {
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
