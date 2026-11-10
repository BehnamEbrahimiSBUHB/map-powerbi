// Where each generated file lives. Shared by the build, the checks and the
// dashboard, so it must stay free of Node-only imports.

import {
  MAP_SETS,
  type Area,
  type Level,
  type MapSet,
  type MapType,
  type Source,
} from "./sources.ts";

/** One source cut to one area. It becomes one map file per type of its set. */
export interface MapGroup {
  readonly set: MapSet;
  readonly source: Source;
  readonly area: Area;
}

export const MAP_GROUPS: readonly MapGroup[] = MAP_SETS.flatMap((set) =>
  set.sources.flatMap((source) => set.areas.map((area) => ({ set, source, area }))),
);

/**
 * Path without root folder or extension, for example
 * `2021/lsoa/swansea/hexmap/swansea-lsoa-2021-hexmap`.
 * Forward slashes, because the dashboard uses it in URLs.
 */
export const outputStem = (source: Source, slug: string, type: MapType): string => {
  const suffix = type === "geographic" ? "" : `-${type}`;
  return `${source.year}/${source.level}/${slug}/${type}/${slug}-${source.level}-${source.year}${suffix}`;
};

/** Sample data is shared by every map of the same level and year. */
export const syntheticFile = (level: Level, year: number): string =>
  `synthetic-${level}-${year}.csv`;

/** Welsh Index of Multiple Deprivation 2025, one row per 2021 LSOA in Wales. */
export const WIMD_PATH = "data/wimd/wimd-2025-lsoa.csv";
export const WIMD_LEVEL: Level = "lsoa";
export const WIMD_YEAR = 2021;
