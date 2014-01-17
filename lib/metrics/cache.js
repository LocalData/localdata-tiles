'use strict';

/*
 * Cache component for New Relic metrics
 *
 */

var agent = require('./agent');
var settings = require('../settings');

var componentName = 'tileserver caching:' + settings.name;
var lastPollTime = Date.now();

var metrics = {};

function makeHitRateMetric(name) {
  var metric = {
    min: 0,
    max: 0,
    total: 0,
    count: 0
  };

  Object.defineProperty(metric, 'sum_of_squares', {
    enumerable: true,
    configurable: true,
    get: function () {
      return metric.total;
    }
  });

  metrics[name] = metric;

  function hit() {
    metric.total += 1;
    metric.count += 1;
    metric.max = 1;
  }

  function miss() {
    metric.count += 1;
  }

  return {
    hit: hit,
    miss: miss
  };
}

// ETag Cache hits/lookup
exports.etagCache = makeHitRateMetric('Component/Cache/ETag/Hits[hits|lookup]');
// // S3 Cache hits/lookup
exports.s3Cache = makeHitRateMetric('Component/Cache/S3/Hits[hits|lookup]');


// Code for reporting metrics to the agent
//

exports.render = function render(options) {
  var data = {
    guid: options.guidPrefix + '.cache',
    name: componentName,
    duration: 0,
    metrics: {}
  };

  data.duration = (Date.now() - lastPollTime)/1000;
  lastPollTime = Date.now();

  Object.keys(metrics).forEach(function (name) {
    var metric = metrics[name];
    metric.polled = true;
    data.metrics[name] = {
      min: metric.min,
      max: metric.max,
      total: metric.total,
      count: metric.count,
      sum_of_squares: metric.sum_of_squares
    };

    // Reset the internal stats
    metric.min = 0;
    metric.max = 0;
    metric.total = 0;
    metric.count = 0;
  });

  return data;
};

exports.success = function success() {
};
