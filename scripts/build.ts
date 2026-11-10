// Builds every map file: downloads the boundaries of each area, then writes
// Power BI shape map files (TopoJSON) and preview images (SVG), one geographic
// map plus one hex map per method in scripts/hex.R.
//
// Usage: bun run scripts/build.ts [--refresh] [--rehex] [--only=<set key>]
//   --refresh  download again instead of reusing files in .cache/
//   --rehex    recompute hexagons instead of reusing files in .cache/hex/
//   --only     build one map set from scripts/sources.ts, e.g. --only=wales-clusters

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import mapshaper from "mapshaper";
import { loadSelector } from "./download.ts";
import { collection, isFeatureCollection, readFeatures, type Feature } from "./geojson.ts";
import { MAP_GROUPS, outputStem, type MapGroup } from "./paths.ts";
import { PALETTE, type HexMethod, type MapType, type Part, type Source } from "./sources.ts";

interface BuiltFile {
  readonly path: string;
  readonly areas: number;
  readonly bytes: number;
}

/** The shapes of one map file, by part. */
type Members = readonly (readonly [Part, readonly Feature[]])[];

interface Options {
  readonly refresh: boolean;
  readonly rehex: boolean;
}

const ROOT = join(import.meta.dir, "..");
const MAPS_DIR = join(ROOT, "maps");
const IMAGES_DIR = join(ROOT, "images");
const HEX_CACHE_DIR = join(ROOT, ".cache", "hex");
const HEX_SCRIPT = join(import.meta.dir, "hex.R");
// Set RSCRIPT to use an R installation that is not on the PATH.
const RSCRIPT = process.env.RSCRIPT ?? "Rscript";
// Property that carries each shape's part through mapshaper and scripts/hex.R.
// Never written to the map files.
const PART_PROPERTY = "council";
const IMAGE_WIDTH = 800;

// ---------- pure helpers ----------

const pick = (
  properties: Readonly<Record<string, unknown>>,
  fields: readonly string[],
): Record<string, unknown> => Object.fromEntries(fields.map((field) => [field, properties[field]]));

const count = (members: Members): number =>
  members.reduce((sum, [, features]) => sum + features.length, 0);

const mapFeatures = (members: Members, source: Source): readonly Feature[] =>
  members.flatMap(([, features]) =>
    features.map((feature) => ({
      type: "Feature" as const,
      properties: pick(feature.properties, source.fields),
      geometry: feature.geometry,
    })),
  );

/** Shapes tagged with their part, for steps that work on the whole file at once. */
const taggedFeatures = (members: Members, source: Source): readonly Feature[] =>
  members.flatMap(([part, features]) =>
    features.map((feature) => ({
      type: "Feature" as const,
      properties: { ...pick(feature.properties, source.fields), [PART_PROPERTY]: part.key },
      geometry: feature.geometry,
    })),
  );

const splitByPart = (features: readonly Feature[], members: Members): Members =>
  members.map(
    ([part]) =>
      [part, features.filter((feature) => feature.properties[PART_PROPERTY] === part.key)] as const,
  );

// Thinner borders where there are more shapes, so dense places stay readable.
const strokeWidth = (shapes: number): number =>
  shapes > 1000 ? 0.2 : shapes > 150 ? 0.4 : shapes > 40 ? 0.6 : 1;

// mapshaper draws SVG shapes using these property names as style attributes.
const imageFeatures = (members: Members): readonly Feature[] => {
  const width = strokeWidth(count(members));
  return members.flatMap(([part, features]) =>
    features.map((feature) => ({
      type: "Feature" as const,
      properties: { fill: PALETTE[part.colour], stroke: "#ffffff", "stroke-width": width },
      geometry: feature.geometry,
    })),
  );
};

const imageCommands = (type: MapType): string =>
  type === "geographic"
    ? // British National Grid, so the image is not stretched as raw longitude/latitude
      // would be. Detail finer than a pixel only bloats the file.
      `-proj EPSG:27700 -simplify resolution=${IMAGE_WIDTH} keep-shapes`
    : // Web Mercator, the projection the hexagons were made in, so they are drawn regular.
      "-proj EPSG:3857";

// ---------- I/O ----------

const convert = async (
  features: readonly Feature[],
  commands: string,
  outputName: string,
): Promise<string | Uint8Array> => {
  const outputs = await mapshaper.applyCommands(
    `-i in.geojson ${commands} ${outputName} -quiet`,
    { "in.geojson": JSON.stringify(collection(features)) },
  );
  const output = outputs[outputName];
  if (output === undefined) {
    throw new Error(`mapshaper produced no ${outputName}`);
  }
  return output;
};

