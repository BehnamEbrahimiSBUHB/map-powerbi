// Build configuration: which ONS layers to download and how to pick out each council.
// To move to a newer ONS release, change the `service` name (and field names if the
// vintage changes) here, then run `bun run build:refresh`.

/** ONS Open Geography Portal ArcGIS REST root. */
export const ONS_SERVICES_URL =
  "https://services1.arcgis.com/ESMARspQHYMw9BZ9/arcgis/rest/services";

export type Level = "oa" | "lsoa" | "msoa" | "council";

/** R packages that turn each area into one equal-sized hexagon. See scripts/hex.R. */
export type HexMethod = "hexmap" | "geogrid";

/** The kinds of map built for each level, year and council. */
export type MapType = "geographic" | HexMethod;

export const HEX_METHODS: readonly HexMethod[] = ["hexmap", "geogrid"];

/**
 * Levels each hex method is built for. The council outline is left out: it would
 * be one hexagon.
 */
export const HEX_LEVELS: Readonly<Record<HexMethod, readonly Level[]>> = {
  hexmap: ["oa", "lsoa", "msoa"],
  geogrid: ["oa", "lsoa", "msoa"],
};

export interface Council {
  readonly slug: string;
  /** Name as used by ONS, e.g. as the prefix of LSOA names. */
  readonly name: string;
  /** Local authority district code (unchanged since 2011). */
  readonly ladCode: string;
  /** 2001 census district code, the prefix of pre-2011 output area codes. */
  readonly oldCode: string;
  /** Fill colour in the preview images. */
  readonly fill: string;
}

/** How a layer's rows are narrowed to one council. */
export type Filter =
  | { readonly kind: "namePrefix"; readonly field: string }
  | { readonly kind: "ladCode"; readonly field: string }
  | { readonly kind: "oldCodePrefix"; readonly field: string };

export interface Source {
  readonly level: Level;
  /** Boundary vintage. Census year, or release year for the council outline. */
  readonly year: number;
  /** FeatureServer name on the ONS Open Geography Portal. */
  readonly service: string;
  /** Unique area code. Used as the shape id and to order pages. */
  readonly codeField: string;
  /** Properties copied into the map file. These become the Power BI map keys. */
  readonly fields: readonly string[];
  readonly filter: Filter;
}

export const COUNCILS: readonly Council[] = [
  { slug: "swansea", name: "Swansea", ladCode: "W06000011", oldCode: "00NX", fill: "#2a78d6" },
  {
    slug: "neath-port-talbot",
    name: "Neath Port Talbot",
    ladCode: "W06000012",
    oldCode: "00NZ",
    fill: "#d95926",
  },
];

// All layers are BGC: generalised to 20 m and clipped to the coastline, which keeps
// files small enough for Power BI while still looking right at council scale.
export const SOURCES: readonly Source[] = [
  {
    level: "oa",
    year: 2001,
    service: "Output_Areas_Dec_2001_Boundaries_EW_BGC_2022",
    codeField: "OA01CD",
    fields: ["OA01CD"],
    filter: { kind: "oldCodePrefix", field: "OA01CDOLD" },
  },
  {
    level: "lsoa",
    year: 2001,
    service: "Lower_Layer_Super_Output_Areas_Dec_2001_EW_BGC_2022",
    codeField: "LSOA01CD",
    fields: ["LSOA01CD", "LSOA01NM", "LSOA01NMW"],
    filter: { kind: "namePrefix", field: "LSOA01NM" },
  },
  {
    level: "msoa",
    year: 2001,
    service: "Middle_Layer_Super_Output_Areas_Dec_2001_Boundaries_EW_BGC_2022",
    codeField: "MSOA01CD",
    fields: ["MSOA01CD", "MSOA01NM", "MSOA01NMW"],
    filter: { kind: "namePrefix", field: "MSOA01NM" },
  },
  {
    level: "oa",
    year: 2011,
    service: "Output_Areas_Dec_2011_Boundaries_EW_BGC_2022",
    codeField: "OA11CD",
    fields: ["OA11CD"],
    filter: { kind: "ladCode", field: "LAD11CD" },
  },
  {
    level: "lsoa",
    year: 2011,
    service: "LSOA_Dec_2011_Boundaries_Generalised_Clipped_BGC_EW_V3",
    codeField: "LSOA11CD",
    fields: ["LSOA11CD", "LSOA11NM", "LSOA11NMW"],
    filter: { kind: "namePrefix", field: "LSOA11NM" },
  },
  {
    level: "msoa",
    year: 2011,
    service: "MSOA_Dec_2011_Boundaries_Generalised_Clipped_BGC_EW_V3_2022",
    codeField: "MSOA11CD",
    fields: ["MSOA11CD", "MSOA11NM", "MSOA11NMW"],
    filter: { kind: "namePrefix", field: "MSOA11NM" },
  },
  {
    level: "oa",
    year: 2021,
    service: "Output_Areas_2021_EW_BGC_V2",
    codeField: "OA21CD",
    fields: ["OA21CD"],
    filter: { kind: "namePrefix", field: "LSOA21NM" },
  },
  {
    level: "lsoa",
    year: 2021,
    service: "Lower_layer_Super_Output_Areas_December_2021_Boundaries_EW_BGC_V5",
    codeField: "LSOA21CD",
    fields: ["LSOA21CD", "LSOA21NM", "LSOA21NMW"],
    filter: { kind: "namePrefix", field: "LSOA21NM" },
  },
  {
    level: "msoa",
    year: 2021,
    service: "Middle_layer_Super_Output_Areas_December_2021_Boundaries_EW_BGC_V3",
    codeField: "MSOA21CD",
    fields: ["MSOA21CD", "MSOA21NM", "MSOA21NMW"],
    filter: { kind: "namePrefix", field: "MSOA21NM" },
  },
  {
    level: "council",
    year: 2026,
    service: "Local_Authority_Districts_May_2026_Boundaries_UK_BGC",
    codeField: "LAD26CD",
    fields: ["LAD26CD", "LAD26NM", "LAD26NMW"],
    filter: { kind: "ladCode", field: "LAD26CD" },
  },
];
