// Blender coverage as the running app has it (the Splash Screen's Blender Coverage view): the source scan plus what the
// scene window provides from Blender's own code, per area.
import { readFile } from "node:fs/promises";
import { chromium, openApp, startServer } from "./app.mjs";
import { computeCoverage, runtimeAvailable } from "../../src/coverage/coverage.js";
import { percent } from "../../src/coverage/format.js";
import { scanImplemented } from "../../scripts/blender-coverage.mjs";

const server = await startServer({ build: false });
const browser = await chromium.launch();
const app = await openApp(browser, server.url);
const runtime = await app.bylonder((b) => b.coverage());
await browser.close();
await server.close();
const surface = JSON.parse(await readFile("src/coverage/blender-surface.json", "utf8"));
const notes = await readFile("docs/blender-coverage.md", "utf8"), implemented = await scanImplemented("src");
const scanned = computeCoverage(surface, implemented, notes), live = computeCoverage(surface, implemented, notes, runtimeAvailable(runtime));
console.log(`Blender ${live.blender}: ${percent(live)} live (${percent(scanned)} by the source scan alone), ${live.total} items`);
for (const area of live.tree.sort((a, b) => b.total - a.total)) console.log(`${area.id.padEnd(22)} ${percent(area).padStart(4)} of ${area.total}`);
const SCORE = { done: 1, equivalent: 1, replaced: 1, partial: 0.5 };
const view3d = live.tree.find((a) => a.id === "VIEW_3D");
for (const mode of view3d.c.filter((n) => n.k === "mode")) console.log(`  VIEW_3D ${mode.id.padEnd(14)} ${percent(mode).padStart(4)} of ${mode.total}`);
console.log("By kind:", Object.fromEntries(["menu", "panel", "op", "key"].map((k) => {
  const nodes = []; const walk = (n) => { if (n.k === k && n.status && n.status !== "skip") nodes.push(n); n.c?.forEach(walk); };
  live.tree.forEach(walk);
  return [k, `${Math.round(100 * nodes.reduce((s, n) => s + (SCORE[n.status] ?? 0), 0) / nodes.length)}% of ${nodes.length}`];
})));
