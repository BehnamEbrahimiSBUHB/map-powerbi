// The shape of the WIMD 2025 CSV. Shared by the download script and the
// dashboard, so it must stay free of Node-only imports.

/** The overall index and its eight domains, as named in the DataMapWales layers. */
export const WIMD_DOMAINS = [
  "overall",
  "income",
  "employment",
  "health",
  "education",
  "access_to_services",
  "housing",
  "community_safety",
  "physical_environment",
] as const;
export type WimdDomain = (typeof WIMD_DOMAINS)[number];

/** Rank 1 is the most deprived of the 1,917 LSOAs. Decile 1 and quintile 1 are the most deprived groups. */
export const WIMD_MEASURES = ["rank", "decile", "quintile"] as const;
export type WimdMeasure = (typeof WIMD_MEASURES)[number];

export const WIMD_LSOA_COUNT = 1917;

export const WIMD_LABELS: Readonly<Record<WimdDomain, string>> = {
  overall: "Overall index",
  income: "Income",
  employment: "Employment",
  health: "Health",
  education: "Education",
  access_to_services: "Access to services",
  housing: "Housing",
  community_safety: "Community safety",
  physical_environment: "Physical environment",
};

export const wimdColumn = (domain: WimdDomain, measure: WimdMeasure): string =>
  `${domain}_${measure}`;
