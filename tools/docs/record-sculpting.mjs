// Records docs/features/sculpting.md's media on the Ceramic Owl example: Sculpt Mode, then Grab, Draw, Crease, Inflate
// and Smooth strokes on the owl, Ctrl Z taking one back, and a render.
// usage: node tools/docs/record-sculpting.mjs
import { execFileSync } from "node:child_process";
import { ffmpeg } from "../media.mjs";
import { rmSync, writeFileSync } from "node:fs";
import { record } from "./record.mjs";

const VIEW = '[data-section="viewport"]';
const OWL = { part: [0.2, 0, 0.8, 1] };

await record("sculpting", { example: "sculpting", node: "Owl" }, async (r) => {
  const { app, page } = r;
  // A stroke through points of the owl (Blender axes, about its center), holding `modifier`.
  const stroke = async (points, modifier) => {
    const screen = [];
    for (const [x, y, z] of points) screen.push(await r.screenOf([x, y, z + 1.05]));
    await page.mouse.move(...screen[0], { steps: 8 });
    if (modifier) await page.keyboard.down(modifier);
    await page.mouse.down();
    for (const [i, point] of screen.entries()) if (i) await page.mouse.move(...point, { steps: 14 });
    await page.mouse.up();
    if (modifier) await page.keyboard.up(modifier);
    await app.settled();
  };
  // The thumbnail: the owl as the example opens it, rendered.
  await page.click('[data-blender="TOPBAR_MT_render"]');
  await page.getByRole("menuitem", { name: "Render Image" }).click();
  await app.until(() => /^(Finished|Render failed)/.test(document.querySelector(".render-result [data-status]")?.textContent ?? ""), null, 600000);
  const png = await app.frame().evaluate(() => document.querySelector(".render-result canvas").toDataURL("image/png"));
  writeFileSync(`${r.out}full.png`, Buffer.from(png.split(",")[1], "base64"));
  execFileSync(ffmpeg, ["-y", "-loglevel", "error", "-i", `${r.out}full.png`, "-vf", "scale=640:-2:flags=lanczos", `${r.out}thumbnail.png`]);
  rmSync(`${r.out}full.png`);
  await app.locator(".render-result [data-close]").click();
  await r.pause(800);
  await app.hover();
  // The owl from the front, framed, out of camera view.
  if (await app.bylonder((b) => b.views.input.state.cameraView)) await r.keys("Numpad 0", "Numpad0");
  await r.keys("Numpad 1", "Numpad1");
  await r.keys("Numpad .", "NumpadDecimal");
  await r.pause(1000);

  await r.gif("sculpt-mode", VIEW, async () => {
    await app.bylonder((b) => b.runOperator("object.mode_set", { mode: "SCULPT" }));
    await app.settled();
    await r.pause(1500);
  });
  await r.gif("grab", VIEW, async () => {
    await app.hover(0.5, 0.5);
    await r.keys("G (Grab)", "g");
    await stroke([[0.55, -0.4, 0.95], [0.68, -0.4, 1.25]]);
  }, OWL);
  await r.gif("draw", VIEW, async () => {
    await r.keys("V (Draw)", "v");
    await stroke([[-0.4, -0.65, 0.62], [0, -0.72, 0.58], [0.4, -0.65, 0.62]]);
    await r.keys("Ctrl drag (subtract)", "Control");
    await stroke([[-0.6, -0.5, -0.1], [-0.45, -0.62, -0.4], [-0.2, -0.72, -0.6]], "Control");
  }, OWL);
  await r.gif("crease", VIEW, async () => {
    await r.keys("Shift C (Crease)", "Shift+c");
    await stroke([[0, -0.78, 0.4], [0, -0.8, 0.25], [0, -0.78, 0.1]]);
  }, OWL);
  await r.gif("inflate", VIEW, async () => {
    await r.keys("I (Inflate)", "i");
    await stroke([[0.45, -0.62, 0.2], [0.5, -0.6, 0.16], [0.45, -0.62, 0.12]]);
  }, OWL);
  await r.gif("smooth-undo", VIEW, async () => {
    await r.keys("Shift drag (Smooth)", "Shift");
    await stroke([[-0.3, -0.7, 0.85], [0.3, -0.7, 0.85]], "Shift");
    await r.pause(600);
    await r.keys("Ctrl Z", "Control+z");
    await r.pause(600);
  }, OWL);

});
