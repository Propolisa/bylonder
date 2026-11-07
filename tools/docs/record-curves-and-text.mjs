// Records docs/features/curves-and-text.md's media: a text typed, given depth and a round bevel, and a Bezier circle
// beveled into a tube, from the Default Cube; then the Neon Sign example's glow material and its render.
// usage: node tools/docs/record-curves-and-text.mjs
import { record } from "./record.mjs";

const VIEW = '[data-section="viewport"]', PROPERTIES = '[data-section="properties"]';
const EDITOR = '.dock-leaf:has(> .dock-heading > button.dock-editor-type[title*="Node Editor"])';

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
  const panel = async (name) => {
    await app.locator(PROPERTIES).getByText(name, { exact: true }).first().click();
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
    await page.keyboard.type("Open Late", { delay: 120 });
    await app.settled();
    await r.keys("Tab");
    await r.keys("Numpad .", "NumpadDecimal");
  });
  await r.tab("Data");
  await r.gif("extrude", undefined, async () => {
    await panel("Geometry");
    await r.field(app.locator(PROPERTIES), "Extrude", 0.02);
    if (!(await app.locator(PROPERTIES).getByText("Depth", { exact: true }).count())) await panel("Bevel");
    await r.field(app.locator(PROPERTIES), "Depth", 0.03);
    await app.hover();
    for (let i = 0; i < 3; i++) await r.keys("Numpad 8", "Numpad8");
  });
  await r.gif("tube", VIEW, async () => {
    await add("Curve", "Circle");
    await app.hover(0.5, 0.5);
    await r.keys("S X 3 Enter", "s", "x", "3", "Enter");
    await r.keys("Numpad .", "NumpadDecimal");
    await r.tab("Data");
    if (!(await app.locator(PROPERTIES).getByText("Depth", { exact: true }).count())) await panel("Bevel");
    await r.field(app.locator(PROPERTIES), "Depth", 0.05);
    await app.hover();
  });
});

await record("curves-and-text", { example: "neon-sign", node: "Frame", size: { width: 1600, height: 950 } }, async (r) => {
  const { app } = r;
  await r.outliner("Swoosh");
  await app.hover();
  await r.keys("Numpad 1", "Numpad1");
  await r.keys("Tab");
  await r.keys("Numpad .", "NumpadDecimal");
  await r.pause(1000);
  await r.shot("swoosh-points", ".viewport-canvas", { part: [0.1, 0.2, 0.9, 0.8] });
  await r.keys("Tab");
  await app.hover();
  await r.keys("Numpad 0", "Numpad0");
  await app.bylonder((b) => { b.views.input.state.overlays = false; b.views.input.setShading("rendered"); });
  await r.pause(30000);
  await r.shot("render", ".viewport-canvas");
  await r.shot("thumbnail", ".viewport-canvas", { part: [0.12, 0, 0.88, 1], width: 960 });
});
