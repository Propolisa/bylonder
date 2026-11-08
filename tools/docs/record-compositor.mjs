// Records docs/features/compositor.md's media: a compositing node group made from the Default Cube through real input
// (New, then a Color Balance between Render Layers and the Group Output, shown on the backdrop), then the Neon Night
// example's tree and its Render Image, with Glare muted and not.
// usage: node tools/docs/record-compositor.mjs [steps] [example]
import { ffmpeg } from "../media.mjs";
import { execFileSync } from "node:child_process";
import { rmSync, writeFileSync } from "node:fs";
import { record } from "./record.mjs";

const SIZE = { width: 1600, height: 950 };
const only = process.argv.slice(2), wanted = (part) => !only.length || only.includes(part);
const EDITOR = ".bl-node-editor:visible", AREA = '.dock-content[data-section="nodes"]';

const workspace = async (r, name) => {
  await r.page.click(`[data-workspace="${name}"]`);
  if (name === "compositing") await r.app.locator(AREA).waitFor();
  await r.app.settled();
  await r.pause(1500);
};
const nodes = (r, idname) => r.app.frame().locator(`${EDITOR} [data-node="${idname}"]`);
const center = (b) => [b.x + b.width / 2, b.y + b.height / 2];
// Home over the Node Editor frames its nodes.
const frameAll = async (r) => {
  await r.page.mouse.move(...center(await r.box(EDITOR)));
  await r.keys("Home");
  await r.pause(500);
};
// Render > Render Image, until the Render window shows the result; returns it as a PNG data URL.
async function renderImage(r) {
  const { app, page } = r;
  await page.click('[data-blender="TOPBAR_MT_render"]');
  await page.getByRole("menuitem", { name: "Render Image" }).click();
  await app.until(() => /^(Finished|Render failed)/.test(document.querySelector(".render-result [data-status]")?.textContent ?? ""), null, 600000);
  return app.frame().evaluate(() => document.querySelector(".render-result canvas").toDataURL("image/png"));
}
const savePng = (r, name, url) => writeFileSync(`${r.out}${name}.png`, Buffer.from(url.split(",")[1], "base64"));
const ffmpegRun = (...args) => execFileSync(ffmpeg, ["-y", "-loglevel", "error", ...args]);

if (wanted("steps")) await record("compositor", { size: SIZE }, async (r) => {
  const { app, page } = r;
  await workspace(r, "compositing");
  // New: Blender's new compositing node group, Render Layers into the Group Output, the render on the backdrop.
  await r.gif("new", AREA, async () => {
    await app.locator(AREA).getByRole("button", { name: "New" }).first().click();
    await nodes(r, "CompositorNodeRLayers").waitFor();
    await app.settled();
    await frameAll(r);
  }, { hold: 2000, part: [0.22, 0, 0.78, 1] });
  // Shift A > Color Balance, linked between Render Layers and the Group Output, then its Gain raised.
  await r.gif("color-balance", AREA, async () => {
    const editor = await r.box(EDITOR);
    const at = [editor.x + editor.width * 0.5, editor.y + editor.height * 0.3];
    await page.mouse.move(...at, { steps: 6 });
    await r.keys("Shift A", "Shift+A");
    await app.frame().locator(".bl-menu").waitFor();
    await page.keyboard.type("Color Balance", { delay: 40 });
    await app.frame().locator(".bl-menu.searching").getByRole("menuitem", { name: "Color Balance" }).first().waitFor();
    await page.keyboard.press("Enter");
    await nodes(r, "CompositorNodeColorBalance").waitFor();
    await page.mouse.click(...at);
    await app.settled();
    const socket = (idname, side, id) => nodes(r, idname).locator(`[data-socket^="${side}:${id}"]`).first().boundingBox();
    await r.drag(center(await socket("CompositorNodeRLayers", "out", "Image")), center(await socket("CompositorNodeColorBalance", "in", "Image")), { steps: 12 });
    await r.drag(center(await socket("CompositorNodeColorBalance", "out", "Image")), center(await socket("NodeGroupOutput", "in", "")), { steps: 12 });
    await r.pause(800);
    await r.field(nodes(r, "CompositorNodeColorBalance"), "Gain", "1.8");
    await r.pause(1500);
  }, { hold: 2500, part: [0.22, 0, 0.78, 1] });
});

if (wanted("example")) await record("compositor", { example: "compositor", node: "Menya Akari", size: SIZE }, async (r) => {
  const { app, page } = r;
  await workspace(r, "compositing");
  await nodes(r, "CompositorNodeGlare").waitFor();
  await frameAll(r);
  await page.mouse.move(5, 60);
  await r.shot("tree", EDITOR, { part: [0.27, 0, 0.73, 1] });
  // Render Image's result at the output size; then Glare muted (M) and rendered again, the two side by side.
  const composited = await renderImage(r);
  await app.locator(".render-result [data-close]").click();
  // A click on Glare's header selects it; M mutes it.
  const glare = await nodes(r, "CompositorNodeGlare").boundingBox();
  await page.mouse.click(glare.x + 40, glare.y + 6);
  await r.keys("M", "m");
  if (!(await app.bylonder((b) => b.world.compositor.group.nodes.get("Glare").mute))) throw Error("Glare is not muted");
  const muted = await renderImage(r);
  savePng(r, "render-image", composited);
  savePng(r, "muted", muted);
  ffmpegRun("-i", `${r.out}muted.png`, "-i", `${r.out}render-image.png`, "-filter_complex", "[0]scale=800:-2[a];[1]scale=800:-2[b];[a][b]hstack", `${r.out}glare.png`);
  ffmpegRun("-i", `${r.out}render-image.png`, "-vf", "scale=800:-2:flags=lanczos", `${r.out}thumbnail.png`);
  rmSync(`${r.out}muted.png`);
});