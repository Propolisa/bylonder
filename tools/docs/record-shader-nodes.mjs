// Records docs/features/shader-nodes.md's media: a sphere and its land and sea material built from the Default Cube
// through real input, then the Blue Planet example's node trees and its render through the camera.
// usage: node tools/docs/record-shader-nodes.mjs
import { record } from "./record.mjs";

const SIZE = { width: 1600, height: 950 };
const EDITOR = '.dock-leaf:has(> .dock-heading > button.dock-editor-type[title*="Node Editor"])';

// Shift A over the Node Editor, typed to search, Enter, and a click at fractions (fx, fy) of it places the node.
async function addNode(r, name, fx, fy) {
  const { app, page } = r;
  const box = await app.frame().locator(".bl-node-editor").boundingBox();
  const at = [box.x + box.width * fx, box.y + box.height * fy];
  const count = await app.frame().locator("[data-node]").count();
  await page.mouse.move(...at, { steps: 6 });
  await r.keys("Shift A", "Shift+A");
  await app.frame().locator(".bl-menu").waitFor();
  await page.keyboard.type(name, { delay: 40 });
  await app.frame().locator(".bl-menu.searching").getByRole("menuitem", { name }).first().waitFor();
  await page.keyboard.press("Enter");
  await app.frame().locator("[data-node]").nth(count).waitFor();
  await app.settled();
  await page.mouse.move(at[0] + 4, at[1] + 4);
  await page.mouse.click(at[0] + 4, at[1] + 4);
  await app.settled();
}
// A drag from one node's output socket to another's input.
async function link(r, from, output, to, input) {
  const socket = (node, side, id) => node.locator(`[data-socket="${side}:${id}"]`).first().boundingBox();
  const a = await socket(from, "out", output), b = await socket(to, "in", input);
  await r.drag([a.x + a.width / 2, a.y + a.height / 2], [b.x + b.width / 2, b.y + b.height / 2], { steps: 12 });
}
const workspace = async (r, name) => {
  await r.page.locator(`[data-workspace="${name}"]`).click();
  await r.app.settled();
  await r.pause(1500);
};

await record("shader-nodes", { size: SIZE }, async (r) => {
  const { app } = r;
  await r.gif("sphere", '[data-section="viewport"]', async () => {
    await app.click();
    await r.keys("X", "x");
    await app.frame().getByRole("menuitem", { name: "Delete" }).click();
    await app.hover();
    await r.keys("Shift A", "Shift+A");
    await app.frame().getByRole("menuitem", { name: "Mesh", exact: true }).hover();
    await app.frame().getByRole("menuitem", { name: "UV Sphere" }).click();
    await app.until((b) => b.world.scene.getMeshByName("Sphere"));
    await app.hover();
    await app.page.mouse.click(...(await app.point()), { button: "right" });
    await app.frame().getByRole("menuitem", { name: "Shade Smooth" }).first().click();
    await app.settled();
  });
  await workspace(r, "shading");
  await r.gif("land-and-sea", undefined, async () => {
    await app.frame().getByRole("button", { name: "New Material" }).click();
    const nodes = (idname) => app.frame().locator(`[data-node="${idname}"]`);
    await nodes("ShaderNodeOutputMaterial").waitFor();
    await addNode(r, "Texture Coordinate", 0.03, 0.2);
    await addNode(r, "Noise Texture", 0.15, 0.1);
    await addNode(r, "Color Ramp", 0.28, 0.1);
    await link(r, nodes("ShaderNodeTexCoord"), "Object", nodes("ShaderNodeTexNoise"), "Vector");
    await link(r, nodes("ShaderNodeTexNoise"), "Fac", nodes("ShaderNodeValToRGB"), "Fac");
    await link(r, nodes("ShaderNodeValToRGB"), "Color", nodes("ShaderNodeBsdfPrincipled"), "Base Color");
    // The ramp's black stop a deep sea blue, its white one a land green, close together for a coastline.
    const ramp = nodes("ShaderNodeValToRGB"), band = await ramp.getByLabel("Color ramp").boundingBox();
    await app.page.mouse.click(band.x + 3, band.y + band.height / 2);
    await ramp.locator('input[type="color"]').fill("#08204a");
    await ramp.getByRole("button", { name: /^Pos/ }).click();
    await ramp.locator("input:not([type])").fill("0.5");
    await app.page.keyboard.press("Enter");
    await app.page.mouse.click(band.x + band.width - 3, band.y + band.height / 2);
    await ramp.locator('input[type="color"]').fill("#3d5a1a");
    await ramp.getByRole("button", { name: /^Pos/ }).click();
    await ramp.locator("input:not([type])").fill("0.53");
    await app.page.keyboard.press("Enter");
    await app.settled();
  }, { hold: 2500 });
});

await record("shader-nodes", { example: "blue-planet", node: "Planet", size: SIZE }, async (r) => {
  const { app } = r;
  await workspace(r, "shading");
  await app.until((b) => b.world.scene.materials.every((m) => !m._buildIsInProgress), null, 120000);
  await r.app.frame().locator(`${EDITOR} [data-node]`).first().waitFor();
  await app.hover(0.5, 0.5);
  await r.pause(1000);
  await r.page.mouse.move(...(await r.box(EDITOR).then((b) => [b.x + b.width / 2, b.y + b.height / 2])));
  await r.keys("Home");
  await r.shot("planet-tree", EDITOR);
  await r.outliner("Moon");
  await r.page.mouse.move(...(await r.box(EDITOR).then((b) => [b.x + b.width / 2, b.y + b.height / 2])));
  await r.keys("Home");
  await r.shot("moon-tree", EDITOR);
  await workspace(r, "layout");
  await app.hover();
  await r.keys("Numpad 0", "Numpad0");
  await app.bylonder((b) => { b.views.input.state.overlays = false; b.views.input.setShading("rendered"); });
  await r.pause(30000);
  await r.shot("render", ".viewport-canvas");
  await r.shot("thumbnail", ".viewport-canvas", { part: [0.12, 0, 0.88, 1], width: 960 });
});
