// Records docs/features/hdri.md's media on the Window Light example: its room rendered by Cycles through a panoramic
// camera, saved as Radiance HDR from the Render Result window.
// usage: node tools/docs/record-hdri.mjs
import { execFileSync } from "node:child_process";
import { rmSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { ffmpeg } from "../media.mjs";
import { record } from "./record.mjs";

const RENDER_CONTEXT = '[data-blender="RENDER_PT_context"]', LENS = '[data-blender="DATA_PT_lens"]';
const OUTPUT = '[data-blender="RENDER_PT_output"]';

await record("hdri", { example: "rendering", node: "Camera" }, async (r) => {
  const { app, page } = r;
  // An enum property's menu in `panel`: its button showing `from`, then the item `to`.
  const pick = async (panel, from, to) => {
    await app.locator(panel).getByText(from, { exact: true }).first().click();
    await r.pause(400);
    await app.frame().getByText(to, { exact: true }).last().click();
    await app.settled();
  };

  await r.tab("Render");
  await pick(RENDER_CONTEXT, "EEVEE", "Cycles");
  // Cycles is fetched and started (render/cycles.js).
  await app.locator('[data-blender="CYCLES_RENDER_PT_sampling"]').waitFor({ timeout: 120000 });

  await r.outliner("Camera");
  // A panoramic camera and an output twice as wide as high, saved as Radiance HDR; a few samples keep it short.
  await app.bylonder((b) => {
    const scene = b.modules.bpyRna.blendData().scenes[0];
    Object.assign(scene.camera.data, { type: "PANO", panorama_type: "EQUIRECTANGULAR" });
    Object.assign(scene.render, { resolution_x: 1024, resolution_y: 512, resolution_percentage: 100 });
    scene.render.image_settings.file_format = "HDR";
    scene.cycles.samples = 32;
  });
  await app.settled();
  // Properties drawn again after the change.
  await r.tab("Output");
  await r.tab("Data");
  await r.shot("panoramic", LENS);
  await r.tab("Output");
  await r.shot("output", OUTPUT);
  await page.click('[data-blender="TOPBAR_MT_render"]');
  await r.gif("render", undefined, async () => {
    await page.getByRole("menuitem", { name: "Render Image" }).click();
    await app.until(() => /^(Finished|Render failed)/.test(document.querySelector(".render-result [data-status]")?.textContent ?? ""), null, 600000);
  });
  console.log("status:", await app.frame().locator(".render-result [data-status]").textContent());
  await r.shot("render-result", undefined);
  // The thumbnail: the panorama as the Render Result window shows it, 800 pixels wide.
  const png = await app.frame().evaluate(() => document.querySelector(".render-result canvas").toDataURL("image/png"));
  writeFileSync(`${r.out}render.png`, Buffer.from(png.split(",")[1], "base64"));
  execFileSync(ffmpeg, ["-y", "-loglevel", "error", "-i", `${r.out}render.png`, "-vf", "scale=800:-2:flags=lanczos", `${r.out}thumbnail.png`]);
  rmSync(`${r.out}render.png`);
  // Save As: Blender's image writer gives a Radiance HDR file.
  const downloading = page.waitForEvent("download");
  await app.frame().locator(".render-result [data-save]").click();
  const download = await downloading;
  console.log("saved:", download.suggestedFilename(), (await readFile(await download.path())).subarray(0, 10).toString("latin1"));
});