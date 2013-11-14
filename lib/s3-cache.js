var async = require('async');
var __ = require('lodash');
var projector = require("nodetiles-core").projector;

var S3_CUSTOM_CACHE_HEADER = 'x-amz-meta-count';

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
  var s3client = options.s3client;

  var setupQuery = function(survey, tile) {
    var bounds = tileToBounds(tile);

    var query = {
      survey: survey
    };
    query[geoField] = { $within: { $box: bounds } };
    return query;
  }

  var getCount = function(survey, tile, done) {
    var query = setupQuery(survey, tile);

    db.collection(collection)
    .count(query, function(error, count){
      console.log("Got count", count);
      done(error, count);
    });
  }

  var validateCache = function(survey, tile, timestamp, done) {
    var bounds = tileToBounds(tile);

    var query = {
      survey: survey
    };
    query[geoField] = { $within: { $box: bounds } };

	  var hasNew = function(callback) {
      var hasNewQuery = {
        survey: survey
      };
      hasNewQuery[geoField] = { $within: { $box: bounds } };
      hasNewQuery[timeField] = { $gt: new Date(timestamp) };

	    async.waterfall([
	      // See if there have been new responses since the timestamp.
	      function (step) {
	        db.collection(collection)
	        .find(hasNewQuery, {
	          limit: 1
	        }, step);
	      },
	      function (cursor, step) {
	        cursor.count(true, step);
	      }
	    ], function (error, count) {
	      if (error) { return callback(error); }
	      callback(null, count > 0);
	    });
	  }

    hasNew(done);

    // async.parallel([
    // 	hasNew,
    // 	getCount
    // 	], function(error, results) {
    //     var data = {
    //       hasNew: results[0],
    //       count: results[1]
    //     };
    // 		done(error, data);
    // });
  };

  function makeTileName(req) {
  	return req.originalUrl;
  };

  function handleRender(req, res, next) {
    // We'll only apply this ETag caching logic if res.send gets used. If we
    // stream data using res.write, then we bypass this functionality.
    var send = res.send;
    res.send = function (body) {
      send.apply(res, arguments);

      console.log("did we set the cache count", res.getHeader(S3_CUSTOM_CACHE_HEADER));

      // Cache the file using S3
      if(s3client) {
        var name = req.originalUrl;
        var headers = {
          'Content-Length': body.length,
          'Content-Type': 'image/png'
        };
        headers[S3_CUSTOM_CACHE_HEADER] = res.getHeader(S3_CUSTOM_CACHE_HEADER);

        var r = s3client.put(name, headers);
        r.on('response', function(res){
          if (200 == res.statusCode) {
            console.log('saved to %s', r.url);
          }
        });
        r.on('error', function(foo, bar){
          console.log("ERROR!", foo, bar);
        })
        r.end(body);
      }
    };
    return next();
  }

  return function useCache(req, res, next) {
  	var name = makeTileName(req);
    var tile = res.locals.tile;
    var survey = req.params.surveyId;

    // First, we need the count.
    getCount(survey, tile, function(error, count){
      if(error) {
        res.send(500);
        return;
      }
      res.setHeader(S3_CUSTOM_CACHE_HEADER, count);

      // Then, we check if the key is in S3
      s3client.head(name).on('response', function(s3res){
        // If the key is in S3...
        if(s3res.statusCode === 200) {
          s3Count = parseInt(s3res.headers[S3_CUSTOM_CACHE_HEADER]);

          var handleValidation = function(error, hasNew) {
            var countMatches = (count === s3Count);
            console.log("Hasnew, countmatches", hasNew, countMatches);
            if (countMatches && !hasNew) {
              console.log("cache hit", s3res.req.url);
              res.redirect(s3res.req.url);
              return;
            }else {
              // We need to render a tile.
              return handleRender(req, res, next);
            }
          }

          // ... we check to see if there are new responses
          validateCache(
            survey,
            tile,
            Date.now(),
            handleValidation
          );
        }else {
          // We need to render a tile.
          return handleRender(req, res, next);
        }

      }).end();

    });


  };
};
