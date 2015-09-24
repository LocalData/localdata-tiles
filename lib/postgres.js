var knex = require('knex');

var settings = require('./settings');

exports.pg = knex({
  client: 'pg',
  debug: true,
  pool: { min: 0, max: 10 },
  connection: settings.psqlConnectionString
});
