// Downloads ONS boundaries for each council, then writes Power BI shape map files
// (TopoJSON) and preview images (SVG) per council and for the two combined: one
// geographic map, plus one hex map per method in scripts/hex.R.
//
// Usage: bun run scripts/build.ts [--refresh] [--rehex]
//   --refresh  download again instead of reusing files in .cache/ons/
//   --rehex    recompute hexagons instead of reusing files in .cache/hex/

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import mapshaper from "mapshaper";
import {
  collection,
  isFeatureCollection,
  readFeatures,
  type Feature,
  type FeatureCollection,
} from "./geojson.ts";
import {
  COUNCILS,
  ONS_SERVICES_URL,
  SOURCES,
  type Council,
  type Filter,
  type HexMethod,
  type Level,
  type MapType,
  type Source,
} from "./sources.ts";
import { COMBINED_SLUG, mapTypes, outputStem } from "./paths.ts";

interface BuiltFile {
  readonly path: string;
  readonly areas: number;
  readonly bytes: number;
}

/** One council's areas. A group is one council, or every council for the combined files. */
type Members = readonly (readonly [Council, readonly Feature[]])[];

interface Options {
  readonly refresh: boolean;
  readonly rehex: boolean;
}

const ROOT = join(import.meta.dir, "..");
const CACHE_DIR = join(ROOT, ".cache", "ons");
const HEX_CACHE_DIR = join(ROOT, ".cache", "hex");
const HEX_SCRIPT = join(import.meta.dir, "hex.R");
// Set RSCRIPT to use an R installation that is not on the PATH.
const RSCRIPT = process.env.RSCRIPT ?? "Rscript";
// Property scripts/hex.R reads to tell councils apart. Never written to the map files.
const COUNCIL_PROPERTY = "council";
const MAPS_DIR = join(ROOT, "maps");
const IMAGES_DIR = join(ROOT, "images");
const PAGE_SIZE = 1000;
const IMAGE_WIDTH = 800;
// At this width a pixel covers roughly 70 m, so finer detail only bloats the images.
const IMAGE_DETAIL_METRES = 40;

// Thinner borders for smaller areas so dense town centres stay readable.
const STROKE_WIDTH: Readonly<Record<Level, number>> = {
  oa: 0.2,
  lsoa: 0.5,
  msoa: 0.8,
  council: 1,
};

// ---------- pure helpers ----------

const whereClause = (filter: Filter, council: Council): string => {
  switch (filter.kind) {
    case "namePrefix":
      // Trailing space stops "Swansea" matching a longer council name.
      return `${filter.field} LIKE '${council.name} %'`;
    case "ladCode":
      return `${filter.field} = '${council.ladCode}'`;
    case "oldCodePrefix":
      return `${filter.field} LIKE '${council.oldCode}%'`;
  }
};

const queryUrl = (source: Source, params: Readonly<Record<string, string>>): string =>
  `${ONS_SERVICES_URL}/${source.service}/FeatureServer/0/query?${new URLSearchParams(params)}`;

const pick = (
  properties: Readonly<Record<string, unknown>>,
  fields: readonly string[],
): Record<string, unknown> => Object.fromEntries(fields.map((field) => [field, properties[field]]));

const mapFeatures = (features: readonly Feature[], source: Source): readonly Feature[] =>
  features.map((feature) => ({
    type: "Feature",
    properties: pick(feature.properties, source.fields),
    geometry: feature.geometry,
  }));

// mapshaper draws SVG shapes using these property names as style attributes.
const imageFeatures = (
  features: readonly Feature[],
  council: Council,
  level: Level,
): readonly Feature[] =>
  features.map((feature) => ({
    type: "Feature",
    properties: { fill: council.fill, stroke: "#ffffff", "stroke-width": STROKE_WIDTH[level] },
    geometry: feature.geometry,
  }));

const imageCommands = (type: MapType): string =>
  type === "geographic"
    ? // British National Grid, so the image is not stretched as raw longitude/latitude would be.
      `-proj EPSG:27700 -simplify interval=${IMAGE_DETAIL_METRES} keep-shapes`
    : // Web Mercator, the projection the hexagons were made in, so they are drawn regular.
      "-proj EPSG:3857";

// The hex script needs to know each area's council to keep councils in one piece.
const hexInputFeatures = (members: Members, source: Source): readonly Feature[] =>
  members.flatMap(([council, features]) =>
    features.map((feature) => ({
      type: "Feature" as const,
      properties: { ...pick(feature.properties, source.fields), [COUNCIL_PROPERTY]: council.slug },
      geometry: feature.geometry,
    })),
  );

const splitByCouncil = (features: readonly Feature[], members: Members): Members =>
  members.map(
    ([council]) =>
      [
        council,
        features.filter((feature) => feature.properties[COUNCIL_PROPERTY] === council.slug),
      ] as const,
  );

// ---------- I/O ----------

const fetchJson = async (url: string): Promise<unknown> => {
  const response = await fetch(url, { signal: AbortSignal.timeout(60_000) });
  if (!response.ok) {
    throw new Error(`ONS request failed with HTTP ${response.status}: ${url}`);
  }
  const body: unknown = await response.json();
  // ArcGIS reports query errors in the body of a 200 response.
  if (typeof body === "object" && body !== null && "error" in body) {
    throw new Error(`ONS query error ${JSON.stringify(body.error)}: ${url}`);
  }
  return body;
};

