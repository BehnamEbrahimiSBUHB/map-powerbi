// Dashboard wiring: builds the slicers from the map configuration, loads the
// chosen map and its data, and draws the map, headline figures, ranked list
// and table.

import {
  MAP_GROUPS,
  WIMD_LEVEL,
  WIMD_PATH,
  WIMD_YEAR,
  outputStem,
  syntheticFile,
  type MapGroup,
} from "../../scripts/paths.ts";
import type { Level, MapType } from "../../scripts/sources.ts";
import {
  WIMD_DOMAINS,
  WIMD_LABELS,
  WIMD_LSOA_COUNT,
  wimdColumn,
  type WimdDomain,
} from "../../scripts/wimd-columns.ts";
import { classBreaks, classOf, formatNumber, mean, parseCsv, sum, type Row } from "./data.ts";
import { draw, isTopology, shapesOf, type Shape } from "./geometry.ts";

type DataSource = "sample" | "wimd";

interface Selection {
  readonly group: MapGroup;
  readonly type: MapType;
  readonly data: DataSource;
  readonly measure: string;
}

interface Option {
  readonly value: string;
  readonly label: string;
}

/** One shape with everything the page shows about it. */
interface Datum {
  readonly id: string;
  readonly label: string;
  readonly parent: string;
  /** Sort key and bar length source. Undefined when the data has no row for the shape. */
  readonly value: number | undefined;
  /** Colour class, 0 (lightest) to 4 (darkest). */
  readonly classIndex: number | undefined;
  /** The value as shown in the table, list and tooltip. */
  readonly display: string;
}

interface Tile {
  readonly label: string;
  readonly value: string;
  readonly note: string;
}

interface View {
  readonly data: readonly Datum[];
  readonly legend: readonly string[];
  readonly tiles: readonly Tile[];
  readonly rankedTitle: string;
  /** Top rows of the ranked list, with the bar length as a share of the longest. */
  readonly ranked: readonly (Datum & { readonly share: number })[];
  readonly measureLabel: string;
  readonly valueHeader: string;
  readonly notice: readonly [string, string];
}

interface SampleMeasure {
  readonly column: string;
  readonly label: string;
  readonly digits: number;
  /** Population adds up across areas. The others are averaged. */
  readonly summary: "total" | "average";
}

const SAMPLE_MEASURES: readonly SampleMeasure[] = [
  { column: "population", label: "Population", digits: 0, summary: "total" },
  { column: "median_age", label: "Median age", digits: 1, summary: "average" },
  { column: "index_score", label: "Index score", digits: 1, summary: "average" },
];
const TYPE_LABELS: Readonly<Record<MapType, string>> = {
  geographic: "Geographic",
  hexmap: "Hexmap",
  geogrid: "Geogrid",
};
const LEVEL_LABELS: Readonly<Record<Level, readonly [string, string]>> = {
  oa: ["OA", "Output Areas"],
  lsoa: ["LSOA", "LSOAs"],
  msoa: ["MSOA", "MSOAs"],
  council: ["Councils", "councils"],
  "health-board": ["Health boards", "health boards"],
  cluster: ["Clusters", "primary care clusters"],
};
const DATA_LABELS: Readonly<Record<DataSource, string>> = {
  sample: "Sample (synthetic)",
  wimd: "WIMD 2025 (real)",
};
const AREA_SECTIONS: Readonly<Record<string, string>> = {
  "swansea-bay-small-areas": "Swansea and Neath Port Talbot",
  "health-board-small-areas": "Health board areas",
};
const DEFAULT_SECTION = "Nations";
const DEFAULT_AREA = "swansea-and-neath-port-talbot";
const CLASSES = 5;
const MAP_WIDTH = 800;
const MAP_PADDING = 6;
const RANKED_ROWS = 10;
const SVG_NS = "http://www.w3.org/2000/svg";
// From class 0 (lightest) to class 4 (darkest).
const WIMD_LEGEND = [
  "Least deprived 20%",
  "20% to 40% least deprived",
  "Middle 20%",
  "20% to 40% most deprived",
  "Most deprived 20%",
];

// ---------- pure helpers ----------

const unique = <T>(values: readonly T[]): readonly T[] => [...new Set(values)];

const text = (value: unknown): string => (typeof value === "string" ? value : "");

const groupsOf = (area: string): readonly MapGroup[] =>
  MAP_GROUPS.filter((group) => group.area.slug === area);

const hasWimd = (group: MapGroup): boolean =>
  group.source.level === WIMD_LEVEL && group.source.year === WIMD_YEAR;

