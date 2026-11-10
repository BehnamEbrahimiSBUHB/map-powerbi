// Minimal GeoJSON types and file reading shared by the build scripts.

import { readFile } from "node:fs/promises";

export interface Feature {
  readonly type: "Feature";
  readonly properties: Readonly<Record<string, unknown>>;
  readonly geometry: unknown;
}

export interface FeatureCollection {
  readonly type: "FeatureCollection";
  readonly features: readonly Feature[];
}

export const collection = (features: readonly Feature[]): FeatureCollection => ({
  type: "FeatureCollection",
  features,
});

export const isFeatureCollection = (value: unknown): value is FeatureCollection =>
  typeof value === "object" &&
  value !== null &&
  (value as { type?: unknown }).type === "FeatureCollection" &&
  Array.isArray((value as { features?: unknown }).features);

export const readFeatures = async (path: string): Promise<readonly Feature[]> => {
  const parsed: unknown = JSON.parse(await readFile(path, "utf8"));
  if (!isFeatureCollection(parsed)) {
    throw new Error(`Not a GeoJSON FeatureCollection: ${path}`);
  }
  return parsed.features;
};
