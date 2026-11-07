// Side-by-side manual testing: the same steps in Bylonder and Blender 5.2.3, a screenshot pair after each step. Bylonder
// runs the steps first (Playwright), aiming at Blender's identifiers (data-blender="VIEW3D_MT_object") or at points;
// the mouse positions and keys it received are then replayed in Blender (steps.py, Blender's event simulation), so
// both get the same input. Writes NN-side-by-side.png (Blender left, Bylonder right) and NN-diff.png per step.
// usage: node tools/blender-reference/side-by-side.mjs STEPS.json [--out DIR]
//   STEPS.json: [{ "click": "VIEW3D_MT_object" | [x, y] | { "view": [fx, fy] } }, { "key": "Shift+A", "at": ... },
//   { "move": ... }, { "shading": "SOLID" | "MATERIAL" | "RENDERED" | "WIREFRAME" }, { "settle": seconds }], window
//   pixels from the top left of a 1600 x 950 window; "view" is a point of the 3D Viewport as fractions of its size;
//   "shading" sets the 3D Viewports' shading in both.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, openApp, startServer } from "../../tests/e2e/app.mjs";
import { TOOLS } from "../../tests/e2e/tools.mjs";
import { referenceBlender } from "../../tests/blender-reference.js";
import { compare } from "./compare.mjs";

const here = fileURLToPath(new URL(".", import.meta.url)), root = fileURLToPath(new URL("../..", import.meta.url));
const args = process.argv.slice(2);
const out = resolve(args.includes("--out") ? args.splice(args.indexOf("--out"), 2)[1] : join(root, ".shots", "side-by-side"));
// --file: a .blend both open first (Blender from its command line, Bylonder by File > Open), instead of the startup file.
const file = args.includes("--file") ? resolve(args.splice(args.indexOf("--file"), 2)[1]) : null;
const steps = JSON.parse(readFileSync(args[0], "utf8"));
const size = { width: 1600, height: 950 };

// Playwright's key names as Blender's event types.
const NAMED = { Tab: "TAB", Enter: "RET", Escape: "ESC", Delete: "DEL", Backspace: "BACK_SPACE", Space: " ", Home: "HOME",
  ArrowUp: "UP_ARROW", ArrowDown: "DOWN_ARROW", ArrowLeft: "LEFT_ARROW", ArrowRight: "RIGHT_ARROW", NumpadDecimal: "NUMPAD_PERIOD",
  "-": "MINUS", ".": "PERIOD", "0": "ZERO", "1": "ONE", "2": "TWO", "3": "THREE", "4": "FOUR", "5": "FIVE", "6": "SIX",
  "7": "SEVEN", "8": "EIGHT", "9": "NINE" };
const MODIFIERS = { Shift: "shift", Control: "ctrl", Alt: "alt" };
function blenderKey(combo) {
  const parts = combo.split("+"), key = parts.pop();
  const type = NAMED[key] ?? (/^Numpad\d$/.test(key) ? `NUMPAD_${key.slice(6)}` : /^F\d+$/.test(key) ? key : key.toUpperCase());
  return { type: type === " " ? "SPACE" : type, modifiers: parts.map((m) => MODIFIERS[m]) };
}

// A target as page pixels: a Blender identifier or CSS selector (its centre), a point, or a point of the 3D Viewport.
async function pointOf(app, target) {
  if (Array.isArray(target)) return target;
  if (target?.view) return app.point(...target.view);
  if (typeof target === "string") {
    const box = await app.locator(/^[A-Z0-9]+_[A-Z]{2}_/.test(target) ? `[data-blender="${target}"]` : target).first().boundingBox();
    return [box.x + box.width / 2, box.y + box.height / 2];
  }
  return app.point(0.5, 0.5);
}