const writeOutput = async (path: string, contents: string | Uint8Array): Promise<number> => {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, contents);
  return Bun.file(path).size;
};

const loadMembers = (group: MapGroup, refresh: boolean): Promise<Members> =>
  Promise.all(
    group.area.parts.map(async (part) => {
      const perSelector = await Promise.all(
        part.selectors.map((selector) => loadSelector(group.source, selector, refresh)),
      );
      return [part, perSelector.flat()] as const;
    }),
  );

// Thinning the whole file in one go keeps neighbours sharing the same border.
const simplify = async (members: Members, source: Source): Promise<Members> => {
  if (source.simplify === undefined) {
    return members;
  }
  const output = await convert(
    taggedFeatures(members, source),
    `-simplify ${source.simplify} keep-shapes -o format=geojson`,
    "out.geojson",
  );
  const parsed: unknown = JSON.parse(typeof output === "string" ? output : new TextDecoder().decode(output));
  if (!isFeatureCollection(parsed) || parsed.features.length !== count(members)) {
    throw new Error(`Simplifying ${source.service} lost shapes`);
  }
  return splitByPart(parsed.features, members);
};

const runHexScript = async (method: HexMethod, input: string, output: string): Promise<void> => {
  const child = Bun.spawn([RSCRIPT, "--vanilla", HEX_SCRIPT, method, input, output], {
    stdout: "ignore",
    stderr: "pipe",
  });
  const [exitCode, stderr] = await Promise.all([child.exited, new Response(child.stderr).text()]);
  if (exitCode !== 0) {
    throw new Error(`${method} failed for ${input} (exit ${exitCode}): ${stderr.trim()}`);
  }
};

// Hexagons are slow to compute, so each result is kept in .cache/hex/ and reused.
const loadHexMembers = async (
  group: MapGroup,
  method: HexMethod,
  members: Members,
  recompute: boolean,
): Promise<Members> => {
  const { source, area } = group;
  const name = `${area.slug}-${source.level}-${source.year}.geojson`;
  const hexPath = join(HEX_CACHE_DIR, method, name);
  if (recompute || !(await Bun.file(hexPath).exists())) {
    const inputPath = join(HEX_CACHE_DIR, "input", method, name);
    await writeOutput(inputPath, JSON.stringify(collection(taggedFeatures(members, source))));
    await runHexScript(method, inputPath, hexPath);
  }
  const hexagons = await readFeatures(hexPath);
  if (hexagons.length !== count(members)) {
    throw new Error(`${hexPath}: expected ${count(members)} hexagons, got ${hexagons.length}`);
  }
  return splitByPart(hexagons, members);
};

const writeMap = async (group: MapGroup, type: MapType, members: Members): Promise<BuiltFile> => {
  const { source, area } = group;
  const stem = outputStem(source, area.slug, type);
  const layer = `${source.level.replaceAll("-", "_")}_${source.year}`;

  const topojson = await convert(
    mapFeatures(members, source),
    `name=${layer} -o format=topojson id-field=${source.codeField}`,
    "out.json",
  );
  const svg = await convert(
    imageFeatures(members),
    `${imageCommands(type)} -o format=svg width=${IMAGE_WIDTH} margin=4`,
    "out.svg",
  );

  const bytes = await writeOutput(join(MAPS_DIR, `${stem}.json`), topojson);
  await writeOutput(join(IMAGES_DIR, `${stem}.svg`), svg);
  return { path: `maps/${stem}.json`, areas: count(members), bytes };
};

const buildGroup = async (group: MapGroup, options: Options): Promise<readonly BuiltFile[]> => {
  const members = await simplify(await loadMembers(group, options.refresh), group.source);
  return Promise.all(
    group.set.types.map(async (type) =>
      writeMap(
        group,
        type,
        type === "geographic" ? members : await loadHexMembers(group, type, members, options.rehex),
      ),
    ),
  );
};

const main = async (): Promise<void> => {
  const refresh = process.argv.includes("--refresh");
  // New downloads make the cached hexagons stale, so a refresh recomputes them too.
  const options: Options = { refresh, rehex: refresh || process.argv.includes("--rehex") };
  const only = process.argv.find((arg) => arg.startsWith("--only="))?.slice("--only=".length);
  const groups = MAP_GROUPS.filter((group) => only === undefined || group.set.key === only);
  if (groups.length === 0) {
    throw new Error(`No map set is called ${only}`);
  }

  // One group at a time keeps the load on the data providers light.
  const built: BuiltFile[] = [];
  for (const group of groups) {
    built.push(...(await buildGroup(group, options)));
  }
  console.table(
    built.map(({ path, areas, bytes }) => ({ file: path, areas, kB: Math.round(bytes / 1024) })),
  );
};

await main();
