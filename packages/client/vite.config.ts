import { defineConfig } from "vite";

export default defineConfig({
  // GitHub Pages serves the site from /<repo>/; CI sets BASE_PATH.
  base: process.env.BASE_PATH ?? "/",
  // Exported game assets (GLB, palette, manifest) are served as-is.
  publicDir: "../../assets/build",
  build: { target: "es2022", chunkSizeWarningLimit: 1500 },
  // Terrain workers import shared code as ES modules.
  worker: { format: "es" },
  // host: reachable from phones on the same Wi-Fi (http://<pc-ip>:5173).
  server: { port: 5173, host: true },
  preview: { host: true },
});
