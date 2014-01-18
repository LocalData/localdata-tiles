'use strict';

/**
 * Uses an LRU cache to help respond to If-None-Match requests.
 *
 * Caches the ETag and the time we last checked the database, keyed by the
 * request URL. If the cached ETag doesn't match the request header, or if there
 * is no cached ETag, then we proceed with usual tile rendering (or whatever
 * comes next). If the cached ETag matches, then we see if there have been new
 * responses in that tile since the last time we checked. If there are new
 * responses, then we move on with whatever comes next.
 * If we have a matching ETag, and there are no new responses, then we send a
 * 304 Not Modified status.
 */

var async = require('async');
var lru = require('lru-cache');

var metrics = require('./metrics/cache');
var Response = require('./models/Response');

function tile2long(x,z) {
  return (x/Math.pow(2,z)*360-180);
}

function tile2lat(y,z) {
  var n=Math.PI-2*Math.PI*y/Math.pow(2,z);
  return (180/Math.PI*Math.atan(0.5*(Math.exp(n)-Math.exp(-n))));
}

function tileToBounds(tile) {
  var sw = [tile2long(tile[1], tile[0]), tile2lat(tile[2] + 1, tile[0])];
  var ne = [tile2long(tile[1] + 1, tile[0]), tile2lat(tile[2], tile[0])];
  return [sw, ne];
}

module.exports = function setup() {
  // Set up LRU cache
  var cache = lru({
    max: 500,
    maxAge: 1000 * 60 * 60 // 1 hour
  });

  // TODO: (prashant) If we want to make the etag-cache module a little more
  // generic, we can pass in the hasNewResponses function, which ought to then
  // just take req, res, and cacheInfo.timestamp. Then this module would not
  // only be agnostic of database/collection/field names, it would be agnostic
  // of the fact that a MongoDB was the underlying resource.
  function hasNewResponses(survey, tile, timestamp, done) {
    var bounds = tileToBounds(tile);
    var query = {
      survey: survey
    };
    query['geo_info.centroid'] = { $within: { $box: bounds } };
    query.created = { $gt: new Date(timestamp) };

    // See if there have been new responses since the timestamp.
    Response.find(query).limit(1).exec(function (error, docs) {
      if (error) {
        return done(error);
      }
      done(null, docs.length > 0);
    });
  }

  // Applies the ETag cache functionality as middleware.
  return function useCache(req, res, next) {
    var timestamp = Date.now();
    var etag = req.headers['if-none-match'];

    if (etag === undefined) {
      return next();
    }

    var bounds = tileToBounds(res.locals.tile);

    var cacheInfo = cache.get(req.url);
    if (cacheInfo) {
      metrics.etagCache.hit();
    } else {
      metrics.etagCache.miss();
    }
    if (cacheInfo && cacheInfo.etag === etag) {
      // See if there have been new responses since we last saw this ETag.
      hasNewResponses(req.params.surveyId, res.locals.tile, cacheInfo.timestamp,
                      function (error, hasNew) {
        if (error) {
          return next();
        }

        if (hasNew) {
          // The responses have changed for this tile.
          // Remove the entry from the cache.
          cache.del(req.url);
          return next();
        }

        // The responses haven't changed for this tile.
        res.set('ETag', etag);
        res.send(304);

        // Update the cache entry.
        cache.set(req.url, {
          etag: etag,
          timestamp: timestamp
        });
      });
    }

    // We'll only apply this ETag caching logic if res.send gets used. If we
    // stream data using res.write, then we bypass this functionality.
    var send = res.send;
    res.send = function (status, body) {
      var etag = res.get('etag');
      send.apply(res, arguments);

      cache.set(req.url, {
        etag: etag,
        timestamp: timestamp
      });
    };

    return next();
  };
};
