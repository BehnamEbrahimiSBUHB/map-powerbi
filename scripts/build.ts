// Downloads ONS boundaries for each council, then writes a Power BI shape map file
// (TopoJSON) and a preview image (SVG) per council and for the two combined.
//
// Usage: bun run scripts/build.ts [--refresh]
//   --refresh  download again instead of reusing files in .cache/

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import mapshaper from "mapshaper";
import {
  COUNCILS,
  ONS_SERVICES_URL,
  SOURCES,
  type Council,
  type Filter,
  type Level,
  type Source,
} from "./sources.ts";

interface Feature {
  readonly type: "Feature";
  readonly properties: Readonly<Record<string, unknown>>;
  readonly geometry: unknown;
}

interface FeatureCollection {
  readonly type: "FeatureCollection";
  readonly features: readonly Feature[];
}

interface BuiltFile {
  readonly path: string;
  readonly areas: number;
  readonly bytes: number;
}

const ROOT = join(import.meta.dir, "..");
const CACHE_DIR = join(ROOT, ".cache", "ons");
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

const collection = (features: readonly Feature[]): FeatureCollection => ({
  type: "FeatureCollection",
  features,
});

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

const outputStem = (source: Source, slug: string): string =>
  join(
    source.level === "council" ? "council" : String(source.year),
    `${slug}-${source.level}-${source.year}`,
  );

const isFeatureCollection = (value: unknown): value is FeatureCollection =>
  typeof value === "object" &&
  value !== null &&
  (value as { type?: unknown }).type === "FeatureCollection" &&
  Array.isArray((value as { features?: unknown }).features);

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
  const cached = Bun.file(cachePath);
  if (!refresh && (await cached.exists())) {
    const parsed: unknown = JSON.parse(await readFile(cachePath, "utf8"));
    if (!isFeatureCollection(parsed)) {
      throw new Error(`Cache file is not a FeatureCollection: ${cachePath}`);
    }
    return parsed.features;
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

const buildGroup = async (
  source: Source,
  slug: string,
  members: readonly (readonly [Council, readonly Feature[]])[],
): Promise<BuiltFile> => {
  const stem = outputStem(source, slug);
  const layer = `${source.level}_${source.year}`;
  const all = members.flatMap(([, features]) => features);

  const topojson = await convert(
    collection(mapFeatures(all, source)),
    `name=${layer} -o format=topojson id-field=${source.codeField}`,
    "out.json",
  );
  // British National Grid, so the image is not stretched as raw longitude/latitude would be.
  const svg = await convert(
    collection(
      members.flatMap(([council, features]) => imageFeatures(features, council, source.level)),
    ),
    `-proj EPSG:27700 -simplify interval=${IMAGE_DETAIL_METRES} keep-shapes ` +
      `-o format=svg width=${IMAGE_WIDTH} margin=4`,
    "out.svg",
  );

  const mapPath = join(MAPS_DIR, `${stem}.json`);
  const bytes = await writeOutput(mapPath, topojson);
  await writeOutput(join(IMAGES_DIR, `${stem}.svg`), svg);
  return { path: join("maps", `${stem}.json`), areas: all.length, bytes };
};

const buildSource = async (source: Source, refresh: boolean): Promise<readonly BuiltFile[]> => {
  const members = await Promise.all(
    COUNCILS.map(
      async (council) => [council, await loadFeatures(source, council, refresh)] as const,
    ),
  );
  const single = members.map((member) => buildGroup(source, member[0].slug, [member]));
  const combined = buildGroup(source, COUNCILS.map((council) => council.slug).join("-and-"), members);
  return Promise.all([...single, combined]);
};

const main = async (): Promise<void> => {
  const refresh = process.argv.includes("--refresh");
  // One source at a time keeps the load on the ONS servers light.
  const built: BuiltFile[] = [];
  for (const source of SOURCES) {
    built.push(...(await buildSource(source, refresh)));
  }
  console.table(
    built.map(({ path, areas, bytes }) => ({ file: path, areas, kB: Math.round(bytes / 1024) })),
  );
};

await main();
