/*jslint node: true */
'use strict';

var _ = require('lodash');
var mongoose = require('mongoose');

function validateResponses (val) {
  return val !== undefined && val !== null;
}

var entrySchema = new mongoose.Schema({
  source: {
    type: { type: String },
    collector: String,
    started: Date,
    finished: Date
  },
  created: Date,
  files: [String],
  responses: {
    type: Object,
    validate: validateResponses
  }
});

entrySchema.set('toObject', {
  transform: function (doc, ret, options) {
    return {
      id: ret._id,
      _id: ret._id,
      source: ret.source,
      created: ret.created,
      modified: ret.modified,
      files: ret.files,
      responses: ret.responses
    };
  }
});

var responseSchema = new mongoose.Schema({
  __v: { type: Number, select: false },
  properties: {
    // survey is a String for active Response docs and an object for "zombie"
    // Response docs that hold deleted entries.
    // TODO: add validation or a custom type for the survey field
    survey: mongoose.SchemaTypes.Mixed,
    humanReadableName: String,
    object_id: { type: String },
    centroid: []
  },
  geometry: {
    type: { type: String },
    coordinates: []
  },
  entries: [entrySchema],
  indexedGeometry: {type: mongoose.SchemaTypes.Mixed, select: false}
}, {
  autoIndex: false
});


responseSchema.pre('save', function (next) {
  next({
    name: 'IllegalWriteError',
    message: 'This is a read-only interface'
  });
});


// Indexes

// Ensure we have a geo index on the centroid field.
// We always restrict based on survey ID, so we use a compound index.
responseSchema.index({
  'properties.survey': 1,
  'indexedGeometry': '2dsphere',
  'entries.modified': 1
});

// Index the survey ID + entry ID. We expose entry ID to clients.
responseSchema.index({
  'properties.survey': 1,
  'entries._id': 1
});

// Index the survey ID + creation date, which we use to sort
responseSchema.index({
  'properties.survey': 1,
  'entries.created': 1
});

// Index the collector name
responseSchema.index({
  'properties.survey': 1,
  'source.collector': 1,
  'entries.created': 1
});

// Index the survey + object ID
// We use a unique index because multiple entries for the same survey and base
// feature will get stored in one object.
// For documents with a "free geometry", that do not correspond to some base
// layer feature, the object_id is the same as the reponse documents _id
responseSchema.index({
  'properties.survey': 1,
  'properties.object_id': 1
}, { unique: true });

responseSchema.set('toObject', {
  transform: function (doc, ret, options) {
    // Return the array of entries in the GeoJSON properties field.
    ret.properties.entries = ret.entries;

    return {
      type: 'Feature',
      id: ret._id,
      properties: ret.properties,
      geometry: ret.geometry
    };
  }
});

responseSchema.methods.getSingleEntry = function getSingleEntry(id) {
  var doc = this.toObject();
  var entry = this.entries.id(id);
  return {
    type: 'Feature',
    id: entry._id,
    // Merge the selected entry's field into the GeoJSON properties field
    properties: _.assign(doc.properties, entry.toObject()),
    geometry: doc.geometry
  };
};

responseSchema.methods.getLatestEntry = function getLatestEntry() {
  var doc = this.toObject();
  var entry = this.entries[this.entries.length - 1];
  return {
    type: 'Feature',
    id: entry._id,
    // Merge the selected entry's field into the GeoJSON properties field
    properties: _.assign(doc.properties, entry.toObject()),
    geometry: doc.geometry
  };
};

responseSchema.methods.toUpsertDoc = function toUpsertDoc() {
  var doc = this.toObject({ virtuals: false});
  var entries = doc.entries;
  delete doc.entries;
  delete doc._id;
  return {
    // We only set the common fields when this is a brand new entry
    $setOnInsert: doc,
    // We always add entries. Make sure they are ascending order of
    // creation time.
    $push: {
      'entries': {
        $each: entries,
        $slice: -1024,
        $sort: { created: 1 }
      }
    }
  };
};

function getSingle(geometry) {
  // If MongoDB knows how to work with this geometry, then our job is easy.
  var type = geometry.type;
  if (type === 'Polygon' ||
      type === 'LineString' ||
      type === 'Point') {
    return geometry;
  }

  var geom;
  if (type === 'GeometryCollection') {
    // For GeometryCollections, we just index the first geometry, or a
    // simplified version of that if its a Multi* geometry.
    // This is similar to what we do right now with MultiPolygon/etc.
    geom = geometry.geometries[0];

    if (geom.type === 'Polygon' ||
        geom.type === 'LineString' ||
        geom.type === 'Point') {
      return geom;
    }
  } else {
    geom = geometry;
  }

  var newType;
  switch (geometry.type) {
    case 'MultiPoint':
      newType = 'Point';
      break;
    case 'MultiLineString':
      newType = 'LineString';
      break;
    case 'MultiPolygon':
      newType = 'Polygon';
      break;
  }

  return {
    type: newType,
    coordinates: geom.coordinates[0]
  };
}

responseSchema.statics.countEntries = function countEntries(query, done) {
  this.aggregate([
    {
      $match: query
    },
    {
      $project: {
        entries: '$entries'
      }
    },
    {
      $unwind: '$entries'
    },
    {
      $group: {
        _id: 'entries',
        count: { $sum: 1 }
      }
    }
  ], function (error, result) {
    if (error) { return done(error); }

    var count = 0;
    // If there are no entries for the survey, then nothing will even match the
    // $match stage
    if (result.length > 0) {
      count = result[0].count;
    }

    done(null, count);
  });
};

responseSchema.statics.getBounds = function getBounds(survey, done) {
  var bbox = [[-180, -89], [180, 89]];
  this.aggregate([
    {
      $match: { 'properties.survey': survey }
    },
    {
      $project: {
        _id: '$_id',
        point: '$properties.centroid'
      }
    },
    {
      $unwind: '$point'
    },
    {
      $group: {
        _id: '$_id',
        x: { $first: '$point' },
        y: { $last: '$point' }
      }
    },
    {
      $group: {
        _id: 'bbox',
        minx: { $min: '$x' },
        miny: { $min: '$y' },
        maxx: { $max: '$x' },
        maxy: { $max: '$y' }
      }
    }
  ], function (error, response) {
    if (error) { return done(error); }

    if (response.length === 0) {
      return done(null, null);
    }

    var data = response[0];
    var bbox = [[ data.minx, data.miny ], [ data.maxx, data.maxy ]];
    done(null, bbox);
  });
};

var Response = module.exports = mongoose.model('Response', responseSchema, 'responses');
