// Records docs/features/lightmaps.md's media on the Meditation example: the scene in Rendered shading through the camera,
// breathing; Object properties > Lightmap on the room and on the figure; the head's Noise modifier in the Graph Editor;
// and the thumbnail, a crop of Render Image.
// usage: node tools/docs/record-lightmaps.mjs
import { record } from "./record.mjs";

// The 3D Viewport and the Properties editor beside it.
const SIDE_BY_SIDE = { x: 0, y: 26, width: 1280, height: 690 };
const LIGHTMAP = '[data-blender="OBJECT_PT_bylonder_lightmap"]';

await record("lightmaps", { example: "meditation", node: "Room" }, async (r) => {
  const { app } = r;
  const select = async (name) => {
    await app.bylonder((b, name) => { b.editor.selection.replace([b.world.scene.getNodeByName(name)]); b.editor.reconcile(); }, name);
    await app.settled();
  };
  await app.hover();
  await r.keys("Numpad 0", "Numpad0");
  await app.locator('.bl-view3d-header [data-value="RENDERED"]').first().click();
  await app.settled();

  await r.gif("breathing", SIDE_BY_SIDE, async () => {
    await r.keys("Space", "Space");
    await r.pause(6000);
    await r.keys("Space", "Space");
  });

  await select("Room");
  await r.tab("Object");
  // Transform folded, so the Lightmap panel shows whole.
  await app.locator('[data-blender="OBJECT_PT_transform"]').locator("header").first().click();
  await app.locator(LIGHTMAP).locator("header").first().click();
  await app.locator(LIGHTMAP).first().scrollIntoViewIfNeeded();
  await app.settled();
  await r.shot("room-lightmap", SIDE_BY_SIDE);
  await select("Mannequin");
  await r.tab("Object");
  await app.locator(LIGHTMAP).first().scrollIntoViewIfNeeded();
  await r.shot("figure-lightmap", SIDE_BY_SIDE);

  await r.render("thumbnail", { width: 800 });
});
