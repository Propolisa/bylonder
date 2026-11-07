// Visual parity: Blender 5.2.3 and Bylonder in the same UI states (ui-states.json), on Blender's startup scene (the
// Default Cube example), at 1600 x 950 and UI scale 1. Writes per state blender.png, bylonder.png, a side-by-side
// and a diff image, and report.json with the mismatch score (share of differing pixels) overall and per Blender editor,
// and per editor how well Bylonder's area overlaps Blender's (layout, intersection over union).
// usage: node tools/blender-reference/parity.mjs [--out DIR] [--blender] [STATE ...]
//   --blender recaptures Blender (otherwise only missing shots). On Linux Blender runs in Xvfb (PARITY_DISPLAY picks the
//   X display, default :81); elsewhere in a window on the desktop. The reference Blender is npm run tools'.
import { fileURLToPath } from "node:url";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromium, openApp, startServer } from "../../tests/e2e/app.mjs";
import { TOOLS } from "../../tests/e2e/tools.mjs";
import { referenceBlender } from "../../tests/blender-reference.js";
import { displacedSphere, lavaMaterial } from "../../tests/e2e/lava.mjs";
import { compare } from "./compare.mjs";

const here = fileURLToPath(new URL(".", import.meta.url)), root = fileURLToPath(new URL("../..", import.meta.url));
const args = process.argv.slice(2);
const flag = (name) => args.includes(name) && args.splice(args.indexOf(name), 1);
const option = (name, fallback) => (args.includes(name) ? args.splice(args.indexOf(name), 2)[1] : fallback);
const out = option("--out", root + ".shots/parity");
const recapture = flag("--blender");
const states = JSON.parse(readFileSync(here + "ui-states.json", "utf8")).filter((s) => !args.length || args.includes(s.id));
const size = { width: 1600, height: 950 };
// Where the mouse rests, as a fraction of the 3D View; ui-shots.py uses the same point.
const REST = [0.25, 0.75];

const blender = referenceBlender();
const startFile = join(TOOLS.blender, "start.blend");
const blenderShots = out + "/blender";

// Blender in a window of Bylonder's size: on Linux in Xvfb with Mesa (PARITY_DISPLAY, default :81), elsewhere on the
// desktop and its GPU. ui-shots.py takes the screenshots with Blender's own Save Screenshot.
async function captureBlender(ids) {
  if (!blender) throw Error("Blender not found: run npm run tools once to install it");
  if (!existsSync(startFile)) spawnSync(blender, ["-b", "--factory-startup", "--python-expr", `import bpy; bpy.ops.wm.save_as_mainfile(filepath=r'${startFile}')`]);
  const display = process.env.PARITY_DISPLAY || ":81";
  const xvfb = process.platform === "linux" && spawn("Xvfb", [display, "-screen", "0", `${size.width}x${size.height}x24`, "-dpi", "96"], { stdio: "ignore" });
  try {
    if (xvfb) await new Promise((resolve) => setTimeout(resolve, 1000));
    const env = { ...process.env, ...(xvfb && { DISPLAY: display, LIBGL_ALWAYS_SOFTWARE: "1" }) };
    const window = ["--window-geometry", "0", "0", String(size.width), String(size.height), "--no-window-focus"];
    const run = spawnSync(blender, ["--factory-startup", "--enable-event-simulate", ...window, startFile, "--python", here + "ui-shots.py", "--", blenderShots, ...ids], { env, encoding: "utf8", timeout: 300000 });
    const shot = (run.stdout.match(/^shot .+$/gm) || []).length;
    if (shot !== ids.length) throw Error(`Blender captured ${shot} of ${ids.length} states:\n${run.stdout}\n${run.stderr}`);
  } finally {
    if (xvfb) xvfb.kill();
  }
}

