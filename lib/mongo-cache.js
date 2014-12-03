'use strict';

var Promise = require('bluebird');

var metrics = require('./metrics/cache');
var Response = require('./models/Response');
var CacheItem = require('./models/CacheItem');
var settings = require('./settings');

var CACHE_NAME = 'tile-cache-' + settings.name;

Promise.promisifyAll(Response);
Promise.promisifyAll(CacheItem);

function tile2long(x, z) {
  return (x/Math.pow(2,z)*360-180);
}

function tile2lat(y, z) {
  var n=Math.PI-2*Math.PI*y/Math.pow(2,z);
  return (180 / Math.PI * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n))));
}

function tileToBounds(tile) {
  var sw = [tile2long(tile[1], tile[0]), tile2lat(tile[2] + 1, tile[0])];
  var ne = [tile2long(tile[1] + 1, tile[0]), tile2lat(tile[2], tile[0])];
  return [sw, ne];
}

function makeTileName(req) {
  var query = req.query;

  // Sort query parameters, so we use consistent filenames
  var keys = Object.keys(query).sort();
  var queryString;
  if (keys.length > 0) {
    queryString = '?' + keys.map(function (key) {
      return key + '=' + query[key];
    }).join('&');
  } else {
    queryString = '';
  }

  return req.path + queryString;
}

function setupQuery(survey, tile) {
  var bounds = tileToBounds(tile);
  var west = bounds[0][0];
  var south = bounds[0][1];
  var east = bounds[1][0];
  var north = bounds[1][1];

  var boundingCoordinates = [ [ [west, south], [west, north], [east, north], [east, south], [west, south] ] ];

  var query = {
    'properties.survey': survey
  };
  query.indexedGeometry = {
    $geoIntersects: {
      $geometry: {
        type: 'Polygon',
        coordinates: boundingCoordinates
      }
    }
  };

  return query;
}

function getCount(survey, tile) {
  var query = setupQuery(survey, tile);

  return Response.countAsync(query);
}

// See if the tile has fewer than trueCount objects.
function hasFewer(survey, tile, trueCount) {
  if (trueCount === 0 || !trueCount) {
    // The tile cannot have fewer than 0 objects.
    return Promise.resolve(false);
  }

  var query = setupQuery(survey, tile);

  // If there were N (trueCount) items before, then check for the Nth item. If
  // it exists, then the tile has at least N items. Otherise, the tile has
  // fewer than N items.
  return Promise.resolve(
    Response.find(query)
    .select({ _id: 1 })
    .skip(trueCount - 1)
    .limit(1)
    .lean()
    .exec())
  .then(function (docs) {
    if (docs && docs.length > 0) {
      return false;
    }
    return true;
  });
}

function hasNew(survey, tile, timestamp) {
  var query = setupQuery(survey, tile);
  query['entries.modified'] = { $gt: new Date(timestamp) };

  return Promise.resolve(
    Response.findOne(query)
    .select({ _id: 1 })
    .lean()
    .exec())
  .then(function (doc) {
    return !!doc;
  });
}

function getCacheItem(name) {
  return CacheItem.findOneAndUpdateAsync({
    _id: {
      cache: CACHE_NAME,
      key: name
    }
  }, {
    $set: {
      accessed: new Date()
    }
  });
}

function saveCacheItem(name, contents) {
  // Wrap in a Promise.try, so that any potential synchronous Mongoose
  // exceptions get funneled into the promise.
  return Promise.try(function () {
    return CacheItem.findOneAndUpdateAsync({
      _id: {
        cache: CACHE_NAME,
        key: name
      }
    }, {
      $set: {
        accessed: new Date(),
        contents: contents
      }
    }, {
      upsert: true,
      select: { _id: 1 }
    });
  });
}

function handleRender(req, res, countPromise, next) {
  // We'll only apply this caching logic if res.send gets used. If we
  // stream data using res.write, then we bypass this functionality.
  var send = res.send;
  res.send = function (_status, _body) {
    var body;
    var status;

    // Express lets callers swap the body and status code, so we need to
    // support that, too.
    if (typeof _status === 'number') {
      body = _body;
      status = _status;
    } else {
      body = _status;
      status = 200;
    }

    if (status !== 200) {
      send.call(res, _status, _body);
      return;
    }

    countPromise.then(function (count) {
      var name = makeTileName(req);
      var contents = {
        contentType: res.get('Content-Type'),
        modified: new Date(),
        count: count,
        data: new Buffer(body)
      };

      return saveCacheItem(name, contents);
    }).finally(function () {
      send.call(res, body);
    });
  };
  return next();
}

module.exports = function useCache(req, res, next) {
  var stopMetric = metrics.mongoCache();

  var name = makeTileName(req);

  var tile = res.locals.tile;
  var survey = req.params.surveyId;

  // Get the cache entry
  getCacheItem(name)
  .then(function (cached) {
    // If there's no cache entry, then render the tile.
    if (!cached) {
      console.log('info at=mongo_cache event=miss reason=absent name=' + name);
      stopMetric.miss();
      // Get the actual data count and render the tile.
      handleRender(req, res, getCount(survey, tile), next);
      return;
    }

    var fewerPromise = hasFewer(survey, tile, cached.contents.count);
    var modifiedPromise = hasNew(survey, tile, cached.contents.modified);

    return Promise.join(fewerPromise, modifiedPromise, function (hasFewer, hasNew) {
      if (hasFewer) {
        console.log('info at=mongo_cache event=miss reason=deletion cached_count=' + cached.contents.count + ' name=' + name);
        stopMetric.miss();
        // Get the actual data count and render the tile.
        handleRender(req, res, getCount(survey, tile), next);
        return;
      }

      if (hasNew) {
        console.log('info at=mongo_cache event=miss reason=modification name=' + name);
        stopMetric.miss();
        // Get the actual data count and render the tile.
        handleRender(req, res, getCount(survey, tile), next);
        return;
      }

      console.log('info at=mongo_cache event=hit name=' + name);
      stopMetric.hit();

      res.setHeader('Content-Type', cached.contents.contentType);
      var data = cached.contents.data;
      res.send(data.read(0, data.length()));
    });
  }).catch(function (error) {
    console.log('error at=mongo_cache issue=validation_error name=' + name);
    console.log(error);
    console.log(error.stack);
    console.log('info at=mongo_cache event=miss reason=validation_error name=' + name);

    stopMetric.miss();

    handleRender(req, res, getCount(survey, tile), next);
  });
};
