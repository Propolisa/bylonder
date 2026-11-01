// Records docs/features/particle-hair.md's media: the Combed Hair example's particle system, Particle Edit Mode and
// combing.   usage: node tools/docs/record-particle-hair.mjs
import { record } from "./record.mjs";

const VIEW = '[data-section="viewport"]', PROPERTIES = '[data-section="properties"]';

await record("particle-hair", { example: "hair", node: "Head" }, async (r) => {
  const { app, page } = r;
  await app.hover();
  await r.keys("Numpad 1", "Numpad1");
  await r.keys("Numpad .", "NumpadDecimal");
  for (let i = 0; i < 3; i++) await app.page.mouse.wheel(0, -120);
  await app.settled();
  await r.shot("thumbnail", VIEW, { part: [0.2, 0.08, 0.8, 0.95] });
  await r.tab("Particles");
  await r.shot("particles", PROPERTIES, { part: [0, 0, 1, 0.75] });
  await r.gif("particle-edit", VIEW, () => r.menu(app.frame().locator("button", { hasText: "Object Mode" }), "Particle Edit"));
  await r.gif("comb", VIEW, async () => {
    for (const [from, to] of [[[0.5, 0.28], [0.3, 0.62]], [[0.5, 0.28], [0.7, 0.62]], [[0.42, 0.3], [0.36, 0.7]]]) {
      await r.drag(await app.point(...from), await app.point(...to), { steps: 25 });
      await r.pause(300);
    }
  });
});