// The cube's location keyed as ui-shots.py keys it (Blender's location (2, 0, 1) is Babylon's position (2, 1, 0)), then
// an area (the Timeline's) switched to another editor from its Editor Type menu.
const animationEditor = (title, from = "Timeline") => async (app) => {
  await app.bylonder((b) => {
    const a = b.world.animation, cube = b.world.scene.getNodeByName("Cube");
    const refs = [...a.channels.keys()].filter((ref) => ref.includes("object:") && /position/.test(ref) && a.channels.get(ref).group === "Cube");
    a.insert(refs, 1);
    cube.position.set(2, 1, 0);
    a.insert(refs, 40);
    a.seek(1);
  });
  const rest = await app.point(...REST);
  await app.locator(`.dock-editor-type[title="Editor Type · ${from}"]`).click();
  await app.frame().getByRole("menuitem", { name: title, exact: true }).click();
  await app.page.mouse.move(...rest);
};

// The visible animation editor's sidebar on a tab.
const sidebarTab = (app, name) => app.frame().locator(".anim-sidebar:visible").getByRole("tab", { name }).click();
// The third channel row's centre below the channel region's top, as ui-shots.py clicks it (CHANNEL_ROW_2).
async function clickChannelRow2(app) {
  const canvases = await app.frame().locator("canvas.anim-channels:visible").all();
  const boxes = await Promise.all(canvases.map((c) => c.boundingBox()));
  const box = boxes.sort((a, b) => b.height - a.height)[0];
  await app.page.mouse.click(box.x + 80, box.y + 67);
}
// As ui-shots.py: keys typed in turn with the mouse resting.
const keys = async (app, ...names) => { await app.hover(...REST); for (const name of names) await app.page.keyboard.press(name); };
// As ui-shots.py: the cube duplicated and moved by typed values.
const duplicate = async (app, ...moves) => {
  await keys(app, "Shift+D", ...moves[0], "Enter");
  for (const move of moves.slice(1)) await keys(app, "g", ...move, "Enter");
};

