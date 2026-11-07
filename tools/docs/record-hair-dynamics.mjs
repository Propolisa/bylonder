// Records docs/features/hair-dynamics.md's media on the Sea Anemone example: playing the simulation, the tentacles'
// Generate Hair Curves and Hair Dynamics settings, and a frame reached by typing it.
// usage: node tools/docs/record-hair-dynamics.mjs
import { record } from "./record.mjs";

const VIEW = '[data-section="viewport"]', PROPERTIES = '[data-section="properties"]';
const rendered = async (r) => {
  await r.app.bylonder((b) => { b.views.input.state.overlays = false; b.views.input.setShading("rendered"); });
  await r.page.mouse.move(1, 1);
};

await record("hair-dynamics", { example: "hair-dynamics", node: "Tentacles" }, async (r) => {
  const { app } = r;
  await app.hover();
  await r.keys("Numpad 0", "Numpad0");
  await rendered(r);
  await r.pause(8000);
  await r.gif("play", VIEW, async () => {
    await app.hover();
    await r.keys("Space");
    await r.pause(9000);
    await r.keys("Space");
  });
  await r.tab("Modifiers");
  await r.gif("generate", undefined, async () => {
    await r.field(app.locator(PROPERTIES), "Hair Length", 0.6);
    await r.pause(2500);
    await r.field(app.locator(PROPERTIES), "Hair Length", 0.42);
    await r.pause(1500);
  });
  // Hair Dynamics' Gravity panel, opened; its Z is the last Z among the modifiers' inputs.
  await app.locator(PROPERTIES).last().getByText("Gravity", { exact: true }).click();
  await app.settled();
  // Gravity's Z, the last Z among the modifiers' inputs.
  const gravity = async (z) => {
    const last = (await app.locator(PROPERTIES).locator('xpath=.//*[normalize-space(text())="Z"]').count()) - 1;
    await r.field(app.locator(PROPERTIES), "Z", z, last);
  };
  await r.gif("gravity", undefined, async () => {
    await r.frame(1);
    await gravity(-4);
    await r.frame(60);
    await r.pause(2500);
    await gravity(-0.5);
    await r.frame(1);
    await r.frame(60);
    await r.pause(1500);
  });
  await r.frame(90);
  await r.pause(8000);
  await r.shot("thumbnail", VIEW, { part: [0.1, 0.05, 0.9, 0.95] });
});
