'use strict';

var Response = require('./models/Response');

var statsBySurvey = {};

exports.get = function getStats(surveyId, callback) {
  if (statsBySurvey[surveyId] !== undefined) {
    callback(statsBySurvey[surveyId]);
    return;
  }

  Response.find({ survey: surveyId }, function(error, responses){
    console.log('STATS CACHE MISS');
    var stats = {};
    var i,
        key;

    for (i = 0; i < responses.length; i += 1) {
      var r = responses[i].responses;
      for (key in r) {
        if (__.has(r, key)) {
          var val = r[key];

          if (__.has(stats, key)) {
            if (__.has(stats[key], r[key])){
              stats[key][val] += 1;
            } else {
              stats[key][val] = 1;
            }
          } else {
            stats[key] = {};
            stats[key][val] = 1;
          }
        }
      }
    }

    // Calculate "no answer" responses
    var summer = function(memo, num) {
      return memo + num;
    };

    for (key in stats) {
      if(__.has(stats, key)) {
        var sum = __.reduce(stats[key], summer, 0);
        var remainder = responses.length - sum;

        stats[key]['no response'] = remainder;
      }
    }

    statsBySurvey[surveyId] = stats;
    callback(stats);
  });
};
