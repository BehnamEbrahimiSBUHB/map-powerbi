// Build configuration: which boundary layers to download, which areas to cut
// them into, and which map types to make. Pure data: the dashboard imports it,
// so it must stay free of Node-only imports.
//
// To move to a newer release, change the `service` name (and field names if the
// vintage changes), then run `bun run build:refresh`.

/** ONS Open Geography Portal ArcGIS REST root. */
export const ONS_SERVICES_URL =
  "https://services1.arcgis.com/ESMARspQHYMw9BZ9/arcgis/rest/services";

/** DataMapWales (Welsh Government) WFS endpoint. */
export const DATAMAPWALES_WFS_URL = "https://datamap.gov.wales/geoserver/ows";

/** What one shape in a map file is. */
export type Level = "oa" | "lsoa" | "msoa" | "council" | "health-board" | "cluster";

/** R packages that turn each area into one equal-sized hexagon. See scripts/hex.R. */
export type HexMethod = "hexmap" | "geogrid";

export type MapType = "geographic" | HexMethod;

export const ALL_TYPES: readonly MapType[] = ["geographic", "hexmap", "geogrid"];

/**
 * Fill colours for the preview images. Only three, because more cannot all stay
 * distinguishable for colour-blind readers. Each part picks one by index so
 * that neighbouring parts differ. Validated together on light and dark surfaces.
 */
export const PALETTE = ["#2a78d6", "#d95926", "#199e70"] as const;
export type Colour = 0 | 1 | 2;

export interface Council {
  readonly slug: string;
  /** Name as used by ONS, e.g. as the prefix of LSOA names. */
  readonly name: string;
  /** Local authority district code. Needed only for layers filtered by it. */
  readonly ladCode?: string;
  /** 2001 census district code, the prefix of pre-2011 output area codes. */
  readonly oldCode?: string;
}

/** How a layer's rows are narrowed to one council. */
export type Filter =
  | { readonly kind: "namePrefix"; readonly field: string }
  | { readonly kind: "ladCode"; readonly field: string }
  | { readonly kind: "oldCodePrefix"; readonly field: string };

/** One download: the rows of a layer that belong to one place. */
export type Selector =
  | { readonly kind: "council"; readonly council: Council }
  /** Rows whose area code starts with a prefix, e.g. "W" for Wales. */
  | { readonly kind: "codePrefix"; readonly prefix: string; readonly label: string }
  /** Rows picked by exact area code, for places no field or prefix identifies. */
  | { readonly kind: "codes"; readonly codes: readonly string[]; readonly label: string }
  /** Every row of a layer that already covers just the right place. */
  | { readonly kind: "all"; readonly label: string };

/**
 * A group inside one map file. Parts get different colours in the preview, and
 * the hex maps keep each part in one piece.
 */
export interface Part {
  readonly key: string;
  readonly label: string;
  readonly colour: Colour;
  readonly selectors: readonly Selector[];
}

/** What one map file covers. */
export interface Area {
  readonly slug: string;
  readonly label: string;
  readonly parts: readonly Part[];
}

export interface Source {
  readonly level: Level;
  /** Boundary vintage. Census year, or release year for other layers. */
  readonly year: number;
  readonly provider: "ons" | "datamapwales";
  /** ONS FeatureServer name, or DataMapWales layer name. */
  readonly service: string;
  /** Unique area code. Used as the shape id and to order pages. */
  readonly codeField: string;
  /** Properties written to the map file: code, then name, then Welsh name. They become the Power BI map keys. */
  readonly fields: readonly string[];
  /** Name of each output field in the layer itself, where it differs. */
  readonly layerFields?: Readonly<Record<string, string>>;
  /** Needed only for sources used with council selectors. */
  readonly filter?: Filter;
  /** mapshaper `-simplify` arguments, for layers too detailed at the scale they are used. */
  readonly simplify?: string;
}

/** A family of maps: every source is cut into every area, in every type. */
export interface MapSet {
  readonly key: string;
  /** Heading used in the file catalogue. */
  readonly title: string;
  readonly sources: readonly Source[];
  readonly areas: readonly Area[];
  readonly types: readonly MapType[];
  /** Set when a file is knowingly larger than Power BI's 1,500-shape limit. */
  readonly overPowerBiLimit?: boolean;
}

