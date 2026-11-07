// Records the media of docs/features/texture-paint.md (the Texture Paint vase), uv-editing.md (the Tin Cans) and
// image-textures.md (the Framed Print): workspaces, strokes in the 3D Viewport and the Image Editor, Vertex Paint, a
// cylinder's unwrap, a UV island moved onto another label, Image > New, the Image Texture nodes, the image's Runtime
// panel, and each example rendered through its camera.
// usage: node tools/docs/record-texture-paint.mjs [texture-paint] [uv-editing] [image-textures]
import { recorder } from "./record.mjs";

const IMAGE = '#image-section', VIEW = '[data-section="viewport"]';
const NODES = '.dock-leaf:has(> .dock-heading > button.dock-editor-type[title*="Node Editor"])';
const SIZE = { width: 1600, height: 950 };
const only = process.argv.slice(2);

async function session(feature, options, steps) {
  if (only.length && !only.includes(feature)) return;
  const r = await recorder(feature, { size: SIZE, ...options });
  try {
    await steps(r);
  } catch (error) {
    await r.page.screenshot({ path: `${r.out}../record-${feature}-failed.png` }).catch(() => {});
    throw error;
  } finally {
    await r.close();
  }
}
// A point of a region at fractions of its box.
async function at(r, selector, fx, fy) {
  const box = await r.app.locator(selector).first().boundingBox();
  return [box.x + box.width * fx, box.y + box.height * fy];
}
async function workspace(r, name) {
  await r.page.locator(`[data-workspace="${name}"]`).click();
  await r.app.settled();
  await r.pause(1500);
}
async function frameSelected(r) {
  await r.app.page.mouse.move(...(await at(r, VIEW, 0.5, 0.5)));
  await r.keys("Numpad .", "NumpadDecimal");
  await r.pause(1000);
}
// The 3D Viewport through the scene camera in Rendered shading, overlays off, once its samples have refined.
async function rendered(r) {
  await r.app.hover();
  await r.keys("Numpad 0", "Numpad0");
  await r.app.bylonder((b) => { b.views.input.state.overlays = false; b.views.input.setShading("rendered"); });
  await r.pause(30000);
}
async function pickImage(r, name) {
  await r.app.locator(`${IMAGE} [data-blender="IMAGE_HT_header"] button[title*="Browse Image"], ${IMAGE} button[aria-label*="Browse Image"]`).first().click();
  await r.app.frame().getByRole("menuitem", { name, exact: true }).last().click();
  await r.app.settled();
}
const stroke = async (r, selector, from, to) => r.drag(await at(r, selector, ...from), await at(r, selector, ...to), { steps: 30 });

await session("texture-paint", { example: "texture-paint", node: "Vase" }, async (r) => {
  await workspace(r, "texture-paint");
  await frameSelected(r);
  await r.shot("workspace", undefined);
  // The brush takes the cobalt of a painted band (Shift X samples), then a stroke across the glaze.
  await r.app.page.mouse.move(...(await at(r, IMAGE, 0.5, 0.36)));
  await r.gif("paint-3d", VIEW, async () => {
    await r.app.page.mouse.move(...(await at(r, IMAGE, 0.3, 0.34)), { steps: 5 });
    await r.keys("Shift X", "Shift+x");
    await stroke(r, VIEW, [0.42, 0.52], [0.58, 0.47]);
  });
  await r.gif("paint-2d", undefined, () => stroke(r, IMAGE, [0.2, 0.55], [0.45, 0.5]));
  await r.outliner("Dish");
  await frameSelected(r);
  await r.gif("vertex-paint", VIEW, async () => {
    await r.app.frame().getByText("Texture Paint", { exact: true }).first().click().catch(() => r.app.frame().getByText("Object Mode", { exact: true }).first().click());
    await r.app.frame().getByRole("menuitem", { name: "Vertex Paint", exact: true }).last().click();
    await r.app.settled();
    await stroke(r, VIEW, [0.35, 0.5], [0.65, 0.45]);
  });
  await workspace(r, "layout");
  await r.keys("Ctrl Z", "Control+z");
  await r.keys("Ctrl Z", "Control+z");
  await rendered(r);
  await r.shot("render", ".viewport-canvas");
  await r.shot("thumbnail", ".viewport-canvas", { part: [0.12, 0, 0.88, 1], width: 960 });
});

