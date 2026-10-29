// Common Blender session work done as a user does it in Bylonder (keys, menus, clicks), compared with the same work
// done by Blender 5.2.3 (tools/blender-reference/workflows.py writes tests/fixtures/workflows.json). One app instance
// runs every workflow: File > New > Default Cube resets the scene between them, without reloading the page.
// usage: npm run test:workflows [-- name filter]   (E2E_URL=http://localhost:5173/ uses a running server)
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { chromium, openApp, startServer } from "./app.mjs";

const expected = JSON.parse(readFileSync(new URL("../fixtures/workflows.json", import.meta.url)));
let app;

const workflows = {
  async "block-out"() {
    await add("Mesh", "UV Sphere");
    await keys("g", "x", "3", "Enter", "s", "0", ".", "5", "Enter");
    await add("Mesh", "Cylinder");
    await keys("g", "y", "-", "3", "Enter", "r", "z", "4", "5", "Enter");
    await outlinerClick("Light");
    await keys("x");
    await pick("Delete");
  },
  async organize() {
    await add("Mesh", "Monkey");
    await keys("g", "y", "3", "Enter", "Shift+d", "x", "3", "Enter", "m");
    await pick("New Collection");
    const dialog = app.locator('[role="dialog"][aria-label="Move to New Collection"]');
    await dialog.getByRole("textbox").fill("Props");
    await dialog.getByRole("button", { name: "Create" }).click();
    await outlinerClick("Suzanne");
    await outlinerClick("Cube", { modifiers: ["Control"] });
    await keys("Control+p");
    await pick("Object");
    await outlinerClick("Suzanne.001");
    await keys("h");
  },
  async animate() {
    await keys("i");
    await typeInto('[role="spinbutton"][aria-label="Current Frame"]', "30");
    await keys("g", "z", "2", "Enter", "i");
  },
};

// The scene as tools/blender-reference/workflows.py's state() reads it, from Bylonder's RNA (what bpy sees).
const state = () => app.bylonder((b) => {
  const r = b.rna, round = (v) => Math.round(v * 1e4) / 1e4 + 0, vec = (v) => Array.from(v, round);
  const objects = {};
  for (const ob of r.objects()) {
    const o = r.pointer("Object", ob);
    const entry = {
      type: o.type, location: vec(o.location), rotation_euler: vec(o.rotation_euler), scale: vec(o.scale),
      parent: o.parent?.name ?? null, hide_viewport: o.hide_get(),
      modifiers: [...o.modifiers].map((m) => [m.name, m.type]),
      materials: [...o.material_slots].map((slot) => slot.material?.name ?? null),
    };
    if (o.type === "MESH") {
      const { vertices, edges, polygons } = o.data, co = [...vertices].map((v) => v.co);
      const bound = (pick) => [0, 1, 2].map((i) => round(pick(...co.map((c) => c[i]))));
      entry.mesh = { vertices: vertices.length, edges: edges.length, faces: polygons.length, bounds: [bound(Math.min), bound(Math.max)] };
    }
    const animation = o.animation_data, bag = animation?.action.layers[0].strips[0].channelbag(animation.action_slot);
    if (bag) entry.keys = Object.fromEntries([...bag.fcurves].map((curve) => [`${curve.data_path}[${curve.array_index}]`, [...curve.keyframe_points].map((k) => vec(k.co))]));
    objects[o.name] = entry;
  }
  const collections = Object.fromEntries(b.world.collections.all().map(({ name }) => [name,
    r.objects().map((ob) => r.pointer("Object", ob)).filter((o) => [...o.users_collection].some((c) => c.name === name)).map((o) => o.name).sort()]));
  const materials = Object.fromEntries(b.world.materials.all().filter((m) => b.world.materials.users(m)).map((m) => {
    const bsdf = r.pointer("Material", m).node_tree.nodes.get("Principled BSDF");
    return [m.name, { base_color: bsdf ? vec(bsdf.inputs.get("Base Color").default_value) : null }];
  }));
  return { objects, collections, materials, frame: r.pointer("Scene", b.world).frame_current };
});

