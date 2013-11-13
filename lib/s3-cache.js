var async = require('async');
var __ = require('lodash');
var projector = require("nodetiles-core").projector;

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
  }

  var getCount = function(survey, tile, done) {
    var query = setupQuery(survey, tile);

    db.collection(collection)
    .count(query, function(error, result){
      done(error, result);
    });
  }

  var validateCache = function(survey, tile, timestamp, done) {
    var bounds = tileToBounds(tile);
    console.log(bounds);

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

    async.parallel([
    	hasNew,
    	getCount
    	], function(error, results) {
        var data = {
          hasNew: results[0],
          count: results[1]
        };
    		done(error, data);
    });
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

      // Cache the file using S3
      if(s3client) {
        var name = req.originalUrl;
        var r = s3client.put(name, {
          'Content-Length': body.length,
          'Content-Cache-Count': count,
          'Content-Type': 'image/png'
        });
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
    var tile = req.locals.tile;
    var surveyId = req.params.surveyId;

    // First, we need the count.
    getCount(survey, tile, function(error, count){
      if(error) {
        res.send(500);
        return;
      }
      res.setHeader('Content-Cache-Count', count);

      // Then, we check if the key is in S3
      s3client.head(name).on('response', function(s3res){

        // If the key is in S3...
        if(s3res.statusCode === 200) {

          // ... we check to see if there are new responses
          validateCache(
            surveyId,
            tile,
            Date.now(),
            function (error, results) {
              var countMatches = (count === s3res.headers['Content-Cache-Count']);
              console.log("Hasnew, countmatches", results.hasNew, countMatches);
              if (countMatches && !results.hasNew) {
                console.log("SEND RESPONSE HERE");
                return;
              }else {
                // We need to render a tile.
                return handleRender(req, res, next);
              }
            }
          );
        }else {
          // We need to render a tile.
          return handleRender(req, res, next);
        }

      }).end();

    });


  };
};
