var knex = require('knex');

var settings = require('./settings');

exports.pg = knex({
  client: 'pg',
  pool: { min: settings.psqlPoolMin, max: settings.psqlPoolMax },
  connection: settings.psqlConnectionString
});