// Bylonder's state against Blender's, field by field.
function compare(actual, wanted) {
  for (const [name, object] of Object.entries(wanted.objects)) {
    assert.ok(actual.objects[name], `object ${name} missing; have ${Object.keys(actual.objects)}`);
    for (const key of new Set([...Object.keys(object), ...Object.keys(actual.objects[name])])) {
      const value = actual.objects[name][key];
      assert.deepEqual(value, object[key], `${name}.${key}: Bylonder ${JSON.stringify(value)}, Blender ${JSON.stringify(object[key])}`);
    }
  }
  assert.deepEqual(Object.keys(actual.objects).sort(), Object.keys(wanted.objects).sort(), "objects");
  for (const key of ["collections", "materials", "frame"]) assert.deepEqual(actual[key], wanted[key], `${key}: Bylonder ${JSON.stringify(actual[key])}, Blender ${JSON.stringify(wanted[key])}`);
}

const keys = async (...list) => {
  await app.hover(0.5, 0.6);
  for (const key of list) {
    await app.page.keyboard.press(key);
    await app.settled();
  }
};
const pick = (label) => app.frame().getByRole("menuitem", { name: label, exact: true }).last().click();
// A point of the scene in Blender's axes, in page coordinates of the 3D Viewport.
async function screenOf([x, y, z]) {
  const [fx, fy] = await app.bylonder((b, point) => {
    const view = b.views.input, { width, height } = view.canvas;
    const p = BABYLON.Vector3.Project(BABYLON.Vector3.FromArray(point), BABYLON.Matrix.Identity(), view.camera.getTransformationMatrix(), { x: 0, y: 0, width, height });
    return [p.x / width, p.y / height];
  }, [x, z, y]);
  return app.point(fx, fy);
}
// A number field edited by clicking it and typing a value.
async function typeInto(selector, value) {
  await app.locator(selector).first().click();
  await app.page.keyboard.press("Control+A");
  await app.page.keyboard.type(value);
  await app.page.keyboard.press("Enter");
}
// The 3D Viewport's context menu (right click), then the menu path.
async function contextMenu(...path) {
  const [x, y] = await app.point(0.5, 0.6);
  await app.page.mouse.click(x, y, { button: "right" });
  for (const label of path) await pick(label);
}
// Shift A over the 3D Viewport, then the menu path.
async function add(...path) {
  await keys("Shift+a");
  for (const label of path) await pick(label);
}
// A click on an Outliner row's name; modifiers held as given.
async function outlinerClick(name, { modifiers = [] } = {}) {
  const row = await app.frame().locator("svg.bl-outliner-region text", { hasText: new RegExp(`^${name.replace(".", "\\.")}$`) }).first().boundingBox();
  for (const key of modifiers) await app.page.keyboard.down(key);
  await app.page.mouse.click(row.x + row.width / 2, row.y + row.height / 2);
  for (const key of modifiers) await app.page.keyboard.up(key);
}

const filter = process.argv[2];
// SHARD=i/n runs every n-th workflow from the i-th (scripts/gates.mjs); each workflow starts from a fresh app, so none
// depends on another's state.
const [shard, shards] = (process.env.SHARD ?? "0/1").split("/").map(Number);
const server = await startServer();
const browser = await chromium.launch();
let failed = 0;
try {
  for (const [name, steps] of Object.entries(workflows).filter((_, i) => i % shards === shard)) {
    if (filter && !name.includes(filter)) continue;
    const started = Date.now();
    try {
      app = await openApp(browser, server.url, { video: process.env.WORKFLOW_VIDEO });
      await steps();
      compare(await state(), expected[name]);
      assert.deepEqual(app.errors, [], "page errors");
      console.log(`ok    ${name} (${Date.now() - started} ms)`);
    } catch (error) {
      failed++;
      const shot = `${tmpdir()}/workflow-${name}.png`;
      await app?.page.screenshot({ path: shot }).catch(() => {});
      console.log(`FAIL  ${name}\n${error.stack}\nScreenshot: ${shot}`);
    } finally {
      await app?.close();
      app = null;
    }
  }
} finally {
  await browser.close();
  await server.close();
}
process.exitCode = failed ? 1 : 0;
