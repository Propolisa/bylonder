// Drives Bylonder's production build in Chromium, for the smoke tests and the visual parity harness.
import { execFileSync, spawnSync } from "node:child_process";
import { statSync } from "node:fs";
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
export async function openApp(browser, url, { example = "Default Cube", node = "Cube", size = { width: 1600, height: 950 } } = {}) {
  const context = await browser.newContext({ viewport: size, acceptDownloads: true });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  await page.goto(url);
  const frame = () => page.frames().findLast((f) => f.url().includes("viewport.html") && !f.isDetached());
  const splash = page.locator("dialog.bl-splash");
  if (example) await splash.getByRole("button", { name: example }).click();
  else {
    await splash.waitFor();
    await page.keyboard.press("Escape");
  }
  await page.waitForFunction((node) => {
    const w = document.querySelector('iframe[src*="viewport.html"]')?.contentWindow;
    return !!(w?.__bylonder?.editor && w.__bylonder.world.scene.getNodeByName(node));
  }, node, { timeout: 60000 });
  await page.click('[data-workspace="layout"]');
  const app = {
    page, context, errors, frame,
    // Evaluates fn(window.__bylonder, arg) in the 3D Viewport frame.
    bylonder: (fn, arg) => frame().evaluate(([source, arg]) => (0, eval)(source)(window.__bylonder, arg), [String(fn), arg]),
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
