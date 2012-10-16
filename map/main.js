require([
  "reqwest",
  "wax"
],

function(reqwest, Wax) {
  window.reqwest = reqwest; // TODO: find a better way of doing this

  wax.tilejson('/tile.json', function(tilejson) {
    var map = new L.Map('map')
      .addLayer(new wax.leaf.connector(tilejson))
      .setView(new L.LatLng(37.751172,-122.430611), 12);
          
    wax.leaf.interaction()
      .map(map)
      .tilejson(tilejson)
      .on(wax.tooltip().animate(true).parent(map._container).events());
  });
});