Nodetiles-init
================

This is an example webserver for use with the **[nodetiles-core](http://github.com/codeforamerica/nodetiles-core)** library, a fully-featured map rendering library for Node.js. This code is meant to be a convenient starting place for using Nodetiles to build a slippy-map &mdash; including Leaflet, Wax, and default asset/image routes &mdash; but is by no means only way to use the nodetiles-core library.

![Screenshot of nodetiles-server](https://raw.github.com/codeforamerica/nodetiles-server/master/screenshot.png)

Installation
-------------

After downloading, be sure to install the dependencies (this may require installing cairo and pixman):

```bash
$ npm install
```

Then start the server:

```bash
$ node server.example.js
```

And visit the webpage: [http://localhost:3000](http://localhost:3000)

Configuration
-------------

Data
----

example data
[Natural Earth](http://naturalearth.org)
projected to 900913 with [zipit](https://github.com/nvkelso/natural-earth-vector/blob/master/tools/make-web-mercator-900913-ready/zip-it.sh)