const measureOptions = (data: DataSource): readonly Option[] =>
  data === "wimd"
    ? WIMD_DOMAINS.map((domain) => ({ value: domain, label: WIMD_LABELS[domain] }))
    : SAMPLE_MEASURES.map(({ column, label }) => ({ value: column, label }));

/** Picks the wanted value when it is on offer, otherwise the fallback, otherwise the first. */
const choose = <T>(options: readonly T[], wanted: unknown, fallback?: T): T => {
  const match = options.find((option) => String(option) === String(wanted));
  const chosen = match ?? (fallback !== undefined && options.includes(fallback) ? fallback : options[0]);
  if (chosen === undefined) {
    throw new Error("Nothing to choose from");
  }
  return chosen;
};

/** Turns whatever the address bar or the form asks for into a view that exists. */
const resolve = (wanted: Readonly<Record<string, string | undefined>>): Selection => {
  const area = choose(unique(MAP_GROUPS.map((group) => group.area.slug)), wanted.area, DEFAULT_AREA);
  const inArea = groupsOf(area);
  const level = choose(unique(inArea.map((group) => group.source.level)), wanted.level, "lsoa");
  const atLevel = inArea.filter((group) => group.source.level === level);
  const years = unique(atLevel.map((group) => group.source.year)).toSorted((a, b) => b - a);
  const year = choose(years, wanted.year);
  const group = atLevel.find((candidate) => candidate.source.year === year);
  if (group === undefined) {
    throw new Error(`No map for ${area}, ${level}, ${year}`);
  }
  const data = choose<DataSource>(hasWimd(group) ? ["sample", "wimd"] : ["sample"], wanted.data);
  return {
    group,
    type: choose(group.set.types, wanted.type, "geographic"),
    data,
    measure: choose(
      measureOptions(data).map((option) => option.value),
      wanted.measure,
    ),
  };
};

const labelOf = (shape: Shape, group: MapGroup): string => {
  const nameField = group.source.fields[1];
  return (nameField === undefined ? "" : text(shape.properties[nameField])) || shape.id;
};

const sampleView = (
  shapes: readonly Shape[],
  rows: readonly Row[],
  group: MapGroup,
  measure: SampleMeasure,
): View => {
  const byCode = new Map(rows.map((row) => [row[group.source.codeField] ?? "", row]));
  const raw = shapes.map((shape) => {
    const row = byCode.get(shape.id);
    const value = row === undefined ? Number.NaN : Number(row[measure.column]);
    return {
      id: shape.id,
      label: labelOf(shape, group),
      parent: row?.council ?? row?.country ?? "",
      value: Number.isFinite(value) ? value : undefined,
    };
  });
  const values = raw.flatMap(({ value }) => (value === undefined ? [] : [value]));
  const breaks = classBreaks(values, CLASSES);
  const data: readonly Datum[] = raw.map((datum) => ({
    ...datum,
    classIndex: datum.value === undefined ? undefined : classOf(datum.value, breaks),
    display: datum.value === undefined ? "No data" : formatNumber(datum.value, measure.digits),
  }));
  const sorted = data
    .filter((datum) => datum.value !== undefined)
    .toSorted((a, b) => (a.value ?? 0) - (b.value ?? 0));
  const lowest = sorted[0];
  const highest = sorted.at(-1);
  const top = sorted.toReversed().slice(0, RANKED_ROWS);
  const max = top[0]?.value ?? 1;
  const low = lowest?.value ?? 0;
  return {
    data,
    legend: [low, ...breaks].map(
      (from, index) =>
        `${formatNumber(from, measure.digits)} to ${formatNumber(breaks[index] ?? highest?.value ?? 0, measure.digits)}`,
    ),
    tiles: [
      { label: "Areas", value: formatNumber(shapes.length, 0), note: "" },
      {
        label: measure.summary === "total" ? "Total" : "Average",
        value: formatNumber(
          measure.summary === "total" ? sum(values) : mean(values),
          measure.digits,
        ),
        note: "",
      },
      { label: "Lowest", value: lowest?.display ?? "No data", note: lowest?.label ?? "" },
      { label: "Highest", value: highest?.display ?? "No data", note: highest?.label ?? "" },
    ],
    rankedTitle: `Highest ${top.length}`,
    ranked: top.map((datum) => ({ ...datum, share: (datum.value ?? 0) / max })),
    measureLabel: measure.label,
    valueHeader: measure.label,
    notice: [
      "The numbers are synthetic.",
      "They are made up to show how the maps look with data. They are not real statistics.",
    ],
  };
};

