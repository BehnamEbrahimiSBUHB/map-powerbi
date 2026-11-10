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
maps/<version>/<level>/<area>/<map type>/<file>.json
```

| Part | Choices |
|---|---|
| Version | The year of the boundaries, for example `2021` |
| Level | What one shape is: `oa`, `lsoa`, `msoa`, `council`, `health-board` or `cluster` |
| Area | What the file covers, for example `swansea`, `swansea-bay`, `wales`, `england-and-wales` or `scotland` |
| Map type | `geographic`, `hexmap` or `geogrid` |

The [catalogue](map-files.md) lists every file with a link and its number of shapes.

**Use the version that matches your data.** Area codes changed between censuses. 2021 census data needs a 2021 map.

### Which map type?

| Map type | What it shows | Use it when |
|---|---|---|
| `geographic` | The real boundaries. | Readers need to recognise places. |
| `hexmap` | One equal-sized hexagon per area, following the outline of the map. Each group (council, health board or nation) stays in one piece, with a thin gap between groups. | Small town-centre areas get lost on the real map. |
| `geogrid` | One equal-sized hexagon per area, on a regular grid shaped like the whole map. Each group stays in one piece. | You want a regular grid with no gap between groups. |

On a hex map every area gets the same space, so a large rural area no longer looks more important than a small urban one. A hexagon sits near the real area, not exactly on it.

Hex maps exist for every file except the single-council outlines.

**One file is too big for Power BI.** The all-Wales LSOA file has 1,917 shapes and Power BI plots 1,500. Use a health board file for LSOA maps in Power BI.

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

Each sample file covers every area that has a map of that level and version. Power BI shows only the rows that match the map you load.

## Use real data: WIMD 2025

[`data/wimd/wimd-2025-lsoa.csv`](../data/wimd/wimd-2025-lsoa.csv) holds the Welsh Index of Multiple Deprivation 2025 for all 1,917 LSOAs in Wales. Unlike the sample files, this is real published data.

1. Load the CSV with **Get data > Text/CSV**.
2. Pick a 2021 LSOA map that Power BI can plot: a council file or a health board file, for example `maps/2021/lsoa/swansea-bay/geographic/swansea-bay-lsoa-2021.json`.
3. Use `LSOA21CD` as **Location**.
4. Use a decile column, for example `overall_decile`, as **Color saturation**.

| Column ending | Meaning |
|---|---|
| `_rank` | 1 is the most deprived LSOA in Wales, 1,917 the least. |
| `_decile` | 1 is the most deprived 10%, 10 the least. |
| `_quintile` | 1 is the most deprived 20%, 5 the least. |

Columns start with the domain: `overall`, `income`, `employment`, `health`, `education`, `access_to_services`, `housing`, `community_safety` or `physical_environment`.

Power BI filters the CSV to the areas on the map, so one file works for every Welsh LSOA map.

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
| Council | 2011 | `LAD11CD` | `LAD11NM` | `LAD11NMW` |
| Council | 2021 | `LAD21CD` | `LAD21NM` | `LAD21NMW` |
| Council | 2026 | `LAD26CD` | `LAD26NM` | `LAD26NMW` |
| Health board | 2023 | `LHB23CD` | `LHB23NM` | `LHB23NMW` |
| Cluster | 2019 | `CLUSTERCD` | `CLUSTERNM` | none |
| Cluster | 2024 | `CLUSTERCD` | `CLUSTERNM` | `CLUSTERNMW` |

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
| The map is slow | Use a single-council file or a higher level such as MSOA. |
| Part of the all-Wales LSOA map is missing | The Shape map visual plots at most 1,500 areas and that file has 1,917. Use a health board file. |

## Attribution

If you publish a map made with these files, include:

> Source: Office for National Statistics licensed under the Open Government Licence v.3.0.
> Contains OS data © Crown copyright and database right 2026.

For primary care clusters or WIMD 2025, also include:

> Contains Welsh Government data licensed under the Open Government Licence v.3.0.
