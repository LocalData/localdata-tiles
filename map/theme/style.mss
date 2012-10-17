@land: lighten(#080,20%);
@text: #FF00FF;
Map {
  background-color: @land;
  /* background-image: "grid.png"; */
}


#world {
  line-color: lighten(yellow, 30%);
  line-width: 1;
  polygon-fill: yellow;
}
#example {
  line-color: lighten(@text,20%);
  line-width: 3;
  polygon-fill: @text;
}

