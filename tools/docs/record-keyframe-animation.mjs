// Records docs/features/keyframe-animation.md's media: keying the Default Cube with I at two frames, playing, and the
// keys on the Timeline.   usage: node tools/docs/record-keyframe-animation.mjs
import { record } from "./record.mjs";

const WINDOW = { part: [0, 0, 0.82, 1] };

await record("keyframe-animation", {}, async (r) => {
  const { app } = r;
  await app.click();
  await r.gif("insert", undefined, async () => {
    await app.hover();
    await r.keys("I");
  }, WINDOW);
  await r.gif("second-key", undefined, async () => {
    await r.frame(40);
    await app.hover();
    for (const key of ["G", "X", "4"]) await r.keys(key, key.toLowerCase());
    await r.keys("Enter");
    await r.keys("R", "r");
    for (const key of ["Z", "9", "0"]) await r.keys(key, key.toLowerCase());
    await r.keys("Enter");
    await r.keys("I");
  }, WINDOW);
  await r.gif("play", undefined, async () => {
    await r.frame(1);
    await app.hover();
    await r.keys("Space");
    await r.pause(4000);
    await r.keys("Space");
  }, WINDOW);
  await r.frame(20);
  await r.shot("thumbnail", ".viewport-canvas", { part: [0.2, 0.15, 0.8, 0.85] });
  await r.shot("timeline", undefined, { part: [0, 0.9, 0.82, 0.975] });
});
