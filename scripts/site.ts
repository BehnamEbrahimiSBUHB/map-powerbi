// Assembles the dashboard into _site/: the bundled script, the page, and
// copies of the map files and sample data it loads.
//
// Usage: bun run scripts/site.ts [--serve]
//   --serve  also serve _site/ locally (port from PORT, default 4173)

import { cp, mkdir, rm } from "node:fs/promises";
import { join, normalize } from "node:path";

const ROOT = join(import.meta.dir, "..");
const SITE_SOURCE = join(ROOT, "site");
const OUTPUT = join(ROOT, "_site");
const DEFAULT_PORT = 4173;
const STATIC_FILES = ["index.html", "styles.css"] as const;
/** Folders the dashboard fetches from at run time. */
const DATA_FOLDERS = ["maps", "data"] as const;

const build = async (): Promise<void> => {
  await rm(OUTPUT, { recursive: true, force: true });
  await mkdir(OUTPUT, { recursive: true });
  const result = await Bun.build({
    entrypoints: [join(SITE_SOURCE, "src", "main.ts")],
    outdir: join(OUTPUT, "assets"),
    target: "browser",
    minify: true,
  });
  if (!result.success) {
    throw new Error(`Bundling failed:\n${result.logs.map(String).join("\n")}`);
  }
  await Promise.all([
    ...STATIC_FILES.map((file) => cp(join(SITE_SOURCE, file), join(OUTPUT, file))),
    ...DATA_FOLDERS.map((folder) => cp(join(ROOT, folder), join(OUTPUT, folder), { recursive: true })),
  ]);
  console.info(`Site written to ${OUTPUT}`);
};

const serve = (): void => {
  const port = Number(process.env.PORT ?? DEFAULT_PORT);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`PORT must be a port number, got ${process.env.PORT}`);
  }
  Bun.serve({
    port,
    hostname: "127.0.0.1",
    fetch: async (request) => {
      const pathname = decodeURIComponent(new URL(request.url).pathname);
      const target = normalize(join(OUTPUT, pathname === "/" ? "index.html" : pathname));
      // Refuse paths that climb out of the site folder.
      const file = target.startsWith(OUTPUT) ? Bun.file(target) : undefined;
      return file !== undefined && (await file.exists())
        ? new Response(file)
        : new Response("Not found", { status: 404 });
    },
  });
  console.info(`Serving http://127.0.0.1:${port}`);
};

await build();
if (process.argv.includes("--serve")) {
  serve();
}
