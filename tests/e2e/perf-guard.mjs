// Perf guard: opens heavy Blender demo files (from .tools/blender-demo-files, the dev server's cache) in Material
// Preview and Rendered and measures, for each, how long the view takes to go idle after the switch, Main's
// evaluations in 3 s of idle, and the frames drawn in 6 s of an orbit (Numpad 6 steps, view3d.view_orbit) after its
// first second. Compared with tests/fixtures/perf-baseline.json when it was recorded on this machine: fails when an orbit draws 30% fewer frames,
// a view no longer goes idle or takes over twice as long, or an idle view evaluates more. Skips missing demo files.
// usage: node tests/e2e/perf-guard.mjs   (UPDATE=1 records the baseline)
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { cpus } from "node:os";
import { fileURLToPath } from "node:url";
import { chromium, openApp, startServer } from "./app.mjs";

const DEMOS = ["gaku", "bike_ride", "impact_fracture"];
const SHADINGS = ["material", "rendered"];
const IDLE_WITHIN = 120000, IDLE_SPAN = 3000, ORBIT_SPAN = 6000, ORBIT_WARMUP = 1000, MAX_FRAME_DROP = 0.3;
const BASELINE = new URL("../fixtures/perf-baseline.json", import.meta.url);
const demoPath = (id) => fileURLToPath(new URL(`../../.tools/blender-demo-files/${id}.blend`, import.meta.url));

const demos = DEMOS.filter((id) => existsSync(demoPath(id)));
const missing = DEMOS.filter((id) => !demos.includes(id));
if (missing.length) console.log(`skip ${missing.join(", ")}: not in .tools/blender-demo-files (the dev server downloads a demo file there on first open)`);
if (!demos.length) process.exit(0);

// Counts what happens in the 3D Viewport frame for `ms`: frames drawn by an enabled view and Main's evaluations.
const count = (app, ms) => app.bylonder(async (b, ms) => {
  const { engine, mainSync } = b.world;
  let frames = 0, evaluations = 0;
  const counting = engine.onEndFrameObservable.add(() => { if (engine.views.some((view) => view.enabled)) frames++; });
  const stop = mainSync.onEvaluated(() => evaluations++);
  await new Promise((done) => setTimeout(done, ms));
  engine.onEndFrameObservable.remove(counting);
  stop();
  return { frames, evaluations };
}, ms);

async function open(browser, url, id) {
  const app = await openApp(browser, url, { example: null, node: "sphere" });
  const chooser = app.page.waitForEvent("filechooser");
  await app.page.click('[data-blender="TOPBAR_MT_file"]');
  await app.page.getByRole("menuitem", { name: "Open..." }).click();
  await (await chooser).setFiles(demoPath(id));
  // Opening a .blend loads the 3D Viewport's frame again.
  await app.page.waitForFunction(() => {
    const scene = document.querySelector('iframe[src*="viewport.html"]')?.contentWindow?.__bylonder?.world?.scene;
    return scene && !scene.getNodeByName("sphere") && scene.meshes.length > 0;
  }, null, { timeout: 180000 });
  await app.settled();
  return app;
}

async function measure(app, shading) {
  await app.bylonder((b, shading) => b.views.input.setShading(shading), shading);
  const switched = Date.now();
  const idle = await app.until((b) => b.views.idle, null, IDLE_WITHIN).then(() => Math.round((Date.now() - switched) / 100) / 10, () => null);
  const { evaluations } = await count(app, IDLE_SPAN);
  await app.hover(0.5, 0.5);
  await orbit(app, ORBIT_WARMUP);
  const counted = count(app, ORBIT_SPAN);
  await orbit(app, ORBIT_SPAN);
  return { frames: (await counted).frames, idle, evaluations };
}

async function orbit(app, ms) {
  for (const end = Date.now() + ms; Date.now() < end;) {
    await app.page.keyboard.press("Numpad6");
    await app.page.waitForTimeout(50);
  }
}

// What failed of `now` against `base`, as lines.
const regressions = (now, base) => [
  now.frames < base.frames * (1 - MAX_FRAME_DROP) && `orbit drew ${now.frames} frames, the baseline ${base.frames}`,
  now.idle === null && base.idle !== null && `never idle within ${IDLE_WITHIN / 1000} s (the baseline: ${base.idle} s)`,
  now.idle > base.idle * 2 + 5 && base.idle !== null && `idle after ${now.idle} s (the baseline: ${base.idle} s)`,
  now.evaluations > base.evaluations && `${now.evaluations} evaluations while idle (the baseline: ${base.evaluations})`,
].filter(Boolean);

const server = await startServer();
const browser = await chromium.launch();
const results = {};
let machine, app;
try {
  for (const id of demos) {
    const started = Date.now();
    app = await open(browser, server.url, id);
    machine ??= `${process.platform}, ${cpus()[0].model.trim()}, ${await app.bylonder((b) => b.world.engine.getGlInfo?.().renderer ?? b.world.engine.description)}`;
    results[id] = {};
    for (const shading of SHADINGS) results[id][shading] = await measure(app, shading);
    if (app.errors.length) console.log(`${id}: ${app.errors.length} page error(s), the first: ${app.errors[0].split("\n")[0]}`);
    await app.close();
    app = null;
    console.log(`${id} (${((Date.now() - started) / 1000).toFixed(0)} s)`);
  }
} finally {
  await app?.close();
  await browser.close();
  await server.close();
}

const baseline = existsSync(BASELINE) ? JSON.parse(readFileSync(BASELINE, "utf8")) : null;
const compared = baseline?.machine === machine;
if (!compared) console.log(baseline ? `the baseline is from another machine (${baseline.machine}): reporting only` : "no baseline: reporting only (UPDATE=1 records one)");
let failed = 0;
for (const [id, shadings] of Object.entries(results)) for (const [shading, now] of Object.entries(shadings)) {
  const base = baseline?.demos[id]?.[shading];
  const problems = compared && base ? regressions(now, base) : [];
  failed += problems.length;
  const was = base ? ` (baseline ${base.frames} frames, idle ${base.idle ?? "never"})` : "";
  console.log(`${problems.length ? "FAIL" : "ok  "}  ${id} ${shading}: orbit ${now.frames} frames, idle after ${now.idle ?? "never"} s, ${now.evaluations} idle evaluations${was}`);
  for (const problem of problems) console.log(`        ${problem}`);
}
if (process.env.UPDATE) {
  writeFileSync(BASELINE, `${JSON.stringify({ machine, demos: { ...(compared && baseline.demos), ...results } }, null, 2)}\n`);
  console.log(`wrote ${fileURLToPath(BASELINE)}`);
}
process.exitCode = failed && !process.env.UPDATE ? 1 : 0;
