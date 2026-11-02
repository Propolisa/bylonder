// End-to-end smoke tests: core flows in Chromium with real mouse and keyboard input, against the production build.
// Assertions read state through window.__bylonder in the 3D Viewport frame and the status bar's statistics, and
// every check fails on a page error.
// usage: npm run test:e2e [-- name filter]
import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { readFileSync } from "node:fs";
import { execFileSync, spawnSync } from "node:child_process";
import { unzipSync, strFromU8 } from "fflate";
import { chromium, openApp, startServer } from "./app.mjs";
import { displacedSphere, lavaMaterial } from "./lava.mjs";

const renderStatus = ".render-result [data-status]";
const rendered = () => app.until((b, selector) => /^(Finished|Render failed)/.test(document.querySelector(selector).textContent), renderStatus, 60000);
let app;

const checks = {
  // The new project's scene (sphere and ground), as a first visit shows it.
  "app boots": { open: { example: null, node: "sphere" }, async run() {} },

  // The docs' Open in Bylonder link: index.html#example=<id> opens that example as a new project, without the splash.
  "an #example= link opens the example": {
    open: { link: "rigged-character", node: "Rig" },
    async run() {
      assert.equal(await app.page.locator("dialog.bl-splash[open]").count(), 0, "no splash");
      assert.equal(await app.page.locator("#project option:checked").textContent(), "Rigged Character");
    },
  },

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

  // Blender's own importer and exporter through the browser's file dialogs: the chosen files, the operator's options in
  // a dialog drawn from its ui, then the import in Main and in the view; the export downloads with its .mtl beside it.
  async "File > Import > Wavefront (.obj) and File > Export > Wavefront (.obj) run Blender's importer and exporter"() {
    const fileMenu = async (submenu, item) => {
      await app.page.click('[data-blender="TOPBAR_MT_file"]');
      await app.page.getByRole("menuitem", { name: new RegExp(`^${submenu}`) }).first().hover();
      await app.page.getByRole("menuitem", { name: item }).click();
    };
    const confirm = (title) => app.frame().getByRole("dialog", { name: title }).getByRole("button", { name: title }).click();
    const chooser = app.page.waitForEvent("filechooser");
    await fileMenu("Import", "Wavefront (.obj)");
    await (await chooser).setFiles(["suzanne.obj", "suzanne.mtl"].map((name) => new URL(`../fixtures/io/${name}`, import.meta.url).pathname));
    await confirm("Import Wavefront OBJ");
    await app.until((b) => b.world.objects.some((node) => node.name === "Suzanne" && node.getTotalVertices() === 1968));
    // Without the save picker the export downloads, as in browsers that lack it.
    await app.page.evaluate(() => { window.showSaveFilePicker = undefined; });
    const downloads = [];
    app.page.on("download", (download) => downloads.push(download));
    await fileMenu("Export", "Wavefront (.obj)");
    await confirm("Export Wavefront OBJ");
    for (let i = 0; i < 100 && downloads.length < 2; i++) await app.page.waitForTimeout(100);
    const names = downloads.map((download) => download.suggestedFilename()).sort();
    assert.deepEqual(names.map((name) => name.split(".").pop()), ["mtl", "obj"], `the .obj and its .mtl (${names})`);
    const chunks = [];
    for await (const chunk of await downloads.find((download) => download.suggestedFilename().endsWith(".obj")).createReadStream()) chunks.push(chunk);
    const obj = Buffer.concat(chunks).toString();
    assert.match(obj, /^o Suzanne$/m);
    assert.ok(obj.match(/^f /gm).length >= 500, "with Suzanne's faces");
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
    const region = app.frame().locator(".bl-outliner-region");
    const box = await region.boundingBox();
    const [x, y] = await app.bylonder((b) => b.world.outliner.area.draw().draw.find((c) => c.op === "text" && c.text === "Cube").at);
    await rightClick(box.x + x + 5, box.y + box.height - y - 4);
    for (const item of ["Delete Hierarchy", "Select Hierarchy"]) await app.frame().getByRole("menuitem", { name: item }).first().waitFor();
  },

  // Menus Blender's code builds in their own popup regions: the material slot's ID selector opens Blender's search of
  // the materials, its choice assigned; sub-menus opened after the editors drew again run their entries, in the 3D View,
  // the Shader Editor and a Properties context menu.
  async "ID selectors search their data-blocks, and nested sub-menus run their entries in every editor"() {
    await app.click();
    const properties = app.locator("#properties-section"), tabs = properties.locator('[data-blender="context"]');
    const browse = properties.getByTitle(/Browse Material/).first();
    for (let i = (await tabs.count()) - 1; i >= 0 && !(await browse.count()); i--) await tabs.nth(i).click();
    await app.bylonder((b) => b.world.materials.newMaterial(b.world.scene.getMeshByName("Cube")));
    await browse.click();
    await app.frame().locator(".bl-menu.searching").getByRole("menuitem", { name: "Material", exact: true }).click();
    await app.until((b) => b.world.scene.getMeshByName("Cube").material.name === "Material");
    await properties.locator('[role="tab"][aria-label="Object"]').click();
    await app.hover();
    await app.locator('[data-blender="VIEW3D_MT_add"]').first().click();
    await app.frame().getByRole("menuitem", { name: "Mesh" }).first().hover();
    await app.frame().getByRole("menuitem", { name: "Cone" }).click();
    await expectStats((s) => s.Objects[1] === 4);
    await rightClick(...(await center(app.locator('#properties-section [role="spinbutton"]').first())));
    await app.frame().getByRole("menuitem", { name: "Reset All to Default Values" }).first().click();
    await app.page.click('[data-workspace="shading"]');
    await app.frame().getByRole("button", { name: "New Material" }).click();
    const editor = app.frame().locator(".bl-node-editor");
    await editor.waitFor();
    const box = await editor.boundingBox();
    await app.page.mouse.move(box.x + box.width * 0.3, box.y + box.height * 0.5);
    await app.page.keyboard.press("Shift+A");
    await app.frame().getByRole("menuitem", { name: "Input" }).first().hover();
    const count = await app.frame().locator("[data-node]").count();
    await app.frame().getByRole("menuitem", { name: "Texture Coordinate" }).click();
    await app.frame().locator("[data-node]").nth(count).waitFor();
  },

  // A knife cut across the cube in Edit Mode, then back to Object Mode: the mesh Blender wrote back is drawn.
  async "a Knife cut in Edit Mode reaches Object Mode"() {
    await app.click();
    await app.page.keyboard.press("Tab");
    await app.until((b) => b.world.editMode.active);
    const [x0, y0] = await app.point(0.3, 0.45), [x1, y1] = await app.point(0.7, 0.55);
    await app.page.mouse.move(x0, y0);
    await app.page.keyboard.press("k");
    await app.page.mouse.down();
    for (let i = 1; i <= 10; i++) await app.page.mouse.move(x0 + ((x1 - x0) * i) / 10, y0 + ((y1 - y0) * i) / 10);
    await app.page.mouse.up();
    await app.page.keyboard.press("Enter");
    await expectStats((s) => s.Verts[1] > 8);
    await app.page.keyboard.press("Tab");
    await app.until((b) => !b.world.editMode.active);
    await expectStats((s) => s.Verts > 8);
  },

  async "right click on a property opens Blender's button context menu"() {
    await app.click();
    await rightClick(...(await center(app.locator('#properties-section [role="spinbutton"]').first())));
    for (const item of ["Insert Keyframes", "Reset All to Default Values", "Copy Data Path"]) await app.frame().getByRole("menuitem", { name: item }).first().waitFor();
  },

  // docs/model.md 7: I over a material's color in the Properties editor (Viewport Display's Color, diffuse_color)
  // keys it in Main with the button operator on the button under the pointer, at the frames the Timeline sets.
  // (Drawing the evaluated albedo waits for Main-owned materials: Babylon's albedo follows the Principled BSDF's Base
  // Color, which the Surface panel shows once Main's node trees are Blender's own; tests/animate-material.test.js.)
  async "I over a material's color in the Properties editor keys it at the Timeline's frames"() {
    await app.click();
    const properties = app.locator("#properties-section"), tabs = properties.locator('[data-blender="context"]');
    const viewport = properties.locator('[data-blender="MATERIAL_PT_viewport"]');
    for (let i = (await tabs.count()) - 1; i >= 0 && !(await viewport.count()); i--) await tabs.nth(i).click();
    await viewport.locator("header").click();
    const color = properties.locator('[data-blender="diffuse_color"]').first();
    const keyAt = async (frame) => {
      await typeInto('[role="spinbutton"][aria-label="Current Frame"]', String(frame));
      await color.hover();
      await app.page.keyboard.press("i");
    };
    await keyAt(1);
    await keyAt(21);
    const keys = await app.bylonder((b) => b.world.animation.anim.fcurves(b.world.mainSync.materialOf(b.world.scene.getMeshByName("Cube").material))
      .map((f) => `${f.rna_path}[${f.array_index}] ${f.keys.map((k) => k.co[0]).join(",")}`));
    assert.deepEqual(keys, [0, 1, 2, 3].map((i) => `diffuse_color[${i}] 1,21`));
  },

  // The HUD region's panel draws the operator's RNA properties; a change re-runs it.
  // Blender's material panels over Main's node tree: the slot list's rows, the Surface panel's Principled BSDF and its
  // Base Color, which the Babylon material draws.
  async "the Material tab shows the slot list and the Principled BSDF, whose Base Color reaches the material"() {
    await app.click();
    const properties = app.locator("#properties-section"), tabs = properties.locator('[data-blender="context"]');
    const surface = properties.locator('[data-blender="EEVEE_MATERIAL_PT_surface"]');
    for (let i = (await tabs.count()) - 1; i >= 0 && !(await surface.count()); i--) await tabs.nth(i).click();
    const row = properties.locator(".bl-overlap").first(), [select, name] = [row.locator("> *").first(), row.locator("> *").nth(1)];
    const [a, b] = [await select.boundingBox(), await name.boundingBox()];
    assert.ok(Math.abs(a.y - b.y) < 2 && a.width > b.width / 2, "a slot's name lies over its row");
    await surface.getByRole("button", { name: "Principled BSDF" }).waitFor();
    await surface.locator('input[type="color"]').first().evaluate((e) => {
      e.value = "#ff0000";
      for (const type of ["input", "change"]) e.dispatchEvent(new Event(type, { bubbles: true }));
    });
    await app.until((b) => { const c = b.world.scene.getMeshByName("Cube").material.albedoColor; return c.r > 0.99 && c.g < 0.01; });
  },

  // Blender's particle systems from its Particles tab: one added emits points the view draws, its Cache panel's Bake runs
  // as Blender's job to its end in the module, and the system goes again.
  async "the Particles tab adds a particle system that emits, and its cache bakes"() {
    const properties = app.locator("#properties-section");
    await app.locator('[role="tab"][aria-label="Particles"]').click();
    await properties.getByRole("button", { name: "Add a particle system" }).click();
    for (const frame of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]) await app.bylonder((b, f) => b.world.animation.time.configure({ frameCurrent: f }), frame);
    await app.until((b) => b.world.scene.meshes.some((m) => m.name.startsWith("__particles") && m.subMeshes[0]?.verticesCount > 10));
    const cache = properties.locator('[data-blender="PARTICLE_PT_cache"]');
    await cache.locator("header").click();
    await cache.getByRole("button", { name: "Bake", exact: true }).click();
    await cache.getByRole("button", { name: "Delete Bake" }).waitFor();
    await cache.getByRole("button", { name: "Delete Bake" }).click();
    await properties.getByRole("button", { name: "Remove the selected particle system" }).click();
    await app.until((b) => !b.world.scene.meshes.some((m) => m.name.startsWith("__particles")));
    await typeInto('[role="spinbutton"][aria-label="Current Frame"]', "1");
  },

  // anim.change_frame runs as Blender's modal operator: the frame follows the pointer until the button is released.
  async "dragging across the Timeline's frame numbers scrubs the frame"() {
    const box = await app.locator(".anim-editor").first().boundingBox(), frame = () => app.bylonder((b) => b.world.animation.time.frame);
    const y = box.y + 8;
    await app.page.mouse.move(box.x + 100, y);
    await app.page.mouse.down();
    const start = await frame();
    await app.page.mouse.move(box.x + 400, y, { steps: 8 });
    const dragging = await frame();
    await app.page.mouse.up();
    assert.ok(dragging > start + 10, `the frame follows the drag: ${start} to ${dragging}`);
    await typeInto('[role="spinbutton"][aria-label="Current Frame"]', "1");
  },

  async "Add > Cylinder shows Adjust Last Operation, whose Vertices rebuild it"() {
    await app.click(0.3, 0.3);
    await app.page.keyboard.press("Shift+a");
    await app.frame().getByRole("menuitem", { name: "Mesh" }).first().click();
    await app.frame().getByRole("menuitem", { name: "Cylinder" }).first().click();
    const hud = app.locator("#redo-panel");
    await hud.getByText("Add Cylinder").waitFor();
    for (const name of ["Vertices", "Radius", "Align", "Location X", "Rotation X"]) await hud.getByText(name, { exact: true }).first().waitFor();
    const vertices = () => app.bylonder((b) => b.editor.selection.nodes[0].getTotalVertices());
    const before = await vertices();
    await hud.locator("[role=spinbutton]").first().dblclick();
    await app.page.keyboard.press("Control+A");
    await app.page.keyboard.type("8");
    await app.page.keyboard.press("Enter");
    await app.until((b, n) => b.editor.selection.nodes[0].getTotalVertices() < n, before);
  },

  async "M opens Blender's Move to Collection menu, whose collection takes the object"() {
    await app.bylonder((b) => b.world.collections.create({ name: "Props" }));
    await app.click();
    await app.page.keyboard.press("m");
    await app.frame().locator(".bl-menu-item", { hasText: /^New Collection/ }).first().waitFor();
    await app.frame().locator(".bl-menu-item", { hasText: /^Collection/ }).first().click();
    await app.frame().locator(".bl-menu-item", { hasText: /^Props/ }).first().click();
    await app.until((b) => b.world.collections.all().find((c) => c.name === "Props").objects.length === 1);
  },

  async "right click on an area header opens Blender's Header menu, whose Vertical Split splits it"() {
    const areas = await app.frame().locator(".dock-leaf").count();
    const box = await app.frame().locator(".dock-heading").first().boundingBox();
    await rightClick(box.x + box.width - 40, box.y + box.height / 2);
    await app.frame().locator(".bl-menu-item", { hasText: /^Vertical Split/ }).click();
    await app.until((b, n) => document.querySelectorAll(".dock-leaf").length === n + 1, areas);
  },

  async "middle mouse orbits and Shift middle mouse pans"() {
    const view = () => app.frame().evaluate(() => { const c = window.__bylonder.views.input.editorCamera; return { alpha: c.position.x, x: c.target.x }; });
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
    const region = app.frame().locator(".bl-outliner-region");
    const box = await region.boundingBox();
    // A row's place on the page, over its name, from the Outliner's own draw (region pixels, y up).
    const row = async (name) => {
      const [x, y] = await app.bylonder((b, name) => b.world.outliner.area.draw().draw.find((c) => c.op === "text" && c.text === name).at, name);
      return [box.x + x + 5, box.y + box.height - y - 4];
    };
    // Its icons are painted where Blender places them: the first collection icon's square, as the page shows it, has
    // the icon's light pixels.
    const at = await app.bylonder((b) => b.world.outliner.area.draw().draw.find((c) => c.op === "icon" && c.icon === "OUTLINER_COLLECTION").at);
    const shot = await app.page.screenshot({ clip: { x: box.x + at[0], y: box.y + box.height - at[1] - 16, width: 16, height: 16 } });
    const bright = await app.page.evaluate(async (png) => {
      const image = await createImageBitmap(await (await fetch(`data:image/png;base64,${png}`)).blob());
      const ctx = new OffscreenCanvas(image.width, image.height).getContext("2d");
      ctx.drawImage(image, 0, 0);
      return ctx.getImageData(0, 0, image.width, image.height).data.some((value, i) => i % 4 === 0 && value > 120);
    }, shot.toString("base64"));
    assert.ok(bright, "the Outliner's collection icon is drawn");
    const cube = await row("Cube");
    await app.page.mouse.click(...cube);
    await app.until((b) => b.editor.selection.nodes.map((n) => n.name).join() === "Cube");
    const before = await app.bylonder((b) => b.world.collections.state.scene.objects.length);
    // A press soon after the click would be a double click (U.dbl_click_time), which renames instead of dragging.
    await app.page.waitForTimeout(400);
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
    assert.equal(await app.bylonder((b) => !!b.world.wm.modal), false);
  },

  // Edit Mode on a curve or a text object is Blender's on Main's own object, whose evaluation the view draws: a Bézier
  // curve's points extrude, and a text takes typed characters.
  async "Edit Curve extrudes a Bézier curve's points, Edit Text types into a text object"() {
    const named = (prefix) => app.bylonder((b, prefix) => {
      const node = b.world.objects.find((n) => n.name.startsWith(prefix) && !n.metadata?.wbDeleted);
      return node && { points: node.metadata.wbCreation.curve.splines?.flatMap((s) => s.bezier_points ?? s.points).length, body: node.metadata.wbCreation.curve.text?.body,
        drawn: node.getTotalVertices() + node.getChildMeshes(true).reduce((n, c) => n + c.getTotalVertices(), 0) };
    }, prefix);
    await app.bylonder((b) => b.runOperator("curve.primitive_bezier_curve_add"));
    await app.until((b) => b.world.objects.some((n) => n.name.startsWith("BézierCurve")));
    await app.hover();
    await app.page.keyboard.press("Tab");
    await app.until((b) => b.world.editMode.active);
    await app.page.keyboard.press("a");
    await expectStats(({ Verts }) => Verts?.[0] === 2 && Verts[1] === 2);
    await app.page.keyboard.press("e");
    await app.hover(0.6, 0.3);
    await app.click(0.6, 0.3);
    // Both selected ends extrude, as in Blender.
    await expectStats(({ Verts }) => Verts?.[1] === 4);
    await app.page.keyboard.press("Tab");
    await app.until((b) => !b.world.editMode.active);
    const curve = await named("BézierCurve");
    assert.equal(curve.points, 4, "the extruded points are the curve's");
    assert.ok(curve.drawn > 0, "the curve is drawn");
    await app.bylonder((b) => b.runOperator("object.text_add"));
    await app.until((b) => b.world.objects.some((n) => n.name.startsWith("Text")));
    const before = (await named("Text")).drawn;
    await app.page.keyboard.press("Tab");
    await app.until((b) => b.world.editMode.active);
    await app.page.keyboard.type("X");
    await app.page.keyboard.press("Tab");
    await app.until((b) => !b.world.editMode.active);
    const text = await named("Text");
    assert.equal(text.body, "TextX");
    assert.ok(text.drawn > before, `the new letter is drawn: ${before} to ${text.drawn}`);
  },

  // Blender's Add Light makes an Area light Babylon draws as its rectangular area light, of Blender's size.
  async "Add Light > Area draws a rectangular area light"() {
    await app.bylonder((b) => b.runOperator("object.light_add", { type: "AREA" }));
    await app.until((b) => b.world.scene.lights.some((l) => l.getClassName() === "RectAreaLight"));
    await app.settled();
    const size = await app.bylonder((b) => { const l = b.world.scene.lights.find((l) => l.getClassName() === "RectAreaLight"); return [l.width, l.height]; });
    assert.deepEqual(size, [1, 1], "Blender's default size");
  },

  // A click in Edit Mode is Blender's view3d.select on Main's edit mesh, picking as in X-ray.
  async "Edit Mode: a click selects the face under it"() {
    await app.click();
    await app.page.keyboard.press("Tab");
    await app.until((b) => b.world.editMode.active);
    await app.page.keyboard.press("3");
    await app.page.keyboard.press("Alt+a");
    await expectStats(({ Faces }) => Faces?.[0] === 0);
    await app.click();
    await expectStats(({ Faces }) => Faces?.[0] === 1);
  },

  // The header's mode menu (object.mode_set's enum, by Blender's object_mode_set_itemf) lists a mesh's modes once.
  async "the mode menu lists each mode once, and its Edit Mode enters Edit Mode"() {
    await app.click();
    await app.frame().locator("button", { hasText: "Object Mode" }).first().click();
    const items = await app.frame().getByRole("menuitem").allTextContents();
    assert.deepEqual(items.filter((item, i) => items.indexOf(item) !== i), [], `listed twice: ${items}`);
    await app.frame().getByRole("menuitem", { name: "Edit Mode" }).click();
    await app.until((b) => b.world.editMode.active);
    await app.page.keyboard.press("Tab");
    await app.until((b) => !b.world.editMode.active);
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

  // The object follows the mouse from the first G on: its projection moves as far as the mouse did.
  "G moves the object with the mouse, from the first G": { open: { example: null, node: "sphere" }, async run() {
    const screen = () => app.bylonder((b) => {
      const node = b.world.objects.find((o) => o.name === "sphere"), view = b.views.input, { width, height } = view.canvas;
      const p = BABYLON.Vector3.Project(node.getAbsolutePosition(), BABYLON.Matrix.Identity(), view.camera.getTransformationMatrix(), { x: 0, y: 0, width, height });
      const scale = view.canvas.getBoundingClientRect().width / width;
      return [p.x / width, p.y / height, p.x * scale, p.y * scale];
    });
    const [fx, fy] = await screen();
    await app.click(fx, fy);
    await app.until((b) => b.editor.selection.nodes.map((n) => n.name).join() === "sphere");
    for (const dx of [60, -40]) {
      const [gx, gy, x0, y0] = await screen(), [x, y] = await app.point(gx, gy);
      await app.page.mouse.move(x + 5, y + 5, { steps: 5 });
      await app.page.waitForTimeout(150);
      await app.page.keyboard.press("g");
      await app.page.mouse.move(x + 5 + dx, y + 5, { steps: 10 });
      await app.page.mouse.click(x + 5 + dx, y + 5);
      await app.until((b) => !b.world.wm.modal);
      const [, , x1, y1] = await screen();
      assert.ok(Math.abs(x1 - x0 - dx) < 2 && Math.abs(y1 - y0) < 2, `moved by ${[x1 - x0, y1 - y0]} px for ${dx} px`);
    }
  } },

  // A number field's drag changes the value by the pixels moved from the first move on: the End frame, an integer, by
  // one frame per two pixels; a second drag back undoes it. Inside the window the pointer stays unlocked, so no lock's
  // first move (Chromium's jump from the lock's origin) reaches the value.
  async "dragging a number field changes it by the pixels moved"() {
    const end = app.locator('[role="spinbutton"][aria-label="End"]');
    for (const [dx, expected] of [[40, "270"], [-40, "250"]]) {
      const box = await end.boundingBox(), x = box.x + box.width / 2, y = box.y + box.height / 2;
      await app.page.mouse.move(x, y);
      await app.page.mouse.down();
      await app.page.mouse.move(x + dx, y, { steps: 10 });
      assert.equal(await app.frame().evaluate(() => !!document.pointerLockElement), false);
      await app.page.mouse.up();
      assert.equal(await end.getAttribute("aria-valuenow"), expected);
    }
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

  // The outline is drawn in screen space (overlay-outline.js): scaling the cube leaves its width in pixels as it was.
  async "the selection outline keeps its pixel width when the cube is scaled by 3"() {
    await app.click();
    const width = async () => {
      await app.until((b) => b.views.idle);
      // Outline pixels (orange) on a row across the cube below its origin, as runs: one per silhouette edge it crosses.
      const runs = await app.bylonder(async (b) => {
        const { canvas } = b.views.input, { width, height } = canvas;
        const context = new OffscreenCanvas(width, height).getContext("2d");
        context.drawImage(await createImageBitmap(canvas), 0, 0);
        const { data } = context.getImageData(0, Math.round(height * 0.55), width, 1), runs = [];
        for (let x = 0, run = 0; x <= width; x++) {
          const [r, g, b] = data.subarray(x * 4, x * 4 + 3), outline = x < width && r - b > 90 && r > 140 && b < 0.6 * g;
          if (outline) run++;
          else if (run) { runs.push(run); run = 0; }
        }
        return runs;
      });
      assert.equal(runs.length, 2, `outline runs ${runs}`);
      return (runs[0] + runs[1]) / 2;
    };
    const unscaled = await width();
    await app.hover(0.25, 0.75);
    for (const key of ["s", "3", "Enter"]) await app.page.keyboard.press(key);
    await app.until((b) => Math.abs(b.world.scene.getMeshByName("Cube").scaling.x - 3) < 1e-6);
    const scaled = await width();
    assert.ok(unscaled >= 1 && unscaled <= 4, `outline ${unscaled} px wide`);
    assert.ok(Math.abs(scaled - unscaled) <= 0.5, `outline ${unscaled} px wide at scale 1, ${scaled} px at scale 3`);
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

  // docs/lava-material.md: a UV sphere displaced by a Clouds texture, then a lava material made from Blender's nodes in
  // the Shading workspace's Shader Editor, shown in Material Preview.
  async "Displace with a Clouds texture, and a lava material from the Shader Editor's nodes in Material Preview"() {
    await displacedSphere(app);
    // Displaced by the clouds: the subdivided sphere's radius varies from point to point.
    await app.until((b) => {
      const p = b.world.scene.getMeshByName("Sphere").getVerticesData("position"), r = [];
      for (let i = 0; i < p.length; i += 3) r.push(Math.hypot(p[i], p[i + 1], p[i + 2]));
      return p.length > 7000 * 3 && Math.max(...r) - Math.min(...r) > 0.1;
    }, null, 30000);
    await lavaMaterial(app);
    const FUNCTIONS = ["node_noise_tex_fbm_4d", "valtorgb_opti_linear", "node_bump", "bl_tex_coord"];
    await app.until((b, functions) => {
      const m = b.world.scene.getMeshByName("Sphere").material, code = m._fragmentCompilationState?._builtCompilationString ?? "";
      return !m._buildIsInProgress && functions.every((f) => code.includes(f));
    }, FUNCTIONS, 60000);
    const links = await app.bylonder((b) => b.world.scene.getMeshByName("Sphere").material.attachedBlocks.flatMap((block) => block.inputs
      .filter((i) => i.connectedPoint && block.declared?.(i.name)).map((i) => `${i.connectedPoint.ownerBlock.getClassName()} ${i.connectedPoint.name} > ${block.getClassName()} ${i.name}`)));
    assert.deepEqual(links.sort(), ["ShaderNodeBsdfPrincipled BSDF > ShaderNodeOutputMaterial Surface", "ShaderNodeBump Normal > ShaderNodeBsdfPrincipled Normal", "ShaderNodeTexCoord Object > ShaderNodeTexNoise Vector",
      "ShaderNodeTexCoord Object > ShaderNodeTexNoise Vector", "ShaderNodeTexNoise Fac > ShaderNodeBsdfPrincipled Emission Strength", "ShaderNodeTexNoise Fac > ShaderNodeBump Height",
      "ShaderNodeTexNoise Fac > ShaderNodeValToRGB Fac", "ShaderNodeValToRGB Color > ShaderNodeBsdfPrincipled Emission Color"]);
    // Material Preview draws the sphere glowing: orange pixels where it is.
    const warm = await app.bylonder(async (b) => {
      const engine = b.world.scene.getEngine();
      b.views.wake();
      await new Promise((resolve) => b.world.scene.onAfterRenderObservable.addOnce(resolve));
      const pixels = await engine.readPixels(0, 0, engine.getRenderWidth(), engine.getRenderHeight());
      let count = 0;
      for (let i = 0; i < pixels.length; i += 4) if (pixels[i] > 120 && pixels[i] > 2 * pixels[i + 2]) count++;
      return count;
    });
    assert.ok(warm > 200, `${warm} orange pixels`);
  },

  // The Scripting workspace's Python Console is Blender's own over the module's CPython, and the Text Editor runs a
  // script; Info reports the operator.
  async "Scripting: the console adds a cube, a script moves the object"() {
    await app.page.click('[data-workspace="scripting"]');
    const pythonConsole = app.locator('[data-blender="CONSOLE"]'), textEditor = app.locator('[data-blender="TEXT_EDITOR"]');
    await pythonConsole.waitFor();
    await app.until(() => /PYTHON\s*INTERACTIVE\s*CONSOLE/.test(document.querySelector('[data-blender="CONSOLE"]').textContent), null, 180000);
    const before = await app.bylonder((b) => b.world.objects.length);
    await pythonConsole.hover();
    await app.page.keyboard.type("bpy.ops.mesh.primitive_cube_add()");
    await app.page.keyboard.press("Enter");
    await app.until((b, n) => b.world.objects.length > n, before);
    await app.until(() => /bpy\.ops\.mesh\.primitive_cube_add\(/.test(document.querySelector('[data-blender="INFO"]').textContent));
    await textEditor.hover();
    await app.page.keyboard.press("Alt+n");
    await app.page.keyboard.type("import bpy\nbpy.context.object.location.x = 2\n");
    await app.page.keyboard.press("Alt+p");
    await app.until((b) => Math.abs(b.editor.selection.nodes.at(-1).position.x - 2) < 1e-6, null, 60000);
  },

  // Camera view looks through the scene camera in the view's own Solid shading, with its overlays (the bones).
  "camera view keeps Solid shading and overlays": { open: { example: "Rigged Character", node: "Rig" }, async run() {
    await app.hover(0.5, 0.5);
    await app.page.keyboard.press("Numpad0");
    await app.until((b) => b.views.input.state.cameraView);
    const view = await app.bylonder((b) => { const v = b.views.input; return { rendered: v.rendered, shading: b.world.workbench.shading(v.camera), overlaysOff: v.section.classList.contains("overlays-off") }; });
    assert.deepEqual(view, { rendered: false, shading: "solid", overlaysOff: false });
  } },

  // An orthographic scene camera frames the scene through Numpad 0 by its Orthographic Scale, as in Blender.
  "an orthographic camera shows the scene through Numpad 0": { open: {}, async run() {
    await app.bylonder((b) => b.runOperator("wm.context_set_enum", { data_path: "scene.camera.data.type", value: "ORTHO" }));
    await app.settled();
    await app.hover(0.5, 0.5);
    await app.page.keyboard.press("Numpad0");
    await app.until((b) => b.views.input.state.cameraView);
    const cube = await app.bylonder((b) => {
      const { camera } = b.views.input, engine = b.world.engine, w = engine.getRenderWidth(), h = engine.getRenderHeight();
      const p = BABYLON.Vector3.Project(b.world.scene.getMeshByName("Cube").getAbsolutePosition(), BABYLON.Matrix.Identity(), camera.getTransformationMatrix(), { x: 0, y: 0, width: w, height: h });
      return { ortho: camera.mode === BABYLON.Camera.ORTHOGRAPHIC_CAMERA, x: p.x / w, y: p.y / h, width: camera.orthoRight - camera.orthoLeft };
    });
    assert.ok(cube.ortho, "the camera is orthographic");
    assert.ok(cube.width > 1 && cube.width < 100, `ortho bounds from the scale, not pixels: ${cube.width}`);
    assert.ok(cube.x > 0.1 && cube.x < 0.9 && cube.y > 0.1 && cube.y < 0.9, `the cube is in view: ${cube.x}, ${cube.y}`);
  } },

  // Align Active Camera to View (Ctrl Alt Numpad 0) moves the scene camera to the view's eye and looks through it.
  "Align Active Camera to View moves the camera to the view": { open: { example: "Rigged Character", node: "Rig" }, async run() {
    await app.hover(0.5, 0.5);
    const eye = await app.bylonder((b) => b.views.input.camera.computeWorldMatrix(true).getTranslation().asArray());
    await app.page.keyboard.press("Control+Alt+Numpad0");
    await app.until((b) => b.views.input.state.cameraView);
    const camera = await app.bylonder((b) => b.views.input.camera.computeWorldMatrix(true).getTranslation().asArray());
    camera.forEach((v, i) => assert.ok(Math.abs(v - eye[i]) < 1e-3, `camera ${camera} at the view's eye ${eye}`));
  } },

  // A sculpt stroke is one undo step (Blender's sculpt undo pushes it): Ctrl Z takes it back and stays in Sculpt Mode.
  // A smaller window shows the cube larger, under the whole brush.
  "Ctrl Z undoes a sculpt stroke in Sculpt Mode": { open: { size: { width: 1280, height: 720 } }, async run() {
    const state = () => app.bylonder((b) => ({ mode: b.world.mainModes.mode(), size: b.world.scene.getMeshByName("Cube").getVerticesData("position").reduce((sum, v) => sum + Math.abs(v), 0) }));
    await app.bylonder((b) => b.runOperator("object.mode_set", { mode: "SCULPT" }));
    await app.settled();
    const before = await state();
    const [x, y] = await app.point(0.5, 0.5);
    await app.page.mouse.move(x - 60, y);
    await app.page.mouse.down();
    for (let i = 1; i <= 30; i++) await app.page.mouse.move(x - 60 + i * 4, y + i);
    await app.page.mouse.up();
    await app.until((b, size) => Math.abs(b.world.scene.getMeshByName("Cube").getVerticesData("position").reduce((sum, v) => sum + Math.abs(v), 0) - size) > 1e-3, before.size);
    await app.page.keyboard.press("Control+z");
    await app.settled();
    assert.deepEqual(await state(), before);
  } },

  // Texture Paint: a stroke on Suzanne in the 3D Viewport and one in the Image Editor paint her image, Ctrl Z takes a
  // stroke back, and the UV Editing workspace shows her UVs over it.
  "Texture Paint paints in the 3D Viewport and the Image Editor": { open: { link: "texture-paint", node: "Suzanne" }, async run() {
    const painted = () => app.bylonder((b) => {
      const pixels = b.modules.bpyRna.blendData().images.get("Suzanne Paint").pixels;
      let sum = 0;
      for (let i = 0; i < pixels.length; i += 401) sum += pixels[i];
      return sum;
    });
    const stroke = async (box, [x0, y0], [x1, y1]) => {
      await app.page.mouse.move(box.x + box.width * x0, box.y + box.height * y0);
      await app.page.mouse.down();
      for (let i = 1; i <= 20; i++) await app.page.mouse.move(box.x + box.width * (x0 + (x1 - x0) * i / 20), box.y + box.height * (y0 + (y1 - y0) * i / 20));
      await app.page.mouse.up();
      await app.settled();
    };
    await app.page.click('[data-workspace="texture-paint"]');
    await app.settled();
    await app.hover(0.5, 0.5);
    await app.page.keyboard.press("NumpadDecimal");
    await app.settled();
    const view = await app.frame().locator(".viewport-canvas").first().boundingBox();
    const before = await painted();
    await stroke(view, [0.4, 0.45], [0.6, 0.5]);
    const stroked = await painted();
    assert.notEqual(stroked, before, "the 3D stroke paints the image");
    await app.page.keyboard.press("Control+z");
    await app.settled();
    assert.equal(await painted(), before, "Ctrl Z takes the stroke back");
    await stroke(await app.frame().locator("#image-section").boundingBox(), [0.2, 0.7], [0.5, 0.4]);
    assert.notEqual(await painted(), before, "the Image Editor stroke paints the image");
    await app.page.click('[data-workspace="uv-editing"]');
    await app.settled();
    assert.ok(await app.frame().locator("#image-section canvas.bl-image-view").isVisible(), "the UV Editor draws");
  } },

  // Grease Pencil: the Bouncing Ball's drawings draw as GreasedLine and fill meshes; a drag in Draw Mode draws a stroke
  // (one undo step), and the Fill tool's Pixel solver, rendered on Babylon, fills a closed shape.
  "Grease Pencil draws, fills and undoes a stroke": { open: { link: "grease-pencil", node: "Bouncing Ball" }, async run() {
    const curves = () => app.bylonder((b) => b.world.mainSync.blender.greasePencil({ repack: true }).filter((d) => !d.onion).reduce((n, d) => n + d.curves.length / 5, 0));
    assert.ok(await app.bylonder((b) => b.world.scene.meshes.some((m) => m.getClassName() === "GreasedLineMesh" && m.getTotalVertices())), "strokes draw as GreasedLine");
    await app.bylonder((b) => b.runOperator("object.mode_set", { mode: "PAINT_GREASE_PENCIL" }));
    await app.settled();
    const before = await curves();
    const drag = async (points) => {
      await app.page.mouse.move(...(await app.point(...points[0])));
      await app.page.mouse.down();
      for (let s = 1; s < points.length; s++) for (let k = 1; k <= 10; k++) {
        const [[x0, y0], [x1, y1]] = [points[s - 1], points[s]];
        await app.page.mouse.move(...(await app.point(x0 + (x1 - x0) * k / 10, y0 + (y1 - y0) * k / 10)));
      }
      // Held still past the moves' redraws: the release alone must draw the finished stroke.
      await app.page.waitForTimeout(800);
      const rendered = await app.bylonder((b) => b.world.scene.getRenderId());
      await app.page.mouse.up();
      await app.settled();
      await app.until((b, id) => b.world.scene.getRenderId() > id, rendered);
    };
    await drag([[0.35, 0.3], [0.65, 0.3], [0.65, 0.55], [0.35, 0.55], [0.35, 0.3]]);
    assert.equal(await curves(), before + 1, "the drag drew a stroke");
    await app.bylonder((b) => b.runOperator("brush.asset_activate", { asset_library_type: "ESSENTIALS", relative_asset_identifier: "brushes/essentials_brushes-gp_draw.blend/Brush/Fill" }));
    await app.bylonder((b) => { b.modules.bpyRna.contextStruct().tool_settings.gpencil_paint.brush.gpencil_settings.fill_solver = "PIXEL"; });
    await app.click(0.5, 0.42);
    await app.settled();
    assert.equal(await curves(), before + 2, "the Pixel solver filled the square");
    await app.page.keyboard.press("Control+z");
    await app.settled();
    assert.equal(await curves(), before + 1, "Ctrl Z undoes the fill");
  } },

  // A pen in Draw Mode: one move event carrying coalesced moves draws them all, and the pen's eraser end erases. The
  // events are the page's own PointerEvents, as a tablet gives them (pressure, tilt, coalesced moves, button 5).
  "Grease Pencil takes a pen's coalesced moves and its eraser end": { open: { link: "grease-pencil", node: "Bouncing Ball" }, async run() {
    const points = () => app.bylonder((b) => b.world.mainSync.blender.greasePencil({ repack: true }).filter((d) => !d.onion).reduce((n, d) => n + d.points.length / 14, 0));
    await app.bylonder((b) => b.runOperator("object.mode_set", { mode: "PAINT_GREASE_PENCIL" }));
    await app.settled();
    const pen = (strokes, { button = 0, buttons = 1 } = {}) => app.bylonder((b, [strokes, button, buttons]) => {
      const canvas = b.views.input.canvas, rect = canvas.getBoundingClientRect();
      const at = ([fx, fy], pressure) => ({ clientX: rect.left + rect.width * fx, clientY: rect.top + rect.height * fy, pointerType: "pen", pointerId: 2, pressure, tiltX: 30, tiltY: -10, bubbles: true });
      for (const path of strokes) {
        // A pen hovers where it then touches down, as a tablet's pen does.
        canvas.dispatchEvent(new PointerEvent("pointermove", { ...at(path[0], 0), buttons: 0 }));
        canvas.dispatchEvent(new PointerEvent("pointerdown", { ...at(path[0], 0.5), button, buttons }));
        const moves = path.slice(1).map((p, i) => new PointerEvent("pointermove", { ...at(p, 0.5 + 0.4 * i / path.length), buttons }));
        canvas.dispatchEvent(new PointerEvent("pointermove", { ...at(path.at(-1), 0.9), buttons, coalescedEvents: moves }));
        canvas.dispatchEvent(new PointerEvent("pointerup", { ...at(path.at(-1), 0), button, buttons: 0 }));
      }
    }, [strokes, button, buttons]);
    const wave = Array.from({ length: 40 }, (_, i) => [0.3 + i * 0.01, 0.35 + 0.08 * Math.sin(i / 4)]);
    const before = await points();
    await pen([wave]);
    await app.settled();
    const drawn = await points() - before;
    assert.ok(drawn > 10, `one event's coalesced moves drew a stroke of ${drawn} points`);
    await pen([[[0.28, 0.25], [0.5, 0.45], [0.72, 0.25]]], { button: 5, buttons: 32 });
    await app.settled();
    assert.ok(await points() < before + drawn, "the eraser end erased");
  } },

  // Shade Flat after Shade Smooth draws flat again (every face sharp is stored as one value of sharp_face).
  "Shade Flat after Shade Smooth draws flat faces": { open: {}, async run() {
    const normal = () => app.bylonder((b) => Array.from(b.world.scene.getMeshByName("Cube").getVerticesData("normal").slice(0, 3), (v) => Math.round(Math.abs(v) * 100) / 100));
    for (const op of ["object.shade_smooth", "object.shade_flat"]) {
      await app.bylonder((b, op) => b.runOperator(op, {}), op);
      await app.settled();
    }
    assert.equal((await normal()).filter((v) => v === 1).length, 1, `a face normal: ${await normal()}`);
  } },

  // The Shader Editor edits the active object's active material for any object type with materials: a Curves object's.
  "the Shader Editor edits a Curves object's material": { open: { example: "Hair Dynamics", node: "Hair" }, async run() {
    await app.bylonder((b) => { b.editor.selection.replace([b.world.scene.getNodeByName("Hair")]); b.world.openNodeEditor("shader"); });
    await app.until(() => document.querySelector("#nodes-section .node-editor-empty").hidden);
  } },

  // The Geometry Nodes workspace's screen: the 3D Viewport, the Geometry Node Editor and the Timeline, the Outliner and
  // the Properties editor.
  async "the Geometry Nodes workspace shows the Geometry Node Editor"() {
    await app.page.click('[data-workspace="geometry-nodes"]');
    for (const id of ["viewport", "nodes", "timeline", "objects", "properties"]) await app.locator(`.dock-content[data-section="${id}"]`).waitFor();
    assert.equal(await app.locator('.dock-content[data-section="info"]').isVisible(), false);
    await app.until(() => /has no Geometry Nodes modifier/.test(document.querySelector("#nodes-section .node-editor-empty").textContent));
  },

  // Opening the Video Sequencer on an empty edit offers to set it up; Remember keeps the choice for next time.
  "opening the Video Sequencer offers to set it up for video": { open: { example: "Volcanic Island", node: "Island" }, async run() {
    await app.bylonder((b) => b.world.animation.time.configure({ frameEnd: 48 }));
    // The Timeline's header is Blender's: its Editor Type is the area's ui_type.
    await app.locator(".dock-heading").filter({ has: app.frame().getByRole("button", { name: "Marker", exact: true }) }).locator('[data-blender="ui_type"]').click();
    await app.frame().getByRole("menuitem", { name: "Video Sequencer" }).click();
    const dialog = app.frame().getByRole("dialog", { name: "Set Up for Video Editing" });
    await dialog.getByRole("checkbox").last().click();
    await dialog.getByRole("button", { name: "Set Up" }).click();
    await app.until((b) => b.world.sequenceEditor.state?.edit?.timeline?.items?.length === 2, null, 30000);
    const out = await app.bylonder((b) => {
      const { items, tracks } = b.world.sequenceEditor.state.edit.timeline, { image_settings, ffmpeg } = b.mainScene.render;
      return { strips: items.map((i) => [i.type, i.from, i.durationInFrames, tracks.find((t) => t.id === i.trackId).kind]),
        output: [image_settings.file_format, ffmpeg.format, ffmpeg.codec, ffmpeg.audio_codec], remembered: JSON.parse(localStorage.getItem("bylonder:preferences:v1")),
        live: b.sceneAudio.live(b.scenes[0].id) };
    });
    assert.deepEqual(out.strips, [["scene", 1, 48, "video"], ["audio", 1, 48, "audio"]]);
    assert.deepEqual(out.output, ["FFMPEG", "MPEG4", "H264", "AAC"]);
    assert.deepEqual([out.remembered.askSequencerSetup, out.remembered.sequencerSetup], [false, { video: true, scene: true, audio: true }]);
    assert.ok(out.live, "the scene plays its sound live, so its strip is silent in the preview");
  } },

  // Output > Frame Rate runs Blender's preset scripts (scripts/presets/framerate); new scenes start at 60 fps.
  async "Frame Rate presets set the scene's fps"() {
    const fps = () => app.bylonder((b) => [b.mainScene.render.fps, +b.mainScene.render.fps_base.toFixed(3), +(b.world.animation.time.state.fps / b.world.animation.time.state.fpsBase).toFixed(2)]);
    assert.deepEqual(await fps(), [60, 1, 60]);
    await app.locator('[role="tab"][aria-label="Output"]').click();
    const choose = async (current, preset) => {
      await app.frame().locator('section[data-blender="RENDER_PT_format"]').getByRole("button", { name: current }).click();
      await app.frame().getByRole("menuitem", { name: preset, exact: true }).click();
    };
    await choose("60", "29.97");
    await app.until((b) => b.mainScene.render.fps === 30);
    assert.deepEqual(await fps(), [30, 1.001, 29.97]);
    await choose("29.97", "24");
    await app.until((b) => b.mainScene.render.fps === 24);
    assert.deepEqual(await fps(), [24, 1, 24]);
  },

  // Video with sound renders its frames in the live scene while the scene's sound mixes in a render context of its own:
  // frames come in from the start, with no mixing beforehand, the video has the sound, and Cancel stops it at once.
  "Render Animation to video mixes the scene's sound along with its frames": { open: { example: "Volcanic Island", node: "Island" }, async run() {
    await app.bylonder((b) => {
      b.world.animation.time.configure({ frameEnd: 24 });
      Object.assign(b.mainScene.render.image_settings, { media_type: "VIDEO", file_format: "FFMPEG" });
      Object.assign(b.mainScene.render.ffmpeg, { format: "WEBM", codec: "WEBM", audio_codec: "OPUS" });
    });
    const statuses = [];
    const download = app.page.waitForEvent("download", { timeout: 300000 });
    await menu("TOPBAR_MT_render", "Render Animation");
    while (true) {
      const status = await app.frame().evaluate((selector) => document.querySelector(selector).textContent, renderStatus);
      if (statuses.at(-1) !== status) statuses.push(status);
      if (/^(Finished|Render failed|Render cancelled)/.test(status)) break;
      await app.page.waitForTimeout(100);
    }
    assert.match(statuses.at(-1), /^Finished 24 frames/);
    const firstFrame = statuses.findIndex((s) => s.startsWith("Frame "));
    assert.ok(firstFrame >= 0 && !statuses.slice(0, firstFrame).some((s) => s.startsWith("Mixing")), `no mix before the frames: ${statuses.join(" / ")}`);
    assert.match(statuses.find((s) => !s.startsWith("Preparing")), /^Frame \d+ \|/);
    const file = `${tmpdir()}/smoke-render.webm`;
    await (await download).saveAs(file);
    const streams = JSON.parse(execFileSync("ffprobe", ["-v", "error", "-show_streams", "-of", "json", file])).streams;
    const audio = streams.find((stream) => stream.codec_type === "audio");
    assert.ok(audio, "the video has a sound track");
    const { stderr } = spawnSync("ffmpeg", ["-hide_banner", "-i", file, "-map", "0:a", "-af", "volumedetect", "-f", "null", "-"], { encoding: "utf8" });
    const mean = Number(stderr.match(/mean_volume: (-?[\d.]+) dB/)?.[1]);
    assert.ok(mean > -60, `the sound track carries the scene's sound (mean ${mean} dB)`);
    await app.bylonder((b) => b.world.animation.time.configure({ frameEnd: 400 }));
    await menu("TOPBAR_MT_render", "Render Animation");
    await app.until((b, selector) => /^Frame \d+/.test(document.querySelector(selector).textContent), renderStatus, 60000);
    await app.locator(".render-result [data-cancel]").click();
    await app.until((b, selector) => document.querySelector(selector).textContent === "Render cancelled", renderStatus, 5000);
  } },

  // The video edit is saved with the action, whatever Remember Scene Edits says: it survives a reload, a project ZIP's
  // export and import, and a .blend's save and open.
  async "The Video Sequencer's edit survives a reload, a project ZIP and a .blend"() {
    const strips = () => app.bylonder((b) => b.world.sequenceEditor.state?.edit?.timeline?.items?.length ?? 0);
    const ready = () => app.page.waitForFunction(() => !!document.querySelector('iframe[src*="viewport.html"]')?.contentWindow?.__bylonder?.editor, null, { timeout: 120000 });
    await app.bylonder(async (b) => { await (await b.sequencer.menus()).Add.find((entry) => entry.label === "Scene").items()[0].run(); });
    await app.until((b) => b.world.sequenceEditor.state?.edit?.timeline?.items?.length === 1);
    await app.page.waitForTimeout(1500);
    await app.page.reload();
    await ready();
    await app.until((b) => b.world.sequenceEditor.state?.edit?.timeline?.items?.length === 1, null, 30000);

    const zip = app.page.waitForEvent("download", { timeout: 60000 });
    await app.page.evaluate(() => document.getElementById("export").click());
    const zipFile = `${tmpdir()}/smoke-vse.zip`;
    await (await zip).saveAs(zipFile);
    await app.page.setInputFiles("#import-input", zipFile);
    await app.page.waitForTimeout(2000);
    await ready();
    await app.until((b) => b.world.sequenceEditor.state?.edit?.timeline?.items?.length === 1, null, 30000);

    const blend = app.page.waitForEvent("download", { timeout: 60000 });
    await menu("TOPBAR_MT_file", "Save As...");
    const blendFile = `${tmpdir()}/smoke-vse.blend`;
    await (await blend).saveAs(blendFile);
    const chooser = app.page.waitForEvent("filechooser");
    await menu("TOPBAR_MT_file", "Open...");
    await (await chooser).setFiles(blendFile);
    await app.page.waitForTimeout(2000);
    await ready();
    await app.until((b) => b.world.sequenceEditor.state?.edit?.timeline?.items?.length === 1, null, 30000);
    assert.equal(await strips(), 1);
  },

  // Help > Reset App deletes what the app keeps in this browser and restarts with one fresh project.
  async "Help > Reset App restarts clean"() {
    const projects = () => app.page.evaluate(() => document.getElementById("project").options.length);
    await app.page.evaluate(() => { localStorage.setItem("reset-marker", "1"); document.getElementById("new-project").click(); });
    await app.page.getByRole("button", { name: "OK" }).click();
    await app.page.waitForFunction(() => document.getElementById("project").options.length >= 2, null, { timeout: 60000 });
    await app.page.waitForFunction(() => !!document.querySelector('iframe[src*="viewport.html"]')?.contentWindow?.__bylonder?.editor, null, { timeout: 120000 });
    // The menus come from the new project's scene window once it has loaded.
    const reset = app.page.getByRole("menuitem", { name: "Reset App..." });
    for (let i = 0; i < 30 && !(await reset.count()); i++) {
      await app.page.keyboard.press("Escape");
      await app.page.click('[data-blender="TOPBAR_MT_help"]');
      await app.page.waitForTimeout(1000);
    }
    app.page.once("dialog", (dialog) => dialog.accept());
    await reset.click();
    await app.page.waitForFunction(() => !localStorage.getItem("reset-marker") && document.getElementById("project")?.options.length === 1, null, { timeout: 120000 });
    await app.page.waitForFunction(() => !!document.querySelector('iframe[src*="viewport.html"]')?.contentWindow?.__bylonder?.editor, null, { timeout: 120000 });
    assert.equal(await projects(), 1);
  },

  // The island makes its sound with Babylon's audio; a Scene Audio strip carries it into the sequencer's mix.
  "Add > Scene Audio puts the scene's sound in the edit": { open: { example: "Volcanic Island", node: "Island" }, async run() {
    const out = await app.bylonder(async (b) => {
      b.world.animation.time.configure({ frameEnd: 48 });
      b.world.animation.seek(1);
      const add = (await b.sequencer.menus()).Add.find((entry) => entry.label === "Scene Audio");
      await add.items()[0].run();
      const { items, tracks } = b.world.sequenceEditor.state.edit.timeline, strip = items.find((i) => i.scene);
      const compositor = await b.sequencer.openCompositor({ frameStart: 1, frameEnd: 48, width: 64, height: 36 });
      const { samples, sampleRate } = await compositor.audio();
      compositor.dispose();
      const rms = (c) => Math.sqrt(c.reduce((sum, v) => sum + v * v, 0) / c.length);
      return { strip: { type: strip.type, from: strip.from, durationInFrames: strip.durationInFrames, src: strip.src, channel: tracks.find((t) => t.id === strip.trackId).kind },
        seconds: samples[0].length / sampleRate, channels: samples.length, rms: rms(samples[0]) };
    });
    assert.deepEqual(out.strip, { type: "audio", from: 1, durationInFrames: 48, src: "", channel: "audio" });
    assert.equal(out.seconds, 2);
    assert.equal(out.channels, 2);
    assert.ok(out.rms > 0.01, `the scene's sound is in the mix (rms ${out.rms})`);
  } },

  // Strips' media comes from the media library after a reload (the URLs saved in the edit die with the page), and a
  // render keeps the Scene Audio it opened with when the scene changes meanwhile. A still mixes no sound.
  "Sequencer media renders after a reload": { open: { example: "Volcanic Island", node: "Island", persistent: true }, async run() {
    await addClipStrip();
    await app.bylonder(async (b) => { await (await b.sequencer.menus()).Add.find((entry) => entry.label === "Scene Audio").items()[0].run(); });
    await reloadWithEdit();
    const mix = await app.bylonder(async (b) => {
      const compositor = await b.sequencer.openCompositor({ frameStart: 1, frameEnd: 12, width: 64, height: 36 });
      b.sceneAudio.changed();
      const audio = await compositor.audio();
      compositor.dispose();
      return { seconds: audio.samples[0].length / audio.sampleRate, warnings: compositor.warnings };
    });
    assert.ok(mix.seconds > 0, "the held Scene Audio mixes after the scene changed");
    assert.deepEqual(mix.warnings, []);

    const image = await renderStatuses("Render Image");
    assert.match(image.at(-1), /^Finished frame 1 /);
    assert.ok(!image.some((s) => s.startsWith("Mixing")), `a still mixes no sound: ${image.join(" / ")}`);
    const center = await app.locator(".render-result canvas").evaluate((canvas) => [...canvas.getContext("2d").getImageData(canvas.width / 2, canvas.height / 2, 1, 1).data]);
    assert.ok(center.slice(0, 3).some((v) => v > 40), `the clip shows in the still: ${center}`);

    const download = app.page.waitForEvent("download", { timeout: 120000 });
    const video = await renderStatuses("Render Animation");
    assert.match(video.at(-1), /^Finished 12 frames/);
    const file = `${tmpdir()}/smoke-sequencer.webm`;
    await (await download).saveAs(file);
    const streams = JSON.parse(execFileSync("ffprobe", ["-v", "error", "-show_streams", "-of", "json", file])).streams;
    assert.deepEqual(streams.map((s) => s.codec_type).sort(), ["audio", "video"]);
    // Known and harmless here: the headless <video> fallback KubeezCut preloads does not load the clip (Mediabunny
    // decodes it), and KubeezCut's embed bundles a Mediabunny of its own next to Bylonder's.
    app.errors.splice(0, app.errors.length, ...app.errors.filter((error) => !/Video load error|Mediabunny was loaded twice/.test(error)));
  } },

  // A strip whose media is gone from the library renders without it, named in the result, with no endless retries.
  "Sequencer media missing after a reload is reported, not waited for": { open: { persistent: true }, async run() {
    await addClipStrip();
    await reloadWithEdit();
    await app.bylonder(async () => { await (await navigator.storage.getDirectory()).removeEntry("clip.webm"); });
    const statuses = await renderStatuses("Render Animation");
    assert.match(statuses.at(-1), /^Finished 12 frames .*Strip "clip\.webm" has missing media/);
    // The media library logs the missing file as an error.
    app.errors.splice(0, app.errors.length, ...app.errors.filter((error) => !/clip\.webm|requested file or directory could not be found/.test(error)));
  } },
  // Edit > Preferences: Blender's Preferences editor in its window, its sections Blender's own, what Bylonder does not
  // honor greyed out (never hidden), Bylonder's own settings in their panel.
  async "Preferences show Blender's sections with greyed and live settings"() {
    const prefs = await openPreferences();
    await section(prefs, "Input");
    assert.ok(await setting(prefs, EMULATE_3_BUTTON).isEnabled(), "a live setting");
    assert.ok(await setting(prefs, EMULATE_NUMPAD).isEnabled());
    await section(prefs, "System");
    assert.ok(await prefs.locator("[data-blender=USERPREF_PT_bylonder]").count() || await prefs.getByText("Keep Scenes Loaded").count(), "Bylonder's panel");
    await section(prefs, "File Paths");
    const disabled = await prefs.locator("button:disabled, input:disabled, [aria-disabled=true]").count();
    assert.ok(disabled > 0, "greyed settings");
  },

  // Add-ons starts Python, lists the add-ons Blender ships, and Install from Disk installs one from the browser's file
  // dialog; enabled, its operator is in the 3D Viewport's Add menu.
  async "Add-ons: Install from Disk installs and enables an add-on"() {
    const prefs = await openPreferences();
    await section(prefs, "Add-ons");
    const region = prefs.locator(".bl-preferences-region");
    for (const name of ["Bylonder", "Pose Library", "Node Wrangler"]) await region.getByText(name).first().waitFor({ timeout: 180000 });
    const chooser = app.page.waitForEvent("filechooser");
    await prefs.locator('[data-blender="USERPREF_MT_addons_settings"]').first().click();
    await app.frame().getByRole("menuitem", { name: "Install from Disk..." }).first().click();
    await (await chooser).setFiles(new URL("../../examples/python/scatter_cubes.py", import.meta.url).pathname);
    // The operator's options (Enable on Install), confirmed as the File Browser's sidebar confirms them.
    await app.frame().getByRole("button", { name: "Install from Disk" }).last().click();
    await region.getByText("Scatter Cubes").first().waitFor({ timeout: 30000 });
    await app.until((b) => b.modules.bpyRna.contextStruct().preferences.addons.get("scatter_cubes"), null, 30000);
    await prefs.press("Escape").catch(() => {});
    await app.hover(0.5, 0.5);
    await app.page.keyboard.press("Shift+A");
    await app.frame().getByRole("menuitem", { name: "Scatter Cubes" }).first().waitFor();
    await app.page.keyboard.press("Escape");
  },

  // Laptops: the number row as the numpad, the left button with Alt as the middle one, two-finger trackpad scrolling.
  async "Emulate Numpad: 1, 3 and 7 on the number row view front, right and top"() {
    await setInput(EMULATE_NUMPAD);
    await app.click(0.3, 0.8);
    for (const [key, name] of [["Digit1", "Front"], ["Digit3", "Right"], ["Digit7", "Top"]]) {
      await app.page.keyboard.press(key);
      await app.until((b, n) => document.querySelector(".view-name").textContent.startsWith(n), name);
    }
  },

  async "Emulate 3 Button Mouse: Alt and left drag orbits"() {
    await setInput(EMULATE_3_BUTTON);
    const before = await cameraPosition();
    await app.hover(0.5, 0.5);
    await app.page.keyboard.down("Alt");
    await app.page.mouse.down();
    const [x, y] = await app.point(0.6, 0.55);
    await app.page.mouse.move(x, y, { steps: 6 });
    await app.page.mouse.up();
    await app.page.keyboard.up("Alt");
    assert.notDeepEqual(await cameraPosition(), before, "orbited");
    assert.equal(await app.bylonder((b) => b.editor.selection.size), 1, "the cube stays selected: no click");
  },

  async "a trackpad's two-finger drag orbits the view"() {
    const before = await cameraPosition();
    await app.hover(0.5, 0.5);
    for (let i = 0; i < 6; i++) await app.page.mouse.wheel(12, 7);
    await app.until((b, p) => b.views.input.editorCamera.position.x !== p[0], before);
  },

  // Closing an editor frees its area in Blender's window; the other areas keep theirs.
  async "Preferences opened and closed three times leave the app working"() {
    for (let i = 0; i < 3; i++) {
      const prefs = await openPreferences();
      await section(prefs, i % 2 ? "Keymap" : "Input");
      await prefs.getByRole("button", { name: "Close" }).click();
    }
    await app.click(0.9, 0.9);
    await expectStats(({ Objects }) => Objects[0] === 0);
    await app.click();
    await expectStats(({ Objects }) => Objects[0] === 1);
    await app.page.keyboard.press("Tab");
    await app.until((b) => b.world.editMode.active);
    await app.page.keyboard.press("Tab");
    await app.until((b) => !b.world.editMode.active);
  },

  async "a rebound key runs its operator, and the Preferences are kept over a reload"() {
    await setInput(EMULATE_NUMPAD);
    // Keymap: Object Mode's Delete on X rebound to Y in its key field.
    const prefs = await openPreferences();
    await section(prefs, "Keymap");
    const search = prefs.locator(".bl-preferences-region input").first();
    await search.fill("object.delete");
    await search.press("Enter");
    await prefs.locator('button[data-blender="type"]', { hasText: /^X$/ }).first().click();
    await app.page.keyboard.press("y");
    await prefs.locator('button[data-blender="type"]', { hasText: /^Y$/ }).first().waitFor();
    await prefs.getByRole("button", { name: "Save Preferences" }).click();
    await prefs.getByRole("button", { name: "Close" }).click();
    await app.click(0.3, 0.8);
    await app.page.keyboard.press("a");
    await app.page.keyboard.press("y");
    await app.frame().getByRole("menuitem", { name: "Delete" }).click();
    await expectStats(({ Objects }) => Objects[1] === 0);
    await app.page.reload();
    await app.page.waitForFunction(() => document.querySelector('iframe[src*="viewport.html"]')?.contentWindow?.__bylonder?.editor, null, { timeout: 180000 });
    assert.equal(await app.frame().evaluate(() => window.__bylonder.userdef.preferences().inputs.use_emulate_numpad), true, "kept over a reload");
  },

};

// A one-second clip with sound imported into the Sequencer's media library (the origin's private file system) and
// placed at frame 1.
async function addClipStrip() {
  const file = `${tmpdir()}/smoke-clip.webm`;
  execFileSync("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", "testsrc=size=64x36:rate=24:duration=1", "-f", "lavfi", "-i", "sine=frequency=440:duration=1", "-c:v", "libvpx", "-c:a", "libopus", "-shortest", file]);
  await app.bylonder(async (b, bytes) => {
    const handle = await (await navigator.storage.getDirectory()).getFileHandle("clip.webm", { create: true });
    const writable = await handle.createWritable();
    await writable.write(new Uint8Array(bytes));
    await writable.close();
    const [media] = await b.sequencer.importMedia([handle]);
    await b.sequencer.addMediaStrip(media.id, { frame: 1 });
  }, [...readFileSync(file)]);
}

// Reloads the page once the edit is saved, waits until it has the same strips again and sets the output to frames
// 1 to 12 of WebM video with Opus sound.
async function reloadWithEdit() {
  const strips = await app.bylonder((b) => b.world.sequenceEditor.state.edit.timeline.items.length);
  await app.page.waitForTimeout(1500);
  await app.page.waitForFunction(() => document.getElementById("save-status").textContent === "Saved locally", null, { timeout: 30000 });
  await app.page.reload();
  await app.page.waitForFunction(() => !!document.querySelector('iframe[src*="viewport.html"]')?.contentWindow?.__bylonder?.editor, null, { timeout: 120000 });
  await app.until((b, n) => b.world.sequenceEditor.state?.edit?.timeline?.items?.length === n, strips, 30000);
  await app.bylonder((b) => {
    b.world.animation.time.configure({ frameStart: 1, frameEnd: 12 });
    b.world.animation.seek(1);
    Object.assign(b.mainScene.render.image_settings, { media_type: "VIDEO", file_format: "FFMPEG" });
    Object.assign(b.mainScene.render.ffmpeg, { format: "WEBM", codec: "WEBM", audio_codec: "OPUS" });
  });
}

// Runs a Render menu entry and returns the render window's statuses until it ends; fails if it takes over 2 minutes.
async function renderStatuses(entry) {
  const statuses = [], until = Date.now() + 120000;
  await menu("TOPBAR_MT_render", entry);
  while (!/^(Finished|Render failed|Render cancelled)/.test(statuses.at(-1))) {
    assert.ok(Date.now() < until, `${entry} never ended: ${statuses.join(" / ")}`);
    const status = await app.frame().evaluate((selector) => document.querySelector(selector).textContent, renderStatus);
    if (statuses.at(-1) !== status) statuses.push(status);
    await app.page.waitForTimeout(100);
  }
  return statuses;
}

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

// Edit > Preferences, its window.
async function openPreferences() {
  await menu("TOPBAR_MT_edit", "Preferences...");
  const prefs = app.frame().locator("[data-blender=PREFERENCES_WINDOW]");
  await prefs.waitFor();
  return prefs;
}
async function section(prefs, name) {
  await prefs.locator("[data-blender=USERPREF_PT_navigation_bar]").getByText(name, { exact: true }).click();
}
// A setting's checkbox, by its RNA description (its tooltip): some of Blender's checkboxes have their label beside them.
const EMULATE_NUMPAD = "Main 1 to 0 keys act as the numpad ones", EMULATE_3_BUTTON = "Emulate Middle Mouse with Alt+Left Mouse";
const setting = (prefs, description) => prefs.locator(`label[title^="${description}"] input`);
// An Input preference turned on in the Preferences editor.
async function setInput(description) {
  const prefs = await openPreferences();
  await section(prefs, "Input");
  if (!(await setting(prefs, description).isChecked())) await prefs.locator(`label[title^="${description}"]`).click();
  await prefs.getByRole("button", { name: "Close" }).click();
}
const cameraPosition = () => app.bylonder((b) => b.views.input.editorCamera.position.asArray());

async function typeInto(selector, value) {
  await app.locator(selector).first().click();
  await app.page.keyboard.press("Control+A");
  await app.page.keyboard.type(value);
  await app.page.keyboard.press("Enter");
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
// SHARD=i/n runs every n-th check from the i-th (scripts/gates.mjs runs shards in parallel).
const [shard, shards] = (process.env.SHARD ?? "0/1").split("/").map(Number);
const server = await startServer();
const browser = await chromium.launch();
let failed = 0;
try {
  for (const [name, check] of Object.entries(checks).filter((_, i) => i % shards === shard)) {
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
