Map {
	background-color: rgba(0,0,0,0);
}

#localdata {

  [GEOMETRY = MultiPolygon],
  [GEOMETRY = Polygon] {
    [zoom >= 14] {
      line-color:#fff;
      line-width:0.5;
      line-opacity:0.5;
    }

    polygon-opacity:0.85;
    polygon-fill:#ef6d4a;
  }

  [GEOMETRY = LineString]::outline {
    line-width: 4;
    line-cap: round;

    [zoom >= 15] {
      line-width: 5;
    }
    [zoom >= 16] {
      line-width: 6;
    }
    [zoom >= 17] {
      line-width: 7;
    }
    [zoom >= 18] {
      line-width: 8;
    }

    line-color: #fff3da;
    line-opacity: 1;
  }

  [GEOMETRY = LineString] {
    line-width: 2;
    line-cap: round;

    [zoom >= 15] {
      line-width: 3;
    }
    [zoom >= 16] {
      line-width: 4;
    }
    [zoom >= 17] {
      line-width: 5;
    }
    [zoom >= 18] {
      line-width: 6;
    }

    line-color: #ef6d4a;
    line-opacity: 0.9;
  }


  [GEOMETRY=Point] {
    marker-line-width: 1;
    marker-width: 8;

    [zoom >= 14] {
      marker-line-width: 1;
      marker-width: 10;
    }

    [zoom >= 16] {
      marker-line-width: 1;
      marker-width: 12;
    }

    marker-type: ellipse;
    marker-line-color: #fff3da;
    marker-fill: #ef6d4a;
    marker-fill-opacity: 0.9;
    marker-line-opacity: 1;
  }

}
