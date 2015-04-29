'use strict';

var nodetiles = require('nodetiles-core');
var stream = require('stream');

var metrics = require('../metrics/pipeline');
var settings = require('../settings.js');


var world = nodetiles.projector.util.tileToMeters(0, 0, 0);


exports.smartBuffer = function smartBuffer(bounds, buffer) {
  if (buffer === undefined) {
    buffer = settings.defaultBuffer;
  }

  var amountX = (bounds.maxX - bounds.minX) * buffer;
  var amountY = (bounds.maxY - bounds.minY) * buffer;

  var minX = bounds.minX - amountX;
  var maxX = bounds.maxX + amountX;
  var minY = bounds.minY - amountY;
  var maxY = bounds.maxY + amountY;

  if (minX < world[0]) {
    minX = world[0];
  }

  if (maxX > world[2]) {
    maxX = world[2];
  }

  if (minY < world[1]) {
    minY = world[1];
  }

  if (maxY > world[3]) {
    maxY = world[3];
  }

  return {
    minX: minX,
    minY: minY,
    maxX: maxX,
    maxY: maxY
  };
};


exports.bufferStream = function bufferStream(stream, done) {
  var bufs = [];
  var length = 0;

  stream.on('readable', function () {
    var buf = stream.read();
    bufs.push(buf);
    length += buf.length;
  });

  stream.on('end', function () {
    done(null, Buffer.concat(bufs, length));
  });

  stream.on('error', function (error) {
    done(error);
  });
};


exports.createRenderStream = function createRenderStream(map, tile) {
  var passThrough = new stream.PassThrough();
  var bounds = nodetiles.projector.util.tileToMeters(tile[1], tile[2], tile[0]);

  // Start the timer.
  var stopMetric = metrics.renderTimer();

  map.render({
    bounds: {minX: bounds[0], minY: bounds[1], maxX: bounds[2], maxY: bounds[3]},
    width: 256,
    height: 256,
    zoom: tile[0],
    callback: function (error, canvas) {
      if (error) {
        passThrough.emit('error', error);
        return;
      }

      var stream = canvas.createPNGStream();

      // Stop the timer when the stream ends.
      stream.on('end', stopMetric);

      // TODO: handle the error
      stream.pipe(passThrough);
    }
  });

  return passThrough;
};


exports.createGrid = function createGrid(map, tile, options, done) {
  if (done === undefined) {
    done = options;
    options = {};
  }

  var drawImage = (options.drawImage === true);

  var bounds = nodetiles.projector.util.tileToMeters(tile[1], tile[2], tile[0]);
  map.renderGrid({
    bounds: {minX: bounds[0], minY: bounds[1], maxX: bounds[2], maxY: bounds[3]},
    width: 64,
    height: 64,
    zoom: tile[0],
    drawImage: drawImage,
    callback: done
  });
};
