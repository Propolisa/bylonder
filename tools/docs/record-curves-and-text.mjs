// Records docs/features/curves-and-text.md's media: a text object added, edited, extruded and beveled, and a Bézier
// curve extruded in Edit Mode, from the Default Cube.   usage: node tools/docs/record-curves-and-text.mjs
import { record } from "./record.mjs";

const VIEW = '[data-section="viewport"]', PROPERTIES = '[data-section="properties"]';

await record("curves-and-text", {}, async (r) => {
  const { app, page } = r;
  const add = async (...path) => {
    await app.hover(0.5, 0.6);
    await r.keys("Shift A", "Shift+A");
    for (const [i, label] of path.entries()) {
      const item = app.frame().getByRole("menuitem", { name: label, exact: true }).last();
      await (i < path.length - 1 ? item.hover() : item.click());
    }
    await app.settled();
  };
  await r.gif("add-text", VIEW, async () => {
    await app.click();
    await r.keys("X", "x");
    await app.frame().getByRole("menuitem", { name: "Delete" }).click();
    await add("Text");
    await app.hover();
    await r.keys("Numpad 7", "Numpad7");
    await r.keys("Numpad .", "NumpadDecimal");
  });
  await r.gif("edit-text", VIEW, async () => {
    await app.hover();
    await r.keys("Tab");
    for (let i = 0; i < 4; i++) await r.keys("Backspace");
    await page.keyboard.type("Bylonder", { delay: 120 });
    await app.settled();
    await r.keys("Tab");
    await r.keys("Numpad .", "NumpadDecimal");
  });
  await r.tab("Data");
  const panel = async (name) => {
    await app.locator(PROPERTIES).getByText(name, { exact: true }).first().click();
    await app.settled();
  };
  await r.gif("extrude", undefined, async () => {
    await panel("Geometry");
    await r.field(app.locator(PROPERTIES), "Extrude", 0.15);
    if (!(await app.locator(PROPERTIES).getByText("Depth", { exact: true }).count())) await panel("Bevel");
    await r.field(app.locator(PROPERTIES), "Depth", 0.03);
    await app.hover();
    for (let i = 0; i < 3; i++) await r.keys("Numpad 8", "Numpad8");
  });
  await r.shot("thumbnail", ".viewport-canvas", { part: [0.45, 0.22, 0.98, 0.7] });
  await r.gif("curve", VIEW, async () => {
    await add("Curve", "Bézier");
    await app.hover();
    await r.keys("Tab");
    await app.hover(0.55, 0.5);
    await r.keys("E", "e");
    await page.mouse.move(...(await app.point(0.7, 0.3)), { steps: 15 });
    await page.mouse.click(...(await app.point(0.7, 0.3)));
    await app.settled();
    await r.keys("Tab");
  });
});
