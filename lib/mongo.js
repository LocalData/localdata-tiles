'use strict';

var mongoose = require('mongoose');

var settings = require('./settings');

exports.connect = function connect(done) {
  // Connect to the database
  mongoose.connect(settings.mongo);
  var db = mongoose.connection;

  db.on('error', done);

  db.once('open', function () {
    done(null, db);
  });
};