const wimdView = (
  shapes: readonly Shape[],
  rows: readonly Row[],
  group: MapGroup,
  domain: WimdDomain,
): View => {
  const byCode = new Map(rows.map((row) => [row.LSOA21CD ?? "", row]));
  const data: readonly Datum[] = shapes.map((shape) => {
    const row = byCode.get(shape.id);
    const rank = Number(row?.[wimdColumn(domain, "rank")]);
    const quintile = Number(row?.[wimdColumn(domain, "quintile")]);
    const known = row !== undefined && Number.isFinite(rank) && Number.isFinite(quintile);
    const name = text(row?.name_en);
    return {
      id: shape.id,
      label: name === "" ? labelOf(shape, group) : `${name} (${labelOf(shape, group)})`,
      parent: "",
      value: known ? rank : undefined,
      // Quintile 1 is the most deprived, which gets the darkest class.
      classIndex: known ? CLASSES - quintile : undefined,
      display: known
        ? `Rank ${formatNumber(rank, 0)}, decile ${row[wimdColumn(domain, "decile")] ?? ""}`
        : "No data",
    };
  });
  const sorted = data
    .filter((datum) => datum.value !== undefined)
    .toSorted((a, b) => (a.value ?? 0) - (b.value ?? 0));
  const mostDeprived = sorted[0];
  const leastDeprived = sorted.at(-1);
  const inWorstFifth = data.filter((datum) => datum.classIndex === CLASSES - 1).length;
  const top = sorted.slice(0, RANKED_ROWS);
  return {
    data,
    legend: WIMD_LEGEND,
    tiles: [
      { label: "Areas", value: formatNumber(shapes.length, 0), note: "" },
      {
        label: "In the most deprived 20% of Wales",
        value: formatNumber(inWorstFifth, 0),
        note: `${formatNumber((100 * inWorstFifth) / Math.max(1, sorted.length), 0)}% of the areas shown`,
      },
      {
        label: "Most deprived",
        value: mostDeprived === undefined ? "No data" : `Rank ${formatNumber(mostDeprived.value ?? 0, 0)}`,
        note: mostDeprived?.label ?? "",
      },
      {
        label: "Least deprived",
        value: leastDeprived === undefined ? "No data" : `Rank ${formatNumber(leastDeprived.value ?? 0, 0)}`,
        note: leastDeprived?.label ?? "",
      },
    ],
    rankedTitle: `Most deprived ${top.length}`,
    // A longer bar means more deprived: rank 1 fills the track.
    ranked: top.map((datum) => ({
      ...datum,
      share: (WIMD_LSOA_COUNT + 1 - (datum.value ?? WIMD_LSOA_COUNT)) / WIMD_LSOA_COUNT,
    })),
    measureLabel: `WIMD 2025 ${WIMD_LABELS[domain].toLowerCase()}`,
    valueHeader: "Rank (1 is most deprived)",
    notice: [
      "Real data.",
      `Welsh Index of Multiple Deprivation 2025, Welsh Government. Rank 1 is the most deprived of ${formatNumber(WIMD_LSOA_COUNT, 0)} areas in Wales.`,
    ],
  };
};

// ---------- DOM ----------

const element = <T extends Element>(selector: string): T => {
  const found = document.querySelector<T>(selector);
  if (found === null) {
    throw new Error(`Page is missing ${selector}`);
  }
  return found;
};

const form = element<HTMLFormElement>("#slicers");
const areaSelect = element<HTMLSelectElement>("#area");
const mapSvg = element<SVGSVGElement>("#map");
const tooltip = element<HTMLElement>("#tooltip");
const status = element<HTMLElement>("#status");

const setText = (selector: string, value: string): void => {
  element<HTMLElement>(selector).textContent = value;
};

const node = <K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
  content = "",
): HTMLElementTagNameMap[K] => {
  const created = document.createElement(tag);
  created.className = className;
  created.textContent = content;
  return created;
};

const renderAreaOptions = (selected: string): void => {
  const sections = Map.groupBy(
    unique(MAP_GROUPS.map((group) => group.area.slug)),
    (slug) => AREA_SECTIONS[groupsOf(slug)[0]?.set.key ?? ""] ?? DEFAULT_SECTION,
  );
  areaSelect.replaceChildren(
    ...[...sections].map(([label, slugs]) => {
      const section = document.createElement("optgroup");
      section.label = label;
      section.append(
        ...slugs.map((slug) => new Option(groupsOf(slug)[0]?.area.label ?? slug, slug, false, slug === selected)),
      );
      return section;
    }),
  );
};

