var knex = require('knex');

var settings = require('./settings');

exports.pg = knex({
  client: 'pg',
  connection: settings.psqlConnectionString
});
