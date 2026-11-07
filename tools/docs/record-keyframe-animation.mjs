// Records docs/features/keyframe-animation.md's media: a pendulum made from the Default Cube scene (a ball hanging
// below its origin), its swing keyed
// with I, eased with Sine interpolation in the Graph Editor and played, then the Newton's Cradle example rendered.
// usage: node tools/docs/record-keyframe-animation.mjs
import { record } from "./record.mjs";
import { rendered } from "./scene-view.mjs";

const VIEW = '[data-section="viewport"]', HEADER = 26;

await record("keyframe-animation", { example: "cube", node: "Cube" }, async (r) => {
  const { app, page } = r;
  const pick = async (...labels) => {
    for (const label of labels) {
      const item = app.frame().getByRole("menuitem", { name: label, exact: true }).last();
      await item.click();
    }
    await app.settled();
  };
  const type = async (...keys) => { for (const key of keys) await r.keys(key, key.toLowerCase()); };

  await r.gif("pendulum", undefined, async () => {
    await app.hover();
    await r.keys("Delete");
    await r.keys("Shift A", "Shift+a");
    await pick("Mesh", "UV Sphere");
    await type("G", "Z", "2", ".", "5");
    await r.keys("Enter");
    await r.keys("Tab");
    await type("G", "Z", "-", "2");
    await r.keys("Enter");
    await r.keys("Tab");
  });

  await r.gif("key-swing", undefined, async () => {
    await app.hover();
    await type("R", "Y", "4", "0");
    await r.keys("Enter");
    await r.keys("I");
    await r.frame(16);
    await app.hover();
    await r.keys("Alt R", "Alt+r");
    await r.keys("I");
  });

  const timeline = await app.locator("#timeline-section").boundingBox();
  await r.gif("ease", undefined, async () => {
    await page.mouse.click(timeline.x + 25, timeline.y - HEADER / 2);
    await r.pause(400);
    await app.frame().getByRole("menuitem", { name: /^Graph Editor/ }).last().click();
    await app.settled();
    await r.drag([timeline.x + 500, timeline.y - HEADER], [timeline.x + 500, 430]);
    await app.frame().getByRole("button", { name: "Normalize" }).first().click();
    await app.settled();
    // View All (Home) does not frame the curves yet: a middle drag pans to the keys, Ctrl middle drag stretches time.
    await r.drag([timeline.x + 230, 625], [timeline.x + 488, 625], { button: "middle" });
    await page.keyboard.down("Control");
    await r.drag([timeline.x + 488, 625], [timeline.x + 548, 625], { button: "middle" });
    await page.keyboard.up("Control");
    await r.keys("A", "a");
    await r.keys("T", "t");
    await pick("Sinusoidal");
    await r.keys("Ctrl E", "Control+e");
    await pick("Ease In");
  }, { part: [0, 0.48, 1, 1] });

  await r.gif("play", undefined, async () => {
    await app.hover();
    await r.keys("Shift Left", "Shift+ArrowLeft");
    await r.keys("Space", " ");
    await r.pause(2500);
    await r.keys("Space", " ");
  });
});

await record("keyframe-animation", { example: "newtons-cradle", node: "Base" }, async (r) => {
  await rendered(r);
  await r.frame(8);
  await r.shot("thumbnail", VIEW, { part: [0.1, 0.06, 0.92, 0.94] });
  await r.gif("cradle", VIEW, async () => {
    await r.frame(1);
    await r.app.hover();
    await r.keys("Space", " ");
    await r.pause(5000);
    await r.keys("Space", " ");
  }, { part: [0.1, 0.06, 0.92, 0.94] });
});
