// End-to-end smoke tests: core flows in Chromium with real mouse and keyboard input, against the production build.
// Assertions read state through window.__bylonder in the 3D Viewport frame and the status bar's statistics, and
// every check fails on a page error.
// usage: npm run test:e2e [-- name filter]
import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { unzipSync, strFromU8 } from "fflate";
import { chromium, openApp, startServer } from "./app.mjs";

const renderStatus = ".render-result [data-status]";
const rendered = () => app.until((b, selector) => /^(Finished|Render failed)/.test(document.querySelector(selector).textContent), renderStatus, 60000);
let app;

const checks = {
  // The new project's scene (sphere and ground), as a first visit shows it.
  "app boots": { open: { example: null, node: "sphere" }, async run() {} },

  async "Render Image shows a rendered frame"() {
    await menu("TOPBAR_MT_render", "Render Image");
    await rendered();
    assert.match(await app.locator(renderStatus).textContent(), /^Finished frame 1/);
    // The result canvas holds the image over a CSS checkerboard: a rendered frame is opaque and not flat.
    const { opaque, colors } = await app.frame().evaluate(() => {
      const canvas = document.querySelector(".render-result canvas");
      const { data } = canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height);
      const colors = new Set();
      let opaque = 0, samples = 0;
      for (let i = 0; i < data.length; i += 4 * 97, samples++) {
        if (data[i + 3] === 255) opaque++;
        colors.add(((data[i] >> 3) << 10) | ((data[i + 1] >> 3) << 5) | (data[i + 2] >> 3));
      }
      return { opaque: opaque / samples, colors: colors.size };
    });
    assert.ok(opaque > 0.99, `opaque fraction ${opaque}`);
    assert.ok(colors > 8, `${colors} distinct colors`);
  },

  async "Render Animation renders the frame range"() {
    await app.locator('[role="spinbutton"][aria-label="End"]').click();
    await app.page.keyboard.press("Control+A");
    await app.page.keyboard.type("2");
    await app.page.keyboard.press("Enter");
    await app.until((b) => b.world.animation.time.state.frameEnd === 2);
    const download = app.page.waitForEvent("download", { timeout: 60000 });
    await menu("TOPBAR_MT_render", "Render Animation");
    await rendered();
    assert.match(await app.locator(renderStatus).textContent(), /^Finished 2 frames/);
    assert.ok((await download).suggestedFilename());
  },

  async "File > Export writes the evaluated scene as .babylon, .js and .js with live modifiers"() {
    await app.bylonder((b) => b.world.modifiers.add(b.world.scene.getMeshByName("Cube"), "SUBSURF", { levels: 2 }));
    const exported = async (item) => {
      const download = app.page.waitForEvent("download", { timeout: 60000 });
      await app.page.click('[data-blender="TOPBAR_MT_file"]');
      await app.page.getByRole("menuitem", { name: /^Export/ }).first().hover();
      await app.page.getByRole("menuitem", { name: item }).click();
      const chunks = [];
      for await (const chunk of await (await download).createReadStream()) chunks.push(chunk);
      return Buffer.concat(chunks);
    };
    const json = JSON.parse(await exported("Babylon (.babylon)"));
    assert.deepEqual(json.meshes.map((m) => m.name), ["Cube"]);
    assert.equal(json.activeCameraID, "Camera");
    assert.equal(json.geometries.vertexData[0].indices.length, 96 * 2 * 3, "the subdivided cube");
    assert.match(String(await exported("JavaScript (.js)")), /export async function createScene\(engine, canvas\)/);
    // Live Modifiers: the module, whose subdivided cube keeps its stack, and the polyfill next to it.
    const zip = unzipSync(await exported("JavaScript, Live Modifiers (.zip)"));
    const module = strFromU8(Object.entries(zip).find(([name]) => name.endsWith(".js") && !name.includes("/"))[1]);
    assert.match(module, /bylonderModifiers/);
    assert.match(module, /liveModifiers/);
    assert.match(strFromU8(zip["bylonder-modifiers/modifiers.js"]), /export async function liveModifiers/);
    assert.ok(zip["bylonder-modifiers/modifiers-worker.js"].length > 0);
    assert.deepEqual(Array.from(zip["bylonder-modifiers/modifiers.wasm"].subarray(0, 4)), [0, 0x61, 0x73, 0x6d], "a WebAssembly module");
  },

  async "topbar File menu and 3D View Object menu open"() {
    await app.page.click('[data-blender="TOPBAR_MT_file"]');
    await app.page.getByRole("menuitem", { name: /^Open/ }).first().waitFor();
    await app.page.keyboard.press("Escape");
    await app.locator('[data-blender="VIEW3D_MT_object"]').click();
    await app.frame().getByRole("menuitem", { name: /^Delete/ }).first().waitFor();
  },

  // Right click runs Blender's keymaps, whose wm.call_menu opens the mode's context menu.
  async "right click opens Blender's Object and Edit Mode context menus in the 3D View"() {
    await app.click();
    await rightClick(...(await app.point()));
    for (const item of ["Shade Smooth", "Set Origin", "Duplicate Objects"]) await app.frame().getByRole("menuitem", { name: item }).first().waitFor();
    await app.page.keyboard.press("Escape");
    await app.page.keyboard.press("Tab");
    await app.until((b) => b.world.editMode.active);
    await rightClick(...(await app.point()));
    for (const item of ["Merge Vertices", "Dissolve Vertices"]) await app.frame().getByRole("menuitem", { name: item }).first().waitFor();
    await app.page.keyboard.press("Escape");
    await app.page.keyboard.press("3");
    await rightClick(...(await app.point()));
    for (const item of ["Inset Faces", "Dissolve Faces"]) await app.frame().getByRole("menuitem", { name: item }).first().waitFor();
  },

  async "right click on an Outliner row opens Blender's Object menu"() {
    const canvas = app.frame().locator(".bl-outliner-region");
    const box = await canvas.boundingBox();
    const [x, y] = await app.bylonder((b) => b.world.outliner.area.draw().draw.find((c) => c.op === "text" && c.text === "Cube").at);
    await rightClick(box.x + x + 5, box.y + box.height - y - 4);
    for (const item of ["Delete Hierarchy", "Select Hierarchy"]) await app.frame().getByRole("menuitem", { name: item }).first().waitFor();
  },

  async "right click on a property opens Blender's button context menu"() {
    await app.click();
    await rightClick(...(await center(app.locator('#properties-section [role="spinbutton"]').first())));
    for (const item of ["Insert Keyframes", "Reset All to Default Values", "Copy Data Path"]) await app.frame().getByRole("menuitem", { name: item }).first().waitFor();
  },

  async "middle mouse orbits and Shift middle mouse pans"() {
    const view = () => app.frame().evaluate(() => { const c = window.__bylonder.views.input.editorCamera; return { alpha: c.alpha, x: c.target.x }; });
    const drag = async (shift) => {
      await app.hover(0.5, 0.5);
      if (shift) await app.page.keyboard.down("Shift");
      await app.page.mouse.down({ button: "middle" });
      const [x, y] = await app.point(0.6, 0.55);
      await app.page.mouse.move(x, y, { steps: 6 });
      await app.page.mouse.up({ button: "middle" });
      if (shift) await app.page.keyboard.up("Shift");
    };
    const start = await view();
    await drag(false);
    const orbited = await view();
    assert.notEqual(orbited.alpha, start.alpha, "orbit");
    await drag(true);
    assert.notEqual((await view()).x, orbited.x, "pan");
  },

  async "numpad 7 views from top, A selects all, X asks and deletes, Ctrl Z undoes"() {
    await app.click(0.3, 0.8);
    await app.page.keyboard.press("Numpad7");
    await app.until(() => /Top/.test(document.querySelector(".view-name").textContent));
    await app.page.keyboard.press("a");
    await app.until((b) => b.editor.selection.size === b.world.objects.length);
    const { Objects: [, total] } = await app.stats();
    await app.page.keyboard.press("x");
    await app.frame().getByRole("menuitem", { name: "Delete" }).click();
    await expectStats(({ Objects }) => Objects[1] === 0);
    await app.page.keyboard.press("Control+z");
    await expectStats(({ Objects }) => Objects[1] === total);
  },

  async "Outliner: click selects, drag moves into a collection, X deletes, Ctrl Z undoes"() {
    const canvas = app.frame().locator(".bl-outliner-region");
    const box = await canvas.boundingBox();
    // A row's place on the page, over its name, from the Outliner's own draw (region pixels, y up).
    const row = async (name) => {
      const [x, y] = await app.bylonder((b, name) => b.world.outliner.area.draw().draw.find((c) => c.op === "text" && c.text === name).at, name);
      return [box.x + x + 5, box.y + box.height - y - 4];
    };
    const cube = await row("Cube");
    await app.page.mouse.click(...cube);
    await app.until((b) => b.editor.selection.nodes.map((n) => n.name).join() === "Cube");
    const before = await app.bylonder((b) => b.world.collections.state.scene.objects.length);
    await app.page.mouse.move(...cube);
    await app.page.mouse.down();
    await app.page.mouse.move(...(await row("Scene Collection")), { steps: 8 });
    await app.page.mouse.up();
    await app.until((b, n) => b.world.collections.state.scene.objects.length === n + 1, before);
    await app.page.mouse.move(...(await row("Cube")));
    await app.page.keyboard.press("x");
    await app.until((b) => !b.world.objects.some((n) => n.name === "Cube" && !n.metadata?.wbDeleted));
    await app.page.keyboard.press("Control+z");
    await app.until((b) => b.world.objects.some((n) => n.name === "Cube" && !n.metadata?.wbDeleted));
  },

  async "Edit Mode: Tab, select all, extrude and confirm"() {
    await app.click();
    await app.page.keyboard.press("Tab");
    await app.until((b) => b.world.editMode.active);
    await app.page.keyboard.press("a");
    const { Verts: [, before] } = await expectStats(({ Verts }) => Verts[0] > 0 && Verts[0] === Verts[1]);
    await app.page.keyboard.press("e");
    await app.hover(0.6, 0.3);
    await app.click(0.6, 0.3);
    await expectStats(({ Verts }) => Verts[1] > before);
    assert.equal(await app.bylonder((b) => !!b.editor.modal), false);
  },

  async "Add Modifier > Subdivision Surface subdivides the cube"() {
    await app.click();
    const { Verts: before } = await app.stats();
    await app.locator('[role="tab"][aria-label="Modifiers"]').click();
    await app.frame().getByRole("button", { name: "Add Modifier" }).click();
    await app.frame().getByRole("menuitem", { name: "Generate" }).hover();
    await app.frame().getByRole("menuitem", { name: "Subdivision Surface" }).click();
    await expectStats(({ Verts }) => Verts > before);
  },

  async "3D View draws Workbench shading and overlay extras, and an empty selects by its axes"() {
    const drawn = await app.bylonder((b) => {
      const { scene } = b.world, camera = b.views.input.camera;
      return {
        solid: scene.getMeshByName("Cube").getMaterialForRenderPass(camera.renderPassId)?.name,
        extras: scene.meshes.filter((m) => m.name.startsWith("__extra ")).map((m) => m.name.slice(8)).sort(),
      };
    });
    assert.equal(drawn.solid, "__workbenchSolid");
    for (const shape of ["camera_frame", "camera_tria", "light_point_lines", "ground_line"]) assert.ok(drawn.extras.includes(shape), shape);
    // A Plain Axes empty at Blender's (3, -3, 0): clicking its Z axis selects it.
    const [fx, fy] = await app.bylonder((b) => {
      const empty = new BABYLON.TransformNode("Empty", b.world.scene);
      empty.position.set(3, 0, -3);
      b.world.objects.push(empty);
      const view = b.views.input, { width, height } = view.canvas;
      const p = BABYLON.Vector3.Project(new BABYLON.Vector3(3, 0.6, -3), BABYLON.Matrix.Identity(), view.camera.getTransformationMatrix(), { x: 0, y: 0, width, height });
      return [p.x / width, p.y / height];
    });
    await app.click(fx, fy);
    await app.until((b) => b.editor.selection.nodes.some((n) => n.name === "Empty"));
  },

  "a hemispheric light selects where it is drawn and moves with G X 2": { open: { example: null, node: "sphere" }, async run() {
    // The new project's light has a direction and no position of its own in Babylon.
    const at = () => app.bylonder((b) => {
      const light = b.world.objects.find((o) => o.getClassName?.() === "HemisphericLight");
      light.position.set(1, 0.5, 3);
      const view = b.views.input, { width, height } = view.canvas;
      const p = BABYLON.Vector3.Project(light.getAbsolutePosition(), BABYLON.Matrix.Identity(), view.camera.getTransformationMatrix(), { x: 0, y: 0, width, height });
      return [p.x / width, p.y / height];
    });
    const [fx, fy] = await at();
    await app.click(fx, fy);
    await app.until((b) => b.editor.selection.nodes.map((n) => n.getClassName?.()).join() === "HemisphericLight");
    await app.page.keyboard.press("g");
    await app.page.keyboard.press("x");
    await app.page.keyboard.type("2");
    await app.page.keyboard.press("Enter");
    await app.until((b) => Math.abs(b.editor.selection.nodes[0].position.x - 3) < 1e-4);
  } },

  async "Cursor tool places the 3D cursor on the cube's surface"() {
    await app.locator('[data-tool="builtin.cursor"]').click();
    await app.click(0.5, 0.45);
    // On the surface up to the depth margin's few pixels (ED_view3d_autodist takes the nearest depth around the mouse).
    await app.until((b) => Math.abs(Math.max(...b.world.sceneSettings.state.cursor.location.map(Math.abs)) - 1) < 0.1);
  },

  async "Inset Faces tool insets the cube from its handle"() {
    await app.click();
    await app.page.keyboard.press("Tab");
    await app.until((b) => b.world.editMode.active);
    await app.page.keyboard.press("a");
    await app.locator('[data-tool="builtin.inset_faces"]').click();
    // Each face on its own, as a closed cube has no region boundary to inset.
    await app.frame().getByText("Individual", { exact: true }).first().click();
    // From the edge of the handle (36 pixels around the selection's center) toward the center, which insets more.
    const [x, y] = await app.point();
    await app.page.mouse.move(x + 30, y);
    await app.page.mouse.down();
    await app.page.mouse.move(x + 2, y, { steps: 10 });
    await app.page.mouse.up();
    await app.until((b) => b.world.editMode.mesh.faces_num === 30);
  },

  async "Loop Cut tool cuts the ring under the pointer and slides it"() {
    await editMeshTool("builtin.loop_cut");
    const [x, y] = await screenOf([1, 1, 0]);
    await app.page.mouse.move(x, y, { steps: 4 });
    await app.page.mouse.down();
    await app.page.mouse.move(x + 20, y - 15, { steps: 6 });
    await app.page.mouse.up();
    await app.until((b) => b.world.editMode.mesh.faces_num === 10);
  },

  async "Spin tool's gizmo button spins the cube about Z"() {
    await editMeshTool("builtin.spin");
    // The Z axis' first button: from the 3D cursor, the gizmo radius (2.3 times 75 pixels) along Y turned 45 degrees.
    const [fx, fy] = await app.bylonder((b) => {
      const view = b.views.input, { width, height } = view.canvas, cssScale = view.canvas.getBoundingClientRect().width / width;
      const project = (v) => BABYLON.Vector3.Project(v, BABYLON.Matrix.Identity(), view.camera.getTransformationMatrix(), { x: 0, y: 0, width, height });
      const origin = project(BABYLON.Vector3.Zero()), right = project(view.camera.getDirection(BABYLON.Vector3.Right()));
      const pixelsPerUnit = Math.hypot(right.x - origin.x, right.y - origin.y) * cssScale;
      const button = project(new BABYLON.Vector3(-Math.SQRT1_2, 0, Math.SQRT1_2).scale((2.3 * 75) / pixelsPerUnit));
      return [button.x / width, button.y / height];
    });
    await app.hover(fx, fy);
    await app.page.mouse.down();
    await app.page.mouse.up();
    await app.until((b) => b.world.editMode.mesh.faces_num === 78);
  },

  async "Knife tool cuts across the cube's faces"() {
    await editMeshTool("builtin.knife");
    const [x, y] = await app.point();
    await app.page.mouse.move(x - 120, y + 10);
    await app.page.mouse.down();
    await app.page.mouse.move(x + 120, y - 10, { steps: 12 });
    await app.page.mouse.up();
    await app.page.keyboard.press("Enter");
    await app.until((b) => b.world.editMode.mesh.faces_num > 6);
  },

  async "Bisect tool cuts the cube along the dragged line"() {
    await editMeshTool("builtin.bisect", { group: "builtin.knife", label: "Bisect" });
    const [x, y] = await app.point();
    await app.page.mouse.move(x - 150, y - 60);
    await app.page.mouse.down();
    await app.page.mouse.move(x + 150, y + 70, { steps: 10 });
    await app.page.mouse.up();
    await app.until((b) => b.world.editMode.mesh.faces_num > 6);
  },

  // On a closed mesh no vertex is on a boundary, so the tool's preselection is the vertex nearest the pointer, which a
  // drag moves (gizmo_preselect_elem_test_select).
  async "Poly Build tool moves the vertex under the pointer"() {
    await editMeshTool("builtin.poly_build");
    const positions = () => app.bylonder((b) => Array.from(b.world.editMode.mesh.vert_positions).join());
    const before = await positions();
    const [x, y] = await screenOf([1, 1, 0]);
    await app.page.mouse.move(x, y, { steps: 4 });
    await app.page.mouse.down();
    await app.page.mouse.move(x + 40, y + 30, { steps: 6 });
    await app.page.mouse.up();
    await app.until((b, before) => b.world.editMode.mesh.verts_num === 8 && Array.from(b.world.editMode.mesh.vert_positions).join() !== before, before);
  },

  async "Annotate tool draws a stroke, Measure tool a ruler"() {
    await app.locator('[data-tool="builtin.annotate"]').click();
    const [x, y] = await app.point(0.3, 0.3);
    await app.page.mouse.move(x, y);
    await app.page.mouse.down();
    await app.page.mouse.move(x + 120, y + 40, { steps: 12 });
    await app.page.mouse.up();
    await app.until((b) => b.world.annotations.layers.some((l) => !l.ruler && l.frames?.some((f) => f.strokes.length)));
    await app.locator('[data-tool="builtin.measure"]').click();
    await app.page.mouse.move(x, y + 200);
    await app.page.mouse.down();
    await app.page.mouse.move(x + 150, y + 220, { steps: 10 });
    await app.page.mouse.up();
    await app.until((b) => b.world.annotations.rulerLayer()?.frames?.some((f) => f.strokes.length));
  },

  async "split a 3D Viewport and switch its shading"() {
    // Drag the corner of the area under the 3D Viewport (the viewport is laid over its area) inward.
    const leaf = await app.frame().evaluate(() => {
      const view = document.querySelector(".viewport-area").getBoundingClientRect();
      return [...document.querySelectorAll(".dock-leaf")].findIndex((leaf) => {
        const r = leaf.getBoundingClientRect();
        return r.left <= view.left && r.right >= view.right && r.top <= view.top && r.bottom >= view.bottom;
      });
    });
    const corner = await app.locator(".dock-leaf").nth(leaf).locator(".dock-corner").boundingBox();
    const x = corner.x + corner.width / 2, y = corner.y + corner.height / 2;
    await app.page.mouse.move(x, y);
    await app.page.mouse.down();
    await app.page.mouse.move(x - 200, y, { steps: 8 });
    await app.page.mouse.up();
    await app.until((b) => b.views.all.filter((v) => v.nav).length === 2);
    await app.locator('.bl-view3d-header [data-value="WIREFRAME"]').nth(1).click();
    assert.deepEqual(await app.bylonder((b) => b.views.all.filter((v) => v.nav).map((v) => v.state.shading).sort()), ["solid", "wire"]);
  },

  // The Scripting workspace's Python Console runs Blender's console in CPython over Bylonder's bpy, and the Text
  // Editor runs a script; Info reports the operator.
  async "Scripting: the console adds a cube, a script moves the object"() {
    await app.page.click('[data-workspace="scripting"]');
    const pythonConsole = app.locator(".bl-console"), textEditor = app.locator(".bl-text-editor");
    await pythonConsole.waitFor();
    await app.until(() => /PYTHON INTERACTIVE CONSOLE/.test(document.querySelector(".bl-console").textContent), null, 180000);
    const before = await app.bylonder((b) => b.world.objects.length);
    await pythonConsole.hover();
    await app.page.keyboard.type("bpy.ops.mesh.primitive_cube_add()");
    await app.page.keyboard.press("Enter");
    await app.until((b, n) => b.world.objects.length > n, before);
    await app.until(() => /bpy\.ops\.mesh\.primitive_cube_add\(/.test(document.querySelector(".bl-info").textContent));
    await textEditor.hover();
    await app.page.keyboard.press("Alt+n");
    await app.page.keyboard.type("import bpy\nbpy.context.object.location.x = 2\n");
    await app.page.keyboard.press("Alt+p");
    await app.until((b) => Math.abs(b.editor.selection.nodes.at(-1).position.x - 2) < 1e-6, null, 60000);
  },
};

