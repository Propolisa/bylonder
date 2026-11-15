// Records docs/features/cycles.md's media on the Window Light example: the render engine set to Cycles, its samples,
// and Render Image rendered by Cycles in the Render Result window.
// usage: node tools/docs/record-cycles.mjs
import { ffmpeg } from "../media.mjs";
import { execFileSync } from "node:child_process";
import { rmSync, writeFileSync } from "node:fs";
import { record } from "./record.mjs";

const CONTEXT = '[data-blender="RENDER_PT_context"]';

await record("cycles", { example: "rendering", node: "Carafe" }, async (r) => {
  const { app, page } = r;
  await r.tab("Render");
  await app.bylonder((b) => b.world.renderSettings.set("render.blenderEngine", "CYCLES"));
  await app.until(() => /Cycles loaded|Cycles needs/.test(document.body.textContent), null, 120000);
  await app.settled();
  await r.shot("engine", CONTEXT);
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
