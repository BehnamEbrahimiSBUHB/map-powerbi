// Checks the committed outputs: every expected map file exists, is a valid
// Power BI shape map, has a preview image, and matches its sample data.
//
// Usage: bun run scripts/check.ts   (exits with code 1 if anything is wrong)

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { GROUP_SLUGS, COMBINED_SLUG, mapTypes, outputStem, syntheticFile } from "./paths.ts";
import { SOURCES, type Source } from "./sources.ts";

interface Topology {
  readonly type: "Topology";
  readonly objects: Readonly<Record<string, { readonly geometries?: readonly { id?: unknown }[] }>>;
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

const idProblems = (path: string, ids: readonly unknown[]): readonly string[] => [
  ...(ids.length === 0 ? [`${path}: no areas`] : []),
  ...(ids.length > MAX_AREAS ? [`${path}: ${ids.length} areas, Power BI plots ${MAX_AREAS}`] : []),
  ...(ids.some((id) => typeof id !== "string" || id === "") ? [`${path}: area without a code`] : []),
  ...(new Set(ids).size !== ids.length ? [`${path}: duplicate area codes`] : []),
];

/** Area codes in the first column of a CSV, skipping the header. */
const csvCodes = (csv: string): readonly string[] =>
  csv
    .trim()
    .split("\n")
    .slice(1)
    .map((line) => line.split(",")[0] ?? "");

// ---------- I/O ----------

const readIds = async (path: string): Promise<readonly unknown[] | string> => {
  const file = Bun.file(join(ROOT, path));
  if (!(await file.exists())) {
    return `${path}: missing`;
  }
  const parsed: unknown = await file.json();
  return isTopology(parsed) ? areaIds(parsed) : `${path}: not TopoJSON`;
};

const checkGroup = async (source: Source, slug: string): Promise<readonly string[]> => {
  const results = await Promise.all(
    mapTypes(source).map(async (type) => {
      const stem = outputStem(source, slug, type);
      const mapPath = `maps/${stem}.json`;
      const imagePath = `images/${stem}.svg`;
      const ids = await readIds(mapPath);
      const imageProblems = (await Bun.file(join(ROOT, imagePath)).exists())
        ? []
        : [`${imagePath}: missing`];
      return typeof ids === "string"
        ? { mapPath, ids: undefined, problems: [ids, ...imageProblems] }
        : { mapPath, ids: new Set(ids), problems: [...idProblems(mapPath, ids), ...imageProblems] };
    }),
  );
  const geographic = results[0]?.ids;
  // A hex map must hold exactly the areas of the map it was made from.
  const mismatches = results
    .slice(1)
    .filter(({ ids }) => ids !== undefined && geographic !== undefined && !sameSet(ids, geographic))
    .map(({ mapPath }) => `${mapPath}: area codes differ from the geographic map`);

  const csvProblems =
    slug === COMBINED_SLUG && source.level !== "council" && geographic !== undefined
      ? await checkSynthetic(source, geographic)
      : [];
  return [...results.flatMap(({ problems }) => problems), ...mismatches, ...csvProblems];
};

const checkSynthetic = async (
  source: Source,
  mapIds: ReadonlySet<unknown>,
): Promise<readonly string[]> => {
  const path = `data/synthetic/${syntheticFile(source)}`;
  if (!(await Bun.file(join(ROOT, path)).exists())) {
    return [`${path}: missing`];
  }
  const codes = new Set<unknown>(csvCodes(await readFile(join(ROOT, path), "utf8")));
  return sameSet(codes, mapIds) ? [] : [`${path}: area codes differ from the map`];
};

const main = async (): Promise<void> => {
  const groups = SOURCES.flatMap((source) => GROUP_SLUGS.map((slug) => [source, slug] as const));
  const problems = (await Promise.all(groups.map(([source, slug]) => checkGroup(source, slug)))).flat();
  const mapCount = SOURCES.reduce(
    (sum, source) => sum + mapTypes(source).length * GROUP_SLUGS.length,
    0,
  );
  if (problems.length > 0) {
    console.error(problems.join("\n"));
    console.error(`${problems.length} problem(s) across ${mapCount} expected map files.`);
    process.exit(1);
  }
  console.info(`All ${mapCount} map files, their images and the sample data are in step.`);
};

await main();
