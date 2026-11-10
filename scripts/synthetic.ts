// Writes made-up sample data, one CSV per level and year, covering every area
// that has a map. The numbers are NOT real statistics. They exist to demo the
// maps in the dashboard and to give Power BI users something to load.
//
// Usage: bun run scripts/synthetic.ts   (run `bun run build` first)

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { loadSelector, selectorLabel } from "./download.ts";
import type { Feature } from "./geojson.ts";
import { MAP_GROUPS, syntheticFile, type MapGroup } from "./paths.ts";
import type { Level, Source } from "./sources.ts";

interface Row {
  readonly code: string;
  readonly name: string;
  readonly parent: string;
  readonly population: number;
  readonly medianAge: number;
  readonly indexScore: number;
}

type Point = readonly [number, number];

const ROOT = join(import.meta.dir, "..");
const DATA_DIR = join(ROOT, "data", "synthetic");

// Rough city and town positions (longitude, latitude). They only give the fake
// numbers a believable town-to-countryside pattern.
const TOWN_CENTRES: readonly Point[] = [
  [-3.943, 51.621], // Swansea
  [-3.804, 51.663], // Neath
  [-3.782, 51.594], // Port Talbot
  [-3.179, 51.481], // Cardiff
  [-2.998, 51.588], // Newport
  [-2.993, 53.046], // Wrexham
  [-0.128, 51.507], // London
  [-1.898, 52.486], // Birmingham
  [-2.244, 53.481], // Manchester
  [-1.549, 53.801], // Leeds
  [-2.588, 51.455], // Bristol
  [-1.613, 54.978], // Newcastle
  [-4.251, 55.864], // Glasgow
  [-3.188, 55.953], // Edinburgh
  [-5.93, 54.597], // Belfast
];
const KM_PER_DEGREE_LAT = 111.2;

const SMALL_AREA_LEVELS: readonly Level[] = ["oa", "lsoa", "msoa"];

/** How far a town's influence reaches, in km. Larger shapes need a longer reach. */
const urbanReachKm = (level: Level): number => (SMALL_AREA_LEVELS.includes(level) ? 4 : 30);

const TYPICAL_POPULATION: Readonly<Record<Level, number>> = {
  oa: 310,
  lsoa: 1600,
  msoa: 7800,
  cluster: 50000,
  council: 170000,
  "health-board": 450000,
};

const NATIONS: Readonly<Record<string, string>> = {
  E: "England",
  W: "Wales",
  S: "Scotland",
  N: "Northern Ireland",
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
const urbanness = (point: Point, level: Level): number =>
  Math.exp(
    -Math.min(...TOWN_CENTRES.map((town) => distanceKm(point, town))) / urbanReachKm(level),
  );

const round1 = (value: number): number => Math.round(value * 10) / 10;
const clamp = (value: number, low: number, high: number): number =>
  Math.min(high, Math.max(low, value));

const text = (value: unknown): string => (typeof value === "string" ? value : "");

/** Small areas sit under a council. Larger shapes sit under a nation, read from the code. */
const parentOf = (level: Level, code: string, selectorParent: string): string =>
  SMALL_AREA_LEVELS.includes(level) ? selectorParent : (NATIONS[code.charAt(0)] ?? selectorParent);

const parentColumn = (level: Level): string =>
  SMALL_AREA_LEVELS.includes(level) ? "council" : "country";

const toRow = (feature: Feature, source: Source, selectorParent: string): Row => {
  const code = text(feature.properties[source.codeField]);
  if (code === "") {
    throw new Error(`Area without ${source.codeField} in ${source.service}`);
  }
  const [a = 0, b = 0, c = 0] = randoms(hash(code), 3);
  const urban = urbanness(centre(feature), source.level);
  return {
    code,
    name: text(feature.properties[source.fields[1] ?? ""]),
    parent: parentOf(source.level, code, selectorParent),
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
    parentColumn(source.level),
    "population",
    "median_age",
    "index_score",
  ];
  const lines = rows.map((row) => [
    row.code,
    ...(nameField === undefined ? [] : [row.name]),
    row.parent,
    row.population,
    row.medianAge,
    row.indexScore,
  ]);
  return `${[header, ...lines].map((line) => line.map(csvCell).join(",")).join("\n")}\n`;
};

/** One row per area code. The same area can appear in several map files. */
const uniqueByCode = (rows: readonly Row[]): readonly Row[] =>
  [...new Map(rows.map((row) => [row.code, row])).values()].toSorted((a, b) =>
    a.code.localeCompare(b.code),
  );

// ---------- I/O ----------

const groupRows = async ({ source, area }: MapGroup): Promise<readonly Row[]> => {
  const perSelector = await Promise.all(
    area.parts.flatMap((part) =>
      part.selectors.map(async (selector) => {
        const features = await loadSelector(source, selector, false);
        return features.map((feature) => toRow(feature, source, selectorLabel(selector)));
      }),
    ),
  );
  return perSelector.flat();
};

const writeLevelYear = async (groups: readonly MapGroup[]): Promise<readonly [string, number]> => {
  const first = groups[0];
  if (first === undefined) {
    throw new Error("No map groups to write sample data for");
  }
  const rows = uniqueByCode((await Promise.all(groups.map(groupRows))).flat());
  const file = syntheticFile(first.source.level, first.source.year);
  await mkdir(DATA_DIR, { recursive: true });
  await writeFile(join(DATA_DIR, file), toCsv(rows, first.source));
  return [file, rows.length];
};

const main = async (): Promise<void> => {
  const byLevelYear = Map.groupBy(
    MAP_GROUPS,
    ({ source }) => `${source.level}-${source.year}`,
  );
  const written = await Promise.all([...byLevelYear.values()].map(writeLevelYear));
  console.table(
    written
      .toSorted(([a], [b]) => a.localeCompare(b))
      .map(([file, rows]) => ({ file: `data/synthetic/${file}`, rows })),
  );
};

await main();
