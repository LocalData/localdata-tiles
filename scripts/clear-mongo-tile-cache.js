#!/usr/bin/env node
'use strict';

var Promise = require('bluebird');

var mongo = require('../lib/mongo');
var CacheItem = require('../lib/models/CacheItem');
var settings = require('../lib/settings');

var CACHE_NAME = 'tile-cache-' + settings.name;

Promise.promisifyAll(CacheItem);
Promise.promisifyAll(mongo);

var conditions = {
  '_id.cache': CACHE_NAME
};

Promise.bind({})
.then(function () {
  return mongo.connectAsync();
}).then(function (db) {
  this.db = db;
  return CacheItem.countAsync(conditions);
}).then(function (count) {
  console.log('Found ' + count + ' cache entries.');
  this.count = count;
  return CacheItem.removeAsync(conditions);
}).then(function () {
  return CacheItem.countAsync(conditions);
}).then(function (count) {
  console.log('Removed ' + (this.count - count) + ' cache entries.');
  this.db.close();
}).catch(function (error) {
  console.log(error);
  console.log(error.stack);
  process.exit(1);
});
