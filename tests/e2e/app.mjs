// Drives Bylonder's production build in Chromium, for the smoke tests and the visual parity harness.
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, statSync } from "node:fs";
import { variantItems } from "../../src/coverage/coverage.js";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";
import { preview } from "vite";

const root = new URL("../..", import.meta.url).pathname;
// Playwright comes from the environment (preinstalled with its Chromium), not from package.json. Pyodide loads from
// its CDN, through the environment's proxy where one is set (Chromium bypasses it for the local server).
const playwright = createRequire(import.meta.url)("playwright");
const proxy = process.env.HTTPS_PROXY && { proxy: { server: process.env.HTTPS_PROXY, bypass: "localhost,127.0.0.1" } };
// Mesa's llvmpipe through ANGLE, as nodes-gpu.test.js runs: Chromium's default SwiftShader takes seconds a frame over
// Blender's 4D noise.
const gl = ["--use-gl=angle", "--use-angle=gl-egl", "--ignore-gpu-blocklist"];
export const chromium = { launch: (options) => playwright.chromium.launch({ ...proxy, args: gl, ...options }) };
// Chromium's incognito contexts crash on file handles read back from IndexedDB (the Sequencer's media library): checks
// that reload with media open the app in a profile of its own.
const persistentContext = (options) => playwright.chromium.launchPersistentContext(mkdtempSync(`${tmpdir()}/bylonder-profile-`), { ...proxy, args: gl, ...options });

const mtime = (file) => statSync(root + file, { throwIfNoEntry: false })?.mtimeMs ?? 0;
const stale = () => {
  const built = mtime("dist/index.html");
  const files = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard"], { cwd: root, encoding: "utf8" }).split("\n");
  return files.some((file) => file && !/^(tests|tools)\/|\.md$/.test(file) && mtime(file) > built);
};

// Serves dist/ with vite preview, building it first when any app source file is newer (unless `build` is false: the
// production check tests the dist/ it is given). E2E_URL uses a running server instead.
export async function startServer({ build = true } = {}) {
  if (process.env.E2E_URL) return { url: process.env.E2E_URL, close() {} };
  if (!build && !mtime("dist/index.html")) throw Error("No dist/: run npm run build first");
  if (build && stale()) {
    console.log("Building dist/ ...");
    if (spawnSync("npm", ["run", "build"], { cwd: root, stdio: ["ignore", "ignore", "inherit"] }).status) throw Error("Build failed");
  }
  const server = await preview({ root, logLevel: "warn", preview: { port: 4320, strictPort: false } });
  return { url: server.resolvedUrls.local[0], close: () => server.close() };
}

// Opens Bylonder in a fresh browser context (fresh project storage), opens `example` from the splash (none: the new
// project's scene) and waits until the 3D Viewport shows the node `node`. Page errors of every frame land in `errors`.
// `link`: an example's id, opened by its #example= link instead of the splash. `video`: a directory to record the
// session to. `persistent`: a browser profile of its own instead of an incognito context. `touch`: a touch device
// (touch events, a coarse pointer, no hover).
export async function openApp(browser, url, { example = "Default Cube", node = "Cube", link, size = { width: 1600, height: 950 }, scale = 1, video, persistent, touch } = {}) {
  const options = { viewport: size, deviceScaleFactor: scale, acceptDownloads: true, ...(touch && { hasTouch: true, isMobile: true }), ...(video && { recordVideo: { dir: video, size } }) };
  const context = await (persistent ? persistentContext(options) : browser.newContext(options));
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(process.env.E2E_STACKS ? error.stack : error.message));
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  await page.goto(link ? `${url}#example=${link}` : url);
  const frame = () => page.frames().findLast((f) => f.url().includes("viewport.html") && !f.isDetached());
  const splash = page.locator("dialog.bl-splash");
  if (link) await page.waitForURL((url) => !url.hash);
  else if (example) {
    const button = splash.getByRole("button", { name: example, exact: true });
    if (!(await button.count())) await splash.getByRole("button", { name: "Examples…" }).click();
    await button.click();
  }
  else {
    await splash.waitFor();
    await page.keyboard.press("Escape");
  }
  await page.waitForFunction((node) => {
    const w = document.querySelector('iframe[src*="viewport.html"]')?.contentWindow;
    return !!(w?.__bylonder?.editor && (!node || w.__bylonder.world.scene.getNodeByName(node)));
  }, node, { timeout: 180000 });
  await page.locator('[data-workspace="layout"]').evaluate((tab) => tab.click());
  const app = {
    page, context, errors, frame,
    // Evaluates fn(window.__bylonder, arg) in the 3D Viewport frame.
    bylonder: (fn, arg) => frame().evaluate(([source, arg]) => (0, eval)(source)(window.__bylonder, arg), [String(fn), arg]),
    // Resolves once the app has done what the last input started (__bylonder.settled).
    settled: () => frame().evaluate(() => window.__bylonder.settled()),
    // Waits until fn(window.__bylonder, arg) is truthy.
    until: (fn, arg, timeout = 15000) => frame().waitForFunction(([source, arg]) => (0, eval)(source)(window.__bylonder, arg), [String(fn), arg], { timeout }),
    locator: (selector) => frame().locator(selector),
    // The status bar's scene statistics, as numbers: { Verts, Tris, Objects: [selected, total], ... }.
    async stats() {
      const text = await page.locator("#scene-stats").textContent();
      return Object.fromEntries([...text.matchAll(/(\w+):([\d,]+)(?:\/([\d,]+))?/g)].map(([, key, a, b]) => {
        const n = (s) => Number(s.replaceAll(",", ""));
        return [key, b === undefined ? n(a) : [n(a), n(b)]];
      }));
    },
    // A point of a 3D Viewport in page coordinates, given as fractions of its size; its center shows the Default Cube.
    async point(fx = 0.5, fy = 0.5, index = 0) {
      const box = await frame().locator(".viewport-canvas").nth(index).boundingBox();
      return [box.x + box.width * fx, box.y + box.height * fy];
    },
    hover: async (...args) => page.mouse.move(...(await app.point(...args))),
    click: async (...args) => page.mouse.click(...(await app.point(...args))),
    close: () => context.close(),
  };
  return app;
}

// What the scene window runs of Blender's own code once a first visit boots (the Blender Coverage view's run-time
// list), sorted. scripts/feature-docs.mjs --runtime saves it; npm run test:prod checks the saved copy.
export const BOOT = { example: null, node: "sphere" };
export async function runtimeCoverage(app) {
  const surface = JSON.parse(readFileSync(new URL("../../src/coverage/blender-surface.json", import.meta.url), "utf8"));
  const { operators, spaceOperators, classes, variants } = await app.bylonder((b, items) => b.coverage(items), variantItems(surface));
  const sorted = (ids) => [...new Set(ids)].sort();
  return { operators: sorted(operators), spaceOperators: Object.fromEntries(Object.entries(spaceOperators).sort().map(([space, ids]) => [space, sorted(ids)])),
    classes: sorted(classes), variants: sorted(variants) };
}