// ---------- councils and health boards ----------

const council = (slug: string, name: string, codes: Partial<Council> = {}): Council => ({
  slug,
  name,
  ...codes,
});

const SWANSEA = council("swansea", "Swansea", { ladCode: "W06000011", oldCode: "00NX" });
const NEATH_PORT_TALBOT = council("neath-port-talbot", "Neath Port Talbot", {
  ladCode: "W06000012",
  oldCode: "00NZ",
});

interface HealthBoard {
  readonly slug: string;
  readonly name: string;
  /** Colour of the board on the all-Wales maps. */
  readonly colour: Colour;
  /** Its councils, each with the colour used on the board's own maps. */
  readonly councils: readonly (readonly [Council, Colour])[];
}

// Membership since April 2019. Colours are picked by hand so neighbours differ.
const HEALTH_BOARDS: readonly HealthBoard[] = [
  {
    slug: "betsi-cadwaladr",
    name: "Betsi Cadwaladr",
    colour: 1,
    councils: [
      [council("isle-of-anglesey", "Isle of Anglesey"), 0],
      [council("gwynedd", "Gwynedd"), 1],
      [council("conwy", "Conwy"), 2],
      [council("denbighshire", "Denbighshire"), 0],
      [council("flintshire", "Flintshire"), 1],
      [council("wrexham", "Wrexham"), 2],
    ],
  },
  { slug: "powys", name: "Powys", colour: 0, councils: [[council("powys", "Powys"), 0]] },
  {
    slug: "hywel-dda",
    name: "Hywel Dda",
    colour: 2,
    councils: [
      [council("ceredigion", "Ceredigion"), 0],
      [council("pembrokeshire", "Pembrokeshire"), 1],
      [council("carmarthenshire", "Carmarthenshire"), 2],
    ],
  },
  {
    slug: "swansea-bay",
    name: "Swansea Bay",
    colour: 1,
    councils: [
      [SWANSEA, 0],
      [NEATH_PORT_TALBOT, 1],
    ],
  },
  {
    slug: "cwm-taf-morgannwg",
    name: "Cwm Taf Morgannwg",
    colour: 2,
    councils: [
      [council("bridgend", "Bridgend"), 0],
      [council("rhondda-cynon-taf", "Rhondda Cynon Taf"), 1],
      [council("merthyr-tydfil", "Merthyr Tydfil"), 2],
    ],
  },
  {
    slug: "cardiff-and-vale",
    name: "Cardiff and Vale",
    colour: 0,
    councils: [
      [council("cardiff", "Cardiff"), 0],
      [council("vale-of-glamorgan", "Vale of Glamorgan"), 1],
    ],
  },
  {
    slug: "aneurin-bevan",
    name: "Aneurin Bevan",
    colour: 1,
    councils: [
      [council("caerphilly", "Caerphilly"), 0],
      [council("blaenau-gwent", "Blaenau Gwent"), 1],
      [council("torfaen", "Torfaen"), 2],
      [council("monmouthshire", "Monmouthshire"), 0],
      [council("newport", "Newport"), 1],
    ],
  },
];

// ---------- areas ----------

const councilPart = (c: Council, colour: Colour): Part => ({
  key: c.slug,
  label: c.name,
  colour,
  selectors: [{ kind: "council", council: c }],
});

const SWANSEA_BAY_AREAS: readonly Area[] = [
  { slug: SWANSEA.slug, label: "Swansea", parts: [councilPart(SWANSEA, 0)] },
  {
    slug: NEATH_PORT_TALBOT.slug,
    label: "Neath Port Talbot",
    parts: [councilPart(NEATH_PORT_TALBOT, 1)],
  },
  {
    slug: "swansea-and-neath-port-talbot",
    label: "Swansea and Neath Port Talbot",
    parts: [councilPart(SWANSEA, 0), councilPart(NEATH_PORT_TALBOT, 1)],
  },
];

