'use strict';

var __ = require('lodash');

var metrics = require('./metrics/cache');
var Response = require('./models/Response');

var statsBySurvey = {};

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
  var stopMetric = metrics.statsCacheLatency();

  var stats = statsBySurvey[surveyId];
  if (stats !== undefined) {
    stopMetric.hit();
    metrics.statsCache.hit();
    done(null, stats);
    return;
  }
  metrics.statsCache.miss();

  getStatsFromDB(surveyId, function (error, stats) {
    stopMetric.miss();
    if (error) {
      console.log(error);
      done(error);
    }
    statsBySurvey[surveyId] = stats;
    done(null, stats);
  });
}

