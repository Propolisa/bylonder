// Temporary probe: F12 with Cycles in the browser, printing the page's console and errors.
import { spawn } from "node:child_process";
import { chromium, openApp } from "../../tests/e2e/app.mjs";

const PORT = "5206", url = `http://localhost:${PORT}/`;
const server = spawn(process.execPath, ["node_modules/vite/bin/vite.js", "--port", PORT, "--strictPort"], { stdio: "ignore" });
while (!(await fetch(url).then((r) => r.ok, () => false))) await new Promise((r) => setTimeout(r, 300));
const browser = await chromium.launch();
try {
  const app = await openApp(browser, url, { example: "Window Light", node: "Carafe" });
  app.page.on("console", (m) => console.log("console:", m.text().slice(0, 300)));
  console.log("isolated:", await app.frame().evaluate(() => crossOriginIsolated), "threads:", await app.frame().evaluate(() => navigator.hardwareConcurrency));
  await app.bylonder((b) => { b.world.renderSettings.set("render.resolutionPercentage", 25); b.world.renderSettings.set("render.blenderEngine", "CYCLES"); });
  await new Promise((r) => setTimeout(r, 20000));
  await app.page.click('[data-blender="TOPBAR_MT_render"]');
  await app.page.getByRole("menuitem", { name: "Render Image" }).click({ noWaitAfter: true });
  const t = Date.now();
  await app.page.waitForFunction(() => /^(Finished|Render failed)/.test([...document.querySelectorAll("iframe")].map((f) => f.contentDocument?.querySelector(".render-result [data-status]")?.textContent).find(Boolean) ?? document.querySelector(".render-result [data-status]")?.textContent ?? ""), null, { timeout: 300000 });
  const status = await app.page.evaluate(() => [...document.querySelectorAll("iframe")].map((f) => f.contentDocument?.querySelector(".render-result [data-status]")?.textContent).find(Boolean) ?? document.querySelector(".render-result [data-status]")?.textContent);
  console.log("status:", status, `${(Date.now() - t) / 1000} s`);
  await app.page.screenshot({ path: process.argv[2] });
  console.log("errors:", app.errors.slice(0, 10));
} finally {
  await browser.close();
  server.kill();
}
