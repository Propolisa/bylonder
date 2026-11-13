import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";
import { scanImplemented } from "./scripts/blender-coverage.mjs";
import { blenderIcons } from "./scripts/blender-icons.mjs";
import { execFileSync } from "node:child_process";
import { createReadStream, readdirSync, readFileSync, statSync } from "node:fs";
import { zipSync } from "fflate";
import { babylonArchive } from "./src/io_scene_babylon/babylon-sources.js";
import { demoFile } from "./scripts/demo-files.mjs";
import { staleModule } from "./scripts/module.mjs";
import pkg from "./package.json" with { type: "json" };

// Commits for the splash's version and changelog, newest first, without merges and work-in-progress commits; none when
// git or its history is unavailable.
const commits = () => {
  try {
    return execFileSync("git", ["log", "-100", "--no-merges", "--format=%h%x09%cI%x09%s"], { encoding: "utf8" }).trim().split("\n").filter(Boolean)
      .map((line) => { const [hash, time, subject] = line.split("\t"); return { hash, time, subject }; })
      .filter(({ subject }) => !/^WIP\b/.test(subject));
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

// virtual:blender-icons is Blender's icon set as one module.
const blenderIconSet = () => ({
  name: "blender-icons",
  resolveId: (id) => (id === "virtual:blender-icons" ? "\0blender-icons" : null),
  async load(id) {
    if (id === "\0blender-icons") return "export default " + JSON.stringify(await blenderIcons("public/icons/blender"));
  },
});

// The dev server answers blender-demo-files/<id>.blend as the site does (scripts/demo-files.mjs), from a copy in .tools/.
const demoFiles = () => ({
  name: "blender-demo-files",
  configureServer(server) {
    server.middlewares.use("/blender-demo-files", async (req, res, next) => {
      const id = /^\/([\w-]+)\.blend$/.exec(req.url.split("?")[0])?.[1];
      try {
        const path = id && await demoFile(id, ".tools/blender-demo-files");
        if (!path) return next();
        res.setHeader("Content-Type", "application/octet-stream");
        createReadStream(path).pipe(res);
      } catch (error) {
        res.statusCode = 502;
        res.end(error.message);
      }
    });
  },
});

// Babylon's module sources File > Export > JavaScript bundles a package with (io_scene_babylon/babylon-sources.js): the
// installed @babylonjs/core's modules and licence as one archive beside the app's pages, made once per server or build.
const babylonSources = () => {
  const core = fileURLToPath(new URL("./node_modules/@babylonjs/core/", import.meta.url));
  const { version } = JSON.parse(readFileSync(core + "package.json", "utf8"));
  const name = babylonArchive(version);
  let archive;
  const bytes = () => (archive ??= zipSync(Object.fromEntries(readdirSync(core, { recursive: true }).map((path) => path.replaceAll("\\", "/"))
    .filter((path) => path.endsWith(".js") || path === "license.md").map((path) => [path, readFileSync(core + path)]))));
  return {
    name: "babylon-sources",
    configureServer(server) {
      server.middlewares.use(`${server.config.base}${name}`, (req, res) => {
        res.setHeader("Content-Type", "application/zip");
        res.end(bytes());
      });
    },
    generateBundle() {
      this.emitFile({ type: "asset", fileName: name, source: bytes() });
    },
  };
};

// The live demos of exported pages (tools/docs/export-demo.mjs), published as they are: built, they would be bundled.
const demos = () => ({
  name: "export-demos",
  generateBundle() {
    for (const path of readdirSync("docs/demos", { recursive: true }).map((path) => `docs/demos/${path.replaceAll("\\", "/")}`))
      if (statSync(path).isFile()) this.emitFile({ type: "asset", fileName: path, source: readFileSync(path) });
  },
});

// A dev server on a source tree whose Blender module is out of date says so, in its terminal and on the app's page,
// instead of the app failing later on a function the old module lacks.
const moduleCheck = () => ({
  name: "module-check",
  apply: "serve",
  configureServer(server) {
    const stale = staleModule();
    if (stale) server.config.logger.warn(`
Blender's module is ${stale}, built for another source tree: run npm run module
`);
  },
  transformIndexHtml() {
    const stale = staleModule();
    return stale ? [{ tag: "div", injectTo: "body-prepend", attrs: { style: "position:fixed;inset:0 0 auto 0;z-index:99999;padding:8px 16px;background:#7a1f1f;color:#fff;font:14px system-ui" },
      children: `Blender's module (${stale}) is out of date for this source tree: run npm run module, then reload.` }] : [];
  },
});

// Cross-origin isolation for Blender's threads (SharedArrayBuffer), as the site's service worker gives it
// (public/workspace-sw.js): every page and file but the docs viewer's page, whose embeds are other sites' pages.
const isolation = () => ({
  name: "cross-origin-isolation",
  configureServer(server) {
    server.middlewares.use((req, res, next) => {
      if (!req.url.split("?")[0].endsWith("/docs.html")) {
        res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
        res.setHeader("Cross-Origin-Embedder-Policy", "credentialless");
      }
      next();
    });
  },
});

export default defineConfig({
  base: process.env.BASE_PATH || "/",
  plugins: [vue(), tailwindcss(), blenderCoverage(), blenderIconSet(), changelog(), demoFiles(), babylonSources(), demos(), isolation(), moduleCheck()],
  define: { __BYLONDER_VERSION__: JSON.stringify(pkg.version), __BYLONDER_CHANGE__: JSON.stringify(commits()[0] ?? null) },
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  // Agents' worktrees live under .claude/: their edits must not reload this checkout's pages (a worktree's own server
  // watches its own files).
  // Blender's backups (*.blend1, written beside a saved .blend) and the dev tools never reload the page.
  server: { watch: { ignored: [`${fileURLToPath(new URL("./.claude", import.meta.url)).replaceAll("\\", "/")}/**`, "**/*.blend1", "**/.tools/**", "**/.shots/**", "**/examples/*/downloads/**"] } },
  build: {
    target: "esnext",
    rollupOptions: {
      input: { workspace: "index.html", viewport: "viewport.html", render: "render.html", docs: "docs.html" },
      // Babylon's shaders, each its own dynamic import (four per effect), in one chunk: one request, not hundreds.
      output: { manualChunks: (id) => (/@babylonjs\/core\/Shaders(WGSL)?\//.test(id) ? "babylon-shaders" : undefined) },
    },
    chunkSizeWarningLimit: 7000,
  },
  worker: { format: "es" },
  // The KubeezCut embed is prebuilt and loads its workers and chunks relative to its own files.
  optimizeDeps: { exclude: ["kubeezcut-embed"] },
});
