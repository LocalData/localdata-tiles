localdata-tiles
================

This is an experimental tileserver for use with the **[nodetiles-core](http://github.com/codeforamerica/nodetiles-core)** library, a fully-featured map rendering library for Node.js. It servers tiles and utfgrids for LocalData surveys

Install instructions
--------------------

To run locally:

Clone and run `npm install`. You may need to run `brew install cairo` and confirm
the installation succeeded (check `brew doctor`) to build this locally.

Copy `setenv_local.sh.sample`

Run `node tileserver.js`

To run on heroku:

Push to heroku set the `MONGO` environment variable with a valid mongo
connection string
