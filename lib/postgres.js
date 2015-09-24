var knex = require('knex');

var settings = require('./settings');

exports.pg = knex({
  client: 'pg',
  debug: true,
  connection: settings.psqlConnectionString
});
