'use strict';

var os = require('os');

var _ = require('lodash');
var request = require('request');

var cacheComponent = require('./cache');
var settings = require('../settings');

var apiUrl = 'https://platform-api.newrelic.com/platform/v1/metrics';
var version = '1.0.0';

var pollCycle = 60 * 1000; // 60 seconds in milliseconds
var host = os.hostname();
var pid = process.pid;
var guidPrefix = 'com.localdata.internal.tileserver.' + settings.name;

var components = [cacheComponent];

var agent = {
  host: host,
  pid: pid,
  version: version
};


var postMetrics;

// Log metrics to the console instead of sending to the API
function postMetricsConsole(data, done) {
  console.log(JSON.stringify(data));
  done(null, true);
}

// Send metrics to New Relic. Callback gets true if New Relic acknowledged a
// successful POST, false otherwise. If something goes wrong, and we can't
// recover by just waiting and sending data later, then we switch to just
// logging data to the console.
function postMetricsAPI(data, done) {
  console.log('POSTing metrics data to New Relic:', JSON.stringify(data));
  request.post({
    url: apiUrl,
    json: data,
    headers: {
      'X-License-Key': settings.newRelicKey,
      'Content-Type': 'application/json',
      'Accept': 'application/json'
    }
  }, function (error, response, body) {
    if (error) {
      console.log('Error POSTing data to New Relic', error);
      done(null, false);
      return;
    }

    if (response.statusCode !== 200) {
      console.log('Error POSTing data to New Relic. Got status code: ' + response.statusCode);

      if (response.statusCode === 400 || response.statusCode === 403) {
        // If we're sending malformed data, or if we have an invalid key,
        // then we should not keep sending data.
        postMetrics = postMetricsConsole;
      }
      done(null, false);
      return;
    }
  });
}


if (!settings.newRelicKey) {
  postMetrics = postMetricsConsole;
} else {
  postMetrics = postMetricsAPI;
}

function processMetrics() {
  console.log('===========processing metrics');
  var data = {
    agent: agent,
    components: []
  };
  
  _.each(components, function (component) {
    // TODO: keep data around, in case there are no events between now and the
    // next poll
    data.components.push(component.render({ guidPrefix: guidPrefix }));
    // //component.metrics = computeMetrics(component.guid);
    // if (lastPollTime === -1) {
    //   lastPollTime = Date.now() - component.duration;
    // }
    // component.duration = Date.now() - lastPollTime;
    // component.metrics.polled = true;
  });

  postMetrics(data, function (error, success) {
    // TODO: If we were unsuccessful, then we should just keep collecting
    // stats. We need to make sure we don't lose any data points that happen in
    // between rendering the data and receiving a confirmation.
  });
}

setInterval(processMetrics, pollCycle);
