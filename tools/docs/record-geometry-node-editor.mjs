// Records docs/features/geometry-node-editor.md's media: the Geometry Node Editor on the Hair Dynamics example's
// Generate Hair Curves group, navigating it, muting a node and changing a value.
// usage: node tools/docs/record-geometry-node-editor.mjs
import { record } from "./record.mjs";

const EDITOR = '.dock-leaf:has(> .dock-heading > button.dock-editor-type[title*="Node Editor"])';

await record("geometry-node-editor", { example: "hair-dynamics", node: "Hair" }, async (r) => {
  const { app, page } = r;
  await page.click('[data-workspace="shading"]');
  await app.settled();
  await r.gif("open", undefined, async () => {
    await r.menu(app.locator(`${EDITOR} button.dock-editor-type`), "Geometry Node Editor");
    await app.locator("[data-node]").first().waitFor();
    await app.locator(".bl-node-editor").hover();
    await r.keys("Home");
  });
  const header = async (idname) => {
    const box = await app.locator(`[data-node="${idname}"]`).first().boundingBox();
    return [box.x + box.width / 2, box.y + 6];
  };
  await r.gif("zoom", EDITOR, async () => {
    const at = await header("GeometryNodeDistributePointsOnFaces");
    await page.mouse.move(...at, { steps: 8 });
    for (let i = 0; i < 6; i++) {
      await page.mouse.wheel(0, -120);
      await r.pause(150);
    }
    await app.settled();
  });
  await r.gif("mute", EDITOR, async () => {
    const at = await header("GeometryNodeDistributePointsOnFaces");
    await page.mouse.move(...at, { steps: 8 });
    await page.mouse.click(...at);
    await app.settled();
    await r.keys("M");
    await r.pause(2000);
    await r.keys("M");
  });
  await r.gif("add-node", EDITOR, async () => {
    const box = await app.locator(".bl-node-editor").boundingBox();
    const at = [box.x + box.width * 0.5, box.y + box.height * 0.85];
    await page.mouse.move(...at, { steps: 8 });
    await r.keys("Shift A", "Shift+A");
    await app.locator(".bl-menu").waitFor();
    await page.keyboard.type("Math", { delay: 80 });
    await r.pause(500);
    await page.keyboard.press("Enter");
    await app.settled();
    await page.mouse.move(at[0] + 30, at[1] - 10, { steps: 6 });
    await page.mouse.click(at[0] + 30, at[1] - 10);
    await app.settled();
  });
  await r.shot("thumbnail", EDITOR);
});
