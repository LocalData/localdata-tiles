require([
  "reqwest",
  "bean",
  "wax"
],

function(reqwest, bean, Wax) {
  window.reqwest = reqwest; // TODO: find a better way of doing this
  window.bean = bean;

  var url = 'http://api.tiles.mapbox.com/v3/matth.map-4ke1itgy.jsonp';

  wax.tilejson(url, function(tilejson) {
    var map = new L.Map('map')
      .addLayer(new wax.leaf.connector(tilejson))
      .setView(new L.LatLng(tilejson.center[1], tilejson.center[0]), tilejson.center[2]);

    wax.tilejson('/26e39f80-ea3a-11e1-bcdf-e9f1e9f87cda/tile.json', function(tilejson2){
      map.addLayer(new wax.leaf.connector(tilejson2));
    });

    wax.leaf.interaction()
      .map(map)
      .tilejson(tilejson)
      .on(wax.tooltip().animate(true).parent(map._container).events());
  });
});