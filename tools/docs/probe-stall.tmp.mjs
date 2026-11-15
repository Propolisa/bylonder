// Temporary probe: what the page's thread does during an F12 with Cycles (CPU profile of the page, longest tasks).
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import { chromium, openApp } from "../../tests/e2e/app.mjs";

const PORT = "5207", url = `http://localhost:${PORT}/`;
const server = spawn(process.execPath, ["node_modules/vite/bin/vite.js", "--port", PORT, "--strictPort"], { stdio: "ignore" });
while (!(await fetch(url).then((r) => r.ok, () => false))) await new Promise((r) => setTimeout(r, 300));
const browser = await chromium.launch();
try {
  const app = await openApp(browser, url, { example: "Window Light", node: "Carafe" });
  await app.bylonder((b) => { b.world.renderSettings.set("render.resolutionPercentage", 25); b.world.renderSettings.set("render.blenderEngine", "CYCLES"); });
  await new Promise((r) => setTimeout(r, 20000));
  await app.frame().evaluate(() => {
    window.__long = [];
    new PerformanceObserver((list) => window.__long.push(...list.getEntries().map((e) => Math.round(e.duration)))).observe({ type: "longtask" });
  });
  const cdp = await app.page.context().newCDPSession(app.page);
  await cdp.send("Profiler.enable");
  await cdp.send("Profiler.setSamplingInterval", { interval: 500 });
  await cdp.send("Profiler.start");
  await app.page.click('[data-blender="TOPBAR_MT_render"]');
  await app.page.getByRole("menuitem", { name: "Render Image" }).click();
  const status = () => app.page.evaluate(() => [...document.querySelectorAll("iframe")].map((f) => f.contentDocument?.querySelector(".render-result [data-status]")?.textContent).find(Boolean) ?? "");
  for (let t = Date.now(); Date.now() - t < 300000 && !/^(Finished|Render failed)/.test(await status());) await new Promise((r) => setTimeout(r, 1000));
  const { profile } = await cdp.send("Profiler.stop");
  console.log("status:", await status());
  console.log("long tasks (ms):", (await app.frame().evaluate(() => window.__long)).sort((a, b) => b - a).slice(0, 15).join(" "));
  // Self time by function.
  const self = new Map(), byId = new Map(profile.nodes.map((n) => [n.id, n]));
  profile.samples.forEach((id, i) => {
    const f = byId.get(id).callFrame, key = `${f.functionName || "(anon)"} ${f.url.split("/").pop()}:${f.lineNumber}`;
    self.set(key, (self.get(key) ?? 0) + (profile.timeDeltas[i] ?? 0) / 1000);
  });
  console.log([...self].filter(([k]) => !/\(idle\)|\(program\)/.test(k)).sort((a, b) => b[1] - a[1]).slice(0, 25).map(([k, ms]) => `${ms.toFixed(0)} ms ${k}`).join("\n"));
  writeFileSync(process.argv[2], JSON.stringify(profile));
} finally {
  await browser.close();
  server.kill();
}