/** One area per health board, split into its councils. */
const HEALTH_BOARD_AREAS: readonly Area[] = HEALTH_BOARDS.map((board) => ({
  slug: board.slug,
  label: `${board.name} health board area`,
  parts: board.councils.map(([c, colour]) => councilPart(c, colour)),
}));

/** All of Wales as small areas, split into its health boards. */
const WALES_BY_HEALTH_BOARD: Area = {
  slug: "wales",
  label: "Wales",
  parts: HEALTH_BOARDS.map((board) => ({
    key: board.slug,
    label: board.name,
    colour: board.colour,
    selectors: board.councils.map(([c]) => ({ kind: "council", council: c }) as const),
  })),
};

const nation = (key: string, label: string, prefix: string, colour: Colour): Part => ({
  key,
  label,
  colour,
  selectors: [{ kind: "codePrefix", prefix, label }],
});

const WALES_COUNCILS: Area = {
  slug: "wales",
  label: "Wales",
  parts: [nation("wales", "Wales", "W", 0)],
};
const ENGLAND_AND_WALES_COUNCILS: Area = {
  slug: "england-and-wales",
  label: "England and Wales",
  parts: [nation("england", "England", "E", 1), nation("wales", "Wales", "W", 0)],
};
const SCOTLAND_COUNCILS: Area = {
  slug: "scotland",
  label: "Scotland",
  parts: [nation("scotland", "Scotland", "S", 0)],
};
const NORTHERN_IRELAND_COUNCILS: Area = {
  slug: "northern-ireland",
  label: "Northern Ireland",
  parts: [nation("northern-ireland", "Northern Ireland", "N", 0)],
};

/** For layers that hold Wales and nothing else. */
const WALES_WHOLE_LAYER: Area = {
  slug: "wales",
  label: "Wales",
  parts: [{ key: "wales", label: "Wales", colour: 0, selectors: [{ kind: "all", label: "Wales" }] }],
};

// The eight clusters of Swansea Bay University Health Board, by council. Picked
// by code because the 2019 layer still files three Bridgend clusters under the
// same "CC3" prefix, from before Bridgend moved to Cwm Taf Morgannwg.
const SWANSEA_BAY_CLUSTERS: Area = {
  slug: "swansea-bay",
  label: "Swansea Bay health board area",
  parts: [
    {
      key: SWANSEA.slug,
      label: SWANSEA.name,
      colour: 0,
      selectors: [
        {
          kind: "codes",
          // BayHealth, CityHealth, Cwmtawe, Llwchwr, Penderi
          codes: ["CC302", "CC306", "CC307", "CC308", "CC310"],
          // The parent place written to the sample data, which is a country at this level.
          label: "Wales",
        },
      ],
    },
    {
      key: NEATH_PORT_TALBOT.slug,
      label: NEATH_PORT_TALBOT.name,
      colour: 1,
      selectors: [
        {
          kind: "codes",
          // Afan, Neath, Upper Valleys
          codes: ["CC301", "CC309", "CC311"],
          label: "Wales",
        },
      ],
    },
  ],
};

// ---------- sources ----------

// Census layers are ONS "BGC": generalised to 20 m and clipped to the coastline,
// which keeps files small while still looking right at council scale.
//
// On 10/11/2026 ONS withdrew public access to these nine services (they answer
// "Token Required"). The build still works from the downloads in .cache/ons/,
// but `--refresh` fails for them until ONS restores access or the services are
// replaced here.
const census = (
  level: Level,
  year: number,
  service: string,
  prefix: string,
  filter: Filter,
): Source => ({
  level,
  year,
  provider: "ons",
  service,
  codeField: `${prefix}CD`,
  fields: level === "oa" ? [`${prefix}CD`] : [`${prefix}CD`, `${prefix}NM`, `${prefix}NMW`],
  filter,
});

const LSOA_2021 = census(
  "lsoa",
  2021,
  "Lower_layer_Super_Output_Areas_December_2021_Boundaries_EW_BGC_V5",
  "LSOA21",
  { kind: "namePrefix", field: "LSOA21NM" },
);
const MSOA_2021 = census(
  "msoa",
  2021,
  "Middle_layer_Super_Output_Areas_December_2021_Boundaries_EW_BGC_V3",
  "MSOA21",
  { kind: "namePrefix", field: "MSOA21NM" },
);

