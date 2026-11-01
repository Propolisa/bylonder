// Records README.md's images: a full-window shot of an example per entry of SHOTS.   usage: node tools/docs/record-readme.mjs
import { record } from "./record.mjs";

const SHOTS = { island: "island", "hair-dynamics": "hair", coast: "coast" };

for (const [example, name] of Object.entries(SHOTS)) {
  await record(`readme-${name}`, { example, node: null, media: "readme", size: { width: 1600, height: 900 } }, async (r) => {
    await r.pause(4000);
    await r.shot(name, undefined, { width: 1600 });
  });
}
