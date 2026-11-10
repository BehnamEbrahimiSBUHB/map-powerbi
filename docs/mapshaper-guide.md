# How to use mapshaper

[mapshaper](https://github.com/mbloch/mapshaper) reads, edits and converts map files. This repository uses it to turn boundaries into Power BI map files.

You can use it in two ways:

- **In the browser:** [mapshaper.org](https://mapshaper.org). Nothing to install. Good for one file.
- **On the command line:** repeatable and scriptable. Good for many files.

## How it thinks

Every mapshaper run has three parts:

```text
input file  ->  commands (each starts with -)  ->  -o output file
```

Commands run from left to right. Each one changes the map in memory. Nothing is saved until `-o`.

```sh
bunx mapshaper input.geojson -filter-fields CODE,NAME -simplify 20% keep-shapes -o format=topojson output.json
```

## Command line

This repository installs mapshaper with Bun, so from the repository folder you can run:

```sh
bun install
bunx mapshaper -v
```

Outside this repository, `bunx mapshaper` downloads and runs it on demand.

### A full example

Goal: turn a GeoJSON file into a small Power BI map.

1. **Look at the file.**

   ```sh
   bunx mapshaper areas.geojson -info
   ```

   Read four lines of the output: `Type` (should be polygon), `Records` (number of shapes), `CRS` (should be longitude/latitude) and the field list.

2. **Keep only the properties you need.**

   ```sh
   bunx mapshaper areas.geojson -filter-fields LSOA21CD,LSOA21NM -o step2.geojson
   ```

3. **Reduce detail.** `keep-shapes` stops small areas from disappearing.

   ```sh
   bunx mapshaper step2.geojson -simplify 20% keep-shapes -o step3.geojson
   ```

4. **Export TopoJSON with the code as the shape id.**

   ```sh
   bunx mapshaper step3.geojson -o format=topojson id-field=LSOA21CD map.json
   ```

Or do it all at once:

```sh
bunx mapshaper areas.geojson \
  -filter-fields LSOA21CD,LSOA21NM \
  -simplify 20% keep-shapes \
  -o format=topojson id-field=LSOA21CD map.json
```

### Things that catch people out

- **Quotes.** Put expressions in single quotes so the shell leaves them alone: `-filter 'NAME.startsWith("Swansea")'`.
- **Field names are case sensitive.** `lsoa21cd` is not `LSOA21CD`. Check with `-info`.
- **Simplifying does not reduce the number of shapes.** It removes points from the outlines. To get fewer shapes, use `-filter` or `-dissolve`.
- **Unknown coordinate system.** A GeoJSON file in metres has no label saying which system it uses. Tell mapshaper with `from=`: `-proj wgs84 from=EPSG:27700`.
- **Several input files become several layers.** Add `combine-files` and `-merge-layers` to join them into one.

## In the browser

1. Open [mapshaper.org](https://mapshaper.org).
2. Drag your file onto the page and select **Import**.
3. Select **Console** to type commands. Leave out `bunx mapshaper` and the file names. For example: `filter-fields LSOA21CD,LSOA21NM`. Type `info` to inspect the layer.
4. Select **Simplify** to reduce detail with a slider. Tick **prevent shape removal**.
5. Select **Export**, choose **TopoJSON** and download the file.

The browser version runs on your computer. Your file is not uploaded.

## Where to go next

- [mapshaper cheat sheet](mapshaper-cheat-sheet.md) for the commands on one page.
- [Prepare your own map](your-own-map.md) for a start-to-finish recipe.
- [mapshaper command reference](https://github.com/mbloch/mapshaper/blob/master/REFERENCE.md) for every option.
