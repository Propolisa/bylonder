// Records README.md's images from the Volcanic Island (examples/island/story.js), the whole window at 1440 x 810 (2x):
// the nest through the scene camera in Rendered shading, then the 3D Viewport split: the camera's render on the left
// (wide, overlays off) and the Lava Point boulder in Edit Mode with X-ray on the right, at the asteroid's strike and after.
// usage: node tools/docs/record-readme.mjs [nest:<frame> ...] [split:<frame> ...]   (DOCS_PORT: the dev server's port)
import { record } from "./record.mjs";

const frames = (kind, fallback) => {
  const given = process.argv.slice(2).filter((a) => a.startsWith(kind + ":")).map((a) => Number(a.slice(kind.length + 1)));
  return process.argv.length > 2 ? given : fallback;
};
const NEST = frames("nest", [2545]), SPLIT = frames("split", [3266, 3366, 5259]);
const RENDER_WIDTH = 0.65;

await record("readme", { example: "island", node: null, media: "readme", size: { width: 1440, height: 810 }, scale: 2 }, async (r) => {
  const { app, page } = r;
  // The recorder's pointer dot hidden: a still shows no pointer.
  const shot = async (name) => {
    await page.mouse.move(720, 806);
    for (const where of [page, app.frame()]) await where.evaluate(() => document.querySelectorAll("div[style*='border-radius: 50%']").forEach((d) => (d.style.display = "none")));
    await r.pause(2500);
    await r.shot(name);
  };
  const center = ({ x, y, width, height }) => [x + width / 2, y + height / 2];
  await r.pause(4000);
  await app.hover();
  await page.keyboard.press("Numpad0");
  await app.bylonder((b) => b.views.input.setShading("rendered"));
  for (const frame of NEST) {
    await r.frame(frame);
    await shot(`nest-${frame}`);
  }
  if (!SPLIT.length) return;

  const frame = await page.locator('iframe[src*="viewport.html"]').boundingBox();
  const corners = await app.locator(".dock-corner").evaluateAll((all) => all.map((c) => c.getBoundingClientRect()).map(({ x, y, width, height }) => [x + width / 2, y + height / 2]));
  const viewport = await app.locator('[data-section="viewport"]').first().boundingBox();
  const start = corners.map(([x, y]) => [frame.x + x, frame.y + y]).find(([x, y]) => Math.abs(y - viewport.y) < 40 && Math.abs(x - viewport.x - viewport.width) < 40);
  await r.drag(start, [viewport.x + viewport.width / 2, start[1] + 4], { steps: 30 });
  // A new area takes half; the splitter between the two views sets the render's share.
  const splitters = await app.locator(".splitpanes--vertical > .splitpanes__splitter").evaluateAll((all) => all.map((s) => s.getBoundingClientRect()).map(({ x, y, width, height }) => [x + width / 2, y + height / 2]));
  const middle = viewport.x + viewport.width / 2;
  const splitter = splitters.map(([x, y]) => [frame.x + x, frame.y + y]).sort((a, c) => Math.abs(a[0] - middle) - Math.abs(c[0] - middle))[0];
  await r.drag(splitter, [viewport.x + viewport.width * RENDER_WIDTH, splitter[1]], { steps: 30 });
  const canvases = (await Promise.all([0, 1].map((i) => app.locator(".viewport-canvas").nth(i).boundingBox()))).sort((a, c) => a.x - c.x);
  await page.mouse.move(...center(canvases[0]));
  await app.bylonder((b) => { b.views.input.state.overlays = false; b.views.input.setShading("rendered"); });
  await page.mouse.move(...center(canvases[1]));
  await app.bylonder((b) => {
    b.views.input.state.xray = true;
    b.views.input.setShading("solid");
    b.editor.selection.replace([b.world.scene.getNodeByName("Lava Point")]);
    b.editor.reconcile();
  });
  await page.keyboard.press("Tab");
  await app.settled();
  await page.keyboard.press("a");
  await page.keyboard.press("NumpadDecimal");
  for (const frame of SPLIT) {
    await r.frame(frame);
    await shot(`split-${frame}`);
  }
});
