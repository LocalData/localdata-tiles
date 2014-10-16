'use strict';

var __ = require('lodash');
var async = require('async');
var concat = require('concat-stream');
var projector = require("nodetiles-core").projector;
var xml2js = require('xml2js');

var metrics = require('./metrics/cache');
var Response = require('./models/Response');
var settings = require('./settings');

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

  function getCount(survey, tile, done) {
    var query = setupQuery(survey, tile);

    Response.count(query, function (error, count) {
      done(error, count);
    });
  }

  function hasNew(survey, tile, timestamp, done) {
    var query = setupQuery(survey, tile);
    query['entries.created'] = { $gt: new Date(timestamp) };

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

  var makeTileName = (function () {
    var prefix = '/' + settings.name;
    return function makeTileName(req) {
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

      // Encode the query string, so knox/S3 treat it as part of the name and
      // not part of the request.
      return prefix + req.path + encodeURIComponent(queryString);
    };
  }());

  function handleRender(req, res, next) {
    // We'll only apply this caching logic if res.send gets used. If we
    // stream data using res.write, then we bypass this functionality.
    var send = res.send;
    res.send = function (body) {
      send.apply(res, arguments);

      var saveMetric;

      var handleS3Error;

      // Cache the file using S3
      if (s3client) {
        saveMetric = metrics.s3Storage();
        var name = makeTileName(req);
        var headers = {
          'Content-Length': body.length,
          'Content-Type': res.get('Content-Type')
        };
        headers[S3_CUSTOM_CACHE_HEADER] = res.getHeader(S3_CUSTOM_CACHE_HEADER);
        var buffer = new Buffer(body);

        handleS3Error = function handleS3Error(error) {
          console.log('warning at=s3_cache issue=save_failure name=' + name);
          console.log(error);
          saveMetric.miss();
        };

        s3client.putBuffer(buffer, name, headers, function (error, res) {
          if (error) {
            handleS3Error(error);
            return;
          }

          var write = concat(function (s3Response) {
            if (res.statusCode === 200) {
              console.log('info at=s3_cache event=save name=' + name);
              saveMetric.hit();
              return;
            }

            xml2js.parseString(s3Response, function (error, data) {
              if (error) {
                handleS3Error(error);
                return;
              }

              if (data.Error) {
                console.log('warning at=s3_cache issue=save_failure s3_status_code=' + res.statusCode + ' code=' + data.Error.Code + ' message="' + data.Error.Message + '" name=' + name);
                saveMetric.miss();
                return;
              }

              handleS3Error(new Error(s3Response));
            });
          });

          // Knox does not currently pull low-level errors from the response
          // IncomingMessage object into the callback's error argument.
          // https://github.com/LearnBoost/knox/issues/114
          if (res) {
            res.pipe(write).on('error', handleS3Error);
          }
        }).on('error', handleS3Error);
      }
    };
    return next();
  }

  return function useCache(req, res, next) {
    var stopMetric = metrics.s3Cache();

    var name = makeTileName(req);
    var tile = res.locals.tile;
    var survey = req.params.surveyId;

    function handleError(error) {
      if (!error) {
        return false;
      }
      console.log('error at=s3_cache issue=validation_error name=' + name);
      console.log(error);
      console.log('info at=s3_cache event=miss reason=validation_error name=' + name);
      stopMetric.miss();

      // We need to render a tile.
      handleRender(req, res, next);
      return true;
    }

    async.parallel([
      // Get the count
      __.bind(getCount, this, survey, tile),
      // Check if the key is in S3
      __.bind(getS3Header, this, name)
    ], function (error, values) {
      if (handleError(error)) {
        return;
      }

      var trueCount = values[0];
      var s3res = values[1];
      var s3Count;

      res.setHeader(S3_CUSTOM_CACHE_HEADER, trueCount);

      function handleValidation(error, hasNew) {
        if (handleError(error)) {
          return;
        }

        if (hasNew) {
          // There are new responses, so we need to render a tile.
          console.log('info at=s3_cache event=miss reason=new_entries name=' + name);
          stopMetric.miss();
          return handleRender(req, res, next);
        }

        console.log('info at=s3_cache event=hit url=' + s3res.req.url);
        stopMetric.hit();
        res.redirect(s3res.req.url);
      }

      // If the key is missing from S3, we need to render a tile.
      if (s3res.statusCode !== 200) {
        if (s3res.statusCode === 404) {
          console.log('info at=s3_cache event=miss reason=absent name=' + name);
        } else {
          console.log('error at=s3_cache issue=validation_error status=' + s3res.statusCode + ' name=' + name);
          console.log('info at=s3_cache event=miss reason=access_error name=' + name);
        }
        stopMetric.miss();
        return handleRender(req, res, next);
      }

      // The key is in S3. Now we use it to see if the cached tile is still
      // valid.
      s3Count = parseInt(s3res.headers[S3_CUSTOM_CACHE_HEADER], 10);

      if (s3Count !== trueCount) {
        // The counts don't match, so we know the cached tile is invalid.
        console.log('info at=s3_cache event=miss reason=mismatched_count count=' + trueCount + ' cached_count=' + s3Count + ' name=' + name);
        stopMetric.miss();
        return handleRender(req, res, next);
      }

      // Check if there are new responses.
      hasNew(survey, tile, s3res.headers['last-modified'], handleValidation);
    });
  };
};
