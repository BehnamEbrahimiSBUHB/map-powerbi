// Turns a TopoJSON file into SVG path data. Pure functions, no DOM.

export type Point = readonly [number, number];

interface TopoGeometry {
  readonly type: string;
  readonly id?: string;
  readonly properties?: Readonly<Record<string, unknown>>;
  readonly arcs?: unknown;
}

export interface Topology {
  readonly type: "Topology";
  readonly transform?: { readonly scale: Point; readonly translate: Point };
  readonly arcs: readonly (readonly Point[])[];
  readonly objects: Readonly<Record<string, { readonly geometries?: readonly TopoGeometry[] }>>;
}

export interface Shape {
  readonly id: string;
  readonly properties: Readonly<Record<string, unknown>>;
  /** Polygons, each a list of rings, each a list of longitude/latitude points. */
  readonly polygons: readonly (readonly (readonly Point[])[])[];
}

export const isTopology = (value: unknown): value is Topology =>
  typeof value === "object" &&
  value !== null &&
  (value as { type?: unknown }).type === "Topology" &&
  Array.isArray((value as { arcs?: unknown }).arcs);

/** TopoJSON stores each arc as steps from the previous point, scaled to integers. */
const decodeArc = (arc: readonly Point[], transform: Topology["transform"]): readonly Point[] => {
  if (transform === undefined) {
    return arc;
  }
  const { scale, translate } = transform;
  let x = 0;
  let y = 0;
  return arc.map(([dx, dy]) => {
    x += dx;
    y += dy;
    return [x * scale[0] + translate[0], y * scale[1] + translate[1]] as const;
  });
};

/** A negative index means the arc at ~index, walked backwards. */
const ring = (indexes: readonly number[], arcs: readonly (readonly Point[])[]): readonly Point[] =>
  indexes.flatMap((index, position) => {
    const arc = arcs[index < 0 ? ~index : index] ?? [];
    const points = index < 0 ? arc.toReversed() : arc;
    // Each arc starts where the previous one ended, so drop the repeated point.
    return position === 0 ? points : points.slice(1);
  });

const polygonsOf = (
  geometry: TopoGeometry,
  arcs: readonly (readonly Point[])[],
): Shape["polygons"] => {
  if (geometry.type === "Polygon") {
    return [(geometry.arcs as readonly (readonly number[])[]).map((r) => ring(r, arcs))];
  }
  if (geometry.type === "MultiPolygon") {
    return (geometry.arcs as readonly (readonly (readonly number[])[])[]).map((polygon) =>
      polygon.map((r) => ring(r, arcs)),
    );
  }
  return [];
};

export const shapesOf = (topology: Topology): readonly Shape[] => {
  const arcs = topology.arcs.map((arc) => decodeArc(arc, topology.transform));
  return Object.values(topology.objects).flatMap((object) =>
    (object.geometries ?? []).map((geometry) => ({
      id: geometry.id ?? "",
      properties: geometry.properties ?? {},
      polygons: polygonsOf(geometry, arcs),
    })),
  );
};

/** Mercator, the projection the Power BI guide recommends. y grows downwards for SVG. */
const mercator = ([lon, lat]: Point): Point => [
  (lon * Math.PI) / 180,
  -Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360)),
];

export interface Drawing {
  readonly width: number;
  readonly height: number;
  readonly paths: readonly { readonly id: string; readonly d: string }[];
}

/** Projects the shapes and scales them to fit a box of the given width. */
export const draw = (shapes: readonly Shape[], width: number, padding: number): Drawing => {
  const projected = shapes.map((shape) => ({
    id: shape.id,
    polygons: shape.polygons.map((polygon) => polygon.map((r) => r.map(mercator))),
  }));
  const all = projected.flatMap((shape) => shape.polygons.flat(2));
  if (all.length === 0) {
    return { width, height: width, paths: [] };
  }
  const xs = all.map(([x]) => x);
  const ys = all.map(([, y]) => y);
  const minX = xs.reduce((a, b) => Math.min(a, b));
  const maxX = xs.reduce((a, b) => Math.max(a, b));
  const minY = ys.reduce((a, b) => Math.min(a, b));
  const maxY = ys.reduce((a, b) => Math.max(a, b));
  const scale = (width - 2 * padding) / (maxX - minX || 1);
  const place = ([x, y]: Point): string =>
    `${((x - minX) * scale + padding).toFixed(1)} ${((y - minY) * scale + padding).toFixed(1)}`;

  return {
    width,
    height: Math.ceil((maxY - minY) * scale + 2 * padding),
    paths: projected.map((shape) => ({
      id: shape.id,
      d: shape.polygons
        .flatMap((polygon) => polygon.map((r) => `M${r.map(place).join("L")}Z`))
        .join(""),
    })),
  };
};
