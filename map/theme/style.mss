Map {
  background-color: #a0c3ff;
  /* background-image: "grid.png"; */
}

#example {
  line-color: #008;
  line-width: 1;
  polygon-fill: #ffffee;
}

@land: #080;
#world {
  line-color: lighten(@land, 30%);
  line-width: 1;
  polygon-fill: @land;
}

