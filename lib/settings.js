/* global process */
'use strict';

var settings = module.exports;

// Default buffer added around tile queries
// You probably won't need to override this default.
settings.defaultBuffer = process.env.DEFAULT_BUFFER || 0.05;

// Don't render feature tiles when zoomed further out. 
settings.maxFeatureZoom = process.env.MAX_FEATURE_ZOOM || 12;

// S3 parameters for storing generated tiles
settings.s3Key = process.env.S3_KEY;
settings.s3Secret = process.env.S3_SECRET;
settings.s3Bucket = process.env.S3_BUCKET;

// Postgresql parcel server
// Use Heroku-style primary postgresql database environment variable
settings.psqlConnectionString = process.env.DATABASE_URL;
settings.featuresTable = process.env.FEATURES_TABLE;

settings.psqlPoolMin = parseInt(process.env.PSQL_POOL_MIN, 10);
if (isNaN(settings.psqlPoolMin)) {
  settings.psqlPoolMin = 4;
}
settings.psqlPoolMax = parseInt(process.env.PSQL_POOL_MAX, 10);
if (isNaN(settings.psqlPoolMax)) {
  settings.psqlPoolMax = 10;
}

settings.port = process.env.PORT || process.argv[2] || 3001;
settings.mongo = process.env.MONGO || 'mongodb://localhost:27017/localdata_production';

// The prefix should actually be an array of tile path prefixes, specified as
// JSON. We support the original interpretation, though, of the prefix as a
// single path prefix specified directly as a simple string.
if (process.env.PREFIX && Object.prototype.toString.call(process.env.PREFIX === '[object String]')) {
  if (process.env.PREFIX.trim()[0] === '[') {
    // JSON array
    settings.prefix = JSON.parse(process.env.PREFIX)
  } else {
    // Legacy value
    settings.prefix = [process.env.PREFIX];
  }
}

settings.noAnswer = 'no response';
settings.unstructuredAnswer = 'response';

// Allow us to disable the caching components with an environment variable
settings.nocache = process.env.NOCACHE;

settings.cacheMethod = process.env.CACHE;

// Monitoring/instrumentation
settings.newRelicKey = process.env.NEW_RELIC_LICENSE_KEY;
settings.name = process.env.NAME || 'default-tileserver';

settings.expressLogger = process.env.EXPRESS_LOGGER || 'default';

// Limit the maximum amount of data we'll process, so we have a rough bound on
// memory usage.
settings.maxResponseCount = parseInt(process.env.MAX_COUNT, 10);
if (isNaN(settings.maxResponseCount)) {
  settings.maxResponseCount = 20000;
}
