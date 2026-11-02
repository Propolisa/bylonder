// Records docs/features/grease-pencil.md's media: the Bouncing Ball example through its camera, Draw Mode and a
// stroke, a fill, Edit Mode, playback with the Dope Sheet, and the 2D Animation template.
//   usage: node tools/docs/record-grease-pencil.mjs
import { record } from "./record.mjs";

const VIEW = '[data-section="viewport"]', PROPERTIES = '[data-section="properties"]';

await record("grease-pencil", { example: "grease-pencil", node: "Bouncing Ball" }, async (r) => {
  const { app } = r;
  await app.hover();
  await r.keys("Numpad 0", "Numpad0");
  await r.frame(7);
  await r.shot("thumbnail", VIEW, { part: [0.15, 0.1, 0.85, 0.9] });
  await r.gif("play", VIEW, async () => { await r.keys("Space", "Space"); await r.pause(2000); await r.keys("Space", "Space"); }, { part: [0.15, 0.1, 0.85, 0.9] });
  await r.frame(1);
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
