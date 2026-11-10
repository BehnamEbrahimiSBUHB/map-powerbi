// Downloads boundary layers and caches them in .cache/. Each download is one
// selector of one source, so areas that share a council share the download.

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { collection, isFeatureCollection, readFeatures, type Feature } from "./geojson.ts";
import {
  DATAMAPWALES_WFS_URL,
  ONS_SERVICES_URL,
  type Selector,
  type Source,
} from "./sources.ts";

const ROOT = join(import.meta.dir, "..");
const CACHE_DIR = join(ROOT, ".cache");
const PAGE_SIZE = 1000;
const REQUEST_TIMEOUT_MS = 120_000;

// ---------- pure helpers ----------

/** Name of an output field in the layer itself. */
const layerField = (source: Source, field: string): string => source.layerFields?.[field] ?? field;

/** The parent place of a selector's areas: a council, a nation, or the layer's coverage. */
export const selectorLabel = (selector: Selector): string =>
  selector.kind === "council" ? selector.council.name : selector.label;

const selectorKey = (selector: Selector): string => {
  switch (selector.kind) {
    case "council":
      return selector.council.slug;
    case "codePrefix":
      return `prefix-${selector.prefix}`;
    case "codes":
      return `codes-${selector.codes.join("-")}`;
    case "all":
      return "all";
  }
};

const required = (value: string | undefined, what: string): string => {
  if (value === undefined) {
    throw new Error(`Configuration is missing ${what}`);
  }
  return value;
};

const whereClause = (source: Source, selector: Selector): string => {
  switch (selector.kind) {
    case "all":
      return "1=1";
    case "codePrefix":
      return `${layerField(source, source.codeField)} LIKE '${selector.prefix}%'`;
    case "codes":
      return `${layerField(source, source.codeField)} IN (${selector.codes.map((code) => `'${code}'`).join(", ")})`;
    case "council": {
      const { council } = selector;
      if (source.filter === undefined) {
        throw new Error(`${source.service} has no filter for picking out one council`);
      }
      switch (source.filter.kind) {
        case "namePrefix":
          // Trailing space stops "Swansea" matching a longer council name.
          return `${source.filter.field} LIKE '${council.name} %'`;
        case "ladCode":
          return `${source.filter.field} = '${required(council.ladCode, `ladCode of ${council.name}`)}'`;
        case "oldCodePrefix":
          return `${source.filter.field} LIKE '${required(council.oldCode, `oldCode of ${council.name}`)}%'`;
      }
    }
  }
};

/** Keeps only the configured fields, under their output names. */
const normalise = (feature: Feature, source: Source): Feature => ({
  type: "Feature",
  properties: Object.fromEntries(
    source.fields.map((field) => [field, feature.properties[layerField(source, field)] ?? null]),
  ),
  geometry: feature.geometry,
});

// ---------- I/O ----------

