// Touch only checks (docs/mobile.md Test plan): Chromium as a touch device at a large phone's and a tablet's sizes,
// driven by touch alone (taps, holds, drags and multi finger gestures through CDP), against the production build.
// usage: npm run test:touch [-- name filter]
import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { chromium, openApp, startServer } from "./app.mjs";

export const DEVICES = { phone: { width: 412, height: 915 }, "large phone": { width: 430, height: 930 }, "tablet portrait": { width: 1024, height: 1366 }, "tablet landscape": { width: 1366, height: 1024 } };

// Fingers through CDP's touch events, at page coordinates: each step moves every finger, as a hand does. `show(points)`
// sees where the fingers are down at each step (none when they lift). A point is [x, y], or [x, y, id] to name its
// finger (by default its index).
export function fingers(page, show) {
  let cdp;
  const send = async (type, points) => {
    cdp ??= await page.context().newCDPSession(page);
    await cdp.send("Input.dispatchTouchEvent", { type, touchPoints: points.map((point, i) => ({ x: point[0], y: point[1], id: point[2] ?? i, radiusX: 4, radiusY: 4, force: 1 })) });
    await show?.(points);
  };
  const wait = (ms) => page.waitForTimeout(ms);
  // Each finger from its start to its end in `steps` moves.
  async function gesture(paths, { steps = 12, hold = 0, interval = 16 } = {}) {
    const at = (t) => paths.map(([[x0, y0], [x1, y1]]) => [x0 + (x1 - x0) * t, y0 + (y1 - y0) * t]);
    await send("touchStart", at(0));
    if (hold) await wait(hold);
    for (let i = 1; i <= steps; i++) {
      await send("touchMove", at(i / steps));
      await wait(interval);
    }
    await send("touchEnd", []);
  }
  return {
    send,
    gesture,
    tap: async ([x, y], count = 1) => { await send("touchStart", Array(count).fill(0).map((_, i) => [x + i * 30, y])); await wait(40); await send("touchEnd", []); },
    hold: async ([x, y], ms) => { await send("touchStart", [[x, y]]); await wait(ms); await send("touchEnd", []); },
    drag: (from, to, options) => gesture([[from, to]], options),
    // n fingers side by side, all moved by (dx, dy).
    pan: ([x, y], [dx, dy], n = 2) => gesture(Array(n).fill(0).map((_, i) => [[x + i * 40 - 20 * (n - 1), y], [x + i * 40 - 20 * (n - 1) + dx, y + dy]])),
    // Two fingers spreading from `from` to `to` pixels apart, around `center`.
    pinch: ([x, y], from, to) => gesture([[[x - from / 2, y], [x - to / 2, y]], [[x + from / 2, y], [x + to / 2, y]]]),
  };
}

