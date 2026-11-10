# mapshaper cheat sheet

Every command here was run with mapshaper 0.7.101 on the boundaries in this repository. Put `bunx mapshaper` in front of each line. New to mapshaper? Read [How to use mapshaper](mapshaper-guide.md) first.

Pattern: `bunx mapshaper <input> <commands> -o <output>`

## Look

| Task | Command |
|---|---|
| Show type, shape count, bounds, coordinate system and fields | `map.geojson -info` |
| Count shapes | `map.geojson -calc 'count()'` |

## Convert

| Task | Command |
|---|---|
| GeoJSON to TopoJSON | `map.geojson -o format=topojson map.json` |
| TopoJSON to GeoJSON | `map.json -o format=geojson map.geojson` |
| Shapefile to TopoJSON | `map.shp -proj wgs84 -o format=topojson map.json` |
| Set the shape id from a field | `map.geojson -o format=topojson id-field=CODE map.json` |
| Export the property table | `map.geojson -o format=csv table.csv` |
| Draw a picture | `map.geojson -style fill='#2a78d6' stroke=white -o format=svg width=800 map.svg` |

## Coordinates

| Task | Command |
|---|---|
| Convert to longitude/latitude (file knows its system, for example a shapefile with `.prj`) | `map.shp -proj wgs84 -o out.geojson` |
| Convert British National Grid GeoJSON to longitude/latitude | `map.geojson -proj wgs84 from=EPSG:27700 -o out.geojson` |
| Convert to British National Grid | `map.geojson -proj EPSG:27700 -o out.geojson` |
| Convert to Web Mercator | `map.geojson -proj EPSG:3857 -o out.geojson` |

## Properties

| Task | Command |
|---|---|
| Keep only some fields | `map.geojson -filter-fields CODE,NAME -o out.geojson` |
| Remove a field | `map.geojson -drop fields=NAME_WELSH -o out.geojson` |
| Rename fields (`new=old`) | `map.geojson -rename-fields code=LSOA21CD,name=LSOA21NM -o out.geojson` |
| Add a calculated field | `map.geojson -each 'label = NAME.toUpperCase()' -o out.geojson` |
| Add columns from a CSV (`keys=map field,csv field`) | `map.geojson -join data.csv keys=CODE,CODE -o out.geojson` |
| Add one column from a CSV | `map.geojson -join data.csv keys=CODE,CODE fields=population -o out.geojson` |

## Shapes

| Task | Command |
|---|---|
| Keep shapes that pass a test | `map.geojson -filter 'NAME.startsWith("Swansea")' -o out.geojson` |
| Remove duplicate keys (keeps the first) | `map.geojson -uniq CODE -o out.geojson` |
| Sort shapes | `map.geojson -sort CODE -o out.geojson` |
| Merge every shape into one outline | `map.geojson -dissolve -o out.geojson` |
| Merge shapes that share a value | `map.geojson -dissolve REGION -o out.geojson` |
| Split multi-part shapes into single parts | `map.geojson -explode -o out.geojson` |
| Cut to a box (`west,south,east,north`) | `map.geojson -clip bbox=-4.1,51.55,-3.9,51.65 -o out.geojson` |
| Remove small islands | `map.geojson -filter-islands min-area=1km2 -o out.geojson` |
| Make a point inside each shape | `map.geojson -points inner -o out.geojson` |
| Join several files into one layer | `-i a.geojson b.geojson combine-files -merge-layers -o format=topojson out.json` |

## Size and quality

| Task | Command |
|---|---|
| Keep 10% of the points, never lose a shape | `map.geojson -simplify 10% keep-shapes -o out.geojson` |
| Simplify to a distance (units of the file) | `map.geojson -simplify dp interval=50 keep-shapes -o out.geojson` |
| Repair overlaps and gaps | `map.geojson -clean -o out.geojson` |
| Round coordinates (about 1 m in degrees) | `map.geojson -o format=topojson precision=0.00001 out.json` |
| Set TopoJSON quantisation | `map.geojson -o format=topojson quantization=10000 out.json` |

## Power BI recipe

One line that covers most files:

```sh
bunx mapshaper input.geojson \
  -proj wgs84 \
  -filter-fields CODE,NAME \
  -uniq CODE \
  -simplify 20% keep-shapes \
  -o format=topojson id-field=CODE map.json
```

Leave out `-proj wgs84` if `-info` already shows longitude/latitude. Add `from=` if the coordinate system is unknown.
