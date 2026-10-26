import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";
import { scanImplemented } from "./scripts/blender-coverage.mjs";
import pkg from "./package.json" with { type: "json" };

// virtual:blender-coverage lists the Blender identifiers found in src/, scanned on every load.
const blenderCoverage = () => ({
  name: "blender-coverage",
  resolveId: (id) => (id === "virtual:blender-coverage" ? "\0blender-coverage" : null),
  async load(id) {
    if (id === "\0blender-coverage") return "export default " + JSON.stringify(await scanImplemented("src"));
  },
  handleHotUpdate({ file, server }) {
    const mod = server.moduleGraph.getModuleById("\0blender-coverage");
    if (mod && /\/src\/.*\.(js|vue)$/.test(file)) server.moduleGraph.invalidateModule(mod);
  },
});

export default defineConfig({
  base: process.env.BASE_PATH || "/",
  plugins: [vue(), tailwindcss(), blenderCoverage()],
  define: { __BYLONDER_VERSION__: JSON.stringify(pkg.version) },
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  build: {
    target: "esnext",
    rollupOptions: {
      input: { workspace: "index.html", viewport: "viewport.html", render: "render.html", docs: "docs.html" },
    },
    chunkSizeWarningLimit: 7000,
  },
  worker: { format: "es" },
  // The KubeezCut embed is prebuilt and loads its workers and chunks relative to its own files.
  optimizeDeps: { exclude: ["kubeezcut-embed"] },
});
