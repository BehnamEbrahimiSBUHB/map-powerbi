# Prepare your own map

You have a JSON map file from somewhere else and want to use it in Power BI. This guide takes it through three stages:

1. [Make it suitable for Power BI](#stage-1-make-it-suitable-for-power-bi).
2. [Turn it into a hexmap](#stage-2-turn-it-into-a-hexmap) (optional).
3. [Turn it into a geogrid](#stage-3-turn-it-into-a-geogrid) (optional).

The examples call your file `mine.json` and its key field `CODE`. Replace both with your own.

## Before you start

- Install [Bun](https://bun.sh), then get this repository:

  ```sh
  git clone https://github.com/CodeWithBehnam/map-powerbi.git
  cd map-powerbi
  bun install
  ```

- Stages 2 and 3 also need [R](https://www.r-project.org) 4.1 or newer. See [Install the R packages](#install-the-r-packages).

## Stage 1: make it suitable for Power BI

### 1. Inspect the file

```sh
bunx mapshaper mine.json -info
```

Compare the output with this table.

| Line | Good | If not |
|---|---|---|
| `Type` | `polygon` | Shape maps need areas. Points and lines will not work. |
| `Records` | 1,500 or fewer | [Reduce the number of shapes](#too-many-shapes). |
| `CRS` | `+proj=longlat +datum=WGS84` | [Convert the coordinates](#wrong-coordinates). |
| `Bounds` | Numbers between -180 and 180 | [Convert the coordinates](#wrong-coordinates). |
| Field list | Includes a field with a unique code or name | You need one. Add it with `-join` from a CSV. |

### 2. Fix what the table flagged

#### Wrong coordinates

If `CRS` names a system, mapshaper can convert it directly:

```sh
bunx mapshaper mine.json -proj wgs84 -o fixed.json
```

If `CRS` says `[unknown]` and the bounds are large numbers, the file is in metres with no label. Say which system it is with `from=`. UK files are usually British National Grid (`EPSG:27700`):

```sh
bunx mapshaper mine.json -proj wgs84 from=EPSG:27700 -o fixed.json
```

Run `-info` again. The bounds should now be small numbers. For the UK, expect roughly -8 to 2 and 49 to 61.

#### Too many shapes

Simplifying does not help here. It removes points, not shapes. Use one of these:

```sh
# Keep only the shapes you need
bunx mapshaper mine.json -filter 'NAME.startsWith("Swansea")' -o fewer.json

# Or merge shapes into larger areas that share a value
bunx mapshaper mine.json -dissolve REGION -o fewer.json
```

#### Duplicate keys

```sh
bunx mapshaper mine.json -uniq CODE -info
```

If `Records` is lower than before, some keys were repeated. Often one area is split into several parts. Merge the parts:

```sh
bunx mapshaper mine.json -dissolve CODE copy-fields=NAME -o merged.json
```

### 3. Export for Power BI

```sh
bunx mapshaper mine.json \
  -filter-fields CODE,NAME \
  -simplify 20% keep-shapes \
  -o format=topojson id-field=CODE powerbi-map.json
```

| Part | What it does |
|---|---|
| `-filter-fields CODE,NAME` | Keeps only the properties Power BI should match on. |
| `-simplify 20% keep-shapes` | Keeps 20% of the outline points and never drops a shape. Use a higher number if borders look too rough. |
| `format=topojson` | Writes the compact format. |
| `id-field=CODE` | Sets each shape's id to its code. |

Load `powerbi-map.json` by following [Use the maps in Power BI](power-bi-guide.md), from step 2. Check your file against [What a map file needs](map-requirements.md) if it does not appear.

## Install the R packages

Stages 2 and 3 use two R packages through [`scripts/hex.R`](../scripts/hex.R). In R, run:

```r
install.packages(c("sf", "clue", "geogrid", "remotes"))
remotes::install_github("mitchelloharawild/hexmap")
```

| Package | Used for | Notes |
|---|---|---|
| [hexmap](https://github.com/mitchelloharawild/hexmap) | Stage 2 | GitHub only and marked experimental. This repository was built with commit `957784f`. |
| [geogrid](https://github.com/jbaileyh/geogrid) | Stage 3 | On CRAN. |
| sf, clue | Both | Reading map files and matching areas to hexagons. |

## Stage 2: turn it into a hexmap

A hexmap gives every area one equal-sized hexagon and keeps areas close to where they really are.

1. **Make a GeoJSON copy** in longitude/latitude with only the properties you want. If you finished stage 1, convert the result:

   ```sh
   bunx mapshaper powerbi-map.json -o format=geojson mine.geojson
   ```

2. **Make the hexagons.**

   ```sh
   Rscript scripts/hex.R hexmap mine.geojson mine-hexmap.geojson
   ```

   To keep groups of areas together, for example councils or regions, add the name of the property that holds the group:

   ```sh
   Rscript scripts/hex.R hexmap mine.geojson mine-hexmap.geojson REGION
   ```

   The group property must be in the file. If stage 1 removed it, keep it in `-filter-fields`.

3. **Export for Power BI.**

   ```sh
   bunx mapshaper mine-hexmap.geojson -o format=topojson id-field=CODE mine-hexmap.json
   ```

   To leave the group property out of the final file, add `-filter-fields CODE,NAME` before `-o`.

4. In Power BI, set **Projection** to **Mercator**. The hexagons are built for it.

## Stage 3: turn it into a geogrid

A geogrid also gives every area one hexagon, on a regular grid shaped like the whole map. It ignores groups, so areas from different groups can end up side by side.

```sh
Rscript scripts/hex.R geogrid mine.geojson mine-geogrid.geojson
bunx mapshaper mine-geogrid.geojson -o format=topojson id-field=CODE mine-geogrid.json
```

**geogrid is slow for large maps.** Its matching step grows with the cube of the number of areas.

| Areas | hexmap | geogrid |
|---|---|---|
| 48 | 4 seconds | 2 seconds |
| 240 | 5 seconds | 2 minutes |
| 1,291 | 34 seconds | Hours (stopped after 8 minutes, not finished) |

Times are from one Apple Silicon laptop. Use hexmap for maps with more than a few hundred areas.

## Which should I pick?

| You want | Pick |
|---|---|
| Hexagons that stay close to the real places | hexmap |
| Groups such as councils kept in one piece | hexmap with a group property |
| A neat, regular block of hexagons | geogrid |
| A map with more than a few hundred areas | hexmap |

## If something does not work

| Problem | Fix |
|---|---|
| `Input file not found` | Check the path. Run the command from the repository folder. |
| `Input has no '...' property` | The group name is misspelt or was removed. Field names are case sensitive. Check with `-info`. |
| `there is no package called ...` | [Install the R packages](#install-the-r-packages). |
| `Rscript: command not found` | Install R, or set `RSCRIPT` to the full path of `Rscript`. |
| A geometry error from `hexmap` | Run `bunx mapshaper mine.geojson -clean -o mine.geojson force` and try again. |
| Hexagons look squashed in Power BI | Set **Projection** to **Mercator**. |
