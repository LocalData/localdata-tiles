Map {
  background-color: #a0c3ff;
  /* background-image: "grid.png"; */
}


@land: lighten(#080,20%);
@text: #FF00FF;
#world {
  line-color: lighten(@land, 30%);
  line-width: 1;
  polygon-fill: @land;
}
#example {
  line-color: lighten(@text,20%);
  line-width: 1;
  polygon-fill: @text;
}

