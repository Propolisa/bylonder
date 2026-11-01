// Production check: the built app (dist/) boots in headless Chromium without a page error or console error, its
// topbar menus, the 3D View header menus and the context menus open with items, every workspace tab shows a screen in
// its object mode, and examples made in Blender open with their objects in the scene sync. CI runs it after the build and before deploying, since some failures only happen in the production build.
// usage: npm run build && npm run test:prod   (E2E_URL checks a running server instead)
import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { chromium, openApp, startServer } from "./app.mjs";

const TOPBAR = ["TOPBAR_MT_file", "TOPBAR_MT_edit", "TOPBAR_MT_render", "TOPBAR_MT_window", "TOPBAR_MT_help"];
const started = Date.now();
const steps = [];
const step = async (name, fn) => {
  const at = Date.now();
  await fn();
  steps.push(name);
  console.log(`ok    ${name} (${Date.now() - at} ms)`);
};

// How many items the menu a button opens shows.
async function menuItems(where, button) {
  await where.locator(button).first().click();
  const items = where.locator(".bl-menu .bl-menu-item");
  await items.first().waitFor({ timeout: 10000 });
  return items.count();
}

// Hovers every item of the open menu, which runs its poll, and the items of the submenus that opens.
async function hoverItems(where) {
  for (const item of await where.locator(".bl-menu").first().locator(".bl-menu-item").all()) {
    if (!(await item.hover({ timeout: 3000 }).then(() => true, () => false))) continue;
    const submenu = where.locator(".bl-menu.submenu");
    if (await submenu.count()) for (const sub of await submenu.last().locator(".bl-menu-item").all()) await sub.hover({ timeout: 3000 }).catch(() => {});
  }
}

