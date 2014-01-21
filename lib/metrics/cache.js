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

function makeMetric() {
  return {
    min: Number.POSITIVE_INFINITY,
    max: Number.NEGATIVE_INFINITY,
    total: 0,
    count: 0,
    sum_of_squares: 0
  };
}

function makeCacheMetric(hitRateName, hitLatencyName, missLatencyName) {
  var hitRateMetric = makeMetric();
  Object.defineProperty(hitRateMetric, 'sum_of_squares', {
    enumerable: true,
    configurable: true,
    get: function () {
      return hitRateMetric.total;
    },
    set: function () {}
  });
  metrics[hitRateName] = hitRateMetric;

  var hitLatencyMetric = makeMetric();
  var missLatencyMetric = makeMetric();
  metrics[hitLatencyName] = hitLatencyMetric;
  metrics[missLatencyName] = missLatencyMetric;

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

    var hitStop = makeStop(hitLatencyMetric);
    var missStop = makeStop(missLatencyMetric);

    return {
      hit: function () {
        hitStop();
        hitRateMetric.total += 1;
        hitRateMetric.count += 1;
        hitRateMetric.max = 1;
        if (1 < hitRateMetric.min) {
          hitRateMetric.min = 1;
        }
      },
      miss: function () {
        missStop();
        hitRateMetric.count += 1;
        if (0 > hitRateMetric.max) {
          hitRateMetric.max = 0;
        }
        hitRateMetric.min = 0;
      }
    };
  };
}



// ETag Cache hits/lookup, seconds/hit, seconds/miss
exports.etagCache = makeCacheMetric('Component/Cache/ETag/Hits[hits|lookup]',
                                    'Component/Cache/ETag/HitLatency[seconds|hit]',
                                    'Component/CacheETag/MissLatency[seconds|miss]');

// S3 Cache hits/lookup, seconds/hit, seconds/miss
exports.s3Cache = makeCacheMetric('Component/Cache/S3/Hits[hits|lookup]',
                                  'Component/Cache/S3/HitLatency[seconds|hit]',
                                  'Component/Cache/S3/MissLatency[seconds|miss]');

// Survey Stats Cache hits/lookup, seconds/hit, seconds/miss
exports.statsCache = makeCacheMetric('Component/Cache/Survey Stats/Hits[hits|lookup]',
                                     'Component/Cache/Survey Stats/HitLatency[seconds|hit]',
                                     'Component/Cache/Survey Stats/MissLatency[seconds|miss]');


// Code for reporting metrics to the agent
//

function logMetric(name, metric) {
  console.log('metric ' + name + ' ' + JSON.stringify(metric));
}

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

    logMetric(name, metric);

    // Reset the internal stats
    metric.min = Number.POSITIVE_INFINITY;
    metric.max = Number.NEGATIVE_INFINITY;
    metric.total = 0;
    metric.count = 0;
    metric.sum_of_squares = 0;
  });

  return data;
};

exports.success = function success() {
};
