require([
  "reqwest",
  "bean",
  "wax"
],

function(reqwest, bean, Wax) {
  window.reqwest = reqwest; // TODO: find a better way of doing this
  window.bean = bean;

  wax.tilejson('/tile.json', function(tilejson) {
    var map = new L.Map('map')
      .addLayer(new wax.leaf.connector(tilejson))
      .setView(new L.LatLng(tilejson.center[1], tilejson.center[0]), tilejson.center[2]);
          
    wax.leaf.interaction()
      .map(map)
      .tilejson(tilejson)
      .on(wax.tooltip().animate(true).parent(map._container).events());
  });
});