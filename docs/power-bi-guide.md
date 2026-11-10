# Use the maps in Power BI

This guide shows how to load one of the map files into the Power BI **Shape map** visual and colour it with your data.

## What you need

- Power BI Desktop.
- A table with one row per area and a column of area codes, for example `W01000736`.
- One map file from [`maps/`](../maps).

No data yet? Use a sample file from [`data/synthetic/`](../data/synthetic). The numbers in those files are made up.

## 1. Pick a map file

Files follow one pattern:

```text
maps/<version>/<level>/<council>/<map type>/<file>.json
```

| Part | Choices |
|---|---|
| Version | `2001`, `2011`, `2021` (census boundaries), `2026` (council outline) |
| Level | `oa`, `lsoa`, `msoa`, `council` |
| Council | `swansea`, `neath-port-talbot`, `swansea-and-neath-port-talbot` |
| Map type | `geographic`, `hexmap`, `geogrid` |

**Use the version that matches your data.** Area codes changed between censuses. 2021 census data needs a 2021 map.

### Which map type?

| Map type | What it shows | Use it when |
|---|---|---|
| `geographic` | The real boundaries. | Readers need to recognise places. |
| `hexmap` | One equal-sized hexagon per area, following the outline of the map. Each council stays in one piece, with a thin gap between them. | Small town-centre areas get lost on the real map. |
| `geogrid` | One equal-sized hexagon per area, on a regular grid shaped like the whole map. Each council stays in one piece. | You want a regular grid with no gap between the councils. |

On a hex map every area gets the same space, so a large rural area no longer looks more important than a small urban one. A hexagon sits near the real area, not exactly on it.

Both hex maps exist for OA, LSOA and MSOA. The council outline is geographic only.

To download a file, open it on GitHub and select **Download raw file**.

## 2. Load it in Power BI

1. Add a **Shape map** visual to the report.
2. Drag your area code column into **Location**.
3. Drag a number, for example population, into **Color saturation**.
4. Select the visual. In the **Visualizations** pane, select **Format visual** and expand **Map settings**.
5. Set **Map type** to **Custom map**.
6. Select **Add a map type** and choose the `.json` file.
7. Set **Projection** to **Mercator**.
8. Select **View map type key** and check that the codes match your column.

Mercator matters most for the hex maps. The hexagons are built for Mercator, so other projections squash them.

These steps follow Microsoft's guide: [Create shape map visualizations in Power BI](https://learn.microsoft.com/en-us/power-bi/visuals/desktop-shape-map).

## 3. Try it with the sample data

1. Download a sample file, for example `data/synthetic/synthetic-lsoa-2021.csv`.
2. In Power BI Desktop, select **Get data > Text/CSV** and load the file.
3. Follow the steps above. Use the first column (for example `LSOA21CD`) as **Location** and `population` as **Color saturation**.
4. Use the matching map: `maps/2021/lsoa/swansea-and-neath-port-talbot/geographic/swansea-and-neath-port-talbot-lsoa-2021.json`.

Each sample file covers both councils. To show one council, load a single-council map or filter on the `council` column.

## Load by URL instead

Power BI can read a map from a web address, so you do not need to download it.

1. In **Map settings**, set **Type** to **URL**.
2. Paste the raw address of a file, for example:

   ```text
   https://raw.githubusercontent.com/CodeWithBehnam/map-powerbi/main/maps/2021/lsoa/swansea-and-neath-port-talbot/geographic/swansea-and-neath-port-talbot-lsoa-2021.json
   ```

This route has not been tested from this repository. If it fails, download the file.

## Map keys

Power BI matches your **Location** column against these properties. All three map types of an area share the same keys, so you can swap the map without changing your data.

| Level | Version | Code | Name | Welsh name |
|---|---|---|---|---|
| OA | 2001 | `OA01CD` | none | none |
| OA | 2011 | `OA11CD` | none | none |
| OA | 2021 | `OA21CD` | none | none |
| LSOA | 2001 | `LSOA01CD` | `LSOA01NM` | `LSOA01NMW` |
| LSOA | 2011 | `LSOA11CD` | `LSOA11NM` | `LSOA11NMW` |
| LSOA | 2021 | `LSOA21CD` | `LSOA21NM` | `LSOA21NMW` |
| MSOA | 2001 | `MSOA01CD` | `MSOA01NM` | `MSOA01NMW` |
| MSOA | 2011 | `MSOA11CD` | `MSOA11NM` | `MSOA11NMW` |
| MSOA | 2021 | `MSOA21CD` | `MSOA21NM` | `MSOA21NMW` |
| Council | 2026 | `LAD26CD` | `LAD26NM` | `LAD26NMW` |

Example values: `W01000736`, `Swansea 028A`, `Abertawe 028A`.

Match on the code where you can. Codes are unique. Output Areas have codes only.

## If something does not work

| Problem | Fix |
|---|---|
| There is no Shape map icon | Go to **File > Options and settings > Options > Preview features**, turn on **Shape map visual** and restart Power BI Desktop. |
| The file picker does not show the file | Rename the file so it ends in `.topojson`. The content stays the same. |
| The map is blank or all one colour | Open **View map type key** and compare the codes with your column. Check that the map version matches your data and that the column type is **Text**. |
| Some areas stay grey | Those codes are missing from your data, or belong to a different version. |
| The hexagons look squashed | Set **Projection** to **Mercator**. |
| The map is slow | Use a single-council file or a higher level such as MSOA. The Shape map visual plots at most 1,500 areas. |

## Attribution

If you publish a map made with these files, include:

> Source: Office for National Statistics licensed under the Open Government Licence v.3.0.
> Contains OS data © Crown copyright and database right 2026.
