localdata-tiles
================

This is an experimental tileserver for use with the **[nodetiles-core](http://github.com/codeforamerica/nodetiles-core)** library, a fully-featured map rendering library for Node.js. It servers tiles and utfgrids for LocalData surveys

Install instructions
--------------------

To run locally on OS X:

Clone and run `npm install`. You may need to run `brew install cairo` and confirm
the installation succeeded (check `brew doctor`). You may also need to `brew install` `fontconfig` and `pixman`.

If you get more Cairo-related errors, you may need to explicitly say where to look for libraries: `export PKG_CONFIG_PATH=/usr/X11/lib/pkgconfig`

Copy `setenv_local.sh.sample` and update the values to match your environment.

Run `node server.js`

To run on heroku:

Push to heroku set the `MONGO` environment variable with a valid mongo
connection string

Fakeroku
--------

`PORT=4334 bin/fakeroku 3001`
