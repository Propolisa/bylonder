// Records docs/features/vertex-and-weight-paint.md's media on the Koi Pond example: the koi's color attribute in Vertex
// Paint, a sampled color painted on, the Tail group in Weight Paint and a stroke that widens it, the Simple Deform
// modifier it limits, the swim played, and a render.
// usage: node tools/docs/record-vertex-and-weight-paint.mjs
import { execFileSync } from "node:child_process";
import { rmSync, writeFileSync } from "node:fs";
import { record } from "./record.mjs";

const VIEW = '[data-section="viewport"]';
const FISH = { part: [0.1, 0.1, 0.9, 0.9] };
// The 3D Viewport and the Properties editor beside it.
const SIDE_BY_SIDE = { x: 0, y: 26, width: 1280, height: 690 };
// Kohaku's place and heading (vertex-and-weight-paint.py).
const KOHAKU = [-0.5, -0.35, 0.35], HEADING = (25 * Math.PI) / 180;

await record("vertex-and-weight-paint", { example: "vertex-and-weight-paint", node: "Kohaku" }, async (r) => {
  const { app, page } = r;
  const mode = async (name) => { await app.bylonder((b, mode) => b.runOperator("object.mode_set", { mode }), name); await app.settled(); };
  // A point along the fish's body, from tail (u = 0) to head (u = 1), across it by v (-1 to 1), on its back.
  const onFish = (u, v = 0) => {
    const x = (u - 0.5) * 1.6, y = v * 0.15;
    return r.screenOf([KOHAKU[0] + x * Math.cos(HEADING) - y * Math.sin(HEADING), KOHAKU[1] + x * Math.sin(HEADING) + y * Math.cos(HEADING), KOHAKU[2] + 0.12]);
  };
  const stroke = async (points, modifier) => {
    const screen = [];
    for (const [u, v] of points) screen.push(await onFish(u, v));
    await page.mouse.move(...screen[0], { steps: 8 });
    if (modifier) await page.keyboard.down(modifier);
    await page.mouse.down();
    for (const [i, point] of screen.entries()) if (i) await page.mouse.move(...point, { steps: 16 });
    await page.mouse.up();
    if (modifier) await page.keyboard.up(modifier);
    await app.settled();
  };
  await r.drag([1052, 450], [900, 450]);
  await app.hover();
  await r.keys("Numpad 7", "Numpad7");
  await r.keys("Numpad .", "NumpadDecimal");
  await r.pause(800);

  await r.gif("vertex-paint", VIEW, async () => {
    await mode("VERTEX_PAINT");
    await r.pause(800);
    // A stroke along the back in the brush's color, black: a Sanke's patch.
    await stroke([[0.42, 0.2], [0.5, -0.3], [0.58, 0.2], [0.64, -0.2]]);
    await r.pause(600);
  }, FISH);
  await r.tab("Data");
  await app.locator(`[data-section="properties"]`).getByText("Color Attributes", { exact: true }).first().click();
  await app.settled();
  await r.shot("attributes", SIDE_BY_SIDE);

  await r.gif("weight-paint", VIEW, async () => {
    await mode("WEIGHT_PAINT");
    await r.pause(1200);
    await stroke([[0.42, -1.4], [0.48, 0], [0.42, 1.4], [0.52, 1.4], [0.58, 0], [0.52, -1.4]]);
    await r.pause(800);
  }, FISH);
  await mode("OBJECT");
  await app.bylonder((b) => b.views.input.setShading("material"));
  await app.hover();
  await r.keys("Numpad 0", "Numpad0");
  await r.pause(1500);
  await r.gif("swim", VIEW, async () => {
    await app.hover();
    await r.keys("Space", " ");
    await r.pause(3000);
    await r.keys("Space", " ");
  });
  await r.tab("Modifiers");
  await r.shot("modifier", SIDE_BY_SIDE);

  await page.click('[data-blender="TOPBAR_MT_render"]');
  await page.getByRole("menuitem", { name: "Render Image" }).click();
  await app.until(() => /^(Finished|Render failed)/.test(document.querySelector(".render-result [data-status]")?.textContent ?? ""), null, 600000);
  const png = await app.frame().evaluate(() => document.querySelector(".render-result canvas").toDataURL("image/png"));
  writeFileSync(`${r.out}full.png`, Buffer.from(png.split(",")[1], "base64"));
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-i", `${r.out}full.png`, "-vf", "scale=720:-2:flags=lanczos", `${r.out}thumbnail.png`]);
  rmSync(`${r.out}full.png`);
});
