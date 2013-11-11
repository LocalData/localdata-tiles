var __ = require('lodash');
var etagCache = require('./etag-cache');


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
  	console.log("Path ", req.route.path);
  	console.log("Original url ", req.originalUrl);
  	return req.originalUrl

  	// Old stuff:
  	// options are surveyId, tile, filter
		// tile is [zoom, x, y]
		//var surveyId = req.params.surveyId;
		//var tile = res.locals.tile;
//
		//var name = settings.s3_dir + '/';
	  //name = name + options.surveyId + '/';
	  //if (options.filter !== undefined) {
	  //	name = name + 'filter/' + options.filter + '/';
	  //}
	  //name = name + options.tile[0] + '/' + options.tile[1] + '/' + options.tile[2] + '.png';
//
	  //console.log('using name ', name):
		//return name;
  };

  return function useCache(req, res, next) {
  	var name = makeTileName();

  	// First, we check if the key is in S3 yet
		S3Client.head(name).on('response', function(res){
			// TODO: handle s3 errors by calling next().

		  console.log(res.statusCode);
		  console.log(res.headers);
		  console.log("Returning next");

		  // If the key is in S3, we check if it's up to date.
		  if(res.statusCode === 200) {
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
