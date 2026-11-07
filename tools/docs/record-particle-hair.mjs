// Records docs/features/particle-hair.md's media on the Grass Hill example: its particle system, Particle Edit Mode,
// combing a swirl into the grass, and the hill rendered through its camera.
// usage: node tools/docs/record-particle-hair.mjs
import { record } from "./record.mjs";

const VIEW = '[data-section="viewport"]', PROPERTIES = '[data-section="properties"]';

await record("particle-hair", { example: "particle-hair", node: "Hill" }, async (r) => {
  const { app, page } = r;
  await app.hover();
  await r.keys("Numpad 0", "Numpad0");
  // Rendered straight after opening draws washed out until the shading changes once: Material Preview first.
  for (const shading of ["material", "rendered"]) {
    await app.bylonder((b, shading) => { b.views.input.state.overlays = false; b.views.input.setShading(shading); }, shading);
    await page.mouse.move(1, 1);
    await r.pause(8000);
  }
  await r.shot("thumbnail", VIEW, { part: [0.1, 0.05, 0.9, 0.95] });
  await app.bylonder((b) => { b.views.input.state.overlays = true; b.views.input.setShading("solid"); });
  await r.tab("Particles");
  await r.shot("particles", PROPERTIES, { part: [0, 0, 1, 0.75] });
  await app.hover();
  await r.keys("Numpad 7", "Numpad7");
  await r.gif("particle-edit", VIEW, () => r.menu(app.frame().locator("button", { hasText: "Object Mode" }), "Particle Edit"));
  await r.gif("comb", VIEW, async () => {
    for (const [from, to] of [[[0.3, 0.7], [0.45, 0.45]], [[0.45, 0.45], [0.65, 0.4]], [[0.65, 0.4], [0.72, 0.6]]]) {
      await r.drag(await app.point(...from), await app.point(...to), { steps: 25 });
      await r.pause(300);
    }
  });
  await r.menu(app.frame().locator("button", { hasText: "Particle Edit" }), "Object Mode");
  await app.hover();
  await r.keys("Numpad 0", "Numpad0");
  await r.gif("result", VIEW, async () => {
    await app.bylonder((b) => { b.views.input.state.overlays = false; b.views.input.setShading("rendered"); });
    await page.mouse.move(1, 1);
    await r.pause(6000);
  });
});