// Bylonder in each state, from the same input as ui-shots.py. Blender starts with the cube selected; a click selects it.
const SETUP = {
  startup: async () => {},
  "object-menu": (app) => app.locator('[data-blender="VIEW3D_MT_object"]').click(),
  "file-menu": (app) => app.page.click('[data-blender="TOPBAR_MT_file"]'),
  "add-menu": async (app) => { await app.hover(); await app.page.keyboard.press("Shift+A"); },
  "edit-mode": async (app) => { await app.hover(...REST); await app.page.keyboard.press("Tab"); },
  "modifier-tab": async (app) => {
    await propertiesTab(app, "Cube", "Modifiers");
    await app.frame().getByRole("button", { name: "Add Modifier" }).click();
    await app.frame().getByRole("menuitem", { name: "Generate" }).hover();
    await app.frame().getByRole("menuitem", { name: "Subdivision Surface" }).click();
    await app.hover(...REST);
  },
  "graph-editor": animationEditor("Graph Editor"),
  "dope-sheet": animationEditor("Dope Sheet"),
  "graph-editor-large": animationEditor("Graph Editor", "3D Viewport"),
  "graph-fmodifiers": async (app) => {
    const rest = await app.point(...REST);
    await animationEditor("Graph Editor", "3D Viewport")(app);
    await sidebarTab(app, "Modifiers");
    for (const type of ["Generator", "Envelope"]) {
      await app.frame().locator(".anim-sidebar:visible").getByRole("button", { name: "Add Modifier" }).click();
      await app.frame().getByRole("menuitem", { name: type, exact: true }).click();
    }
    await app.page.mouse.move(...rest);
  },
  "action-editor": async (app) => {
    const rest = await app.point(...REST);
    await animationEditor("Dope Sheet", "3D Viewport")(app);
    await app.frame().locator(".anim-header:visible").first().getByRole("button", { name: "Dope Sheet" }).click();
    await app.frame().getByRole("menuitem", { name: "Action Editor", exact: true }).click();
    await app.page.mouse.move(...rest);
  },
  "drivers-editor": async (app) => {
    await app.bylonder((b) => {
      const a = b.world.animation, entry = a.ids.entries().find((e) => e.key === "object:Cube");
      a.anim.addDriver(entry.ob, "location", 1, 0);
    });
    const rest = await app.point(...REST);
    await app.locator('.dock-editor-type[title="Editor Type · 3D Viewport"]').click();
    await app.frame().getByRole("menuitem", { name: "Drivers", exact: true }).click();
    await clickChannelRow2(app);
    await sidebarTab(app, "Drivers");
    await app.page.mouse.move(...rest);
  },
  "object-tab": (app) => propertiesTab(app, "Cube", "Object"),
  "material-tab": async (app) => {
    await propertiesTab(app, "Cube", "Material");
    for (let i = 0; i < 2; i++) await app.frame().getByRole("button", { name: "Add a new material slot" }).click();
    await app.frame().locator('.bl-overlap').first().click();
    await app.hover(...REST);
  },
  "geometry-nodes-modifier": async (app) => {
    await propertiesTab(app, "Cube", "Modifiers");
    await app.frame().getByRole("button", { name: "Add Modifier" }).click();
    await app.frame().getByRole("menuitem", { name: "Generate" }).hover();
    await app.frame().getByRole("menuitem", { name: "Geometry Nodes" }).click();
    await app.hover(...REST);
  },
  "light-data": (app) => propertiesTab(app, "Light", "Data"),
  "camera-data": (app) => propertiesTab(app, "Camera", "Data"),
  toolbar: async (app) => { await app.locator('[data-tool="builtin.move"]').click(); await app.hover(...REST); },
  "cursor-tool": async (app) => { await app.locator('[data-tool="builtin.cursor"]').click(); await app.click(0.55, 0.42); },
  "inset-tool": async (app) => {
    await app.hover(...REST);
    await app.page.keyboard.press("Tab");
    await app.until((b) => b.world.editMode.active);
    await app.page.keyboard.press("a");
    await app.locator('[data-tool="builtin.inset_faces"]').click();
    await app.hover(...REST);
  },
  "loop-cut-tool": (app) => editTool(app, "builtin.loop_cut", [1, 1, 0]),
  "spin-tool": (app) => editTool(app, "builtin.spin"),
  "poly-build-tool": (app) => editTool(app, "builtin.poly_build", [1, 1, 0]),
  "sidebar-item": async (app) => { await app.hover(...REST); await app.page.keyboard.press("n"); },
  "curve-edit": (app) => addAndEdit(app, "curve.primitive_bezier_circle_add"),
  "text-edit": (app) => addAndEdit(app, "object.text_add"),
  // The console prints Blender's banner once CPython has loaded.
  scripting: async (app) => {
    await app.page.click('[data-workspace="scripting"]');
    await app.until(() => /PYTHON INTERACTIVE CONSOLE/.test(document.querySelector(".bl-console")?.textContent ?? ""), null, 180000);
  },
  "displaced-sphere": async (app) => { await displacedSphere(app); await app.hover(...REST); },
  // As ui-shots.py: View > Frame Selected frames the sphere (the keyboard is the Shader Editor's after the nodes).
  "lava-material": async (app) => {
    await displacedSphere(app);
    await lavaMaterial(app);
    await app.locator('[data-blender="VIEW3D_MT_view"]').click();
    await app.frame().getByRole("menuitem", { name: "Frame Selected" }).first().click();
    await app.hover(...REST);
  },
  "outliner-expanded": async (app) => {
    const box = await app.locator(".bl-outliner-region").boundingBox();
    await app.page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await app.page.keyboard.press("Shift+A");
  },
  "outline-scale-3": (app) => keys(app, "s", "3", "Enter"),
  "outline-active-selected": async (app) => {
    await duplicate(app, ["y", "3"]);
    await app.page.keyboard.down("Shift");
    await app.click();
    await app.page.keyboard.up("Shift");
    await app.hover(...REST);
  },
  "outline-occluded": (app) => duplicate(app, ["y", "3"], ["x", "-", "2"]),
  xray: (app) => keys(app, "Alt+z"),
};
// As ui-shots.py: Edit Mode with everything selected and a tool, the mouse over a scene point (Blender's axes) or resting.
async function editTool(app, tool, anchor) {
  await app.hover(...REST);
  await app.page.keyboard.press("Tab");
  await app.until((b) => b.world.editMode.active);
  await app.page.keyboard.press("a");
  await app.locator(`[data-tool="${tool}"]`).click();
  if (!anchor) return app.hover(...REST);
  const at = await app.bylonder((b, [x, y, z]) => {
    const view = b.views.input, { width, height } = view.canvas;
    const p = BABYLON.Vector3.Project(new BABYLON.Vector3(x, z, y), BABYLON.Matrix.Identity(), view.camera.getTransformationMatrix(), { x: 0, y: 0, width, height });
    return [p.x / width, p.y / height];
  }, anchor);
  await app.hover(...at);
}

