'use strict';

var async = require('async');
var __ = require('lodash');
var projector = require("nodetiles-core").projector;

var metrics = require('./metrics/cache');
var Response = require('./models/Response');

var S3_CUSTOM_CACHE_HEADER = 'x-amz-meta-count';

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

module.exports = function setup(options) {
  var s3client = options.s3client;

  function setupQuery(survey, tile) {
    var bounds = tileToBounds(tile);

    var query = {
      survey: survey
    };
    query['geo_info.centroid'] = { $within: { $box: bounds } };
    return query;
  }

  function getCount(survey, tile, done) {
    var query = setupQuery(survey, tile);

    Response.count(query, function (error, count) {
      done(error, count);
    });
  }

  function hasNew(survey, tile, timestamp, done) {
    var query = setupQuery(survey, tile);
    query.created = { $gt: new Date(timestamp) };

    Response.findOne(query).lean().exec(function (error, doc) {
      if (error) {
        return done(error);
      }
      done(null, doc !== null);
    });
  }

  function getS3Header(name, done) {
    s3client.head(name)
    .on('response', function (s3res) {
      done(null, s3res);
    })
    .on('error', done)
    .end();
  }

  function makeTileName(req) {
    return req.originalUrl;
  }

  function handleRender(req, res, next) {
    // We'll only apply this ETag caching logic if res.send gets used. If we
    // stream data using res.write, then we bypass this functionality.
    var send = res.send;
    res.send = function (body) {
      send.apply(res, arguments);

      // Cache the file using S3
      if(s3client) {
        var name = req.originalUrl;
        var headers = {
          'Content-Length': body.length,
          'Content-Type': 'image/png'
        };
        headers[S3_CUSTOM_CACHE_HEADER] = res.getHeader(S3_CUSTOM_CACHE_HEADER);
        var buffer = new Buffer(body);
        s3client.putBuffer(buffer, name, headers, function(err, res){ });
      }
    };
    return next();
  }

  return function useCache(req, res, next) {
    var stopMetric = metrics.s3CacheLatency();

    var name = makeTileName(req);
    var tile = res.locals.tile;
    var survey = req.params.surveyId;

    async.parallel([
      // Get the count
      __.bind(getCount, this, survey, tile),
      // Check if the key is in S3
      __.bind(getS3Header, this, name)
    ], function (error, values) {
      var trueCount = values[0];
      var s3res = values[1];
      var s3Count;

      res.setHeader(S3_CUSTOM_CACHE_HEADER, trueCount);

      function handleValidation(error, hasNew) {
        if (error) {
          console.log('Error validating cache.');
          console.log('MISS: unable to validate');
          stopMetric.miss();
          metrics.s3Cache.miss();

          // We need to render a tile.
          return handleRender(req, res, next);
        }

        if (hasNew) {
          // There are new responses, so we need to render a tile.
          console.log('MISS: stale cached tile (new entries)', hasNew, req.url);
          stopMetric.miss();
          metrics.s3Cache.miss();
          return handleRender(req, res, next);
        }

        console.log('CACHE HIT', s3res.req.url);
        stopMetric.hit();
        metrics.s3Cache.hit();
        res.redirect(s3res.req.url);
      }

      // If the key is missing from S3, we need to render a tile.
      if (s3res.statusCode !== 200) {
        console.log('MISS: not in S3', s3res.statusCode, req.url);
        stopMetric.miss();
        metrics.s3Cache.miss();
        return handleRender(req, res, next);
      }

      // The key is in S3. Now we use it to see if the cached tile is still
      // valid.
      s3Count = parseInt(s3res.headers[S3_CUSTOM_CACHE_HEADER], 10);

      if (s3Count !== trueCount) {
        // The counts don't match, so we know the cached tile is invalid.
        console.log('MISS: stale cached tile (mismatched entry count)', trueCount, s3Count, req.url);
        stopMetric.miss();
        metrics.s3Cache.miss();
        return handleRender(req, res, next);
      }

      // Check if there are new responses.
      hasNew(survey, tile, Date.now(), handleValidation);
    });
  };
};
