var knex = require('knex');

var settings = require('./settings');

var pg = knex({
  client: 'pg',
  connection: settings.psqlConnectionString
});

exports.getClient = function getClient() {
  return pg;
};