/** Draws one slicer as a row of radio buttons. */
const renderRadios = (name: string, options: readonly Option[], selected: string): void => {
  element<HTMLElement>(`#${name}-options`).replaceChildren(
    ...options.map((option) => {
      const label = document.createElement("label");
      const input = document.createElement("input");
      input.type = "radio";
      input.name = name;
      input.value = option.value;
      input.checked = option.value === selected;
      label.append(input, node("span", "", option.label));
      return label;
    }),
  );
};

const renderSlicers = ({ group, type, data, measure }: Selection): void => {
  const inArea = groupsOf(group.area.slug);
  const atLevel = inArea.filter((candidate) => candidate.source.level === group.source.level);
  renderAreaOptions(group.area.slug);
  renderRadios(
    "level",
    unique(inArea.map((candidate) => candidate.source.level)).map((level) => ({
      value: level,
      label: LEVEL_LABELS[level][0],
    })),
    group.source.level,
  );
  renderRadios(
    "year",
    unique(atLevel.map((candidate) => candidate.source.year))
      .toSorted((a, b) => a - b)
      .map((year) => ({ value: String(year), label: String(year) })),
    String(group.source.year),
  );
  renderRadios(
    "type",
    group.set.types.map((value) => ({ value, label: TYPE_LABELS[value] })),
    type,
  );
  renderRadios(
    "data",
    (hasWimd(group) ? (["sample", "wimd"] as const) : (["sample"] as const)).map((value) => ({
      value,
      label: DATA_LABELS[value],
    })),
    data,
  );
  renderRadios("measure", measureOptions(data), measure);
};

const cache = new Map<string, Promise<unknown>>();
const load = <T>(url: string, read: (response: Response) => Promise<T>): Promise<T> => {
  const cached = cache.get(url);
  if (cached !== undefined) {
    return cached as Promise<T>;
  }
  const request = fetch(url).then((response) => {
    if (!response.ok) {
      throw new Error(`Could not load ${url} (HTTP ${response.status})`);
    }
    return read(response);
  });
  cache.set(url, request);
  return request;
};

const renderMap = (shapes: readonly Shape[], view: View): void => {
  const drawing = draw(shapes, MAP_WIDTH, MAP_PADDING);
  const byId = new Map(view.data.map((datum) => [datum.id, datum]));
  mapSvg.setAttribute("viewBox", `0 0 ${drawing.width} ${drawing.height}`);
  mapSvg.replaceChildren(
    ...drawing.paths.map(({ id, d }) => {
      const path = document.createElementNS(SVG_NS, "path");
      const classIndex = byId.get(id)?.classIndex;
      path.setAttribute("d", d);
      path.setAttribute("class", classIndex === undefined ? "area na" : `area q${classIndex}`);
      path.dataset.id = id;
      return path;
    }),
  );
};

const renderView = (view: View): void => {
  element<HTMLElement>("#legend").replaceChildren(
    ...view.legend.map((label, index) => {
      const item = document.createElement("li");
      item.append(node("span", `swatch q${index}`), label);
      return item;
    }),
  );
  element<HTMLElement>("#tiles").replaceChildren(
    ...view.tiles.map((tile) => {
      const card = node("div", "tile");
      card.append(
        node("span", "tile-label", tile.label),
        node("span", "tile-value", tile.value),
        node("span", "tile-note", tile.note),
      );
      return card;
    }),
  );
  setText("#ranked-title", view.rankedTitle);
  element<HTMLElement>("#ranked").replaceChildren(
    ...view.ranked.map((datum) => {
      const item = document.createElement("li");
      item.dataset.id = datum.id;
      const bar = node("span", "ranked-bar");
      bar.style.width = `${Math.max(2, datum.share * 100)}%`;
      const track = node("span", "ranked-track");
      track.append(bar);
      item.append(node("span", "ranked-label", datum.label), track, node("span", "ranked-value", datum.display));
      return item;
    }),
  );
  setText("#table-measure", view.valueHeader);
  element<HTMLElement>("#table-body").replaceChildren(
    ...view.data
      .toSorted((a, b) => (a.value ?? Infinity) - (b.value ?? Infinity))
      .map((datum) => {
        const row = document.createElement("tr");
        row.append(
          ...[datum.id, datum.label === datum.id ? "" : datum.label, datum.parent, datum.display].map(
            (cell) => node("td", "", cell),
          ),
        );
        return row;
      }),
  );
  const [strong, rest] = view.notice;
  element<HTMLElement>("#notice").replaceChildren(node("strong", "", strong), ` ${rest}`);
};

