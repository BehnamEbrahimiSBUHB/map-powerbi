// Dashboard wiring: reads the slicers, loads the chosen map and its sample
// data, and draws the map, headline figures, ranked list and table.

import { mapTypes, outputStem, syntheticFile } from "../../scripts/paths.ts";
import { SOURCES, type Level, type MapType, type Source } from "../../scripts/sources.ts";
import { classBreaks, classOf, formatNumber, mean, parseCsv, sum, type Row } from "./data.ts";
import { draw, isTopology, shapesOf, type Shape } from "./geometry.ts";

interface Measure {
  readonly column: string;
  readonly label: string;
  readonly digits: number;
  /** Population adds up across areas. The others are averaged. */
  readonly summary: "total" | "average";
}

interface Selection {
  readonly type: MapType;
  readonly year: number;
  readonly level: Level;
  readonly slug: string;
  readonly measure: Measure;
}

interface Area {
  readonly id: string;
  readonly label: string;
  readonly council: string;
  readonly value: number | undefined;
}

const MEASURES: readonly Measure[] = [
  { column: "population", label: "Population", digits: 0, summary: "total" },
  { column: "median_age", label: "Median age", digits: 1, summary: "average" },
  { column: "index_score", label: "Index score", digits: 1, summary: "average" },
];
const TYPE_LABELS: Readonly<Record<MapType, string>> = {
  geographic: "Geographic",
  hexmap: "Hexmap",
  geogrid: "Geogrid",
};
const LEVEL_LABELS: Readonly<Record<Level, string>> = {
  oa: "Output Areas",
  lsoa: "LSOAs",
  msoa: "MSOAs",
  council: "Councils",
};
const CLASSES = 5;
const MAP_WIDTH = 800;
const MAP_PADDING = 6;
const RANKED_ROWS = 10;
const SVG_NS = "http://www.w3.org/2000/svg";

// ---------- pure helpers ----------

const findSource = (level: Level, year: number): Source | undefined =>
  SOURCES.find((source) => source.level === level && source.year === year);

const text = (value: unknown): string => (typeof value === "string" ? value : "");

const toAreas = (
  shapes: readonly Shape[],
  rows: readonly Row[],
  source: Source,
  measure: Measure,
): readonly Area[] => {
  const byCode = new Map(rows.map((row) => [row[source.codeField] ?? "", row]));
  const nameField = source.fields[1];
  return shapes.map((shape) => {
    const row = byCode.get(shape.id);
    const value = row === undefined ? Number.NaN : Number(row[measure.column]);
    return {
      id: shape.id,
      label: (nameField === undefined ? "" : text(shape.properties[nameField])) || shape.id,
      council: row?.council ?? "",
      value: Number.isFinite(value) ? value : undefined,
    };
  });
};

const hasValue = (area: Area): area is Area & { readonly value: number } =>
  area.value !== undefined;

const legendLabels = (
  breaks: readonly number[],
  low: number,
  high: number,
  digits: number,
): readonly string[] =>
  [low, ...breaks].map((from, index) => {
    const to = breaks[index] ?? high;
    return `${formatNumber(from, digits)} to ${formatNumber(to, digits)}`;
  });

// ---------- DOM ----------

const element = <T extends Element>(selector: string): T => {
  const found = document.querySelector<T>(selector);
  if (found === null) {
    throw new Error(`Page is missing ${selector}`);
  }
  return found;
};

const form = element<HTMLFormElement>("#slicers");
const mapSvg = element<SVGSVGElement>("#map");
const tooltip = element<HTMLElement>("#tooltip");
const status = element<HTMLElement>("#status");

const readSelection = (): Selection => {
  const values = new FormData(form);
  const level = String(values.get("level")) as Level;
  const year = Number(values.get("year"));
  const source = findSource(level, year);
  const wanted = String(values.get("type")) as MapType;
  // Not every method is built for every level, so fall back to the plain map.
  const type = source !== undefined && mapTypes(source).includes(wanted) ? wanted : "geographic";
  return {
    type,
    year,
    level,
    slug: String(values.get("area")),
    measure: MEASURES.find(({ column }) => column === values.get("measure")) ?? MEASURES[0]!,
  };
};

