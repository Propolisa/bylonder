// Records docs/features/hair-dynamics.md's media: playing the simulation, jumping to a frame and changing the Hair
// Dynamics settings on the Hair Dynamics example.   usage: node tools/docs/record-hair-dynamics.mjs
import { record } from "./record.mjs";

const VIEW = '[data-section="viewport"]', PROPERTIES = '[data-section="properties"]';

await record("hair-dynamics", { example: "hair-dynamics", node: "Hair" }, async (r) => {
  const { app } = r;
  await app.hover();
  await r.keys("Numpad 0", "Numpad0");
  await r.gif("play", undefined, async () => {
    await app.hover();
    await r.keys("Space");
    await r.pause(6000);
    await r.keys("Space");
  }, { part: [0, 0, 0.82, 1] });
  await r.gif("frame", undefined, async () => {
    await r.frame(1);
    await r.pause(800);
    await r.frame(60);
  }, { part: [0, 0, 0.82, 1] });
  await r.shot("thumbnail", VIEW, { part: [0.25, 0.1, 0.75, 0.95] });
  await r.tab("Modifiers");
  await r.gif("settings", undefined, async () => {
    await r.field(app.locator(PROPERTIES), "Hair Length", 0.5);
    await r.pause(1500);
    await r.field(app.locator(PROPERTIES), "Density", 400);
  });
});