let current: { readonly data: ReadonlyMap<string, Datum>; readonly measureLabel: string } | undefined;

const highlight = (id: string | undefined): void => {
  for (const path of mapSvg.querySelectorAll(".area.active")) {
    path.classList.remove("active");
  }
  if (id !== undefined) {
    mapSvg.querySelector(`[data-id="${CSS.escape(id)}"]`)?.classList.add("active");
  }
};

const showTooltip = (event: PointerEvent): void => {
  const id = event.target instanceof SVGPathElement ? event.target.dataset.id : undefined;
  const datum = id === undefined ? undefined : current?.data.get(id);
  if (datum === undefined || current === undefined) {
    tooltip.hidden = true;
    highlight(undefined);
    return;
  }
  const detail = [datum.label === datum.id ? "" : datum.id, datum.parent].filter((part) => part !== "");
  tooltip.replaceChildren(
    node("strong", "", datum.label),
    node("span", "", `${current.measureLabel}: ${datum.display}`),
    node("span", "muted", detail.join(" · ")),
  );
  tooltip.hidden = false;
  const frame = element<HTMLElement>("#map-frame").getBoundingClientRect();
  const left = Math.min(event.clientX - frame.left + 14, frame.width - tooltip.offsetWidth - 4);
  tooltip.style.left = `${Math.max(4, left)}px`;
  tooltip.style.top = `${event.clientY - frame.top + 14}px`;
  highlight(datum.id);
};

const update = async (selection: Selection): Promise<void> => {
  const { group, type, data, measure } = selection;
  const { source, area } = group;
  status.textContent = "Loading map…";
  try {
    const [topology, csv] = await Promise.all([
      load(`maps/${outputStem(source, area.slug, type)}.json`, (r) => r.json()),
      load(data === "wimd" ? WIMD_PATH : `data/synthetic/${syntheticFile(source.level, source.year)}`, (r) =>
        r.text(),
      ),
    ]);
    if (!isTopology(topology)) {
      throw new Error("The map file is not TopoJSON.");
    }
    const shapes = shapesOf(topology);
    const rows = parseCsv(csv);
    const view =
      data === "wimd"
        ? wimdView(shapes, rows, group, choose(WIMD_DOMAINS, measure))
        : sampleView(
            shapes,
            rows,
            group,
            SAMPLE_MEASURES.find(({ column }) => column === measure) ?? SAMPLE_MEASURES[0]!,
          );

    current = { data: new Map(view.data.map((datum) => [datum.id, datum])), measureLabel: view.measureLabel };
    renderMap(shapes, view);
    renderView(view);
    const heading = `${view.measureLabel} by ${LEVEL_LABELS[source.level][1]}, ${area.label}, ${source.year} boundaries`;
    setText("#map-title", heading.charAt(0).toUpperCase() + heading.slice(1));
    setText("#map-type", `${TYPE_LABELS[type]} map`);
    mapSvg.setAttribute("aria-label", `${heading}. ${TYPE_LABELS[type]} map.`);
    status.textContent = "";
  } catch (error) {
    status.textContent = error instanceof Error ? error.message : "Could not load the map.";
  }
};

/** Reads what the form asks for, settles on a view that exists, and shows it. */
const apply = (wanted: Readonly<Record<string, string | undefined>>): void => {
  const selection = resolve(wanted);
  renderSlicers(selection);
  const query = new URLSearchParams({
    area: selection.group.area.slug,
    level: selection.group.source.level,
    year: String(selection.group.source.year),
    type: selection.type,
    data: selection.data,
    measure: selection.measure,
  });
  // Keeps the address shareable: opening it again shows the same view.
  history.replaceState(null, "", `?${query}`);
  void update(selection);
};

form.addEventListener("change", () => {
  apply(Object.fromEntries([...new FormData(form)].map(([name, value]) => [name, String(value)])));
});
mapSvg.addEventListener("pointermove", showTooltip);
mapSvg.addEventListener("pointerleave", () => {
  tooltip.hidden = true;
  highlight(undefined);
});
const ranked = element<HTMLElement>("#ranked");
ranked.addEventListener("pointerover", (event) => {
  const item = event.target instanceof Element ? event.target.closest("li") : null;
  highlight(item?.dataset.id);
});
ranked.addEventListener("pointerleave", () => highlight(undefined));

apply(Object.fromEntries(new URLSearchParams(location.search)));