const fetchCount = async (source: Source, where: string): Promise<number> => {
  const body = await fetchJson(queryUrl(source, { where, returnCountOnly: "true", f: "json" }));
  const count = (body as { count?: unknown }).count;
  if (typeof count !== "number") {
    throw new Error(`No count returned for ${source.service} where ${where}`);
  }
  return count;
};

const fetchPages = async (
  source: Source,
  where: string,
  offset = 0,
): Promise<readonly Feature[]> => {
  const body = await fetchJson(
    queryUrl(source, {
      where,
      outFields: source.fields.join(","),
      orderByFields: source.codeField,
      resultOffset: String(offset),
      resultRecordCount: String(PAGE_SIZE),
      // About 0.1 m, well inside the 20 m generalisation of the source.
      geometryPrecision: "6",
      f: "geojson",
    }),
  );
  if (!isFeatureCollection(body)) {
    throw new Error(`Unexpected response shape from ${source.service}`);
  }
  return body.features.length < PAGE_SIZE
    ? body.features
    : [...body.features, ...(await fetchPages(source, where, offset + PAGE_SIZE))];
};

const download = async (source: Source, council: Council): Promise<readonly Feature[]> => {
  const where = whereClause(source.filter, council);
  const [expected, features] = await Promise.all([
    fetchCount(source, where),
    fetchPages(source, where),
  ]);
  if (expected === 0 || features.length !== expected) {
    throw new Error(
      `${source.service}: expected ${expected} areas for ${council.name}, got ${features.length}`,
    );
  }
  return features;
};

const loadFeatures = async (
  source: Source,
  council: Council,
  refresh: boolean,
): Promise<readonly Feature[]> => {
  const cachePath = join(CACHE_DIR, source.service, `${council.slug}.geojson`);
  if (!refresh && (await Bun.file(cachePath).exists())) {
    return readFeatures(cachePath);
  }
  const features = await download(source, council);
  await mkdir(dirname(cachePath), { recursive: true });
  await writeFile(cachePath, JSON.stringify(collection(features)));
  return features;
};

const convert = async (
  input: FeatureCollection,
  commands: string,
  outputName: string,
): Promise<string | Uint8Array> => {
  const outputs = await mapshaper.applyCommands(
    `-i in.geojson ${commands} ${outputName} -quiet`,
    { "in.geojson": JSON.stringify(input) },
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
  source: Source,
  slug: string,
  method: HexMethod,
  members: Members,
  recompute: boolean,
): Promise<Members> => {
  const name = `${slug}-${source.level}-${source.year}.geojson`;
  const hexPath = join(HEX_CACHE_DIR, method, name);
  if (recompute || !(await Bun.file(hexPath).exists())) {
    const inputPath = join(HEX_CACHE_DIR, "input", method, name);
    await writeOutput(inputPath, JSON.stringify(collection(hexInputFeatures(members, source))));
    await runHexScript(method, inputPath, hexPath);
  }
  const hexagons = await readFeatures(hexPath);
  const expected = members.flatMap(([, features]) => features).length;
  if (hexagons.length !== expected) {
    throw new Error(`${hexPath}: expected ${expected} hexagons, got ${hexagons.length}`);
  }
  return splitByCouncil(hexagons, members);
};

const buildGroup = async (
  source: Source,
  slug: string,
  type: MapType,
  members: Members,
): Promise<BuiltFile> => {
  const stem = outputStem(source, slug, type);
  const layer = `${source.level}_${source.year}`;
  const all = members.flatMap(([, features]) => features);

  const topojson = await convert(
    collection(mapFeatures(all, source)),
    `name=${layer} -o format=topojson id-field=${source.codeField}`,
    "out.json",
  );
  const svg = await convert(
    collection(
      members.flatMap(([council, features]) => imageFeatures(features, council, source.level)),
    ),
    `${imageCommands(type)} -o format=svg width=${IMAGE_WIDTH} margin=4`,
    "out.svg",
  );

  const bytes = await writeOutput(join(MAPS_DIR, `${stem}.json`), topojson);
  await writeOutput(join(IMAGES_DIR, `${stem}.svg`), svg);
  return { path: join("maps", `${stem}.json`), areas: all.length, bytes };
};

const buildSource = async (source: Source, options: Options): Promise<readonly BuiltFile[]> => {
  const members: Members = await Promise.all(
    COUNCILS.map(
      async (council) => [council, await loadFeatures(source, council, options.refresh)] as const,
    ),
  );
  const groups: readonly (readonly [string, Members])[] = [
    ...members.map((member) => [member[0].slug, [member]] as const),
    [COMBINED_SLUG, members],
  ];
    return Promise.all(
    groups.flatMap(([slug, group]) => [
      ...mapTypes(source).map(async (type) =>
        buildGroup(
          source,
          slug,
          type,
          type === "geographic"
            ? group
            : await loadHexMembers(source, slug, type, group, options.rehex),
        ),
      ),
    ]),
  );
};

const main = async (): Promise<void> => {
  const refresh = process.argv.includes("--refresh");
  // New downloads make the cached hexagons stale, so a refresh recomputes them too.
  const options: Options = { refresh, rehex: refresh || process.argv.includes("--rehex") };
  // One source at a time keeps the load on the ONS servers light.
  const built: BuiltFile[] = [];
  for (const source of SOURCES) {
    built.push(...(await buildSource(source, options)));
  }
  console.table(
    built.map(({ path, areas, bytes }) => ({ file: path, areas, kB: Math.round(bytes / 1024) })),
  );
};

await main();
