# Contributing

Thanks for helping. This page explains how to set up, what to run and what to check before you open a pull request.

## Ways to help

- Report a map that does not load or does not match your data: open a **Problem with a map file** issue.
- Ask for another area, level or version: open a **Request a map** issue.
- Fix or improve a guide in [`docs/`](docs).
- Improve the build scripts or the dashboard.

## Set up

You need [Bun](https://bun.sh).

```sh
git clone https://github.com/CodeWithBehnam/map-powerbi.git
cd map-powerbi
bun install
```

Rebuilding the hex maps also needs R 4.1 or newer with four packages. See [Install the R packages](docs/your-own-map.md#install-the-r-packages). You do not need R to work on guides, checks or the dashboard.

## Commands

| Command | What it does | Needs |
|---|---|---|
| `bun run typecheck` | Type-checks the scripts and the dashboard. | Bun |
| `bun run check` | Checks every map file, image and sample data file. | Bun |
| `bun run site:serve` | Builds the dashboard and serves it at `http://127.0.0.1:4173`. | Bun |
| `bun run data` | Rewrites the synthetic sample data. | Bun, a finished build |
| `bun run build` | Rebuilds `maps/` and `images/`, reusing downloads and hexagons in `.cache/`. | Bun, R |
| `bun run build:rehex` | Same, but computes the hexagons again. Slow. | Bun, R |
| `bun run build:refresh` | Downloads from ONS again and rebuilds everything. Slowest. | Bun, R, internet |

## How the repository fits together

| Path | What it holds | Edit by hand? |
|---|---|---|
| `scripts/sources.ts` | Which ONS layers, councils and hex methods to build. | Yes |
| `scripts/build.ts`, `scripts/hex.R` | The build. | Yes |
| `maps/`, `images/` | Generated map files and previews. | No. Change the scripts and rebuild. |
| `data/synthetic/` | Generated sample data. | No. Change `scripts/synthetic.ts`. |
| `site/` | The dashboard source. | Yes |
| `docs/` | The guides. | Yes |

Generated files are committed, because people download them straight from GitHub.

## Before you open a pull request

1. Run `bun run typecheck` and `bun run check`.
2. If you changed the maps or the dashboard, run `bun run site:serve` and look at the page.
3. If paths, area counts or map keys changed, update `README.md` and the guides.
4. Keep the change small and say what you checked in the pull request.

## Style

- British English in prose and comments.
- Commit messages follow [Conventional Commits](https://www.conventionalcommits.org), for example `fix: correct 2011 MSOA key name`.
- TypeScript is strict. Keep logic in pure functions and file or network access at the edges.
- Comments explain why, not what.

## Licences

- Code and guides: [MIT](LICENSE).
- Boundary data: [Open Government Licence v3.0](https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/), from the Office for National Statistics. Keep the attribution in `README.md`.

By contributing, you agree that your work is released under the MIT licence.
