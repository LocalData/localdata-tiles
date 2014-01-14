'use strict';

var mongoose = require('mongoose');

var settings = require('./settings');

// Database options
var mongooseOptions = {
  db: {
    w: 1,
    safe: true,
    native_parser: true
  }
};

exports.connect = function connect(done) {
  // Connect to the database
  mongoose.connect(settings.mongo, mongooseOptions);
  var db = mongoose.connection;

  db.on('error', done);

  db.once('open', function () {
    done(null, db);
  });
};
