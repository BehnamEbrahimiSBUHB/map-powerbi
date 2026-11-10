# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this repository is

A data repository. It publishes Power BI Shape map files (TopoJSON saved as `.json`) and SVG preview images for Swansea and Neath Port Talbot, built from ONS Open Geography Portal boundaries. `maps/` and `images/` are generated and committed, because users download them straight from GitHub.

## Commands

```sh
bun install
bun run build          # rebuild maps/ and images/, reusing raw downloads in .cache/
bun run build:refresh  # download from ONS again, then rebuild
```

There are no tests and no linter. `tsconfig.json` is strict, but `typescript` and `@types/bun` are not installed, so `tsc` cannot run in the repository as it stands.

## Architecture

Two files under `scripts/`:

- `sources.ts` is the configuration. `SOURCES` lists one ONS FeatureServer layer per level and version (OA, LSOA and MSOA for 2001, 2011 and 2021, plus one council outline). `COUNCILS` lists the two councils. Each source carries a `Filter`, a discriminated union that says how to narrow the England and Wales layer to one council, because the layers do not share a common council field:
  - `namePrefix`: the area name starts with the council name (LSOA, MSOA and 2021 OA).
  - `ladCode`: a council code column (2011 OA and the council outline).
  - `oldCodePrefix`: the pre-2011 OA code starts with the 2001 district code (2001 OA has no other link to a council).
- `build.ts` is pure helpers followed by an I/O section. For each source it downloads each council once (paged GeoJSON, cached in `.cache/ons/<service>/<council>.geojson`), then writes three groups: each council alone and both combined. It throws if the number of downloaded areas differs from the service's own `returnCountOnly` count.

mapshaper is called in-process through `applyCommands` with in-memory files, not through its CLI. `scripts/mapshaper.d.ts` declares only that one function, since mapshaper ships no types.

Each group goes through mapshaper twice with different feature properties:

- Map file: only `source.fields` are kept, as these become the Power BI map keys. Coordinates stay in longitude and latitude, which Power BI expects. `id-field` is set to the area code.
- Preview image: properties are replaced by `fill`, `stroke` and `stroke-width`, which mapshaper turns into SVG style attributes. Geometry is projected to EPSG:27700 and simplified. The simplification applies to images only.

## Things to keep in step

- Output paths are `maps/<year or "council">/<slug>-<level>-<year>.json`, with the same stem under `images/`. `README.md` links to every map file and states the area counts, map key names, ONS service names and download date, so update it whenever `sources.ts` changes or the build output changes.
- The Shape map visual plots at most 1,500 areas. The combined OA files are the closest to that limit.
- The two council fill colours were validated together for colour-blind separation on light and dark backgrounds. Re-validate if either changes.
- ONS data is under the Open Government Licence v3.0. Keep the attribution section in `README.md`.
