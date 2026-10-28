// End-to-end smoke tests: core flows in Chromium with real mouse and keyboard input, against the production build.
// Assertions read state through window.__bylonder in the 3D Viewport frame and the status bar's statistics, and
// every check fails on a page error.
// usage: npm run test:e2e [-- name filter]
import assert from "node:assert/strict";
import { tmpdir } from "node:os";
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

  async "topbar File menu and 3D View Object menu open"() {
    await app.page.click('[data-blender="TOPBAR_MT_file"]');
    await app.page.getByRole("menuitem", { name: /^Open/ }).first().waitFor();
    await app.page.keyboard.press("Escape");
    await app.locator('[data-blender="VIEW3D_MT_object"]').click();
    await app.frame().getByRole("menuitem", { name: /^Delete/ }).first().waitFor();
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
    await app.locator('[data-shading="wire"]').nth(1).click();
    assert.deepEqual(await app.bylonder((b) => b.views.all.filter((v) => v.nav).map((v) => v.state.shading).sort()), ["solid", "wire"]);
  },
};

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
