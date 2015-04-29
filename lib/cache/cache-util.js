'use strict';

var settings = require('../settings');

function tile2long(x, z) {
  return (x/Math.pow(2,z)*360-180);
}

function tile2lat(y, z) {
  var n=Math.PI-2*Math.PI*y/Math.pow(2,z);
  return (180 / Math.PI * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n))));
}

function tileToBounds(tile) {
  var sw = [tile2long(tile[1], tile[0]), tile2lat(tile[2] + 1, tile[0])];
  var ne = [tile2long(tile[1] + 1, tile[0]), tile2lat(tile[2], tile[0])];
  return [sw, ne];
}

exports.tileToBounds = tileToBounds;

  var makeTileName = (function () {
    var prefix = '/' + settings.name;
    return function makeTileName(req) {
      var query = req.query;

      // Sort query parameters, so we use consistent filenames
      var keys = Object.keys(query).sort();
      var queryString;
      if (keys.length > 0) {
        queryString = '?' + keys.map(function (key) {
          return key + '=' + query[key];
        }).join('&');
      } else {
        queryString = '';
      }

      // Encode the query string, so knox/S3 treat it as part of the name and
      // not part of the request.
      return prefix + req.path + encodeURIComponent(queryString);
    };
  }());