const CENSUS_SOURCES: readonly Source[] = [
  census("oa", 2001, "Output_Areas_Dec_2001_Boundaries_EW_BGC_2022", "OA01", {
    kind: "oldCodePrefix",
    field: "OA01CDOLD",
  }),
  census("lsoa", 2001, "Lower_Layer_Super_Output_Areas_Dec_2001_EW_BGC_2022", "LSOA01", {
    kind: "namePrefix",
    field: "LSOA01NM",
  }),
  census("msoa", 2001, "Middle_Layer_Super_Output_Areas_Dec_2001_Boundaries_EW_BGC_2022", "MSOA01", {
    kind: "namePrefix",
    field: "MSOA01NM",
  }),
  census("oa", 2011, "Output_Areas_Dec_2011_Boundaries_EW_BGC_2022", "OA11", {
    kind: "ladCode",
    field: "LAD11CD",
  }),
  census("lsoa", 2011, "LSOA_Dec_2011_Boundaries_Generalised_Clipped_BGC_EW_V3", "LSOA11", {
    kind: "namePrefix",
    field: "LSOA11NM",
  }),
  census("msoa", 2011, "MSOA_Dec_2011_Boundaries_Generalised_Clipped_BGC_EW_V3_2022", "MSOA11", {
    kind: "namePrefix",
    field: "MSOA11NM",
  }),
  census("oa", 2021, "Output_Areas_2021_EW_BGC_V2", "OA21", {
    kind: "namePrefix",
    field: "LSOA21NM",
  }),
  LSOA_2021,
  MSOA_2021,
];

// ONS "BSC": generalised to 200 m, the version meant for maps of a whole nation.
// Used for the all-Wales and health board maps. These two layers also carry the
// rural-urban classification, which is not copied into the map files.
const LSOA_2021_WIDE = census("lsoa", 2021, "LSOA_2021_EW_BSC_V4_RUC", "LSOA21", {
  kind: "namePrefix",
  field: "LSOA21NM",
});
const MSOA_2021_WIDE = census("msoa", 2021, "MSOA_2021_EW_BSC_V3_RUC", "MSOA21", {
  kind: "namePrefix",
  field: "MSOA21NM",
});

const LAD_2026_SERVICE = "Local_Authority_Districts_May_2026_Boundaries_UK_BGC";

/** Full 20 m detail, for the outline of a single council. */
const COUNCIL_OUTLINE_2026: Source = {
  level: "council",
  year: 2026,
  provider: "ons",
  service: LAD_2026_SERVICE,
  codeField: "LAD26CD",
  fields: ["LAD26CD", "LAD26NM", "LAD26NMW"],
  filter: { kind: "ladCode", field: "LAD26CD" },
};

// A nation at 20 m detail is far more than a report can show, so these are thinned.
const NATION_SIMPLIFY = "8%";

const councils = (
  year: number,
  service: string,
  layerFields?: Readonly<Record<string, string>>,
): Source => {
  const prefix = `LAD${String(year).slice(2)}`;
  return {
    level: "council",
    year,
    provider: "ons",
    service,
    codeField: `${prefix}CD`,
    fields: [`${prefix}CD`, `${prefix}NM`, `${prefix}NMW`],
    simplify: NATION_SIMPLIFY,
    ...(layerFields === undefined ? {} : { layerFields }),
  };
};

// The 2011 layer covers Great Britain only and names its fields in lower case.
const COUNCILS_2011 = councils(2011, "Local_Authority_Districts_December_2011_GB_BGC_2022", {
  LAD11CD: "lad11cd",
  LAD11NM: "lad11nm",
  LAD11NMW: "lad11nmw",
});
const COUNCILS_2021 = councils(2021, "Local_Authority_Districts_December_2021_UK_BGC_2022");
const COUNCILS_2026 = councils(2026, LAD_2026_SERVICE);

