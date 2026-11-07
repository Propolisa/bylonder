// Records docs/features/grease-pencil.md's media: the Dusk Lake example through its camera in Rendered shading, played,
// Draw Mode and a stroke, a fill, Edit Mode, and the layers.
//   usage: node tools/docs/record-grease-pencil.mjs
import { record } from "./record.mjs";

const VIEW = '[data-section="viewport"]', PROPERTIES = '[data-section="properties"]';

await record("grease-pencil", { example: "grease-pencil", node: "Dusk Lake" }, async (r) => {
  const { app } = r;
  await r.frame(60);
  await r.render("thumbnail", { wait: 4000 });
  await app.bylonder((b) => { b.views.input.state.overlays = false; b.views.input.setShading("rendered"); });
  await r.gif("play", VIEW, async () => { await r.keys("Space", "Space"); await r.pause(5000); await r.keys("Space", "Space"); }, { part: [0.15, 0.1, 0.85, 0.9] });
  await r.frame(1);
  await app.bylonder((b) => { b.views.input.state.overlays = true; });
  await r.gif("draw", VIEW, async () => {
    await r.menu(app.frame().locator("button", { hasText: "Object Mode" }), "Draw Mode");
    await r.drag(await app.point(0.3, 0.35), await app.point(0.7, 0.3), { steps: 30 });
    await r.pause(300);
  });
  await r.gif("fill", VIEW, async () => {
    for (const [from, to] of [[[0.3, 0.6], [0.5, 0.75]], [[0.5, 0.75], [0.7, 0.6]], [[0.7, 0.6], [0.3, 0.6]]]) await r.drag(await app.point(...from), await app.point(...to), { steps: 15 });
    await app.locator('[role="button"][aria-label="Fill"]').last().click();
    await app.settled();
    await app.click(0.5, 0.65);
    await app.settled();
    await r.pause(300);
  });
  await r.gif("edit", VIEW, async () => {
    await r.menu(app.frame().locator("button", { hasText: "Draw Mode" }), "Edit Mode");
    await r.keys("A", "a");
    await r.keys("G", "g");
    await app.page.mouse.move(...(await app.point(0.55, 0.45)), { steps: 15 });
    await app.page.mouse.click(...(await app.point(0.55, 0.45)));
    await app.settled();
  });
  await r.tab("Data");
  await r.shot("layers", PROPERTIES, { part: [0, 0, 1, 0.7] });
});
