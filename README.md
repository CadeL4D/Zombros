# Zombros

Open-world, low-poly co-op zombie survival in the browser. Design: [DESIGN.md](DESIGN.md).

## Layout

```
content/contracts/   skeleton, palette, slots, scale — the JSON every tool and the game read
packages/shared/     typed contracts + manifest validation (vitest)
packages/client/     Three.js (WebGPU, WebGL2 fallback) + Vite
assets/pipeline/     Blender Python: palette, base_human, validate, export, build_all
assets/build/        exported GLBs, palette.png, manifest.json (committed; served by the client)
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
"C:\Program Files\Blender Foundation\Blender 5.1\blender.exe" -b --factory-startup -P assets/pipeline/build_all.py
```

`build_all` validates every asset against the contracts (bones, tri budget, 1–4 weights per vertex, palette-only UVs) before exporting, then updates `assets/build/manifest.json`.

## Contracts in short

- **Scale:** 1 unit = 1 m, 1 m build grid, wall module 2 × 3 m, human 1.8 m.
- **Skeleton:** 22 deform bones + `root`, `prop_L`, `prop_R` sockets; A-pose; names use `_L`/`_R`.
- **Character height** is a runtime uniform scale (0.9–1.1); body shape is morphs: `female`, `heavy`, `thin`, `muscular`.
- **Palette:** 16 × 16 swatches; models only UV into swatch centres. Recolour per character by repainting a swatch (`PaletteTexture.recolor`).

## Deploy

Every push to `main` builds and publishes to GitHub Pages (`.github/workflows/deploy.yml`). One-time: repo **Settings → Pages → Source: GitHub Actions**.