/** Greys out map types that do not exist for the chosen level and year. */
const syncTypeOptions = (source: Source, selected: MapType): void => {
  const available = mapTypes(source);
  for (const input of form.querySelectorAll<HTMLInputElement>('input[name="type"]')) {
    input.disabled = !available.includes(input.value as MapType);
    input.checked = input.value === selected;
  }
  element<HTMLElement>("#type-note").hidden = available.length === Object.keys(TYPE_LABELS).length;
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

const setText = (selector: string, value: string): void => {
  element<HTMLElement>(selector).textContent = value;
};

const renderMap = (
  shapes: readonly Shape[],
  areas: readonly Area[],
  breaks: readonly number[],
): void => {
  const drawing = draw(shapes, MAP_WIDTH, MAP_PADDING);
  const byId = new Map(areas.map((area) => [area.id, area]));
  mapSvg.setAttribute("viewBox", `0 0 ${drawing.width} ${drawing.height}`);
  mapSvg.replaceChildren(
    ...drawing.paths.map(({ id, d }) => {
      const path = document.createElementNS(SVG_NS, "path");
      const value = byId.get(id)?.value;
      path.setAttribute("d", d);
      path.setAttribute("class", value === undefined ? "area na" : `area q${classOf(value, breaks)}`);
      path.dataset.id = id;
      return path;
    }),
  );
};

const renderLegend = (labels: readonly string[]): void => {
  element<HTMLElement>("#legend").replaceChildren(
    ...labels.map((label, index) => {
      const item = document.createElement("li");
      const swatch = document.createElement("span");
      swatch.className = `swatch q${index}`;
      item.append(swatch, label);
      return item;
    }),
  );
};

const renderTiles = (areas: readonly Area[], measure: Measure): void => {
  const valued = areas.filter(hasValue).toSorted((a, b) => a.value - b.value);
  const values = valued.map((area) => area.value);
  const lowest = valued[0];
  const highest = valued.at(-1);
  setText("#tile-areas", formatNumber(areas.length, 0));
  setText("#tile-summary-label", measure.summary === "total" ? "Total" : "Average");
  setText(
    "#tile-summary",
    formatNumber(measure.summary === "total" ? sum(values) : mean(values), measure.digits),
  );
  setText("#tile-low", lowest === undefined ? "No data" : formatNumber(lowest.value, measure.digits));
  setText("#tile-low-area", lowest?.label ?? "");
  setText(
    "#tile-high",
    highest === undefined ? "No data" : formatNumber(highest.value, measure.digits),
  );
  setText("#tile-high-area", highest?.label ?? "");
};

const renderRanked = (areas: readonly Area[], measure: Measure): void => {
  const top = areas
    .filter(hasValue)
    .toSorted((a, b) => b.value - a.value)
    .slice(0, RANKED_ROWS);
  const max = top[0]?.value ?? 1;
  element<HTMLElement>("#ranked").replaceChildren(
    ...top.map((area) => {
      const item = document.createElement("li");
      item.dataset.id = area.id;
      const label = document.createElement("span");
      label.className = "ranked-label";
      label.textContent = area.label;
      const bar = document.createElement("span");
      bar.className = "ranked-bar";
      bar.style.width = `${Math.max(2, (area.value / max) * 100)}%`;
      const track = document.createElement("span");
      track.className = "ranked-track";
      track.append(bar);
      const value = document.createElement("span");
      value.className = "ranked-value";
      value.textContent = formatNumber(area.value, measure.digits);
      item.append(label, track, value);
      return item;
    }),
  );
};

const renderTable = (areas: readonly Area[], measure: Measure): void => {
  const sorted = areas.toSorted((a, b) => (b.value ?? -Infinity) - (a.value ?? -Infinity));
  setText("#table-measure", measure.label);
  element<HTMLElement>("#table-body").replaceChildren(
    ...sorted.map((area) => {
      const row = document.createElement("tr");
      const cells = [
        area.id,
        area.label === area.id ? "" : area.label,
        area.council,
        area.value === undefined ? "No data" : formatNumber(area.value, measure.digits),
      ];
      row.append(
        ...cells.map((cell) => {
          const td = document.createElement("td");
          td.textContent = cell;
          return td;
        }),
      );
      return row;
    }),
  );
};

let current: { readonly areas: ReadonlyMap<string, Area>; readonly measure: Measure } | undefined;

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
  const area = id === undefined ? undefined : current?.areas.get(id);
  if (area === undefined || current === undefined) {
    tooltip.hidden = true;
    highlight(undefined);
    return;
  }
  const { measure } = current;
  const value = area.value === undefined ? "No data" : formatNumber(area.value, measure.digits);
  tooltip.replaceChildren();
  const title = document.createElement("strong");
  title.textContent = area.label;
  const detail = document.createElement("span");
  detail.textContent = `${measure.label}: ${value}`;
  const code = document.createElement("span");
  code.className = "muted";
  code.textContent = [area.label === area.id ? "" : area.id, area.council]
    .filter((part) => part !== "")
    .join(" · ");
  tooltip.append(title, detail, code);
  tooltip.hidden = false;
  const frame = element<HTMLElement>("#map-frame").getBoundingClientRect();
  const left = Math.min(event.clientX - frame.left + 14, frame.width - tooltip.offsetWidth - 4);
  tooltip.style.left = `${Math.max(4, left)}px`;
  tooltip.style.top = `${event.clientY - frame.top + 14}px`;
  highlight(area.id);
};

