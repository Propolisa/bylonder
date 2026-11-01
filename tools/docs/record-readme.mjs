// Records README.md's hero: the whole window on the Volcanic Island, through its camera in Rendered shading, at story
// frames: the pair in the nest facing each other, and the chick's first try at flying (examples/island/story.js).
// usage: node tools/docs/record-readme.mjs [frame ...]
import { record } from "./record.mjs";

const FRAMES = process.argv.slice(2).map(Number);
if (!FRAMES.length) FRAMES.push(1177, 2516);

await record("readme", { example: "island", node: null, media: "readme", size: { width: 1600, height: 900 } }, async (r) => {
  await r.pause(4000);
  await r.app.hover();
  await r.page.keyboard.press("Numpad0");
  await r.app.bylonder((b) => b.views.input.setShading("rendered"));
  for (const frame of FRAMES) {
    await r.frame(frame);
    await r.app.hover();
    await r.pause(3000);
    await r.shot(`island-${frame}`);
  }
});
