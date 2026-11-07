// Records docs/features/modifiers.md's media on the Spiral Stair example: the step's modifier stack (Bevel, then Array
// with the Turn empty as Object Offset), the Turn empty rotated to wind the stair, the Array's Count, and the stair
// through its camera in Rendered shading.
//   usage: node tools/docs/record-modifiers.mjs
import { record } from "./record.mjs";

const VIEW = '[data-section="viewport"]', PROPERTIES = '[data-section="properties"]';

await record("modifiers", { example: "arrays", node: null }, async (r) => {
  const { app } = r;
  const select = (name) => app.bylonder((b, name) => {
    b.editor.selection.replace([b.world.scene.getNodeByName(name)]);
    b.editor.reconcile();
  }, name);
  await r.pause(3000);
  await r.render("thumbnail", { part: [0.15, 0, 0.85, 1] });
  await select("Step");
  await r.tab("Modifiers");
  await r.shot("stack", PROPERTIES, { part: [0, 0, 1, 0.75] });
  await r.gif("count", VIEW, async () => {
    for (const count of [8, 20, 44]) {
      await r.field(app.locator(PROPERTIES), "Count", count);
      await r.pause(500);
    }
  });
  await select("Turn");
  await r.gif("turn", VIEW, async () => {
    await app.hover();
    await r.keys("R", "r");
    await r.keys("Z", "z");
    await app.page.keyboard.type("8", { delay: 300 });
    await r.pause(800);
    await r.keys("Enter");
    await r.pause(800);
    await r.keys("Ctrl Z", "Control+z");
  });
});
