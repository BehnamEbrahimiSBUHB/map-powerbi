// Downloads the Welsh Index of Multiple Deprivation (WIMD) 2025 from
// DataMapWales and writes one CSV with a row per 2021 LSOA in Wales.
// These are real published statistics, unlike data/synthetic/.
//
// Usage: bun run scripts/wimd.ts [--refresh]

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { WIMD_PATH } from "./paths.ts";
import { DATAMAPWALES_WFS_URL } from "./sources.ts";
import { WIMD_DOMAINS, WIMD_MEASURES, wimdColumn, type WimdDomain } from "./wimd-columns.ts";

interface Scores {
  readonly lsoa: string;
  readonly nameEn: string;
  readonly nameCy: string;
  readonly values: Readonly<Record<string, number>>;
}

const ROOT = join(import.meta.dir, "..");
const CACHE_DIR = join(ROOT, ".cache", "wimd");
/** WIMD 2025 ranks every 2021 LSOA in Wales. */
const EXPECTED_ROWS = 1917;

// ---------- pure helpers ----------

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const text = (value: unknown): string => (typeof value === "string" ? value : "");

const toScores = (properties: unknown, layer: string): Scores => {
  if (!isRecord(properties) || typeof properties.lsoa !== "string") {
    throw new Error(`${layer}: a row has no LSOA code`);
  }
  const values = Object.fromEntries(
    WIMD_MEASURES.map((measure) => {
      const value = properties[measure];
      if (typeof value !== "number") {
        throw new Error(`${layer}: ${properties.lsoa} has no ${measure}`);
      }
      return [measure, value];
    }),
  );
  return {
    lsoa: properties.lsoa,
    nameEn: text(properties.lsoa_name_en),
    nameCy: text(properties.lsoa_name_cy),
    values,
  };
};

const csvCell = (value: string | number): string => {
  const cell = String(value);
  return /[",\n]/.test(cell) ? `"${cell.replaceAll('"', '""')}"` : cell;
};

const toCsv = (byDomain: ReadonlyMap<WimdDomain, ReadonlyMap<string, Scores>>): string => {
  const overall = byDomain.get("overall");
  if (overall === undefined) {
    throw new Error("The overall index is missing");
  }
  const header = [
    "LSOA21CD",
    "name_en",
    "name_cy",
    ...WIMD_DOMAINS.flatMap((domain) => WIMD_MEASURES.map((measure) => wimdColumn(domain, measure))),
  ];
  const rows = [...overall.values()]
    .toSorted((a, b) => a.lsoa.localeCompare(b.lsoa))
    .map((area) => [
      area.lsoa,
      area.nameEn,
      area.nameCy,
      ...WIMD_DOMAINS.flatMap((domain) => {
        const scores = byDomain.get(domain)?.get(area.lsoa);
        if (scores === undefined) {
          throw new Error(`${area.lsoa} is missing from the ${domain} domain`);
        }
        return WIMD_MEASURES.map((measure) => scores.values[measure] ?? "");
      }),
    ]);
  return `${[header, ...rows].map((row) => row.map(csvCell).join(",")).join("\n")}\n`;
};

// ---------- I/O ----------

const loadDomain = async (domain: WimdDomain, refresh: boolean): Promise<ReadonlyMap<string, Scores>> => {
  const layer = `geonode:wimd2025_${domain}`;
  const cachePath = join(CACHE_DIR, `${domain}.json`);
  if (refresh || !(await Bun.file(cachePath).exists())) {
    const query = new URLSearchParams({
      service: "WFS",
      version: "1.1.0",
      request: "GetFeature",
      typeName: layer,
      // Attributes only: the shapes are already in maps/.
      propertyName: ["lsoa", "lsoa_name_en", "lsoa_name_cy", ...WIMD_MEASURES].join(","),
      outputFormat: "application/json",
    });
    const response = await fetch(`${DATAMAPWALES_WFS_URL}?${query}`, {
      signal: AbortSignal.timeout(120_000),
    });
    if (!response.ok) {
      throw new Error(`${layer}: request failed with HTTP ${response.status}`);
    }
    await mkdir(dirname(cachePath), { recursive: true });
    await writeFile(cachePath, await response.text());
  }
  const body: unknown = JSON.parse(await readFile(cachePath, "utf8"));
  if (!isRecord(body) || !Array.isArray(body.features)) {
    throw new Error(`${layer}: unexpected response shape`);
  }
  const scores = body.features.map((feature: unknown) =>
    toScores(isRecord(feature) ? feature.properties : undefined, layer),
  );
  const byLsoa = new Map(scores.map((row) => [row.lsoa, row]));
  if (byLsoa.size !== EXPECTED_ROWS) {
    throw new Error(`${layer}: expected ${EXPECTED_ROWS} LSOAs, got ${byLsoa.size}`);
  }
  return byLsoa;
};

const main = async (): Promise<void> => {
  const refresh = process.argv.includes("--refresh");
  const domains = await Promise.all(
    WIMD_DOMAINS.map(async (domain) => [domain, await loadDomain(domain, refresh)] as const),
  );
  const path = join(ROOT, WIMD_PATH);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, toCsv(new Map(domains)));
  console.info(`Wrote ${WIMD_PATH}: ${EXPECTED_ROWS} LSOAs, ${WIMD_DOMAINS.length} domains.`);
};

await main();