const server = await startServer({ build: false });
const browser = await chromium.launch();
let app;
try {
  // The new project's scene, as a first visit opens it.
  await step("boots", async () => { app = await openApp(browser, server.url, { example: null, node: "sphere" }); });
  const { page } = app;
  const noErrors = (what) => assert.deepEqual(app.errors, [], `page errors after ${what}`);
  noErrors("booting");

  for (const id of TOPBAR) {
    await step(`topbar ${id}`, async () => {
      assert.ok(await menuItems(page, `[data-blender="${id}"]`) > 0, `${id} has items`);
      if (id === "TOPBAR_MT_file") {
        // File > New: Blender's submenu of templates.
        await page.locator(".bl-menu .bl-menu-item", { hasText: /^New/ }).first().hover();
        await page.locator(".bl-menu.submenu .bl-menu-item").first().waitFor({ timeout: 10000 });
      }
      await page.keyboard.press("Escape");
      await page.keyboard.press("Escape");
      noErrors(id);
    });
  }

  const frame = app.frame();
  const headerMenus = await frame.locator('.bl-pulldown[data-blender^="VIEW3D_MT_"]').evaluateAll((els) => [...new Set(els.map((el) => el.dataset.blender))]);
  assert.ok(headerMenus.length >= 4, `3D View header menus: ${headerMenus}`);
  for (const id of headerMenus) {
    await step(`3D View ${id}`, async () => {
      assert.ok(await menuItems(frame, `.bl-pulldown[data-blender="${id}"]`) > 0, `${id} has items`);
      await hoverItems(frame);
      await page.keyboard.press("Escape");
      await page.keyboard.press("Escape");
      noErrors(id);
    });
  }

  // Right click opens Blender's context menus through its keymaps: the 3D View's in Object and Edit Mode and the
  // Outliner's on an object's row.
  const contextMenu = async (name, [x, y], before = async () => {}) => {
    await step(`context menu ${name}`, async () => {
      await before();
      await page.mouse.move(x, y);
      await page.mouse.click(x, y, { button: "right" });
      await frame.locator(".bl-menu .bl-menu-item").first().waitFor({ timeout: 10000 });
      await hoverItems(frame);
      await page.keyboard.press("Escape");
      await page.keyboard.press("Escape");
      noErrors(name);
    });
  };
  const view = await frame.locator(".viewport-canvas").first().boundingBox(), center = [view.x + view.width / 2, view.y + view.height / 2];
  const selectFirst = () => app.bylonder((b) => { b.editor.selection.replace([b.world.objects.find((n) => n.getTotalVertices?.())]); b.editor.reconcile(); });
  await contextMenu("VIEW3D_MT_object_context_menu", center, selectFirst);
  await contextMenu("VIEW3D_MT_edit_mesh_context_menu", center, async () => {
    await page.mouse.move(...center);
    await page.keyboard.press("Tab");
    await app.until((b) => b.world.editMode.active);
  });
  await page.keyboard.press("Tab");
  const outliner = await frame.locator(".bl-outliner-region").boundingBox();
  const row = await app.bylonder((b) => b.world.outliner.area.draw().draw.find((c) => c.op === "text" && c.text === b.world.objects.find((n) => n.getTotalVertices?.()).name).at);
  await contextMenu("OUTLINER_MT_object", [outliner.x + row[0] + 5, outliner.y + outliner.height - row[1] - 4]);
  const header = await frame.locator(".dock-heading").first().boundingBox();
  await contextMenu("Header", [header.x + header.width - 40, header.y + header.height / 2]);
  await step("OBJECT_MT_move_to_collection", async () => {
    await selectFirst();
    await page.mouse.move(...center);
    await page.keyboard.press("m");
    await frame.locator(".bl-menu .bl-menu-item").first().waitFor({ timeout: 10000 });
    await hoverItems(frame);
    await page.keyboard.press("Escape");
    await page.keyboard.press("Escape");
    noErrors("OBJECT_MT_move_to_collection");
  });

  // Each workspace tab shows its screen and puts the active mesh in the workspace's object mode where Bylonder has that
  // mode, else leaves it in its mode, as ED_workspace_change does when a mode cannot be entered. A switch is checked
  // once the app has settled: leaving a mode and compiling a view's shaders take a while on a runner without a GPU.
  const MODES = { modeling: "EDIT", sculpting: "SCULPT", "uv-editing": "EDIT", "texture-paint": "TEXTURE_PAINT", animation: "POSE" };
  const meshModes = ["OBJECT", "EDIT", "SCULPT"];
  let expected = "OBJECT";
  const tabs = await page.locator("#workspace-tabs [data-workspace]").evaluateAll((els) => els.map((el) => el.dataset.workspace));
  assert.ok(tabs.length >= 11, `workspace tabs: ${tabs}`);
  for (const id of [...tabs, "layout"]) {
    await step(`workspace ${id}`, async () => {
      await page.click(`[data-workspace="${id}"]`);
      await page.waitForFunction((id) => document.querySelector(`[data-workspace="${id}"]`)?.classList.contains("active"), id, { timeout: 30000 });
      await app.settled();
      // Its screen draws: editors of a visible size in the workspace.
      await page.waitForFunction(() => [...document.querySelectorAll("#workspace > *")].some((el) => el.offsetWidth > 100 && el.offsetHeight > 100), null, { timeout: 10000 });
      const mode = await app.bylonder((b) => b.editor.selection.nodes.at(-1)?.metadata?.wbMode ?? "OBJECT");
      const wanted = MODES[id] ?? "OBJECT";
      if (meshModes.includes(wanted)) expected = wanted;
      assert.equal(mode, expected, `object mode in ${id}`);
      noErrors(`switching to ${id}`);
    });
  }

  // Examples made in Blender open with every object of Main in the scene sync, once (an armature left out of it was
  // invisible to every tool), and without a page error.
  for (const example of ["Rigged Character", "Hair Dynamics"]) {
    await step(`example ${example}`, async () => {
      const opened = await openApp(browser, server.url, { example, node: example === "Rigged Character" ? "Rig" : "Hair" });
      try {
        await opened.settled();
        const problems = await opened.bylonder((b) => {
          const { scene, objects, mainSync } = b.world, authored = (n) => !n.name.startsWith("__");
          const nodes = [...scene.meshes, ...scene.transformNodes, ...scene.lights, ...scene.cameras].filter(authored);
          const names = nodes.map((n) => n.name);
          return [...objects.filter((n) => !mainSync.objectOf(n)).map((n) => `${n.name}: not in Main's sync`),
            ...[...new Set(names.filter((n, i) => names.indexOf(n) !== i))].map((n) => `${n}: two objects`)];
        });
        assert.deepEqual(problems, [], `${example}: objects`);
        // The rig on Babylon (mapped): Babylon skins the body (docs/runtimes.md).
        if (example === "Rigged Character") {
          const skeleton = await opened.bylonder((b) => {
            const node = (name) => b.world.objects.find((n) => n.name === name);
            b.modules.bpyRna.idStruct(b.world.mainSync.objectOf(node("Rig"))).bylonder.runtime = "MAPPED";
            b.world.mainSync.view();
            return node("Body").skeleton?.name ?? null;
          });
          await opened.settled();
          assert.equal(skeleton, "Rig", "Rigged Character: the body skinned by Babylon");
        }
        assert.deepEqual(opened.errors, [], `${example}: page errors`);
      } finally {
        await opened.close();
      }
    });
  }
  console.log(`Production check passed: ${steps.length} steps in ${Math.round((Date.now() - started) / 1000)} s`);
} catch (error) {
  const shot = `${tmpdir()}/prod-check.png`;
  await app?.page.screenshot({ path: shot }).catch(() => {});
  console.log(`FAIL  ${error.stack}\nPage errors: ${JSON.stringify(app?.errors ?? [], null, 2)}\nScreenshot: ${shot}`);
  process.exitCode = 1;
} finally {
  await app?.close();
  await browser.close();
  await server.close();
}
