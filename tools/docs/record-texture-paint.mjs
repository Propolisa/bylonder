// Records the media of docs/features/texture-paint.md, uv-editing.md and image-textures.md on the Texture Paint example:
// the UV Editing and Texture Paint workspaces, Smart UV Project, moving a UV island, strokes in the 3D Viewport and the
// Image Editor, Vertex Paint, Image > New, the Image Texture node and the image's Runtime panel.
// usage: node tools/docs/record-texture-paint.mjs
import { tmpdir } from "node:os";
import { recorder } from "./record.mjs";

const IMAGE = '#image-section', VIEW = '[data-section="viewport"]';
const NODES = '.dock-leaf:has(> .dock-heading > button.dock-editor-type[title*="Node Editor"])';
const SIZE = { width: 1600, height: 950 };

async function session(feature, steps) {
  const r = await recorder(feature, { example: "texture-paint", node: "Suzanne", size: SIZE });
  try {
    await steps(r);
  } catch (error) {
    await r.page.screenshot({ path: `${tmpdir()}/record-${feature}.png` }).catch(() => {});
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
// Suzanne framed in the 3D Viewport (View > Frame Selected).
async function frameSuzanne(r) {
  await r.app.page.mouse.move(...(await at(r, VIEW, 0.5, 0.5)));
  await r.keys("Numpad .", "NumpadDecimal");
  await r.pause(1000);
}
// A click on an Outliner row's name.
async function clickRow(r, name) {
  const row = await r.app.locator("svg.bl-outliner-region text").filter({ hasText: new RegExp(`^${name}$`) }).first().boundingBox();
  await r.page.mouse.click(row.x + row.width / 2, row.y + row.height / 2);
  await r.app.settled();
}
const stroke = async (r, selector, from, to) => r.drag(await at(r, selector, ...from), await at(r, selector, ...to), { steps: 30 });

await session("uv-editing", async (r) => {
  await workspace(r, "uv-editing");
  await frameSuzanne(r);
  await r.shot("workspace", undefined);
  await r.shot("thumbnail", IMAGE);
  await r.gif("unwrap", undefined, async () => {
    await r.app.page.mouse.move(...(await at(r, VIEW, 0.6, 0.5)));
    await r.keys("U", "u");
    await r.app.frame().getByRole("menuitem", { name: "Smart UV Project...", exact: true }).last().click();
    await r.app.settled();
    await r.keys("Enter");
    await r.app.settled();
  });
  await r.gif("select-move", IMAGE, async () => {
    const [x, y] = await at(r, IMAGE, 0.45, 0.55);
    await r.app.page.mouse.move(x, y, { steps: 8 });
    await r.keys("Alt A", "Alt+a");
    await r.keys("L", "l");
    await r.keys("G", "g");
    await r.app.page.mouse.move(x + 80, y + 40, { steps: 15 });
    await r.app.page.mouse.click(x + 80, y + 40);
    await r.app.settled();
  });
});

await session("texture-paint", async (r) => {
  await workspace(r, "texture-paint");
  await frameSuzanne(r);
  await r.shot("workspace", undefined);
  await r.gif("paint-3d", VIEW, () => stroke(r, VIEW, [0.4, 0.4], [0.62, 0.5]));
  await r.shot("thumbnail", VIEW, { part: [0.15, 0.2, 0.85, 0.85] });
  await r.gif("paint-2d", { x: 0, y: 0, width: 1312, height: 930 }, () => stroke(r, IMAGE, [0.15, 0.7], [0.5, 0.35]));
  await clickRow(r, "Sphere");
  await r.app.page.mouse.move(...(await at(r, VIEW, 0.5, 0.5)));
  await r.keys("Numpad .", "NumpadDecimal");
  await r.pause(800);
  await r.gif("vertex-paint", VIEW, async () => {
    await r.app.frame().getByText("Object Mode", { exact: true }).first().click();
    await r.app.frame().getByRole("menuitem", { name: "Vertex Paint", exact: true }).last().click();
    await r.app.settled();
    await stroke(r, VIEW, [0.35, 0.35], [0.6, 0.6]);
  });
});

await session("image-textures", async (r) => {
  await workspace(r, "texture-paint");
  await r.shot("image-editor", IMAGE);
  await r.gif("new-image", IMAGE, async () => {
    await r.menu("IMAGE_MT_image");
    await r.app.frame().getByRole("menuitem", { name: /^New/ }).last().click();
    await r.app.settled();
    await r.app.frame().getByRole("button", { name: "OK" }).last().click();
    await r.app.settled();
  });
  await workspace(r, "uv-editing");
  await r.app.locator(`${IMAGE} .bl-region-tab`).filter({ hasText: /^Image$/ }).click();
  await r.app.settled();
  await r.shot("runtime", IMAGE, { part: [0.55, 0, 1, 0.5] });
  await workspace(r, "shading");
  await clickRow(r, "Suzanne");
  await r.pause(1500);
  await r.shot("image-node", NODES);
  await r.shot("thumbnail", VIEW, { part: [0.2, 0.15, 0.8, 0.85] });
});
