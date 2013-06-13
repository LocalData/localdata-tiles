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

var mongoose = require('mongoose');
var async = require('async');
var lru = require('lru-cache');

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

module.exports = function setup(options) {
  var db = options.db;
  var collection = options.collection;
  var geoField = options.geoField;
  var timeField = options.timeField;

  // Set up LRU cache
  var cache = lru({
    max: 500,
    maxAge: 1000 * 60 * 60 // 1 hour
  });

  function hasNewResponses(survey, tile, timestamp, done) {
    var bounds = tileToBounds(tile);
    async.waterfall([
      // See if there have been new responses since the timestamp.
      function (step) {
        db.collection(collection)
        .find({
          survey: survey,
          timeField: { $gt: new Date(timestamp) },
          geoField: { $within: { $box: bounds } }
        }, {
          limit: 1
        }, step);
      },
      function (cursor, step) {
        cursor.count(true, step);
      }
    ], function (error, count) {
      if (error) { return done(error); }
      done(null, count > 0);
    });
  }

  // Applies the ETag cache functionality as middleware.
  return function useCache(req, res, next) {
    var timestamp = Date.now();
    var etag = req.headers['if-none-match'];

    if (etag === undefined) {
      return next();
    }

    var cacheInfo = cache.get(req.url);
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
