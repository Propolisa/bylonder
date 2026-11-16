// Records docs/features/lightmaps.md's media on the Meditation example: the scene in Rendered shading through the camera,
// breathing; Object properties > Lightmap on the room and on the figure; the thumbnail, a crop of Render Image; then the
// bake in the app: Cycles as the render engine, Render properties > Bake > Lightmaps, Bake Lightmaps of the six lit
// objects at BAKE_SAMPLES (default 64), its time logged, and the baked .blend saved to BAKE_OUT when it is set.
// usage: node tools/docs/record-lightmaps.mjs
import { writeFileSync } from "node:fs";
import { record } from "./record.mjs";

// The 3D Viewport and the Properties editor beside it.
const SIDE_BY_SIDE = { x: 0, y: 26, width: 1280, height: 690 };
const LIGHTMAP = '[data-blender="OBJECT_PT_bylonder_lightmap"]';
const BAKE = '[data-blender="CYCLES_RENDER_PT_bake_bylonder_lightmaps"]';
const SAMPLES = Number(process.env.BAKE_SAMPLES ?? 64);

await record("lightmaps", { example: "meditation", node: "Room" }, async (r) => {
  const { app } = r;
  const select = async (...names) => {
    await app.bylonder((b, names) => { b.editor.selection.replace(names.map((name) => b.world.scene.getNodeByName(name))); b.editor.reconcile(); }, names);
    await app.settled();
  };
  // Bake Lightmaps of the selected objects, waited for in the status bar; returns its seconds.
  const bake = async () => {
    const started = Date.now();
    await app.locator(BAKE).getByRole("button", { name: "Bake Lightmaps" }).click();
    await app.page.locator("#running-jobs .bl-job").waitFor();
    await app.page.locator("#running-jobs .bl-job").waitFor({ state: "detached", timeout: 4 * 3600000 });
    await app.settled();
    return (Date.now() - started) / 1000;
  };
  await app.hover();
  await r.keys("Numpad 0", "Numpad0");
  await app.locator('.bl-view3d-header [data-value="RENDERED"]').first().click();
  await app.settled();

  await r.gif("breathing", SIDE_BY_SIDE, async () => {
    await r.keys("Space", "Space");
    await r.pause(6000);
    await r.keys("Space", "Space");
  });
  // Back to frame 1, where meditation.py bakes: a bake is of the scene at the current frame.
  await r.keys("Shift Left", "Shift+ArrowLeft");

  await select("Room");
  await r.tab("Object");
  // Transform folded, so the Lightmap panel shows whole.
  await app.locator('[data-blender="OBJECT_PT_transform"]').locator("header").first().click();
  await app.locator(LIGHTMAP).locator("header").first().click();
  await app.locator(LIGHTMAP).first().scrollIntoViewIfNeeded();
  await app.settled();
  await r.shot("room-lightmap", SIDE_BY_SIDE);
  await select("Mannequin");
  await r.tab("Object");
  await app.locator(LIGHTMAP).first().scrollIntoViewIfNeeded();
  await r.shot("figure-lightmap", SIDE_BY_SIDE);

  await r.render("thumbnail", { width: 800 });

  await r.tab("Render");
  await app.locator('[data-blender="RENDER_PT_context"]').getByText("EEVEE", { exact: true }).first().click();
  await r.pause(600);
  await app.frame().getByText("Cycles", { exact: true }).last().click();
  await app.locator(BAKE).waitFor({ state: "attached", timeout: 120000 }).catch(async () => {
    await app.locator('[data-blender="CYCLES_RENDER_PT_bake"]').locator("header").first().click();
  });
  await app.locator(BAKE).getByRole("button", { name: "Bake Lightmaps" }).scrollIntoViewIfNeeded();
  await r.field(app.locator(BAKE), "Samples", SAMPLES);
  await r.shot("bake-panel", SIDE_BY_SIDE);
  await select("Room", "Turtle", "Cushion", "Bench", "Bowl", "Mannequin");
  // The GIF: the click and the bake's first seconds in the status bar.
  let baking;
  await r.gif("bake", undefined, async () => {
    baking = bake();
    await r.pause(8000);
  }, { hold: 0 });
  console.log(`Six lightmaps baked in ${(await baking).toFixed(0)} s at ${SAMPLES} samples`);
  await select("Room");
  await r.tab("Object");
  await app.locator(LIGHTMAP).first().scrollIntoViewIfNeeded();
  await r.shot("room-baked", SIDE_BY_SIDE);
  if (process.env.BAKE_OUT) {
    const bytes = await app.bylonder((b) => btoa(Array.from(b.world.mainSync.blender.writeBlend(), (c) => String.fromCharCode(c)).join("")));
    writeFileSync(process.env.BAKE_OUT, Buffer.from(bytes, "base64"));
  }
});
