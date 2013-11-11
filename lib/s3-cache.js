var async = require('async');
var __ = require('lodash');

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
  };

  function makeTileName(req) {
  	// console.log("Path ", req.route.path);
  	console.log("Original url ", req.originalUrl);
  	return req.originalUrl
  };

  return function useCache(req, res, next) {
  	var name = makeTileName(req);
  	console.log("Checking for ", name);

  	// First, we check if the key is in S3 yet
		s3client.head(name).on('response', function(s3res){
			// TODO: handle s3 errors by calling next().

		  console.log(s3res.statusCode);
		  console.log(s3res.headers);
		  console.log("Returning next");

		  // If the key is in S3, we check if it's up to date.
		  if(s3res.statusCode === 200) {
		  	var timestamp = Date.now();

	  		hasNewResponses(
	  			req.params.surveyId,
	  			res.locals.tile,
	  			timestamp,
          function (error, hasNew) {
	        if (error) {
	          return next();
	        }

	        if (hasNew) {
	          // The responses have changed for this tile.
	          // We need to render a tile.
	          return next();
	        }

	        // The responses haven't changed for this tile.
	        // Send the file
	        console.log("SEND RESPONSE HERE");
	        // res.send(STUFF HERE);
	      });

		  }else {
		  	return next();
		  }
		}).end();

  };
};
