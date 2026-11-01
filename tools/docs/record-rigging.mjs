// Records docs/features/rigging.md's media: Pose Mode, selecting and rotating bones, keying the pose, bone collections,
// a bone constraint and Weight Paint on the Rigged Character example.   usage: node tools/docs/record-rigging.mjs
import { record } from "./record.mjs";

const VIEW = '[data-section="viewport"]', PROPERTIES = '[data-section="properties"]';
// The middle of the 3D Viewport, where the figure stands.
const FIGURE = { part: [0.3, 0.15, 0.7, 0.75] };

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
  await r.pause(1000);
  for (let i = 0; i < 3; i++) await page.mouse.wheel(0, -120);
  await app.settled();

  await r.gif("pose-mode", VIEW, () => r.keys("Ctrl Tab", "Control+Tab"), FIGURE);
  await r.gif("select", VIEW, async () => {
    await clickBone("forearm.L");
    await r.pause(400);
    await clickBone("upper_arm.L", ["Shift"]);
  }, FIGURE);
  await r.gif("select-box", VIEW, async () => {
    const [shin, thigh] = [await r.boneAt("Rig", "shin.L"), await r.boneAt("Rig", "thigh.L", 0)];
    await r.drag([Math.min(shin[0], thigh[0]) - 25, thigh[1] - 15], [Math.max(shin[0], thigh[0]) + 25, shin[1] + 30]);
    await app.settled();
    await r.pause(400);
    await page.mouse.move(...(await r.boneAt("Rig", "forearm.R")), { steps: 8 });
    await r.keys("L", "l");
  }, FIGURE);
  await clickBone("upper_arm.L");
  await r.gif("rotate", VIEW, async () => {
    await r.keys("R");
    for (const key of ["4", "5"]) await r.keys(key);
    await r.keys("Enter");
  }, FIGURE);
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
  await r.gif("weight-paint", VIEW, async () => {
    await app.hover();
    await r.keys("Ctrl Tab", "Control+Tab");
    await app.bylonder((b) => { const find = (name) => b.world.objects.find((n) => n.name === name); b.editor.selection.replace([find("Rig"), find("Body")]); });
    await app.settled();
    await app.bylonder((b) => b.runOperator("object.mode_set", { mode: "WEIGHT_PAINT" }));
    await app.settled();
    await r.pause(400);
    const chest = await r.boneAt("Rig", "chest");
    await page.keyboard.down("Alt");
    await clickBone("chest");
    await page.keyboard.up("Alt");
    await r.pause(400);
    await r.drag([chest[0] - 40, chest[1] + 10], [chest[0] + 40, chest[1] + 10]);
    await app.settled();
  }, FIGURE);
});
