'use strict';

var settings = module.exports;

// Default buffer added around tile queries
// You probably won't need to override this default.
settings.defaultBuffer = process.env.DEFAULT_BUFFER || 0.05;

// S3 parameters for storing generated tiles
settings.s3Key = process.env.S3_KEY;
settings.s3Secret = process.env.S3_SECRET;
settings.s3Bucket = process.env.S3_BUCKET;

// Postgresql parcel server
// Use Heroku-style primary postgresql database environment variable
settings.psqlConnectionString = process.env.DATABASE_URL;
settings.featuresTable = process.env.FEATURES_TABLE;

settings.port = process.env.PORT || process.argv[2] || 3001;
settings.mongo = process.env.MONGO || 'mongodb://localhost:27017/localdata_production';
settings.prefix = process.env.PREFIX;

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