const update = async (): Promise<void> => {
  const selection = readSelection();
  const source = findSource(selection.level, selection.year);
  if (source === undefined) {
    status.textContent = "No map for that level and version.";
    return;
  }
  syncTypeOptions(source, selection.type);
  status.textContent = "Loading map…";
  try {
    const [topology, csv] = await Promise.all([
      load(`maps/${outputStem(source, selection.slug, selection.type)}.json`, (r) => r.json()),
      load(`data/synthetic/${syntheticFile(source)}`, (r) => r.text()),
    ]);
    if (!isTopology(topology)) {
      throw new Error("The map file is not TopoJSON.");
    }
    const shapes = shapesOf(topology);
    const areas = toAreas(shapes, parseCsv(csv), source, selection.measure);
    const values = areas.filter(hasValue).map((area) => area.value);
    const breaks = classBreaks(values, CLASSES);
    const low = values.reduce((a, b) => Math.min(a, b), Infinity);
    const high = values.reduce((a, b) => Math.max(a, b), -Infinity);

    current = { areas: new Map(areas.map((area) => [area.id, area])), measure: selection.measure };
    renderMap(shapes, areas, breaks);
    renderLegend(legendLabels(breaks, low, high, selection.measure.digits));
    renderTiles(areas, selection.measure);
    renderRanked(areas, selection.measure);
    renderTable(areas, selection.measure);
    const heading = `${selection.measure.label} by ${LEVEL_LABELS[selection.level]}, ${selection.year} boundaries`;
    setText("#map-title", heading);
    setText("#map-type", `${TYPE_LABELS[selection.type]} map`);
    mapSvg.setAttribute("aria-label", `${heading}. ${TYPE_LABELS[selection.type]} map.`);
    setText("#ranked-title", `Highest ${Math.min(RANKED_ROWS, values.length)}`);
    status.textContent = "";
  } catch (error) {
    status.textContent = error instanceof Error ? error.message : "Could not load the map.";
  }
};

form.addEventListener("change", () => void update());
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

/** Lets a link open a chosen view, for example `?type=hexmap&level=oa`. */
const applyQuery = (): void => {
  for (const [name, value] of new URLSearchParams(location.search)) {
    const input = form.querySelector<HTMLInputElement>(
      `input[name="${CSS.escape(name)}"][value="${CSS.escape(value)}"]`,
    );
    if (input !== null) {
      input.checked = true;
    }
  }
};

const writeQuery = (): void => {
  const query = new URLSearchParams(
    [...new FormData(form)].map(([name, value]) => [name, String(value)]),
  );
  history.replaceState(null, "", `?${query}`);
};

form.addEventListener("change", writeQuery);
applyQuery();
void update();
