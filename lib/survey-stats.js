'use strict';

var __ = require('lodash');
var lru = require('lru-cache');
var Q = require('q');

var metrics = require('./metrics/cache');
var Response = require('./models/Response');

// Set up LRU cache
var cache = lru({
  max: 100,
  maxAge: 1000 * 60 * 60 // 1 hour
});

function getStatsFromDB(surveyId, done) {
  var stats = {
    collectors: {}
  };
  var processed = {};
  var count = 0;

  function summer(memo, num) {
    return memo + num;
  }

  function handleDoc(doc) {
    var key,
        val;

    // Check if we've already processed an object with this id
    if (processed[doc.object_id] !== undefined) {
      return;
    }
    processed[doc.object_id] = true;
    count += 1;

    // Record the collector
    key = doc.source.collector;
    val = stats.collectors[key];
    if (val !== undefined) {
      val += 1;
    } else {
      val = 1;
    }
    stats.collectors[key] = val;

    if (doc.responses === undefined) {
      return;
    }

    // Count the answers
    var r = doc.responses;
    Object.keys(r).forEach(function (key) {
      var val = r[key];
      var question = stats[key];
      if (question === undefined) {
        question = stats[key] = {};
        question[val] = 1;
      } else {
        var tally = question[val];
        if (tally === undefined) {
          tally = 1;
        } else {
          tally += 1;
        }
        question[val] = tally;
      }
    });
  }

  function getChunk(start, done) {
    var length = 5000;
    Response.find({ survey: surveyId })
    .sort('-created')
    .skip(start).limit(length)
    .lean()
    .exec(function (error, chunk) {
      if (error) {
        done(error);
        return;
      }

      var i;
      for (i = 0; i < chunk.length; i += 1) {
        handleDoc(chunk[i]);
      }

      if (chunk.length === length) {
        getChunk(start + length, done);
      } else {
        done(null);
      }
    });
  }

  getChunk(0, function (error) {
    if (error) {
      done(error);
      return;
    }

    if (count === 0) {
      done(null, stats);
      return;
    }

    // Calculate "no response" count for each question
    Object.keys(stats).forEach(function (key) {
      var stat = stats[key];
      var sum = __.reduce(stat, summer, 0);
      var remainder = count - sum;

      stats[key]['no response'] = remainder;
    });

    done(null, stats);
  });
}


exports.get = function getStats(surveyId, done) {
  var stopMetric = metrics.statsCache();
  var hit = true;

  var statsPromise = cache.get(surveyId);

  if (statsPromise === undefined) {
    hit = false;

    var deferred = Q.defer();
    statsPromise = deferred.promise;
    cache.set(surveyId, statsPromise);

    getStatsFromDB(surveyId, deferred.makeNodeResolver());
  }

  statsPromise.then(function (stats) {
    if (hit) {
      stopMetric.hit();
    } else {
      stopMetric.miss();
    }
    done(null, stats);
  }).fail(function (error) {
    console.log(error);
    cache.del(surveyId);
    done(error);
  }).done();
}