await session("uv-editing", {}, async (r) => {
  await r.gif("unwrap", undefined, async () => {
    await r.app.click();
    await r.keys("X", "x");
    await r.app.frame().getByRole("menuitem", { name: "Delete" }).click();
    await r.app.hover();
    await r.keys("Shift A", "Shift+A");
    await r.app.frame().getByRole("menuitem", { name: "Mesh", exact: true }).hover();
    await r.app.frame().getByRole("menuitem", { name: "Cylinder", exact: true }).click();
    await r.app.settled();
    await workspace(r, "uv-editing");
    await r.app.page.mouse.move(...(await at(r, VIEW, 0.6, 0.5)));
    await r.keys("A", "a");
    await r.keys("U", "u");
    await r.app.frame().getByRole("menuitem", { name: "Cylinder Projection", exact: true }).last().click();
    await r.app.settled();
  });
});

await session("uv-editing", { example: "tin-cans", node: "Tomato" }, async (r) => {
  await workspace(r, "uv-editing");
  await frameSelected(r);
  await pickImage(r, "Can Labels").catch(() => {});
  await r.app.page.mouse.move(...(await at(r, IMAGE, 0.5, 0.5)));
  await r.keys("Home");
  await r.shot("workspace", undefined);
  await r.shot("thumbnail", IMAGE, { part: [0.04, 0.06, 0.96, 0.96] });
  // The side's island picked with L and moved a label down the atlas: the can wears the next label.
  await r.gif("select-move", undefined, async () => {
    const [x, y] = await at(r, IMAGE, 0.5, 0.2);
    await r.app.page.mouse.move(x, y, { steps: 8 });
    await r.keys("Alt A", "Alt+a");
    await r.keys("L", "l");
    await r.keys("G Y -0.25 Enter", "g", "y", "-", "0", ".", "2", "5", "Enter");
    await r.app.settled();
  }, { hold: 2000 });
  await workspace(r, "layout");
  await rendered(r);
  await r.shot("render", ".viewport-canvas");
});

await session("image-textures", { example: "framed-print", node: "Print" }, async (r) => {
  await workspace(r, "texture-paint");
  await r.app.page.mouse.move(...(await at(r, IMAGE, 0.5, 0.5)));
  await r.keys("Home");
  await r.shot("image-editor", IMAGE);
  await r.gif("new-image", IMAGE, async () => {
    await r.menu("IMAGE_MT_image");
    await r.app.frame().getByRole("menuitem", { name: /^New/ }).last().click();
    await r.app.settled();
    await r.app.frame().getByRole("button", { name: "OK" }).last().click();
    await r.app.settled();
  });
  await r.keys("Ctrl Z", "Control+z");
  await workspace(r, "uv-editing");
  await r.app.locator(`${IMAGE} .bl-region-tab`).filter({ hasText: /^Image$/ }).click();
  await r.app.settled();
  await r.shot("runtime", IMAGE, { part: [0.55, 0, 1, 0.5] });
  await workspace(r, "shading");
  await r.outliner("Print");
  await r.pause(1500);
  await r.page.mouse.move(...(await at(r, NODES, 0.5, 0.5)));
  await r.keys("Home");
  await r.shot("image-node", NODES);
  await workspace(r, "layout");
  await rendered(r);
  await r.shot("render", ".viewport-canvas");
  await r.shot("thumbnail", ".viewport-canvas", { part: [0.12, 0, 0.88, 1], width: 960 });
});