// As ui-shots.py: Delete over the view, the Add operator, then Tab.
async function addAndEdit(app, idname) {
  await app.hover(...REST);
  await app.page.keyboard.press("Delete");
  await app.bylonder((b, op) => b.runOperator(op), idname);
  await app.hover(...REST);
  await app.page.keyboard.press("Tab");
}

// The object selected alone, and the Properties editor on a tab.
// The object `name` made active, as a click in the Outliner makes it (the startup scene has none), then a Properties tab.
async function propertiesTab(app, name, tab) {
  await app.bylonder((b, name) => b.editor.selection.replace([b.world.objects.find((ob) => ob.name === name)]), name);
  await app.locator(`[role="tab"][aria-label="${tab}"]`).click();
  await app.hover(...REST);
}

async function captureBylonder(browser, url, state) {
  const app = await openApp(browser, url, { size });
  try {
    await app.click();
    await app.hover(...REST);
    await SETUP[state.id](app);
    // Wait until the views stop rendering, then two more frames for menus and overlays to settle.
    await app.until((b) => b.views.idle);
    await app.page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const areas = await Promise.all((await app.locator(".dock-leaf").all()).map((leaf) => leaf.boundingBox()));
    return { png: await app.page.screenshot(), areas };
  } finally {
    await app.close();
  }
}

// Intersection over union of two rectangles: how well an editor's area in Bylonder matches Blender's.
function overlap(a, b) {
  const w = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x), h = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  const common = Math.max(0, w) * Math.max(0, h);
  return common / (a.width * a.height + b.width * b.height - common);
}

mkdirSync(blenderShots, { recursive: true });
const missing = states.filter((s) => recapture || !existsSync(`${blenderShots}/${s.id}.png`)).map((s) => s.id);
if (missing.length) await captureBlender(missing);
const areas = JSON.parse(readFileSync(blenderShots + "/areas.json", "utf8"));

const server = await startServer();
const browser = await chromium.launch();
const report = [];
try {
  const page = await browser.newPage();
  for (const state of states) {
    const dir = `${out}/${state.id}`;
    mkdirSync(dir, { recursive: true });
    const blenderPng = readFileSync(`${blenderShots}/${state.id}.png`);
    const { png: bylonderPng, areas: bylonderAreas } = await captureBylonder(browser, server.url, state);
    const { mismatch, editors, sideBySide, diff } = await compare(page, blenderPng, bylonderPng, areas[state.id]);
    const layout = Object.fromEntries(areas[state.id].map((a) => [a.type, Math.max(...bylonderAreas.map((b) => overlap(a, b)))]));
    writeFileSync(`${dir}/blender.png`, blenderPng);
    writeFileSync(`${dir}/bylonder.png`, bylonderPng);
    writeFileSync(`${dir}/side-by-side.png`, sideBySide);
    writeFileSync(`${dir}/diff.png`, diff);
    report.push({ ...state, mismatch, editors, layout });
    const percent = (n) => (n * 100).toFixed(1) + "%";
    console.log(`${state.id.padEnd(14)} ${percent(mismatch).padStart(6)}  ${Object.entries(editors).map(([type, n]) => `${type} ${percent(n)}`).join(", ")}\n${"".padEnd(22)}layout ${Object.entries(layout).map(([type, n]) => `${type} ${percent(n)}`).join(", ")}`);
  }
} finally {
  await browser.close();
  await server.close();
}
writeFileSync(out + "/report.json", JSON.stringify(report, null, 1));
console.log("Report: " + out);