const fetchJson = async (url: string): Promise<unknown> => {
  const response = await fetch(url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  if (!response.ok) {
    throw new Error(`Request failed with HTTP ${response.status}: ${url}`);
  }
  const body: unknown = await response.json();
  // ArcGIS reports query errors in the body of a 200 response.
  if (typeof body === "object" && body !== null && "error" in body) {
    throw new Error(`Query error ${JSON.stringify(body.error)}: ${url}`);
  }
  return body;
};

const onsUrl = (source: Source, params: Readonly<Record<string, string>>): string =>
  `${ONS_SERVICES_URL}/${source.service}/FeatureServer/0/query?${new URLSearchParams(params)}`;

const fetchOnsCount = async (source: Source, where: string): Promise<number> => {
  const body = await fetchJson(onsUrl(source, { where, returnCountOnly: "true", f: "json" }));
  const count = (body as { count?: unknown }).count;
  if (typeof count !== "number") {
    throw new Error(`No count returned for ${source.service} where ${where}`);
  }
  return count;
};

// A page can come back short of PAGE_SIZE when its shapes are large, so keep
// asking until every expected row has arrived.
const fetchOnsPages = async (
  source: Source,
  where: string,
  expected: number,
  collected: readonly Feature[] = [],
): Promise<readonly Feature[]> => {
  if (collected.length >= expected) {
    return collected;
  }
  const body = await fetchJson(
    onsUrl(source, {
      where,
      outFields: source.fields.map((field) => layerField(source, field)).join(","),
      orderByFields: layerField(source, source.codeField),
      resultOffset: String(collected.length),
      resultRecordCount: String(PAGE_SIZE),
      // About 0.1 m, well inside the 20 m generalisation of the layers.
      geometryPrecision: "6",
      f: "geojson",
    }),
  );
  if (!isFeatureCollection(body) || body.features.length === 0) {
    throw new Error(`${source.service}: got ${collected.length} of ${expected} rows where ${where}`);
  }
  return fetchOnsPages(source, where, expected, [...collected, ...body.features]);
};

const downloadOns = async (source: Source, selector: Selector): Promise<readonly Feature[]> => {
  const where = whereClause(source, selector);
  const expected = await fetchOnsCount(source, where);
  if (expected === 0) {
    throw new Error(`${source.service}: nothing matches ${where}`);
  }
  const features = await fetchOnsPages(source, where, expected);
  if (features.length !== expected) {
    throw new Error(`${source.service}: expected ${expected} rows where ${where}, got ${features.length}`);
  }
  return features;
};

const downloadDataMapWales = async (
  source: Source,
  selector: Selector,
): Promise<readonly Feature[]> => {
  if (selector.kind !== "all") {
    throw new Error(`${source.service}: DataMapWales layers are only downloaded whole`);
  }
  const query = new URLSearchParams({
    service: "WFS",
    version: "1.1.0",
    request: "GetFeature",
    typeName: source.service,
    outputFormat: "application/json",
    // Longitude then latitude, the order GeoJSON expects.
    srsName: "EPSG:4326",
  });
  const body = await fetchJson(`${DATAMAPWALES_WFS_URL}?${query}`);
  if (!isFeatureCollection(body) || body.features.length === 0) {
    throw new Error(`${source.service}: no features returned`);
  }
  const total = (body as { totalFeatures?: unknown }).totalFeatures;
  if (typeof total === "number" && total !== body.features.length) {
    throw new Error(`${source.service}: expected ${total} features, got ${body.features.length}`);
  }
  return body.features;
};

const cachePath = (source: Source, selector: Selector): string =>
  join(
    CACHE_DIR,
    source.provider,
    source.service.replaceAll(":", "_"),
    `${selectorKey(selector)}.geojson`,
  );

const loads = new Map<string, Promise<readonly Feature[]>>();

// DataMapWales layers are only downloaded whole, so picking by code filters that download.
const pickCodes = async (
  source: Source,
  selector: Extract<Selector, { kind: "codes" }>,
  refresh: boolean,
): Promise<readonly Feature[]> => {
  const all = await loadSelector(source, { kind: "all", label: selector.label }, refresh);
  const picked = all.filter((feature) =>
    selector.codes.includes(String(feature.properties[source.codeField])),
  );
  if (picked.length !== selector.codes.length) {
    throw new Error(
      `${source.service}: found ${picked.length} of the ${selector.codes.length} codes ${selector.codes.join(", ")}`,
    );
  }
  return picked;
};

/** The areas of one selector, with only the configured fields. Cached on disk and in memory. */
export const loadSelector = (
  source: Source,
  selector: Selector,
  refresh: boolean,
): Promise<readonly Feature[]> => {
  if (source.provider === "datamapwales" && selector.kind === "codes") {
    return pickCodes(source, selector, refresh);
  }
  const path = cachePath(source, selector);
  const running = loads.get(path);
  if (running !== undefined) {
    return running;
  }
  const load = (async () => {
    if (!refresh && (await Bun.file(path).exists())) {
      return readFeatures(path);
    }
    const raw =
      source.provider === "ons"
        ? await downloadOns(source, selector)
        : await downloadDataMapWales(source, selector);
    const features = raw.map((feature) => normalise(feature, source));
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, JSON.stringify(collection(features)));
    return features;
  })();
  loads.set(path, load);
  return load;
};