const HEALTH_BOARDS_2023: Source = {
  level: "health-board",
  year: 2023,
  provider: "ons",
  service: "Local_Health_Boards_December_2023_WA_BGC",
  codeField: "LHB23CD",
  fields: ["LHB23CD", "LHB23NM", "LHB23NMW"],
  simplify: "20%",
};

// Cluster boundaries come at full survey detail, so they are thinned hard.
const CLUSTERS_2019: Source = {
  level: "cluster",
  year: 2019,
  provider: "datamapwales",
  service: "geonode:primary_care_clusters_2019",
  codeField: "CLUSTERCD",
  fields: ["CLUSTERCD", "CLUSTERNM"],
  layerFields: { CLUSTERCD: "ClusterCod", CLUSTERNM: "GPClusterN" },
  simplify: "5%",
};
const CLUSTERS_2024: Source = {
  level: "cluster",
  year: 2024,
  provider: "datamapwales",
  service: "geonode:primary_care_clusters_2024_hwm",
  codeField: "CLUSTERCD",
  fields: ["CLUSTERCD", "CLUSTERNM", "CLUSTERNMW"],
  layerFields: { CLUSTERCD: "code", CLUSTERNM: "name_en", CLUSTERNMW: "enw_cy" },
  simplify: "5%",
};

// ---------- map sets ----------

export const MAP_SETS: readonly MapSet[] = [
  {
    key: "swansea-bay-small-areas",
    title: "Swansea and Neath Port Talbot: OA, LSOA and MSOA",
    sources: CENSUS_SOURCES,
    areas: SWANSEA_BAY_AREAS,
    types: ALL_TYPES,
  },
  {
    // A single council would be a single hexagon, so no hex maps here.
    key: "swansea-bay-council-outlines",
    title: "Swansea and Neath Port Talbot: council outlines",
    sources: [COUNCIL_OUTLINE_2026],
    areas: SWANSEA_BAY_AREAS,
    types: ["geographic"],
  },
  {
    key: "health-board-small-areas",
    title: "Health board areas: LSOA and MSOA",
    sources: [LSOA_2021_WIDE, MSOA_2021_WIDE],
    areas: HEALTH_BOARD_AREAS,
    types: ALL_TYPES,
  },
  {
    // 1,917 LSOAs: more than Power BI plots, kept for the dashboard and other tools.
    key: "wales-small-areas",
    title: "All Wales: LSOA and MSOA",
    sources: [LSOA_2021_WIDE, MSOA_2021_WIDE],
    areas: [WALES_BY_HEALTH_BOARD],
    types: ALL_TYPES,
    overPowerBiLimit: true,
  },
  {
    key: "councils-great-britain",
    title: "Councils: Wales, England and Wales, Scotland",
    sources: [COUNCILS_2011, COUNCILS_2021, COUNCILS_2026],
    areas: [WALES_COUNCILS, ENGLAND_AND_WALES_COUNCILS, SCOTLAND_COUNCILS],
    types: ALL_TYPES,
  },
  {
    key: "councils-northern-ireland",
    title: "Councils: Northern Ireland",
    sources: [COUNCILS_2021, COUNCILS_2026],
    areas: [NORTHERN_IRELAND_COUNCILS],
    types: ALL_TYPES,
  },
  {
    key: "wales-health-boards",
    title: "Welsh health boards",
    sources: [HEALTH_BOARDS_2023],
    areas: [WALES_WHOLE_LAYER],
    types: ALL_TYPES,
  },
  {
    key: "wales-clusters",
    title: "Welsh primary care clusters",
    sources: [CLUSTERS_2019, CLUSTERS_2024],
    areas: [WALES_WHOLE_LAYER],
    types: ALL_TYPES,
  },
  {
    // One health board is shown much closer up than all of Wales, so keep more detail.
    key: "swansea-bay-clusters",
    title: "Swansea Bay primary care clusters",
    sources: [
      { ...CLUSTERS_2019, simplify: "25%" },
      { ...CLUSTERS_2024, simplify: "25%" },
    ],
    areas: [SWANSEA_BAY_CLUSTERS],
    types: ALL_TYPES,
  },
];
