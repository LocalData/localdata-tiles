localdata-tiles
================

localdata-tiles serves the tiled raster maps for LocalData using a fork of the [nodetiles](http://github.com/codeforamerica/nodetiles-core) rendering library. It provides PNG tiles and UTF grids for LocalData surveys.

Install instructions
--------------------

To run locally on OS X:

Clone and run `npm install`. You may need to run `brew install cairo` and confirm
the installation succeeded (check `brew doctor`). You may also need to `brew install` `fontconfig` and `pixman`.

If you get more Cairo-related errors, you may need to explicitly say where to look for libraries: `export PKG_CONFIG_PATH=/opt/X11/lib/pkgconfig`

Copy `sample.env` and update the values to match your environment.

Using [env-run](https://npmjs.org/package/envrun), run `envrun -e your-brand-new.env -p 3001 node server.js`


Running on Heroku
-----------------
Follow the instructions for using the [cairo buildpack](https://github.com/mojodna/heroku-buildpack-cairo)
when creating a Heroku app.



Fakeroku
--------

You'll need an SSL key and cert in:

```
/Users/coolguy/.ssh/localdata-key.pem
/Users/coolguy/.ssh/localdata-cert.pem
```

Then run `PORT=4334 bin/fakeroku 3001`

Layer definitions
-----------------

To define a layer, POST some `application/json` to `/surveys/SURVEYID/tile.json` with the following format:

```json
{
  "select": {"entries.responses": 1},
  "query": {},
  "styles": "Map {\n background-color: rgba(0,0,0,0);\n}\n\n#localdata {\n  [zoom >= 14] {\n    line-color:#fff;\n    line-width:0.5;\n    line-opacity:0.5;\n  }\n\n  polygon-opacity:0.85;\n  polygon-fill: #801020;\n\n  [\"responses.What-is-the-built-character\" = \"Medium\"] {\n    polygon-fill: #102080;\n  }\n  [\"responses.Is-there-anything-else-you-would-like-to-say-about-housing-in-San-Francisco.length\" > 0] {\n    polygon-fill: #102080;\n  }\n}"
}
```

The `styles` field contains a string with the Carto style sheet.

You can also issue a GET to `/surveys/SURVEYID/tile.json?layerDefinition=LAYERDEF`, where `LAYERDEF` is the (url-encoded) JSON from the POST.

In either case, the server will respond with a `tile.json` that includes the appropriate URLs for
