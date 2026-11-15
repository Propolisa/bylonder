// Records docs/features/cycles.md's media on the Window Light example: the render engine set to Cycles and Render Image
// rendered by Cycles in the Render Result window.
// usage: node tools/docs/record-cycles.mjs
import { ffmpeg } from "../media.mjs";
import { execFileSync } from "node:child_process";
import { rmSync, writeFileSync } from "node:fs";
import { record } from "./record.mjs";

const CONTEXT = '[data-blender="RENDER_PT_context"]';

await record("cycles", { example: "rendering", node: "Carafe" }, async (r) => {
  const { app, page } = r;
  await r.tab("Render");
  // A quarter of the output's resolution, so the recording's render takes seconds.
  await app.bylonder((b) => { b.world.renderSettings.set("render.resolutionPercentage", 25); b.world.renderSettings.set("render.blenderEngine", "CYCLES"); });
  // Cycles is fetched and started (render/cycles.js).
  await r.pause(20000);
  console.log("engine set");
  await r.shot("engine", CONTEXT);
  await page.click('[data-blender="TOPBAR_MT_render"]');
  await r.gif("render-image", undefined, async () => {
    await page.getByRole("menuitem", { name: "Render Image" }).click();
    await app.until(() => /^(Finished|Render failed)/.test(document.querySelector(".render-result [data-status]")?.textContent ?? ""), null, 600000);
  });
  console.log("rendered");
  await r.shot("render-result", undefined);
  // The thumbnail: the render at its own size, scaled to 800 pixels wide.
  const png = await app.frame().evaluate(() => document.querySelector(".render-result canvas").toDataURL("image/png"));
  writeFileSync(`${r.out}render.png`, Buffer.from(png.split(",")[1], "base64"));
  execFileSync(ffmpeg, ["-y", "-loglevel", "error", "-i", `${r.out}render.png`, "-vf", "scale=800:-2:flags=lanczos", `${r.out}thumbnail.png`]);
  rmSync(`${r.out}render.png`);
});
