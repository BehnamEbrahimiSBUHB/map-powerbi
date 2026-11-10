// Writes made-up sample data for every census level and year, one CSV each.
// The numbers are NOT real statistics. They exist to demo the maps in the
// dashboard and to give Power BI users something to load.
//
// Usage: bun run scripts/synthetic.ts   (run `bun run build` first)

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { readFeatures, type Feature } from "./geojson.ts";
import { syntheticFile } from "./paths.ts";
import { COUNCILS, SOURCES, type Council, type Level, type Source } from "./sources.ts";

interface Row {
  readonly code: string;
  readonly name: string;
  readonly council: string;
  readonly population: number;
  readonly medianAge: number;
  readonly indexScore: number;
}

type Point = readonly [number, number];

const ROOT = join(import.meta.dir, "..");
const CACHE_DIR = join(ROOT, ".cache", "ons");
const DATA_DIR = join(ROOT, "data", "synthetic");

// Rough town-centre positions (longitude, latitude). They only give the fake
// numbers a believable town-to-countryside pattern.
const TOWN_CENTRES: readonly Point[] = [
  [-3.943, 51.621], // Swansea
  [-3.804, 51.663], // Neath
  [-3.782, 51.594], // Port Talbot
];
const URBAN_REACH_KM = 4;
const KM_PER_DEGREE_LAT = 111.2;

const TYPICAL_POPULATION: Readonly<Record<Level, number>> = {
  oa: 310,
  lsoa: 1600,
  msoa: 7800,
  council: 190000,
};

// ---------- pure helpers ----------

/** FNV-1a, so each area code always gives the same numbers. */
const hash = (text: string): number =>
  [...text].reduce((acc, char) => Math.imul(acc ^ char.charCodeAt(0), 16777619) >>> 0, 2166136261);

/** mulberry32 generator: returns the next value in [0, 1) and the next state. */
const nextRandom = (state: number): readonly [number, number] => {
  const next = (state + 0x6d2b79f5) >>> 0;
  const a = Math.imul(next ^ (next >>> 15), next | 1);
  const b = a ^ (a + Math.imul(a ^ (a >>> 7), a | 61));
  return [((b ^ (b >>> 14)) >>> 0) / 4294967296, next];
};

const randoms = (seed: number, count: number): readonly number[] =>
  Array.from({ length: count }).reduce<{ values: number[]; state: number }>(
    ({ values, state }) => {
      const [value, next] = nextRandom(state);
      return { values: [...values, value], state: next };
    },
    { values: [], state: seed },
  ).values;

const isPoint = (value: unknown): value is Point =>
  Array.isArray(value) && typeof value[0] === "number" && typeof value[1] === "number";

/** Every coordinate pair in a geometry, however deeply its rings are nested. */
const points = (coordinates: unknown): readonly Point[] =>
  isPoint(coordinates)
    ? [coordinates]
    : Array.isArray(coordinates)
      ? coordinates.flatMap(points)
      : [];

const centre = (feature: Feature): Point => {
  const all = points((feature.geometry as { coordinates?: unknown }).coordinates);
  if (all.length === 0) {
    throw new Error(`Area has no coordinates: ${JSON.stringify(feature.properties)}`);
  }
  return [
    all.reduce((sum, [lon]) => sum + lon, 0) / all.length,
    all.reduce((sum, [, lat]) => sum + lat, 0) / all.length,
  ];
};

const distanceKm = ([lonA, latA]: Point, [lonB, latB]: Point): number => {
  const kmPerDegreeLon = KM_PER_DEGREE_LAT * Math.cos((latA * Math.PI) / 180);
  return Math.hypot((lonA - lonB) * kmPerDegreeLon, (latA - latB) * KM_PER_DEGREE_LAT);
};

/** 1 in a town centre, falling towards 0 in the countryside. */
const urbanness = (point: Point): number =>
  Math.exp(-Math.min(...TOWN_CENTRES.map((town) => distanceKm(point, town))) / URBAN_REACH_KM);

const round1 = (value: number): number => Math.round(value * 10) / 10;
const clamp = (value: number, low: number, high: number): number =>
  Math.min(high, Math.max(low, value));

const text = (value: unknown): string => (typeof value === "string" ? value : "");

const toRow = (feature: Feature, source: Source, council: Council): Row => {
  const code = text(feature.properties[source.codeField]);
  if (code === "") {
    throw new Error(`Area without ${source.codeField} in ${source.service}`);
  }
  const [a = 0, b = 0, c = 0] = randoms(hash(code), 3);
  const urban = urbanness(centre(feature));
  return {
    code,
    name: text(feature.properties[source.fields[1] ?? ""]),
    council: council.name,
    population: Math.round(TYPICAL_POPULATION[source.level] * (0.75 + 0.5 * a)),
    medianAge: round1(46 - 14 * urban + 6 * (b - 0.5)),
    indexScore: round1(clamp(15 + 60 * urban + 30 * (c - 0.5), 0, 100)),
  };
};

const csvCell = (value: string | number): string => {
  const cell = String(value);
  return /[",\n]/.test(cell) ? `"${cell.replaceAll('"', '""')}"` : cell;
};

const toCsv = (rows: readonly Row[], source: Source): string => {
  const nameField = source.fields[1];
  const header = [
    source.codeField,
    ...(nameField === undefined ? [] : [nameField]),
    "council",
    "population",
    "median_age",
    "index_score",
  ];
  const lines = rows.map((row) => [
    row.code,
    ...(nameField === undefined ? [] : [row.name]),
    row.council,
    row.population,
    row.medianAge,
    row.indexScore,
  ]);
  return `${[header, ...lines].map((line) => line.map(csvCell).join(",")).join("\n")}\n`;
};

// ---------- I/O ----------

const buildSource = async (source: Source): Promise<readonly [string, number]> => {
  const perCouncil = await Promise.all(
    COUNCILS.map(async (council) => {
      const features = await readFeatures(
        join(CACHE_DIR, source.service, `${council.slug}.geojson`),
      );
      return features.map((feature) => toRow(feature, source, council));
    }),
  );
  const rows = perCouncil.flat().toSorted((a, b) => a.code.localeCompare(b.code));
  const file = syntheticFile(source);
  await mkdir(DATA_DIR, { recursive: true });
  await writeFile(join(DATA_DIR, file), toCsv(rows, source));
  return [file, rows.length];
};

const main = async (): Promise<void> => {
  const written = await Promise.all(
    SOURCES.filter((source) => source.level !== "council").map(buildSource),
  );
  console.table(written.map(([file, rows]) => ({ file: join("data", "synthetic", file), rows })));
};

await main();
