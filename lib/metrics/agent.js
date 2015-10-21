'use strict';

var os = require('os');

var _ = require('lodash');
var Promise = require('bluebird');
var request = require('request');

var cacheComponent = require('./cache');
var pipelineComponent = require('./pipeline');
var settings = require('../settings');

Promise.promisifyAll(request);

var apiUrl = 'https://platform-api.newrelic.com/platform/v1/metrics';
var version = '1.0.0';

var pollCycle = 60 * 1000; // 60 seconds in milliseconds
var host = os.hostname();
var pid = process.pid;
var guidPrefix = 'com.localdata.internal.tileserver.' + settings.name;

var components = [cacheComponent, pipelineComponent];

var agent = {
  host: host,
  pid: pid,
  version: version
};


var postMetrics;

// Log metrics to the console instead of sending to the API
function postMetricsConsole(data, done) {
  _.each(data.components, function (component) {
    var metrics = component.metrics;
    _.each(_.keys(metrics), function (name) {
      exports.logMetric(name, metrics[name]);
    });
  });
  return Promise.resolve(true);
}

// Send metrics to New Relic. Callback gets true if New Relic acknowledged a
// successful POST, false otherwise. If something goes wrong, and we can't
// recover by just waiting and sending data later, then we switch to just
// logging data to the console.
function postMetricsAPI(data, done) {
  console.log('POSTing metrics data to New Relic');
  return request.postAsync({
    url: apiUrl,
    json: data,
    headers: {
      'X-License-Key': settings.newRelicKey,
      'Content-Type': 'application/json',
      'Accept': 'application/json'
    }
  }).spread(function (response, body) {
    if (response.statusCode !== 200) {
      console.log('Error POSTing data to New Relic. Got status code: ' + response.statusCode);

      if (response.statusCode === 400 || response.statusCode === 403) {
        // If we're sending malformed data, or if we have an invalid key,
        // then we should not keep sending data.
        // We already log non-trivial metrics in each component's render
        // function, so we can just skip the New Relic POST
        postMetrics = function () { return true; };
      }
      return false;
    }
    return true;
  }).catch(function (error) {
    console.log('Error POSTing data to New Relic', error);
    return false;
  });
}


if (!settings.newRelicKey) {
  postMetrics = postMetricsConsole;
} else {
  postMetrics = postMetricsAPI;
}

function processMetrics() {
  components.reduce(function (promise, component) {
    // TODO: keep data around, in case there are no events between now and the
    // next poll
    // //component.metrics = computeMetrics(component.guid);
    // if (lastPollTime === -1) {
    //   lastPollTime = Date.now() - component.duration;
    // }
    // component.duration = Date.now() - lastPollTime;
    // component.metrics.polled = true;
    return promise.then(function () {
      return postMetrics({
        agent: agent,
        components: [component.render({ guidPrefix: guidPrefix })]
      }).then(function (success) {
        // TODO: If we were unsuccessful, then we should just keep collecting
        // stats. We need to make sure we don't lose any data points that happen in
        // between rendering the data and receiving a confirmation.
      });
    });
  }, Promise.resolve());
}

setInterval(processMetrics, pollCycle);

exports.logMetric = function logMetric(name, metric) {
  if (metric.min === Number.POSITIVE_INFINITY) {
    return;
  }
  var measurements = Object.keys(metric).map(function (key) {
    return key + '=' + metric[key];
  }).join(' ');
  console.log('metric ' + name + ' ' + measurements);
};
