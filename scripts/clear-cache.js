#!/usr/bin/env node
'use strict';

/*
 * Deletes all of the cached files for this service from S3.
 *
 * The script uses the S3_BUCKET and NAME environment variables to determine
 * what to delete. If those are well-configured (like on Heroku), then this
 * should be safe.
 *
 * Run locally with
 *   $ envrun --path scripts/clear-cache.js
 * Or run on Heroku with
 *   $ heroku run scripts/clear-cache.js -a my-tileserver-app
 */

var _ = require('lodash');
var async = require('async');
var knox = require('knox');

var settings = require('../lib/settings');

var prefix = settings.name;

var client = knox.createClient({
  key: settings.s3Key,
  secret: settings.s3Secret,
  bucket: settings.s3Bucket
});

function getKeys(done) {
  client.list({ prefix: prefix }, function (error, data) {
    if (error) { return done(error); }
    done(null, {
      finished: !data.IsTruncated,
      keys: _.pluck(data.Contents, 'Key')
    });
  });
}

var count = 0;
function deleteKeys(keys, done) {
  async.eachLimit(keys, 5, function (key, next) {
    // Because of the wonky handling of keys that have embedded query-string
    // pieces, we need to apply some escaping.
    var parts = key.split('?');
    if (parts.length > 1) {
      parts[1] = encodeURIComponent('?' + parts[1]);
      key = parts.join('');
    }
    client.deleteFile(key, function (error, response) {
      if (error) { return next(error); }
      count += 1;
      process.stdout.write('.');
      response.on('error', next);
      response.resume();
      response.on('end', next);
    });
  }, done);
}

function deleteAll(done) {
  var finished = false;
  async.whilst(
    function () { return !finished; },
    async.waterfall.bind(async, [
      function (step) {
        getKeys(function (error, data) {
          if (error) { return step(error); }
          finished = data.finished;
          step(null, data.keys);
        });
      },
      deleteKeys
    ]),
    done
  );
}

deleteAll(function (error) {
  console.log('\nDeleted ' + count + ' objects.');
  if (error) { throw error; }
});
