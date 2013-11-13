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

  var validateCache = function(survey, tile, timestamp, done) {
    var bounds = tileToBounds(tile);

	  var getCount = function(callback) {
	    db.collection(collection)
	    .find({
	      survey: survey,
	      timeField: { $gt: new Date(timestamp) },
	      geoField: { $within: { $box: bounds } }
	    }, callback);
	  };

	  var hasNew = function(callback) {
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
	      if (error) { return callback(error); }
	      callback(null, count > 0);
	    });
	  }

    async.parallel([
    	hasNew,
    	getCount
    	], function(error, results) {
    	console.log("ERROR + RESULTS", error, results);
    });
  };

  function makeTileName(req) {
  	// console.log("Path ", req.route.path);
  	console.log("Original url ", req.originalUrl);
  	return req.originalUrl
  };


  function handleRender(req, res, next) {
    // We'll only apply this ETag caching logic if res.send gets used. If we
    // stream data using res.write, then we bypass this functionality.
    var send = res.send;
    res.send = function (status, body) {
      send.apply(res, arguments);

      // Cache the file using S3
	    console.log("S3client", s3client);
	    if(s3client) {
	      console.log("Putting file to s3");
	      var name = req.originalUrl;
	      var r = s3client.put(name, {
	        'Content-Length': data.length, //res.getHeader('content-length'),
	        'Content-Cache-Count': count;
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
	      r.end(data);
	    }

    };
    return next();
  }

  return function useCache(req, res, next) {
  	var name = makeTileName(req);
  	console.log("Checking for ", name);

  	// First, we check if the key is in S3
		s3client.head(name).on('response', function(s3res){
		  console.log("S3 headers: ", s3res.headers);

		  // If the key is in S3...
		  if(s3res.statusCode === 200) {

		  	// ... we check to see if there are new responses
	  		validateCache(
	  			req.params.surveyId,
	  			res.locals.tile,
	  			Date.now(),
          function (error, hasNew, count) {
          	var countMatches = count === s3res.headers['Content-Cache-Count'];
          	console.log("Hasnew, countmatches", hasNew, countMatches);
		        if (countMatches && !hasNew) {
		        	// The responses haven't changed for this tile.
			        // Send the file
			        console.log("SEND RESPONSE HERE");
		        }else {
		        	// The responses have changed for this tile.
				      // We need to render a tile.
				      return handleRender(req, res, next);
		        }
	      	}
	      );
		  }

      // The responses have changed for this tile.
      // We need to render a tile.
      return handleRender(req, res, next);

		}).end();

  };
};
