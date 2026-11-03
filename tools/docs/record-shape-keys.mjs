// Records docs/features/shape-keys.md's media: a petal made from the Default Cube scene, a Basis and a key added,
// the key edited in Edit Mode, its value dragged and keyed, the Runtime panel on Babylon (mapped), then the Lotus
// example blooming in Rendered shading.
// usage: node tools/docs/record-shape-keys.mjs
import { record } from "./record.mjs";
import { rendered } from "./scene-view.mjs";

const VIEW = '[data-section="viewport"]', PANEL = '[data-blender="DATA_PT_shape_keys"]', RUNTIME = '[data-blender="DATA_PT_bylonder_shape_keys_runtime"]';
// The petal and the Properties editor beside it, once widened.
const SIDE_BY_SIDE = { x: 240, y: 120, width: 1040, height: 560 };
const SCENE = { part: [0.08, 0.06, 0.92, 0.94] };

await record("shape-keys", { example: "cube", node: "Cube" }, async (r) => {
  const { app } = r;
  const pick = async (...labels) => {
    for (const label of labels) {
      const item = app.frame().getByRole("menuitem", { name: label, exact: true }).last();
      await item.click();
    }
    await app.settled();
  };
  const type = async (...keys) => { for (const key of keys) await r.keys(key, key.toLowerCase()); };
  const value = () => app.locator(PANEL).getByRole("spinbutton", { name: "Value" }).first();
  const setValue = async (v) => {
    await value().dblclick();
    await app.page.keyboard.press("Control+A");
    await app.page.keyboard.type(String(v));
    await app.page.keyboard.press("Enter");
    await app.settled();
  };

  await r.drag([1052, 450], [860, 450]);
  await r.gif("petal", undefined, async () => {
    await app.hover();
    await r.keys("Delete");
    await r.keys("Shift A", "Shift+a");
    await pick("Mesh", "Plane");
    await type("S", "Y", "2");
    await r.keys("Enter");
    await type("R", "X", "9", "0");
    await r.keys("Enter");
    await type("G", "Z", "2");
    await r.keys("Enter");
  });

  for (let i = 0; i < 5 && !(await app.locator(PANEL).count()); i++) {
    await r.tab("Data");
    await r.pause(800);
  }
  await r.gif("add-keys", SIDE_BY_SIDE, async () => {
    for (let i = 0; i < 2; i++) {
      await app.locator(PANEL).getByRole("button", { name: /add/i }).first().click();
      await app.settled();
      await r.pause(400);
    }
  });

  await r.gif("edit-key", SIDE_BY_SIDE, async () => {
    await app.hover();
    await r.keys("Tab");
    await r.keys("A", "a");
    await type("R", "X", "-", "6", "0");
    await r.keys("Enter");
    await r.keys("Tab");
  });

  await r.gif("value", SIDE_BY_SIDE, async () => {
    await setValue(0);
    await r.pause(400);
    const box = await value().boundingBox(), from = [box.x + box.width / 2, box.y + box.height / 2];
    await r.drag(from, [from[0] + 80, from[1]], { steps: 30 });
    await r.pause(600);
  });

  await r.gif("key-value", undefined, async () => {
    await r.frame(1);
    await setValue(0);
    await value().hover();
    await r.keys("I");
    await r.frame(48);
    await setValue(1);
    await value().hover();
    await r.keys("I");
    await r.frame(1);
    await app.hover();
    await r.keys("Space", " ");
    await r.pause(2500);
    await r.keys("Space", " ");
  });

  await app.locator(RUNTIME).getByRole("button", { name: "Blender" }).first().click();
  await app.frame().getByRole("menuitem", { name: "Babylon (mapped)", exact: true }).last().click();
  await app.settled();
  await r.shot("runtime", RUNTIME);
});

await record("shape-keys", { example: "lotus", node: "Lotus" }, async (r) => {
  await rendered(r);
  await r.frame(72);
  await r.shot("thumbnail", VIEW, SCENE);
  await r.gif("lotus", VIEW, async () => {
    await r.frame(1);
    await r.app.hover();
    await r.keys("Space", " ");
    await r.pause(5000);
    await r.keys("Space", " ");
  }, SCENE);
});
