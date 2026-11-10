// Where each generated file lives. Shared by the build, the checks and the
// dashboard, so it must stay free of Node-only imports.

import { COUNCILS, HEX_LEVELS, HEX_METHODS, type MapType, type Source } from "./sources.ts";

/** Folder and file name for the files that hold every council. */
export const COMBINED_SLUG = COUNCILS.map((council) => council.slug).join("-and-");

/** One group per council, then the combined group. */
export const GROUP_SLUGS: readonly string[] = [
  ...COUNCILS.map((council) => council.slug),
  COMBINED_SLUG,
];

export const mapTypes = (source: Source): readonly MapType[] => [
  "geographic",
  ...HEX_METHODS.filter((method) => HEX_LEVELS[method].includes(source.level)),
];

/**
 * Path without root folder or extension, for example
 * `2021/lsoa/swansea/hexmap/swansea-lsoa-2021-hexmap`.
 * Forward slashes, because the dashboard uses it in URLs.
 */
export const outputStem = (source: Source, slug: string, type: MapType): string => {
  const suffix = type === "geographic" ? "" : `-${type}`;
  return `${source.year}/${source.level}/${slug}/${type}/${slug}-${source.level}-${source.year}${suffix}`;
};

export const syntheticFile = (source: Source): string =>
  `synthetic-${source.level}-${source.year}.csv`;
