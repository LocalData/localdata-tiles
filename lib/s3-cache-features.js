'use strict';

var __ = require('lodash');
var async = require('async');
var concat = require('concat-stream');
var projector = require("nodetiles-core").projector;
var Promise = require('bluebird');
var xml2js = require('xml2js');

var metrics = require('./metrics/cache');
var Response = require('./models/Response');
var settings = require('./settings');

var knex = require('knex');

// XXX TODO -- should this connection be created at the app level?
var pg = knex({
  client: 'pg',
  connection: settings.psqlConnectionString
});


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

  function makeEnvelope(tile) {
    var bounds = tileToBounds(tile);
    var west = bounds[0][0];
    var south = bounds[0][1];
    var east = bounds[1][0];
    var north = bounds[1][1];

    return knex.raw('geom && ST_MakeEnvelope(?, ?, ?, ?)', [west, south, east, north]);
  }

  function getCount(tile) {
    var query = pg.count('object_id')
      .from(settings.featuresTable)
      .where(makeEnvelope(tile));

    return query;
  }

  function hasNew(tile, timestamp) {
    // Convert the timestamp to UNIX time (what postgres wants)
    timestamp = new Date(timestamp).getTime() / 1000;

    var query = pg.select('timestamp')
      .from(settings.featuresTable)
      .where(makeEnvelope(tile))
      .andWhere(knex.raw("timestamp > to_timestamp(?)", [timestamp]))
      .limit(1);

    return query;
  }

  function getS3Header(name, done) {
    s3client.head(name)
    .on('response', function (s3res) {
      done(null, s3res);
    })
    .on('error', done)
    .end();
  }

  function getS3Object(name, done) {
    s3client.get(name)
    .on('response', function (s3res) {
      done(null, s3res);
    })
    .on('error', done)
    .end();
  }

  var getS3ObjectAsync = Promise.promisify(getS3Object);

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

        console.log("Checking response content type", res.get('Content-Type'));

        saveMetric = metrics.s3Storage();
        var name = makeTileName(req);
        var headers = {
          'Content-Length': body.length,
          'Content-Type': res.get('Content-Type')
        };

        // Set the count
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

              if (!data) {
                console.log('warning at=s3_cache issue=unknown_response s3_status_code=' + res.statusCode + ' body="' + s3Response + '"');
                saveMetric.miss();
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

    var rendered = false;
    var piped = false;

    // Get the count and the S3 object (if any) at the same time. We will need
    // both for the first count test or to render a tile for the first time.
    var countAsnyc = getCount(tile);
    var getS3Async = getS3ObjectAsync(name);

    return Promise.join(getS3Async, countAsnyc)
      .spread(function (s3res, rows) {
        var trueCount = parseInt(rows[0].count, 10);

        // If the key is missing from S3, we need to render a tile.
        if (s3res.statusCode !== 200) {
          if (s3res.statusCode === 404) {
            console.log('info at=s3_cache event=miss reason=absent name=' + name);
          } else {
            console.log('error at=s3_cache issue=validation_error status=' + s3res.statusCode + ' name=' + name);
            console.log('info at=s3_cache event=miss reason=access_error name=' + name);
          }
          s3res.resume();
          stopMetric.miss();

          // Set the count and start the rendering.
          res.setHeader(S3_CUSTOM_CACHE_HEADER, trueCount);
          handleRender(req, res, next);
          return;
        }

        // If we have the S3 object, check if the count matches.
        // If it doesn't match, we need to kick off a render.
        var s3Count = parseInt(s3res.headers[S3_CUSTOM_CACHE_HEADER], 10);
        if (s3Count !== trueCount) {
          console.log('info at=s3_cache event=miss reason=mismatched_count count=' + trueCount + ' cached_count=' + s3Count + ' name=' + name);
          s3res.resume();
          stopMetric.miss();
          // rendered = true; // XXX No longer needed?
          res.setHeader(S3_CUSTOM_CACHE_HEADER, trueCount);
          handleRender(req, res, next);
          return;
        }

        // If the count matches, now we need to check the modified date.
        //
        // TODO:
        // In theory, we could modify this check to get the last modified date
        // (no matter if it's newer). That way we could start this check at the
        // same time as the count  and S3 queries, and compare the dates using
        // javascript rather than in the database. Might be a bit faster.
        hasNew(tile, s3res.headers['last-modified'])
          .then(function (rows) {
            // If we get newer responses back, the cache is invalid.
            var invalid = rows[0] !== undefined;

            if (invalid) {
              // There are new or modified entries, so we need to render a tile.
              console.log('info at=s3_cache event=miss reason=new_entries name=' + name);
              s3res.resume();
              stopMetric.miss();
              // rendered = true; // XXX No longer needed?
              handleRender(req, res, next);
              return;
            }

            // At this point, we can use the cached tile.
            console.log('info at=s3_cache event=hit url=' + s3res.req.url);
            stopMetric.hit();

            // If this is a conditional request, then check the etag/modification
            // timestamp and potentially send back a 304 instead of sending the
            // data. In that case, make sure we call s3res.resume().
            var clientETag = req.get('if-none-match');
            var clientModified = req.get('if-modified-since');
            if ((clientETag && clientETag === s3res.headers.etag) ||
                (clientModified && clientModified === s3res.headers['last-modified'])) {
              res.set('etag', s3res.headers.etag);
              res.set('last-modified', s3res.headers['last-modified']);
              res.statusCode = 304;
              s3res.resume();
              res.end();
            } else {
              // If it's not a conditional request, or if the data has changed,
              // then pipe the S3 data to the response.
              res.set('content-type', s3res.headers['content-type']);
              res.set('etag', s3res.headers.etag);
              res.statusCode = 200;
              s3res.pipe(res);
            }
            piped = true;

            return new Promise(function (resolve, reject) {
              s3res.on('end', function () {
                resolve();
              });
              s3res.on('error', function (error) {
                reject(error);
              });
            });

          })
          .catch(function (error) {
            if (!rendered) {
              console.log('error at=s3_cache issue=validation_error name=' + name);
              console.log(error);
              console.log(error.stack);
              console.log('info at=s3_cache event=miss reason=validation_error name=' + name);
              stopMetric.miss();

              // We need to render a tile.
              handleRender(req, res, next);
            } else {
              // We encountered an error after kicking off a render. The cache miss
              // has been tracked, and the response is now out of our hands, so we
              // just need to log the error.
              console.log('error at=s3_cache issue=validation_error name=' + name);
              console.log(error);
              console.log(error.stack);
            }
          });
      });
  };

};