let app, touch;
// Taps apart by more than Blender's double click time (U.dbl_click_time), as separate taps are.
const pause = () => app.page.waitForTimeout(400);
const center = async (locator) => {
  const box = await locator.boundingBox();
  assert.ok(box, `${locator} is shown`);
  return [box.x + box.width / 2, box.y + box.height / 2];
};
const camera = () => app.bylonder((b) => { const c = b.views.input.editorCamera; return { position: c.position.asArray(), target: c.target.asArray() }; });
const moved = (a, b) => a.some((v, i) => Math.abs(v - b[i]) > 1e-3);
const distance = ({ position, target }) => Math.hypot(...position.map((v, i) => v - target[i]));
const uiScale = () => app.bylonder((b) => b.userdef.preferences().view.ui_scale);
const unit = () => app.frame().evaluate(() => parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--bl-row")));
// The Properties editor, on its Object tab (the Default Cube's), opened from its strip where it is folded.
async function objectProperties() {
  const fold = app.locator('.dock-fold[aria-label*="Properties"]');
  if (await fold.count() && (await fold.getAttribute("aria-expanded")) !== "true") await touch.tap(await center(fold));
  await app.settled();
  await app.page.waitForTimeout(1000);
}
// A tap beside the open drawer closes it.
async function closeDrawer() {
  const drawer = app.locator(".dock-drawer");
  if (!(await drawer.count())) return;
  const box = await drawer.boundingBox();
  await touch.tap([box.x / 2, box.y + box.height / 2]);
  await drawer.waitFor({ state: "detached" });
  await pause();
}
// The areas, top to bottom and left to right, by their editors.
const areas = () => app.frame().evaluate(() => [...document.querySelectorAll(".dock-split-tree .dock-leaf")].map((leaf) => [leaf.dataset.section, Math.round(leaf.getBoundingClientRect().top), Math.round(leaf.getBoundingClientRect().left)])
  .sort((a, b) => a[1] - b[1] || a[2] - b[2]).map(([id]) => id));
const selected = () => app.bylonder((b) => b.editor.selection.nodes[0].position.asArray());

const checks = {
  async "the 3D Viewport header scrolls to its shading buttons, and a tap sets Rendered"() {
    const header = app.locator(".dock-header-content:has(.bl-view3d-header)").first();
    const rendered = app.locator('.bl-view3d-header [data-value="RENDERED"]').first();
    const [, y] = await center(header);
    const box = await header.boundingBox();
    while (!(await rendered.evaluate((el) => { const r = el.getBoundingClientRect(); return r.right <= innerWidth && r.left >= 0; }))) {
      await touch.drag([box.x + box.width - 10, y], [box.x + 10, y]);
      // Until the header's momentum scroll has stopped.
      await app.page.waitForTimeout(1000);
    }
    await touch.tap(await center(rendered));
    await app.until((b) => b.views.input.state.shading === "rendered");
    await touch.tap(await center(app.locator('.bl-view3d-header [data-value="SOLID"]').first()));
    await app.until((b) => b.views.input.state.shading === "solid");
  },

  // An area too small for its panels folds to a strip on its edge; a tap opens it as a drawer at a usable width.
  async "every folded area opens as a drawer at Blender's minimum width or more, and a tap outside closes it"() {
    const folds = await app.locator(".dock-fold").count();
    const unit = await app.frame().evaluate(() => parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--bl-row")));
    for (let i = 0; i < folds; i++) {
      await touch.tap(await center(app.locator(".dock-fold").nth(i)));
      const drawer = app.locator(".dock-drawer");
      await drawer.waitFor();
      const box = await drawer.boundingBox();
      const vertical = await drawer.evaluate((el) => el.classList.contains("left") || el.classList.contains("right"));
      if (vertical) assert.ok(box.width >= 11 * unit - 1, `drawer ${i} is ${box.width}px wide`);
      // Outside the drawer: the middle of the widest part of what it partly covers.
      const b = await app.locator(".dock-drawer-backdrop").boundingBox(), cx = b.x + b.width / 2, cy = b.y + b.height / 2;
      const gaps = [[box.x - b.x, [(b.x + box.x) / 2, cy]], [b.x + b.width - box.x - box.width, [(box.x + box.width + b.x + b.width) / 2, cy]],
        [box.y - b.y, [cx, (b.y + box.y) / 2]], [b.y + b.height - box.y - box.height, [cx, (box.y + box.height + b.y + b.height) / 2]]];
      await touch.tap(gaps.sort((p, q) => q[0] - p[0])[0][1]);
      await drawer.waitFor({ state: "detached" });
      await pause();
    }
  },

  async "a tap selects, a tap on nothing deselects"() {
    await touch.tap(await app.point(0.5, 0.92));
    await app.until((b) => b.editor.selection.size === 0);
    await pause();
    await touch.tap(await app.point(0.5, 0.5));
    await app.until((b) => b.editor.selection.size === 1);
  },

  async "two fingers pan, a pinch zooms, three fingers orbit the 3D Viewport"() {
    const at = await app.point(0.5, 0.6);
    let before = await camera();
    await touch.pan(at, [60, 40]);
    let after = await camera();
    assert.ok(moved(before.target, after.target), "pan moves the view's target");
    before = after;
    await touch.pinch(at, 80, 200);
    after = await camera();
    assert.ok(distance(after) < distance(before) * 0.9, `spreading zooms in: ${distance(before)} to ${distance(after)}`);
    before = after;
    await touch.pan(at, [80, 0], 3);
    after = await camera();
    assert.ok(moved(before.position, after.position) && Math.abs(distance(after) - distance(before)) < 1e-2 * distance(before), "three fingers orbit");
    // Back out, so the cube does not fill the view for the next checks.
    await touch.pinch(at, 200, 80);
  },

  async "a long press opens the 3D Viewport's context menu"() {
    await touch.hold(await app.point(0.5, 0.5), 1000);
    await app.locator(".bl-menu").filter({ hasText: "Shade Smooth" }).waitFor();
    await app.page.keyboard.press("Escape");
    await app.locator(".bl-menu").waitFor({ state: "detached" }).catch(() => {});
  },

  async "a press and hold shows a control's tooltip, which stays until the next tap"() {
    const button = app.locator(".bl-view3d-header [title]").first();
    await button.scrollIntoViewIfNeeded();
    await touch.hold(await center(button), 550);
    const tip = app.locator('[role="tooltip"]');
    await tip.waitFor();
    await app.page.waitForTimeout(500);
    assert.equal(await tip.count(), 1, "the tooltip stays after lifting");
    await touch.tap(await app.point(0.5, 0.92));
    await tip.waitFor({ state: "detached" });
    assert.equal(await app.bylonder((b) => b.editor.selection.size), 1, "the closing tap did nothing else");
  },

  async "two fingers tap undo, three redo: a Delete from the context menu"() {
    const count = () => app.bylonder((b) => b.world.objects.filter((n) => n.isEnabled(false)).length);
    const objects = (n, step) => app.until((b, n) => b.world.objects.filter((o) => o.isEnabled(false)).length === n, n).catch(() => assert.fail(`${step}: not ${n} objects`));
    const all = await count();
    await touch.hold(await app.point(0.5, 0.5), 1000);
    await touch.tap(await center(app.locator(".bl-menu-item", { hasText: /^Delete/ }).last()));
    await objects(all - 1, "Delete from the context menu");
    await pause();
    await touch.tap(await app.point(0.5, 0.92), 2);
    await objects(all, "two fingers undo");
    await pause();
    await touch.tap(await app.point(0.5, 0.92), 3);
    await objects(all - 1, "three fingers redo");
    await pause();
    await touch.tap(await app.point(0.5, 0.92), 2);
    await objects(all, "undone again for the next checks");
  },

  // docs/mobile.md Dragging a value: one finger drags, a second holds a soft modifier beside the readout.
  async "dragging Location X shows its readout clear of the finger; held Shift is ten times finer, held Ctrl snaps"() {
    await objectProperties();
    const field = app.locator('#properties-section [role="spinbutton"][aria-label="Location"]:visible').first();
    await field.scrollIntoViewIfNeeded();
    const value = () => field.evaluate((el) => Number(el.getAttribute("aria-valuenow")));
    const [x, y] = await center(field), start = (await selected())[0];
    const step = async (points) => { await touch.send("touchMove", points); await app.page.waitForTimeout(30); };
    // A finger's drag from 0 to 20 pixels right, then over `distance` more, with a second finger on `soft` from there.
    const readout = app.locator(".bl-value-readout");
    async function drag(distance, soft) {
      await touch.send("touchStart", [[x, y]]);
      for (let dx = 5; dx <= 20; dx += 5) await step([[x + dx, y]]);
      await readout.waitFor();
      const second = soft ? [await center(app.locator(`.bl-value-drag button[aria-label="${soft}"]`))] : [];
      if (soft) await touch.send("touchStart", [[x + 20, y], ...second]);
      const before = await value();
      for (let dx = 25; dx <= 20 + distance; dx += 5) await step([[x + dx, y], ...second]);
      return (await value()) - before;
    }
    // Once the region has drawn the value again, so the next drag presses the field it shows.
    const end = async () => { await touch.send("touchEnd", []); await readout.waitFor({ state: "detached" }); await app.settled(); await app.page.waitForTimeout(1000); };
    const normal = await drag(40);
    assert.match(await readout.textContent(), /Location X/);
    const shown = await field.textContent(), read = await readout.textContent();
    assert.ok(read.includes(shown.trim()), `the readout (${read}) shows the field's text (${shown})`);
    const box = await readout.boundingBox(), finger = 44;
    assert.ok(box.y + box.height <= y - finger / 2 || box.y >= y + finger / 2, `the readout (${box.y}..${box.y + box.height}) is clear of the finger at ${y}`);
    assert.ok(normal > 0, "a drag right raises the value");
    await end();
    const fine = await drag(40, "Shift");
    assert.ok(Math.abs(fine * 10 - normal) < normal * 0.3, `Shift: ${fine} over the distance ${normal} takes without it`);
    await end();
    assert.equal(await app.locator('.bl-touch-bar button[aria-label="Shift"]').getAttribute("data-state"), "off", "the drag's end lets Shift go");
    await drag(20, "Ctrl");
    const snapped = await value();
    assert.ok(Math.abs(snapped - Math.round(snapped)) < 1e-6, `Ctrl snaps to whole units: ${snapped}`);
    await end();
    assert.equal(await app.bylonder((b) => b.world.wm.modal), null);
    await closeDrawer();
    // Each drag is an undo step: two finger taps undo them.
    for (let i = 0; i < 3 && Math.abs((await selected())[0] - start) > 1e-6; i++) { await touch.tap(await app.point(0.5, 0.92), 2); await pause(); }
    assert.ok(Math.abs((await selected())[0] - start) < 1e-6, "undone");
  },

  // docs/mobile.md Area management: Blender's edge menu (screen.area_options) by a long press inside the edge's
  // touch margin, and an area carried by its header.
  async "a long press on an area edge opens Blender's edge menu: Swap Areas swaps, Join joins, a split splits"() {
    await closeDrawer();
    const edge = app.locator(".dock-split-tree .splitpanes__splitter:visible").first();
    const box = await edge.boundingBox(), vertical = box.height > box.width;
    const at = vertical ? [box.x + box.width / 2 + 9, box.y + box.height / 2] : [box.x + box.width / 2, box.y + box.height / 2 + 9];
    const menu = app.locator(".bl-menu").filter({ hasText: "Swap Areas" });
    const edgeMenu = async () => { await touch.hold(at, 1000); await menu.waitFor(); await pause(); };
    const choose = async (label) => { await touch.tap(await center(menu.locator(".bl-menu-item", { hasText: label }))); await menu.waitFor({ state: "detached" }); await pause(); };
    const before = await areas(), count = () => app.bylonder((b) => b.dock.areas.length), all = await count();
    await edgeMenu();
    for (const label of ["Vertical Split", "Horizontal Split", vertical ? "Join Right" : "Join Up", vertical ? "Join Left" : "Join Down"])
      assert.equal(await menu.locator(".bl-menu-item", { hasText: label }).count(), 1, label);
    await choose("Swap Areas");
    const swapped = await areas();
    assert.notDeepEqual(swapped, before, "the areas swapped");
    await edgeMenu();
    await choose("Swap Areas");
    assert.deepEqual(await areas(), before, "swapped back");
    await edgeMenu();
    await choose(vertical ? "Join Left" : "Join Down");
    assert.equal((await areas()).length, before.length - 1, "joined");
    await app.bylonder((b) => b.dock.reset());
    await app.page.waitForTimeout(300);
    assert.deepEqual(await areas(), before);
    await edgeMenu();
    await choose("Vertical Split");
    assert.equal(await count(), all + 1, "split");
    await app.bylonder((b) => b.dock.reset());
    await app.page.waitForTimeout(300);
  },

  async "an area held and dragged by its header swaps with the area it is dropped on, which is highlighted"() {
    await closeDrawer();
    const before = await areas(), viewport = before.indexOf("viewport"), other = before.find((id, i) => i !== viewport);
    const heading = app.locator(`.dock-leaf[data-section="${other}"] > .dock-heading`);
    const from = await center(heading), to = await app.point(0.5, 0.5);
    await touch.send("touchStart", [from]);
    await app.page.waitForTimeout(550);
    for (let i = 1; i <= 10; i++) { await touch.send("touchMove", [[from[0] + (to[0] - from[0]) * i / 10, from[1] + (to[1] - from[1]) * i / 10]]); await app.page.waitForTimeout(20); }
    await app.locator(".dock-drop").waitFor();
    const drop = await app.locator(".dock-drop").boundingBox(), area = await app.locator('.dock-leaf[data-section="viewport"]').boundingBox();
    assert.ok(Math.abs(drop.x - area.x) < 2 && Math.abs(drop.width - area.width) < 2, "the 3D Viewport is highlighted");
    await touch.send("touchEnd", []);
    await app.locator(".dock-drop").waitFor({ state: "detached" });
    const after = await areas();
    assert.equal(after.indexOf(other), viewport, "the carried area took the 3D Viewport's place");
    assert.equal(await app.locator(".bl-menu").count(), 0, "no menu");
    await app.bylonder((b) => b.dock.reset());
    await app.page.waitForTimeout(300);
  },

  // Kept as Blender keeps the Preferences: saved by Save Preferences, or on leaving with Auto-Save Preferences.
  async "a pinch over the Properties editor sets Resolution Scale, kept after a reload"() {
    const before = await uiScale();
    const fold = app.locator('.dock-fold[aria-label*="Properties"]');
    if (await fold.count()) await touch.tap(await center(fold));
    await app.locator("#properties-section").waitFor();
    await touch.pinch(await center(app.locator("#properties-section")), 60, 120);
    await app.until((b, value) => Math.abs(b.userdef.preferences().view.ui_scale - value) > 0.1, before);
    const after = await uiScale();
    const size = await app.page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--bl-row"));
    assert.equal(parseFloat(size), Math.round(20 * after * 100) / 100, "the topbar's row follows");
    await app.bylonder((b) => b.userdef.save());
    await app.page.reload();
    await app.page.waitForFunction(() => document.querySelector('iframe[src*="viewport.html"]')?.contentWindow?.__bylonder?.editor, null, { timeout: 180000 });
    assert.equal(await uiScale(), after);
  },
};

const filter = process.argv[2];
if (process.argv[1] === new URL(import.meta.url).pathname) {
  const server = await startServer();
  const browser = await chromium.launch();
  let failed = 0;
  try {
    for (const [device, size] of Object.entries(DEVICES)) {
      app = await openApp(browser, server.url, { size, touch: true });
      touch = fingers(app.page);
      for (const [name, check] of Object.entries(checks)) {
        if (filter && !`${device}: ${name}`.includes(filter)) continue;
        const started = Date.now();
        try {
          await check();
          assert.deepEqual(app.errors, [], "page errors");
          console.log(`ok    ${device}: ${name} (${Date.now() - started} ms)`);
        } catch (error) {
          failed++;
          // No finger stays down for the next check.
          await touch.send("touchEnd", []).catch(() => {});
          const shot = `${tmpdir()}/${`touch-${device}-${name}`.replace(/\W+/g, "-")}.png`;
          await app.page.screenshot({ path: shot }).catch(() => {});
          console.log(`FAIL  ${device}: ${name}\n${error.stack}\nScreenshot: ${shot}`);
          app.errors.length = 0;
        }
      }
      await app.close();
    }
  } finally {
    await browser.close();
    await server.close();
  }
  process.exitCode = failed ? 1 : 0;
}
