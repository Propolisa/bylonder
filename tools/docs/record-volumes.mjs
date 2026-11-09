// Records docs/features/volumes.md's media on the Temple Light example: Rendered shading through the camera, the dust's
// material and its Anisotropy, the sun turned and its Cast Shadow, the Volumes settings, the dust drifting as the frames
// play, and Render Image.
// usage: node tools/docs/record-volumes.mjs
import { ffmpeg } from "../media.mjs";
import { execFileSync } from "node:child_process";
import { rmSync, writeFileSync } from "node:fs";
import { record } from "./record.mjs";

const SHADOW = '[data-blender="DATA_PT_EEVEE_light_shadow"]', VOLUME = '[data-blender="EEVEE_MATERIAL_PT_volume"]';
// The 3D Viewport and the Properties editor beside it.
const SIDE_BY_SIDE = { x: 0, y: 26, width: 1280, height: 690 };

await record("volumes", { example: "volumes", node: "Dust" }, async (r) => {
  const { app, page } = r;
  const select = async (name) => {
    await app.bylonder((b, name) => { b.editor.selection.replace([b.world.scene.getNodeByName(name)]); b.editor.reconcile(); }, name);
    await app.settled();
  };
  // A number field dragged sideways by `dx` pixels.
  const drag = async (locator, dx) => {
    const box = await locator.first().boundingBox(), from = [box.x + box.width / 2, box.y + box.height / 2];
    await r.drag(from, [from[0] + dx, from[1]], { steps: 30 });
  };
  const spin = (panel, name) => app.locator(panel).locator(`xpath=.//*[normalize-space(text())="${name}"]/following::*[@role="spinbutton"][1]`).first();
  await r.drag([1052, 450], [900, 450]);
  await app.hover();
  await r.keys("Numpad 0", "Numpad0");

  await r.gif("shading", SIDE_BY_SIDE, async () => {
    await app.locator('.bl-view3d-header [data-value="SOLID"]').first().click();
    await r.pause(800);
    await app.locator('.bl-view3d-header [data-value="RENDERED"]').first().click();
    await app.settled();
    await r.pause(3000);
  });

  await select("Dust");
  await r.tab("Material");
  // The Volume panel opened (Blender keeps it closed for a new material).
  const volume = app.locator(VOLUME).first();
  if (!(await volume.locator('[role="spinbutton"]').count())) await volume.locator("text=Volume").first().click();
  await app.settled();
  await r.shot("dust", SIDE_BY_SIDE);
  // Anisotropy: forward scattering makes the shafts glow toward the sun, back scattering dims them.
  await r.gif("anisotropy", SIDE_BY_SIDE, async () => {
    await drag(spin(VOLUME, "Anisotropy"), -120);
    await r.pause(900);
    await drag(spin(VOLUME, "Anisotropy"), 120);
  });

  await select("Sun");
  await r.tab("Data");
  // The sun turned about Z (R Z and the mouse): the shafts swing across the hall. Ctrl Z turns it back.
  await r.gif("sun-rotate", SIDE_BY_SIDE, async () => {
    await app.hover(0.6, 0.5);
    await r.keys("R Z", "r", "z");
    const [x, y] = await app.point(0.6, 0.5);
    await page.mouse.move(x + 80, y, { steps: 25 });
    await page.mouse.move(x - 40, y, { steps: 25 });
    await page.mouse.click(x - 40, y);
    await app.settled();
    await r.pause(1200);
    await r.keys("Ctrl Z", "Control+z");
  });
  await r.gif("cast-shadow", SIDE_BY_SIDE, async () => {
    const toggle = app.locator(SHADOW).getByRole("checkbox").first();
    await toggle.click();
    await app.settled();
    await r.pause(1500);
    await toggle.click();
    await app.settled();
  });

  await r.tab("Render");
  await r.shot("settings", '[data-blender="RENDER_PT_eevee_volumes"]');
  // Bylonder's Volumes panel, lower in the Render tab.
  await app.locator('[data-blender="RENDER_PT_bylonder_volumes"]').first().scrollIntoViewIfNeeded();
  await r.shot("presets", '[data-blender="RENDER_PT_bylonder_volumes"]');
  await app.locator('[data-blender="RENDER_PT_eevee_volumes"]').first().scrollIntoViewIfNeeded();

  await r.gif("play", SIDE_BY_SIDE, async () => {
    await app.hover();
    await r.keys("Space", " ");
    await r.pause(4000);
    await r.keys("Space", " ");
  });

  await page.click('[data-blender="TOPBAR_MT_render"]');
  await page.getByRole("menuitem", { name: "Render Image" }).click();
  await app.until(() => /^(Finished|Render failed)/.test(document.querySelector(".render-result [data-status]")?.textContent ?? ""), null, 600000);
  await r.shot("render-image", undefined);
  // The thumbnail: the render at its own size, scaled to 800 pixels wide.
  const png = await app.frame().evaluate(() => document.querySelector(".render-result canvas").toDataURL("image/png"));
  writeFileSync(`${r.out}render.png`, Buffer.from(png.split(",")[1], "base64"));
  execFileSync(ffmpeg, ["-y", "-loglevel", "error", "-i", `${r.out}render.png`, "-vf", "scale=800:-2:flags=lanczos", `${r.out}thumbnail.png`]);
  rmSync(`${r.out}render.png`);
});
