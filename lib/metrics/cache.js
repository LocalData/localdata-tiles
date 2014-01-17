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

function makeHitMissLatencyMetric(hitName, missName) {
  var hitMetric = {
    min: 0,
    max: 0,
    total: 0,
    count: 0,
    sum_of_squares: 0
  };

  var missMetric = {
    min: 0,
    max: 0,
    total: 0,
    count: 0,
    sum_of_squares: 0
  };

  metrics[hitName] = hitMetric;
  metrics[missName] = missMetric;

  return function start() {
    var t0 = Date.now();

    function makeStop(metric) {
      return function stop() {
        var t = (Date.now() - t0) / 1000;
        metric.min = Math.min(t, metric.min);
        metric.max = Math.max(t, metric.max);
        metric.total += t;
        metric.count += 1;
        metric.sum_of_squares += t * t;
      };
    }

    return {
      hit: makeStop(hitMetric),
      miss: makeStop(missMetric)
    };
  };
}

function makeLatencyMetric(name) {
  var metric = {
    min: 0,
    max: 0,
    total: 0,
    count: 0,
    sum_of_squares: 0
  };

  metrics[name] = metric;

  return function start() {
    var t0 = Date.now();
    return function stop() {
      var t = (Date.now() - t0) / 1000;
      metric.min = Math.min(t, metric.min);
      metric.max = Math.max(t, metric.max);
      metric.total += t;
      metric.count += 1;
      metric.sum_of_squares += t * t;
    };
  };
}

// ETag Cache hits/lookup
exports.etagCache = makeHitRateMetric('Component/Cache/ETag/Hits[hits|lookup]');
// S3 Cache hits/lookup
exports.s3Cache = makeHitRateMetric('Component/Cache/S3/Hits[hits|lookup]');
// S3 Cache seconds/hit, seconds/miss
exports.s3CacheLatency = makeHitMissLatencyMetric('Component/Cache/S3/HitLatency[seconds|hit]', 'Component/Cache/S3/MissLatency[seconds|miss]');


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
