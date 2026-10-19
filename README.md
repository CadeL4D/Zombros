# Zombros

Open-world, low-poly co-op zombie survival in the browser. Design: [DESIGN.md](DESIGN.md).

## Layout

```
content/contracts/   skeleton, palette, slots, scale — the JSON every tool and the game read
packages/shared/     typed contracts + manifest validation (vitest)
packages/client/     Three.js (WebGPU, WebGL2 fallback) + Vite
assets/pipeline/     Blender Python: palette, export, build_all
assets/build/        exported GLBs, palette.png, manifest.json (committed; served by the client)
```

## Setup

Everything (Node, pnpm, Python, Blender, caches, AI models) lives inside this folder under `tools/`, `.venv/`, `.pnpm-store/` and `.cache/`. Nothing is installed globally. First time: `bash tools/setup.sh` (downloads and checksum-verifies everything). Then start each shell with:

```bash
source tools/env.sh
```

## Run

```bash
pnpm install
pnpm dev        # http://localhost:5173
pnpm test       # contract + manifest checks
```

## Rebuild assets

Live, through the Blender MCP: add `assets/pipeline` to `sys.path`, `import build_all; build_all.main()`.

Headless:

```bash
blender -b --factory-startup -P assets/pipeline/build_all.py
```

Survivors and zombies are coloured capsules for now; character modelling and animation come later (DESIGN.md §17).

## Contracts in short

- **Scale:** 1 unit = 1 m, 1 m build grid, wall module 2 × 3 m, human 1.8 m.
- **Skeleton:** 22 deform bones + `root`, `prop_L`, `prop_R` sockets; A-pose; names use `_L`/`_R`.
- **Palette:** 16 × 16 swatches; models only UV into swatch centres.

## Deploy

Every push to `main` builds and publishes to GitHub Pages (`.github/workflows/deploy.yml`). One-time: repo **Settings → Pages → Source: GitHub Actions**.
