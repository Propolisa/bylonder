import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";
import { scanImplemented } from "./scripts/blender-coverage.mjs";
import { execFileSync } from "node:child_process";
import pkg from "./package.json" with { type: "json" };

// Commits for the splash's version and changelog, newest first; none when git or its history is unavailable.
const commits = () => {
  try {
    return execFileSync("git", ["log", "-100", "--format=%h%x09%cI%x09%s"], { encoding: "utf8" }).trim().split("\n").filter(Boolean)
      .map((line) => { const [hash, time, subject] = line.split("\t"); return { hash, time, subject }; });
  } catch {
    return [];
  }
};
const changelog = () => ({
  name: "bylonder-changelog",
  resolveId: (id) => (id === "virtual:bylonder-changelog" ? "\0bylonder-changelog" : null),
  load: (id) => (id === "\0bylonder-changelog" ? "export default " + JSON.stringify(commits()) : null),
});

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
  plugins: [vue(), tailwindcss(), blenderCoverage(), changelog()],
  define: { __BYLONDER_VERSION__: JSON.stringify(pkg.version), __BYLONDER_CHANGE__: JSON.stringify(commits()[0] ?? null) },
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
