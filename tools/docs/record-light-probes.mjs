// Records docs/features/light-probes.md's media on the Reading Corner example: Rendered shading through the camera
// before any bake, the Irradiance Volume's settings, Bake Light Cache and the room filling with bounced light, the
// Sphere probe's reflection in the vase, Delete Light Cache, and Render Image.
// usage: node tools/docs/record-light-probes.mjs
import { ffmpeg } from "../media.mjs";
import { execFileSync } from "node:child_process";
import { rmSync, writeFileSync } from "node:fs";
import { record } from "./record.mjs";

const BAKE = '[data-blender="DATA_PT_lightprobe_bake"]';
// The 3D Viewport and the Properties editor beside it.
const SIDE_BY_SIDE = { x: 0, y: 26, width: 1280, height: 690 };

await record("light-probes", { example: "light-probes", node: "Room Volume" }, async (r) => {
  const { app } = r;
  const select = async (name) => {
    await app.bylonder((b, name) => { b.editor.selection.replace([b.world.scene.getNodeByName(name)]); b.editor.reconcile(); }, name);
    await app.settled();
  };
  await r.drag([1052, 450], [900, 450]);
  await app.hover();
  await r.keys("Numpad 0", "Numpad0");

  await r.gif("shading", SIDE_BY_SIDE, async () => {
    await app.locator('.bl-view3d-header [data-value="SOLID"]').first().click();
    await r.pause(800);
    await app.locator('.bl-view3d-header [data-value="RENDERED"]').first().click();
    await app.settled();
    await r.pause(2500);
  });

  await select("Room Volume");
  await r.tab("Data");
  await r.shot("volume", SIDE_BY_SIDE);
  await r.gif("bake", SIDE_BY_SIDE, async () => {
    await app.locator(BAKE).getByText("Bake Light Cache").first().click();
    await app.settled();
    await r.pause(2500);
  });

  await select("Corner Sphere");
  await r.tab("Data");
  await r.shot("sphere", SIDE_BY_SIDE);

  await select("Room Volume");
  await r.tab("Data");
  await r.gif("delete", SIDE_BY_SIDE, async () => {
    await app.locator(BAKE).locator('[data-icon="TRASH"], button[title*="Delete"]').first().click();
    await app.settled();
    await r.pause(1500);
    await app.locator(BAKE).getByText("Bake Light Cache").first().click();
    await app.settled();
    await r.pause(1500);
  });

  await r.page.click('[data-blender="TOPBAR_MT_render"]');
  await r.page.getByRole("menuitem", { name: "Render Image" }).click();
  await app.until(() => /^(Finished|Render failed)/.test(document.querySelector(".render-result [data-status]")?.textContent ?? ""), null, 600000);
  await r.shot("render-image", undefined);
  const png = await app.frame().evaluate(() => document.querySelector(".render-result canvas").toDataURL("image/png"));
  writeFileSync(`${r.out}render.png`, Buffer.from(png.split(",")[1], "base64"));
  execFileSync(ffmpeg, ["-y", "-loglevel", "error", "-i", `${r.out}render.png`, "-vf", "scale=800:-2:flags=lanczos", `${r.out}thumbnail.png`]);
  rmSync(`${r.out}render.png`);
});
