// Records docs/features/shader-nodes.md's media: the lava sphere of docs/lava-material.md built from the Default Cube
// through real input (tests/e2e/lava.mjs, at the window size the smoke test drives it at).
// usage: node tools/docs/record-shader-nodes.mjs
import { record } from "./record.mjs";
import { displacedSphere, lavaMaterial } from "../../tests/e2e/lava.mjs";

const EDITOR = '.dock-leaf:has(> .dock-heading > button.dock-editor-type[title*="Node Editor"])';

await record("shader-nodes", { size: { width: 1600, height: 950 } }, async (r) => {
  const { app } = r;
  await r.gif("sphere", undefined, () => displacedSphere(app), { hold: 1500 });
  await r.gif("nodes", undefined, () => lavaMaterial(app), { hold: 2500 });
  await app.until((b) => !b.world.scene.getMeshByName("Sphere").material._buildIsInProgress, null, 60000);
  await r.shot("node-tree", EDITOR);
  await app.hover(0.5, 0.5);
  await r.keys("Numpad .", "NumpadDecimal");
  await r.pause(2000);
  await r.shot("thumbnail", ".viewport-canvas", { part: [0.3, 0.05, 0.7, 0.95] });
});