async function runBylonder() {
  const server = await startServer(), browser = await chromium.launch();
  const app = await openApp(browser, server.url, { size });
  const shots = [], events = [];
  try {
    if (file) {
      const chooser = app.page.waitForEvent("filechooser");
      await app.page.click('[data-blender="TOPBAR_MT_file"]');
      await app.page.getByRole("menuitem", { name: "Open..." }).click();
      await (await chooser).setFiles(file);
      await app.page.waitForTimeout(3000);
      // A large file's open replaces the 3D Viewport's frame: wait for the new one.
      await app.page.waitForFunction(() => !!document.querySelector('iframe[src*="viewport.html"]')?.contentWindow?.__bylonder?.views, null, { timeout: 180000 });
      await app.until((b) => b.views.idle, null, 180000).catch(() => {});
    }
    for (const step of steps) {
      const sent = [];
      if (step.click || step.move) {
        const [x, y] = await pointOf(app, step.click ?? step.move);
        if (step.click) await app.page.mouse.click(x, y); else await app.page.mouse.move(x, y);
        sent.push({ type: step.click ? "LEFTMOUSE" : "MOUSEMOVE", x: Math.round(x), y: Math.round(y) });
      }
      if (step.key) {
        const [x, y] = await pointOf(app, step.at);
        await app.page.mouse.move(x, y);
        await app.page.keyboard.press(step.key);
        sent.push({ ...blenderKey(step.key), x: Math.round(x), y: Math.round(y) });
      }
      if (step.shading) await app.bylonder((b, type) => b.views.input.setShading(type), step.shading === "WIREFRAME" ? "wire" : step.shading.toLowerCase());
      await app.page.waitForTimeout((step.settle ?? 1) * 1000);
      await app.until((b) => b.views.idle).catch(() => {});
      shots.push(await app.page.screenshot());
      events.push({ events: sent, settle: step.settle ?? 1, ...(step.shading && { shading: step.shading }) });
    }
  } finally {
    await app.close();
    await browser.close();
    await server.close();
  }
  return { shots, events };
}

function runBlender(events) {
  const blender = referenceBlender(), startFile = join(TOOLS.blender, "start.blend"), dir = join(out, "blender");
  if (!blender) throw Error("Blender not found: run npm run tools once to install it");
  if (!existsSync(startFile)) spawnSync(blender, ["-b", "--factory-startup", "--python-expr", `import bpy; bpy.ops.wm.save_as_mainfile(filepath=r'${startFile}')`]);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "events.json"), JSON.stringify(events));
  const window = ["--window-geometry", "0", "0", String(size.width), String(size.height), "--no-window-focus"];
  const env = { ...process.env, ...(file && { SIDE_BY_SIDE_FILE: file }) };
  const run = spawnSync(blender, ["--factory-startup", "--enable-event-simulate", ...window, startFile, "--python", here + "steps.py", "--", join(dir, "events.json"), dir], { encoding: "utf8", timeout: 600000, env });
  if ((run.stdout.match(/^shot \d+$/gm) || []).length !== events.length) throw Error(`Blender took ${run.stdout.match(/^shot/gm)?.length ?? 0} of ${events.length} shots:\n${run.stdout}\n${run.stderr}`);
  return events.map((_, i) => readFileSync(join(dir, `${String(i).padStart(2, "0")}.png`)));
}

mkdirSync(out, { recursive: true });
const { shots, events } = await runBylonder();
const blenderShots = runBlender(events);
const browser = await chromium.launch(), page = await browser.newPage();
try {
  for (const [i, png] of shots.entries()) {
    const { mismatch, sideBySide, diff } = await compare(page, blenderShots[i], png, []);
    const name = String(i).padStart(2, "0");
    writeFileSync(join(out, `${name}-side-by-side.png`), sideBySide);
    writeFileSync(join(out, `${name}-diff.png`), diff);
    console.log(`${name} ${JSON.stringify(steps[i])} ${(mismatch * 100).toFixed(1)}% differ`);
  }
} finally {
  await browser.close();
}
console.log(`Shots: ${out}`);