// Edit Mode on the cube with everything selected, and a tool from the toolbar: one in a group from the flyout its
// button opens when held.
async function editMeshTool(tool, { group, label } = {}) {
  await app.click();
  await app.page.keyboard.press("Tab");
  await app.until((b) => b.world.editMode.active);
  await app.page.keyboard.press("a");
  if (!group) return app.locator(`[data-tool="${tool}"]`).click();
  await app.locator(`[data-tool="${group}"]`).hover();
  await app.page.mouse.down();
  const item = app.frame().getByText(label, { exact: true }).last();
  await item.waitFor();
  await app.page.mouse.up();
  await item.click();
  await app.until((b, name) => b.world.toolsystem.active("EDIT_MESH").idname === name, tool);
}

// A point of the scene in Blender's axes, in page coordinates of the 3D Viewport.
async function screenOf([bx, by, bz]) {
  const [fx, fy] = await app.bylonder((b, [x, y, z]) => {
    const view = b.views.input, { width, height } = view.canvas;
    const p = BABYLON.Vector3.Project(new BABYLON.Vector3(x, z, y), BABYLON.Matrix.Identity(), view.camera.getTransformationMatrix(), { x: 0, y: 0, width, height });
    return [p.x / width, p.y / height];
  }, [bx, by, bz]);
  return app.point(fx, fy);
}

