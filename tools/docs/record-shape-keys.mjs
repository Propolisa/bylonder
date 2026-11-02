// Records docs/features/shape-keys.md's media: the Shape Keys panel on the Shape Keys example, a key's value dragged,
// a key edited in Edit Mode, the keyed bounce played, and the Runtime panel on Babylon (mapped).
// usage: node tools/docs/record-shape-keys.mjs
import { record } from "./record.mjs";

const VIEW = '[data-section="viewport"]', PANEL = '[data-blender="DATA_PT_shape_keys"]', RUNTIME = '[data-blender="DATA_PT_bylonder_shape_keys_runtime"]';
const BLOB = { part: [0.25, 0.2, 0.75, 0.8] };
// The blob and the Properties editor beside it, once widened.
const SIDE_BY_SIDE = { x: 240, y: 120, width: 1040, height: 520 };

await record("shape-keys", { example: "shape-keys", node: "Blob" }, async (r) => {
  const { app, page } = r;
  // The Properties editor widened, so the tree of keys shows their names.
  await r.drag([1052, 450], [860, 450]);
  for (let i = 0; i < 5 && !(await app.locator(PANEL).count()); i++) {
    await r.tab("Data");
    await r.pause(800);
  }
  await r.shot("panel", PANEL);
  const value = (key) => app.locator(PANEL).getByRole("spinbutton", { name: "Value" }).nth(["Squash", "Stretch", "Bulge"].indexOf(key));

  await r.gif("value", SIDE_BY_SIDE, async () => {
    const box = await value("Bulge").boundingBox(), from = [box.x + box.width / 2, box.y + box.height / 2];
    await r.drag(from, [from[0] + 50, from[1]], { steps: 30 });
    await r.pause(600);
  });
  await r.gif("play", VIEW, async () => {
    await app.hover();
    await r.keys("Space", " ");
    await r.pause(3000);
    await r.keys("Space", " ");
  }, BLOB);
  await r.frame(8);
  await r.shot("thumbnail", VIEW, { part: BLOB.part });

  await app.locator(RUNTIME).getByRole("button", { name: "Blender" }).first().click();
  await app.frame().getByRole("menuitem", { name: "Babylon (mapped)", exact: true }).last().click();
  await app.settled();
  await r.shot("runtime", RUNTIME);
  await r.gif("edit", VIEW, async () => {
    const row = await app.locator(PANEL).getByText("Stretch", { exact: true }).first().boundingBox();
    await page.mouse.click(row.x + row.width / 2, row.y + row.height / 2);
    await app.settled();
    await app.hover();
    await r.keys("Tab");
    await r.keys("A", "a");
    await r.keys("G", "g");
    const view = await app.locator(VIEW).boundingBox();
    await page.mouse.move(view.x + view.width / 2 + 80, view.y + view.height / 2, { steps: 12 });
    await page.mouse.click(view.x + view.width / 2 + 80, view.y + view.height / 2);
    await app.settled();
    await r.keys("Tab");
    await r.pause(600);
  }, BLOB);
});
