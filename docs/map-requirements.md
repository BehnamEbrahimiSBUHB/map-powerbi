# What a map file needs for Power BI

Use this checklist before you load any map into the Power BI **Shape map** visual. Every file in this repository already meets it.

## Checklist

| # | Requirement | Why | How to check with mapshaper |
|---|---|---|---|
| 1 | The file is TopoJSON or GeoJSON. | These are the two formats the Shape map visual accepts. | `bunx mapshaper map.json -info` |
| 2 | Coordinates are longitude and latitude (WGS84). | Power BI applies its own projection. Coordinates in metres draw as a dot or not at all. | `-info` shows `CRS: +proj=longlat +datum=WGS84` and bounds between -180 and 180. |
| 3 | There are at most 1,500 shapes. | The visual plots no more than that. | `-info` shows `Records`. |
| 4 | Every shape has a key property that is unique. | Power BI joins your data to the map on this value. Two shapes with one key cannot be told apart. | `-uniq <field>` then `-info`: the record count must not drop. |
| 5 | The key matches your data exactly. | `W01000736` and `w01000736 ` (wrong case, extra space) do not match. | Compare with **View map type key** in Power BI. |
| 6 | Shapes are polygons. | The visual fills areas with colour. Points and lines have nothing to fill. | `-info` shows `Type: polygon`. |
| 7 | The file is small. | Large files make reports slow to open. | Check the file size. Aim for under about 1 MB. |
| 8 | Only useful properties are kept. | Every property becomes a map key column. Fewer is clearer and smaller. | `-info` lists the fields. |

Rows 1 and 3 come from Microsoft's guide: [Create shape map visualizations in Power BI](https://learn.microsoft.com/en-us/power-bi/visuals/desktop-shape-map). The other rows are working practice from building these files. The 1 MB figure in row 7 is a rule of thumb, not a Power BI limit.

## Choices this repository makes

| Choice | Value | Reason |
|---|---|---|
| Format | TopoJSON saved as `.json` | Shared borders are stored once, so files are much smaller than GeoJSON. |
| Key | The ONS area code, also set as the shape `id` | Codes are unique. Names are not always. |
| Extra properties | English and Welsh names | Lets you match on a name when you have no code. |
| Detail | ONS "generalised" boundaries (20 m) | Looks right at council scale and stays small. |
| Hex maps | Hexagons built in Web Mercator | They stay regular under Power BI's **Mercator** projection. |

## Next steps

- To fix a file that fails this checklist, see [Prepare your own map](your-own-map.md).
- For the commands, see the [mapshaper cheat sheet](mapshaper-cheat-sheet.md).
