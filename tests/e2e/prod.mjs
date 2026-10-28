// Production check: the built app (dist/) boots in headless Chromium without a page error or console error, its
// topbar menus and the 3D View header menus open with items, and every workspace tab shows a screen. CI runs it after
// the build and before deploying, since some failures only happen in the production build.
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
      // Hovering runs each item's poll, and opens submenus, whose items are hovered in turn.
      const menu = frame.locator(".bl-menu").first();
      for (const item of await menu.locator(".bl-menu-item").all()) {
        if (!(await item.hover({ timeout: 3000 }).then(() => true, () => false))) continue;
        const submenu = frame.locator(".bl-menu.submenu");
        if (await submenu.count()) for (const sub of await submenu.last().locator(".bl-menu-item").all()) await sub.hover({ timeout: 3000 }).catch(() => {});
      }
      await page.keyboard.press("Escape");
      await page.keyboard.press("Escape");
      noErrors(id);
    });
  }

  const tabs = await page.locator("#workspace-tabs [data-workspace]").evaluateAll((els) => els.map((el) => el.dataset.workspace));
  assert.ok(tabs.length >= 11, `workspace tabs: ${tabs}`);
  for (const id of [...tabs, "layout"]) {
    await step(`workspace ${id}`, async () => {
      await page.click(`[data-workspace="${id}"]`);
      await page.waitForFunction((id) => document.querySelector(`[data-workspace="${id}"]`)?.classList.contains("active"), id, { timeout: 10000 });
      // Its screen draws: editors of a visible size in the workspace.
      await page.waitForFunction(() => [...document.querySelectorAll("#workspace > *")].some((el) => el.offsetWidth > 100 && el.offsetHeight > 100), null, { timeout: 10000 });
      noErrors(`switching to ${id}`);
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
