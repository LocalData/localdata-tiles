/**
 * LocalData Tileserver
 *
 * LD internal testing notes:
 * Nortown:
 * $ time curl -L --compressed http://localhost:3001/dbcb3590-0f59-11e2-81e6-bffd22dee0ec/filter/condition/tiles/14/4411/6055.png > file.png
 *
 * http://localhost:3001/dbcb3590-0f59-11e2-81e6-bffd22dee0ec/utfgrids/14/4411/6055.json > grid.txt
 * http://localhost:3001/dbcb3590-0f59-11e2-81e6-bffd22dee0ec/utfgrids/14/4412/6055.json > grid.txt
 and the PNG: http://localhost:3001/dbcb3590-0f59-11e2-81e6-bffd22dee0ec/tiles/14/4412/6055.png
 */

'use strict';

if (process.env.NEW_RELIC_LICENSE_KEY) {
  require('newrelic');
}

var http = require('http');

var compression = require('compression');
var errorhandler = require('errorhandler');
var express = require('express');
var morgan = require('morgan');

var app = module.exports = express();

var mongo = require('./lib/mongo');
var settings = require('./lib/settings');
var routes = require('./lib/routes');

// Basic configuration
var PORT = settings.port;

function allowCrossDomain(req, res, next) {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET');
    res.header('Access-Control-Allow-Headers', 'Content-Type');
    next();
}

app.use(morgan(settings.expressLogger));
app.use(allowCrossDomain);

// Set up development error handling
if (app.get('env') === 'development') {
  app.use(errorhandler());
}

app.use(compression());

// Setup routes
routes.setup(app);

// Connect to the database and start the server
mongo.connect(function (error) {
  if (error) {
    console.log('Error connecting to database', error);
    process.exit(1);
  }

  var server = http.createServer(app);

  server.listen(PORT, function (error) {
    console.log('Listening on port %d in %s mode', PORT, app.get('env'));
  });
});
