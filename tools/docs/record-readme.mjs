// Records README.md's images from the Volcanic Island (examples/island/story.js), the whole window at 1600 x 900:
// the nest through the scene camera in Rendered shading at story frames, then the asteroid's strike with the 3D
// Viewport split: the camera's render on the left, the island in Edit Mode on the right.
// usage: node tools/docs/record-readme.mjs [nest frame ...]      (DOCS_PORT picks the dev server's port)
import { record } from "./record.mjs";

const NEST = process.argv.slice(2).map(Number);
if (!NEST.length) NEST.push(1177, 2516);
const STRIKE = 3262;

// The 3D Viewports, left to right.
const viewsByX = (b) => b.views.all.sort((a, c) => a.canvas.getBoundingClientRect().x - c.canvas.getBoundingClientRect().x);

await record("readme", { example: "island", node: null, media: "readme", size: { width: 1600, height: 900 } }, async (r) => {
  const { app, page } = r;
  await r.pause(4000);
  await app.hover();
  await page.keyboard.press("Numpad0");
  await app.bylonder((b) => b.views.input.setShading("rendered"));
  for (const frame of NEST) {
    await r.frame(frame);
    await app.hover();
    await r.pause(3000);
    await r.shot(`nest-${frame}`);
  }

  await r.frame(STRIKE);
  const frame = await page.locator('iframe[src*="viewport.html"]').boundingBox();
  const corners = await app.locator(".dock-corner").evaluateAll((all) => all.map((c) => c.getBoundingClientRect()).map(({ x, y, width, height }) => [x + width / 2, y + height / 2]));
  const viewport = await app.locator('[data-section="viewport"]').first().boundingBox();
  const [cx, cy] = corners.map(([x, y]) => [frame.x + x, frame.y + y]).find(([x, y]) => Math.abs(y - viewport.y) < 40 && Math.abs(x - viewport.x - viewport.width) < 40);
  const start = [cx, cy];
  await r.drag(start, [viewport.x + viewport.width * 0.45, start[1] + 4], { steps: 30 });
  await app.bylonder((b) => {
    const [left, right] = viewsByX(b);
    left.state.overlays = false;
    left.setShading("rendered");
    right.setShading("solid");
    b.editor.selection.replace([b.world.scene.getNodeByName("Island")]);
    b.editor.reconcile();
  });
  const right = await app.bylonder((b) => { const { x, y, width, height } = viewsByX(b)[1].canvas.getBoundingClientRect(); return [x + width / 2, y + height / 2]; });
  await page.mouse.move(frame.x + right[0], frame.y + right[1]);
  await page.keyboard.press("Tab");
  await app.settled();
  await page.keyboard.press("NumpadDecimal");
  await r.pause(3000);
  await r.shot("strike-split");
});
