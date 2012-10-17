nodetiles-server
================

This is an example webserver to use with [nodetiles](http://github.com/codeforamerica/nodetiles), a nodejs map rendering library. 

![Screenshot of nodetiles-server](https://raw.github.com/codeforamerica/nodetiles-server/master/screenshot.png)


installation
-------------

Be sure to install the dependencies:

```bash
$ npm install
```

Then start the server:

```bash
$ node server
```

And visit the webpage: [http://localhost:3000](http://localhost:3000)


nodetiles co-development
-------------------------------------

I would recommend symlinking between the /node_modules directory and your local copy of nodetiles:

```bash
ln -s /path/to/nodetiles node_modules/nodetiles
```

data
----

example data
[Natural Earth](http://naturalearth.org)
projected to 900913 with [zipit](https://github.com/nvkelso/natural-earth-vector/blob/master/tools/make-web-mercator-900913-ready/zip-it.sh)

