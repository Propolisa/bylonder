// Records docs/features/mesh-modeling.md's media: on the Default Cube, Edit Mode's Scale, Loop Cut, Inset, Extrude,
// Bevel and Bisect shaping a camera body; on the Rangefinder Camera example, the finished model's edges, its
// lens spun from a profile, and its render (also the thumbnail).
// usage: node tools/docs/record-mesh-modeling.mjs
import { execFileSync } from "node:child_process";
import { copyFileSync, rmSync, writeFileSync } from "node:fs";
import { recorder } from "./record.mjs";

const VIEW = '[data-section="viewport"]';
const CENTER = { part: [0.2, 0.12, 0.8, 0.88] };

async function session(options, steps) {
  const r = await recorder("mesh-modeling", options);
  try {
    await steps(r);
  } catch (error) {
    await r.page.screenshot({ path: `${r.out}../record-mesh-modeling.png` }).catch(() => {});
    throw error;
  } finally {
    await r.close();
  }
}
// Moves the pointer to a point of the scene (Blender axes) and returns it.
const at = async (r, point) => {
  const p = await r.screenOf(point);
  await r.page.mouse.move(...p, { steps: 8 });
  return p;
};
const faces = (r) => r.app.bylonder((b) => b.world.editMode.mesh.faces_num);

await session({ example: "cube", node: "Cube" }, async (r) => {
  const { app, page } = r;
  await app.hover();
  await r.keys("Tab");
  await app.until((b) => b.world.editMode.active);
  // The cube framed (View > Frame Selected), with room for the slab it becomes.
  await r.keys("Numpad .", "NumpadDecimal");
  await r.pause(800);
  await app.bylonder((b) => { b.views.input.camera.radius *= 1.15; });
  // A slab: Scale along Y and Z by typed values.
  await r.gif("scale", VIEW, async () => {
    for (const [axis, value] of [["y", "0.32"], ["z", "0.55"]]) {
      await app.hover(0.65, 0.5);
      await r.keys(`S ${axis.toUpperCase()} ${value}`, "s", axis, ...value.split(""), "Enter");
    }
  }, CENTER);
  // A loop cut around the body: Ctrl R over a vertical edge, a click places it, the mouse slides it down, a click
  // confirms.
  await r.gif("loop-cut", VIEW, async () => {
    await at(r, [1, -0.32, 0.2]);
    await r.keys("Ctrl R", "Control+r");
    const [x, y] = await at(r, [1, -0.32, 0]);
    await r.pause(400);
    await page.mouse.click(x, y);
    await page.mouse.move(x, y + 25, { steps: 12 });
    await page.mouse.click(x, y + 25);
    await app.until((b) => b.world.editMode.mesh.faces_num > 6);
  }, CENTER);
  // The top's face, inset, then extruded up into the viewfinder's housing.
  await r.gif("inset-extrude", VIEW, async () => {
    await r.keys("3 (Face)", "3");
    const [x, y] = await at(r, [0, 0, 0.55]);
    await page.mouse.click(x, y);
    await app.settled();
    await r.keys("I 0.12", "i", "0", ".", "1", "2", "Enter");
    await r.pause(400);
    await r.keys("E 0.2", "e", "0", ".", "2", "Enter");
  }, CENTER);
  // Bevel every edge: A, Ctrl B, a typed width.
  await r.gif("bevel", VIEW, async () => {
    await r.keys("A", "a");
    await at(r, [1.4, 0, 0.7]);
    await r.keys("Ctrl B 0.04", "Control+b", "0", ".", "0", "4", "Enter");
    await app.settled();
  }, CENTER);
  const before = await faces(r);
  // Bisect: everything selected, the Bisect tool's drag cuts a plane through it.
  await r.gif("bisect", VIEW, async () => {
    await r.keys("A", "a");
    await app.locator('[data-tool="builtin.knife"]').first().click({ button: "left", delay: 600 });
    const item = app.frame().getByRole("menuitem", { name: "Bisect" }).first();
    if (await item.count()) await item.click();
    else await app.locator('[data-tool="builtin.bisect"]').first().click();
    await app.settled();
    const [x0, y0] = await r.screenOf([-0.3, -0.33, 1.2]), [x1, y1] = await r.screenOf([-0.3, -0.33, -0.8]);
    await r.drag([x0, y0], [x1, y1], { steps: 20 });
  }, CENTER);
  console.log(`faces: ${before} then ${await faces(r)}`);
});

await session({ example: "mesh-modeling", node: "Camera Body" }, async (r) => {
  const { app } = r;
  await app.hover();
  // An object alone in Local View (Numpad /), seen from the front and a little to the left and above, in Edit Mode.
  const isolate = async (name) => {
    await app.bylonder((b, name) => { b.editor.selection.replace([b.world.scene.getNodeByName(name)]); b.editor.reconcile(); }, name);
    await app.hover();
    await r.keys("Numpad /", "NumpadDivide");
    await r.pause(800);
    await r.keys("Numpad .", "NumpadDecimal");
    await r.pause(800);
    for (const key of ["Numpad1", "Numpad4", "Numpad4", "Numpad8"]) await r.keys(key.replace("pad", "pad "), key);
    await r.keys("Tab");
    await r.keys("A", "a");
    await r.pause(1500);
  };
  const leave = async () => {
    await r.keys("Tab");
    await r.keys("Numpad /", "NumpadDivide");
    await r.pause(800);
  };
  await isolate("Lens");
  await r.shot("lens", VIEW, CENTER);
  await leave();
  await r.page.click('[data-blender="TOPBAR_MT_render"]');
  await r.page.getByRole("menuitem", { name: "Render Image" }).click();
  await app.until(() => /^(Finished|Render failed)/.test(document.querySelector(".render-result [data-status]")?.textContent ?? ""), null, 600000);
  const png = await app.frame().evaluate(() => document.querySelector(".render-result canvas").toDataURL("image/png"));
  writeFileSync(`${r.out}full.png`, Buffer.from(png.split(",")[1], "base64"));
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-i", `${r.out}full.png`, "-vf", "scale=800:-2:flags=lanczos", `${r.out}render.png`]);
  copyFileSync(`${r.out}render.png`, `${r.out}thumbnail.png`);
  rmSync(`${r.out}full.png`);
});