async function rightClick(x, y) {
  await app.page.mouse.move(x, y);
  await app.page.mouse.click(x, y, { button: "right" });
}

async function center(locator) {
  const box = await locator.boundingBox();
  return [box.x + box.width / 2, box.y + box.height / 2];
}

async function menu(id, item) {
  await app.page.click(`[data-blender="${id}"]`);
  await app.page.getByRole("menuitem", { name: item }).click();
}

async function expectStats(test, timeout = 10000) {
  const until = Date.now() + timeout;
  let stats;
  while (Date.now() < until) {
    stats = await app.stats();
    if (test(stats)) return stats;
    await app.page.waitForTimeout(100);
  }
  assert.fail(`status bar never matched ${test}: ${JSON.stringify(stats)}`);
}

const filter = process.argv[2];
const server = await startServer();
const browser = await chromium.launch();
let failed = 0;
try {
  for (const [name, check] of Object.entries(checks)) {
    if (filter && !name.includes(filter)) continue;
    const started = Date.now();
    try {
      app = await openApp(browser, server.url, check.open);
      await (check.run ?? check)();
      assert.deepEqual(app.errors, [], "page errors");
      console.log(`ok    ${name} (${Date.now() - started} ms)`);
    } catch (error) {
      failed++;
      const shot = `${tmpdir()}/e2e-${name.replace(/\W+/g, "-")}.png`;
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
