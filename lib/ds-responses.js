'use strict';

var stream = require('stream');
var util = require('util');

var _ = require('lodash');
var projector = require('nodetiles-core').projector;

var metrics = require('./metrics/pipeline');
var Response = require('./models/Response');
var settings = require('./settings');

// Limit the maximum amount of data we'll process, so we have a rough bound on
// memory usage.
var QUERY_LIMIT = 20000;

var NOANSWER = settings.noAnswer;
var ANSWER = settings.unstructuredAnswer;

var FEATURE = 'Feature';

function ToFeatures(options) {
  stream.Transform.call(this, {
    objectMode: true
  });
  this.type = options.type;
  this.entryPath = options.entryPath;
  this.convertAnswers = options.convertAnswers;
  this.grid = options.grid;
  this.project = options.project;
  this.procTimer = options.procTimer;
}

util.inherits(ToFeatures, stream.Transform);

ToFeatures.prototype._transform = function transform(item, encoding, done) {
  this.procTimer.start();

  item.type = FEATURE;

  // Copy all the relevant data items to the properties field.
  var entries = item.entries;
  if (entries) {
    delete item.entries;
    if (this.type) {
      _.assign(item.properties, this.convertAnswers(entries[entries.length - 1][this.entryPath]));
    } else {
      _.assign(item.properties, entries[entries.length - 1][this.entryPath]);
    }
  }

  // Add the geometries to the properties for use in the UTF grids
  // We need to do a deep copy here, otherwise we'll get the reprojected
  // geometries later.
  // TODO: we should investigate ways of progressively drawing the shape in the
  // dashboard, so we don't need to send the geometry at all.
  if (this.grid) {
    item.properties.geometry = _.cloneDeep(item.geometry);
    item.properties.name = item.properties.humanReadableName;
    delete item.properties.humanReadableName;
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

    var limit = QUERY_LIMIT;

    var dbTimer = metrics.dbTimer();
    var procTimer = metrics.processingTimer();

    var project;
    if (projection !== mapProjection) {
      project = function (feature) {
        return projector.project.Feature(projection, mapProjection, feature);
      };
    }

    var toFeatures = new ToFeatures({
      type: type,
      entryPath: entryPath,
      convertAnswers: convertAnswers,
      grid: grid,
      project: project,
      procTimer: procTimer
    });

    dbTimer.start();
    var docStream = Response.find(query)
    .select(select)
    .lean()
    .limit(limit)
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
