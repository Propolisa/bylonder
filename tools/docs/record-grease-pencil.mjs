// Records docs/features/grease-pencil.md's media: the Dusk Lake example through its camera in Rendered shading, played,
// then in File > New > 2D Animation: a stroke in Draw Mode, a fill, Edit Mode, and the layers.
//   usage: node tools/docs/record-grease-pencil.mjs
import { record } from "./record.mjs";

const VIEW = '[data-section="viewport"]', PROPERTIES = '[data-section="properties"]';

await record("grease-pencil", { example: "grease-pencil", node: "Dusk Lake" }, async (r) => {
  const { app } = r;
  await r.frame(60);
  await r.render("thumbnail");
  await app.bylonder((b) => { b.views.input.state.overlays = false; b.views.input.setShading("rendered"); });
  await r.gif("play", VIEW, async () => { await r.keys("Space", "Space"); await r.pause(5000); await r.keys("Space", "Space"); }, { part: [0.15, 0.1, 0.85, 0.9] });
  // The layers in the Outliner, maximized (Ctrl Space), three levels shown (Numpad +).
  const outliner = '.dock-content[data-section="objects"]';
  await app.locator(outliner).hover();
  await r.keys("Ctrl Space", "Control+Space");
  await app.locator(outliner).hover();
  for (let i = 0; i < 3; i++) await r.keys("Numpad +", "NumpadAdd");
  await app.page.mouse.move(1, 1);
  await r.shot("layers", outliner, { part: [0, 0, 0.5, 0.75] });
  await app.locator(outliner).hover();
  await r.keys("Ctrl Space", "Control+Space");
  // Drawing starts from Blender's 2D Animation template: File > New > 2D Animation, its Stroke object in Draw Mode.
  await app.page.click('[data-blender="TOPBAR_MT_file"]');
  await app.page.getByRole("menuitem", { name: /^New/ }).first().hover();
  await app.page.getByRole("menuitem", { name: "2D Animation" }).first().click();
  // The viewport's frame loads again for the new file.
  for (let tries = 0; tries < 60; tries++) {
    if (await app.bylonder((b) => b.world.objects.some((node) => node.name === "Stroke")).catch(() => false)) break;
    await r.pause(1000);
  }
  await app.settled();
  await r.pause(1500);
  await r.gif("draw", VIEW, async () => {
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
});
