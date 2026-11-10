// Checks the committed outputs: every expected map file exists, is a valid
// Power BI shape map, has a preview image, and matches its data files.
//
// Usage: bun run scripts/check.ts   (exits with code 1 if anything is wrong)

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  MAP_GROUPS,
  WIMD_LEVEL,
  WIMD_PATH,
  WIMD_YEAR,
  outputStem,
  syntheticFile,
  type MapGroup,
} from "./paths.ts";

interface Topology {
  readonly type: "Topology";
  readonly objects: Readonly<Record<string, { readonly geometries?: readonly { id?: unknown }[] }>>;
}

interface GroupResult {
  readonly group: MapGroup;
  /** Area codes of the geographic map, when it could be read. */
  readonly ids: ReadonlySet<string> | undefined;
  readonly problems: readonly string[];
}

const ROOT = join(import.meta.dir, "..");
/** The Power BI Shape map visual plots no more areas than this. */
const MAX_AREAS = 1500;

// ---------- pure helpers ----------

const isTopology = (value: unknown): value is Topology =>
  typeof value === "object" &&
  value !== null &&
  (value as { type?: unknown }).type === "Topology" &&
  typeof (value as { objects?: unknown }).objects === "object";

const areaIds = (topology: Topology): readonly unknown[] =>
  Object.values(topology.objects).flatMap((object) =>
    (object.geometries ?? []).map((geometry) => geometry.id),
  );

const sameSet = (a: ReadonlySet<unknown>, b: ReadonlySet<unknown>): boolean =>
  a.size === b.size && [...a].every((value) => b.has(value));

const idProblems = (
  path: string,
  ids: readonly unknown[],
  allowOverLimit: boolean,
): readonly string[] => [
  ...(ids.length === 0 ? [`${path}: no areas`] : []),
  ...(ids.length > MAX_AREAS && !allowOverLimit
    ? [`${path}: ${ids.length} areas, Power BI plots ${MAX_AREAS}`]
    : []),
  ...(ids.some((id) => typeof id !== "string" || id === "") ? [`${path}: area without a code`] : []),
  ...(new Set(ids).size !== ids.length ? [`${path}: duplicate area codes`] : []),
];

/** Area codes in the first column of a CSV, skipping the header. */
const csvCodes = (csv: string): ReadonlySet<string> =>
  new Set(
    csv
      .trim()
      .split("\n")
      .slice(1)
      .map((line) => line.split(",")[0] ?? ""),
  );

// ---------- I/O ----------

const readIds = async (path: string): Promise<readonly unknown[] | string> => {
  const file = Bun.file(join(ROOT, path));
  if (!(await file.exists())) {
    return `${path}: missing`;
  }
  const parsed: unknown = await file.json();
  return isTopology(parsed) ? areaIds(parsed) : `${path}: not TopoJSON`;
};

const readCsvCodes = async (path: string): Promise<ReadonlySet<string> | undefined> =>
  (await Bun.file(join(ROOT, path)).exists())
    ? csvCodes(await readFile(join(ROOT, path), "utf8"))
    : undefined;

const checkGroup = async (group: MapGroup): Promise<GroupResult> => {
  const { set, source, area } = group;
  const results = await Promise.all(
    set.types.map(async (type) => {
      const stem = outputStem(source, area.slug, type);
      const mapPath = `maps/${stem}.json`;
      const imagePath = `images/${stem}.svg`;
      const ids = await readIds(mapPath);
      const imageProblems = (await Bun.file(join(ROOT, imagePath)).exists())
        ? []
        : [`${imagePath}: missing`];
      return typeof ids === "string"
        ? { mapPath, ids: undefined, problems: [ids, ...imageProblems] }
        : {
            mapPath,
            ids: new Set(ids.filter((id): id is string => typeof id === "string")),
            problems: [
              ...idProblems(mapPath, ids, set.overPowerBiLimit === true),
              ...imageProblems,
            ],
          };
    }),
  );
  const geographic = results[0]?.ids;
  // A hex map must hold exactly the areas of the map it was made from.
  const mismatches = results
    .slice(1)
    .filter(({ ids }) => ids !== undefined && geographic !== undefined && !sameSet(ids, geographic))
    .map(({ mapPath }) => `${mapPath}: area codes differ from the geographic map`);
  return {
    group,
    ids: geographic,
    problems: [...results.flatMap(({ problems }) => problems), ...mismatches],
  };
};

/** Every area on a map needs a row in the sample data of its level and year. */
const checkSynthetic = async (results: readonly GroupResult[]): Promise<readonly string[]> => {
  const files = new Map<string, ReadonlySet<string> | undefined>();
  const problems: string[] = [];
  for (const { group, ids } of results) {
    const path = `data/synthetic/${syntheticFile(group.source.level, group.source.year)}`;
    if (!files.has(path)) {
      files.set(path, await readCsvCodes(path));
      if (files.get(path) === undefined) {
        problems.push(`${path}: missing`);
      }
    }
    const codes = files.get(path);
    if (ids !== undefined && codes !== undefined && [...ids].some((id) => !codes.has(id))) {
      problems.push(`${path}: no row for some areas of ${group.area.slug}`);
    }
  }
  return problems;
};

/** WIMD ranks every LSOA in Wales, so it must match the all-Wales LSOA map exactly. */
const checkWimd = async (results: readonly GroupResult[]): Promise<readonly string[]> => {
  const wales = results.find(
    ({ group }) =>
      group.area.slug === "wales" &&
      group.source.level === WIMD_LEVEL &&
      group.source.year === WIMD_YEAR,
  );
  const codes = await readCsvCodes(WIMD_PATH);
  if (codes === undefined) {
    return [`${WIMD_PATH}: missing`];
  }
  if (wales?.ids === undefined) {
    return [`${WIMD_PATH}: no all-Wales LSOA map to compare with`];
  }
  return sameSet(codes, wales.ids) ? [] : [`${WIMD_PATH}: area codes differ from the all-Wales map`];
};

const main = async (): Promise<void> => {
  const results = await Promise.all(MAP_GROUPS.map(checkGroup));
  const problems = [
    ...results.flatMap((result) => result.problems),
    ...(await checkSynthetic(results)),
    ...(await checkWimd(results)),
  ];
  const mapCount = MAP_GROUPS.reduce((sum, group) => sum + group.set.types.length, 0);
  if (problems.length > 0) {
    console.error(problems.join("\n"));
    console.error(`${problems.length} problem(s) across ${mapCount} expected map files.`);
    process.exit(1);
  }
  console.info(`All ${mapCount} map files, their images and the data files are in step.`);
};

await main();
