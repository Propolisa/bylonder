// Records docs/features/rigging.md's media: Pose Mode, selecting and rotating bones, keying the pose, bone collections
// and a bone constraint on the Rigged Character example.   usage: node tools/docs/record-rigging.mjs
import { record } from "./record.mjs";

const VIEW = '[data-section="viewport"]', PROPERTIES = '[data-section="properties"]';

await record("rigging", { example: "rigged-character", node: "Rig" }, async (r) => {
  const { app, page } = r;
  const clickBone = async (bone, modifiers = []) => {
    const at = await r.boneAt("Rig", bone);
    await page.mouse.move(...at, { steps: 8 });
    for (const key of modifiers) await page.keyboard.down(key);
    await page.mouse.click(...at);
    for (const key of modifiers) await page.keyboard.up(key);
    await app.settled();
  };
  await app.hover();
  await r.keys("Numpad 1", "Numpad1");
  await r.keys("Numpad .", "NumpadDecimal");
  for (let i = 0; i < 3; i++) await page.mouse.wheel(0, -120);
  await app.settled();

  await r.gif("pose-mode", VIEW, () => r.keys("Ctrl Tab", "Control+Tab"));
  await r.gif("select", VIEW, async () => {
    await clickBone("forearm.L");
    await r.pause(400);
    await clickBone("upper_arm.L", ["Shift"]);
  });
  await r.gif("rotate", VIEW, async () => {
    await r.keys("R");
    for (const key of ["4", "5"]) await r.keys(key);
    await r.keys("Enter");
  });
  await r.gif("keyframe", undefined, async () => {
    await r.keys("Alt R", "Alt+r");
    await app.hover();
    await r.keys("I");
    await r.frame(40);
    await app.hover();
    await r.keys("R");
    for (const key of ["6", "0"]) await r.keys(key);
    await r.keys("Enter");
    await r.keys("I");
    await r.keys("Space");
    await r.pause(3000);
    await r.keys("Space");
  }, { part: [0, 0, 0.82, 1] });
  await r.tab("Data");
  await r.gif("bone-collections", PROPERTIES, async () => {
    const panel = app.locator('[data-blender="DATA_PT_bone_collections"]');
    await panel.locator('[data-blender="armature.collection_add"]').click();
    await app.settled();
    await r.pause(400);
    await panel.locator('[data-blender="armature.collection_assign"]').click();
    await app.settled();
  }, { part: [0, 0, 1, 0.55] });
  await r.tab("Bone Constraints");
  await r.gif("constraint", PROPERTIES, async () => {
    await r.menu(app.frame().getByRole("button", { name: "Add Bone Constraint" }), "Limit Rotation");
  }, { part: [0, 0, 1, 0.55] });
  const [x, y] = await r.boneAt("Rig", "spine");
  await r.shot("thumbnail", { x: x - 240, y: y - 220, width: 480, height: 400 });
});
