'use strict';

var settings = module.exports;

settings.appName = 'LocalData Tile Server';
if (process.env.NAME !== undefined) {
  settings.appName += ': ' + process.env.NAME;
}

// S3 parameters for storing generated tiles
settings.s3Key = process.env.S3_KEY;
settings.s3Secret = process.env.S3_SECRET;
settings.s3Bucket = process.env.S3_BUCKET;

settings.port = process.env.PORT || process.argv[2] || 3001;
settings.mongo = process.env.MONGO || 'mongodb://localhost:27017/localdata_production';
settings.prefix = process.env.PREFIX || '/tiles';

settings.noAnswer = 'no response';
