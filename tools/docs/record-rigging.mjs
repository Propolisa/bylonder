// Records docs/features/rigging.md's media: a rig built and skinned from the Default Cube scene, then on the Desk Lamp
// example Pose Mode, selecting and rotating bones, keying the pose, bone collections, a bone constraint, the pose
// library, Weight Paint, and the lamp's light following its Head bone in Rendered shading.
// usage: node tools/docs/record-rigging.mjs
import { record } from "./record.mjs";
import { rendered } from "./scene-view.mjs";

const SCENE = { part: [0.08, 0.06, 0.92, 0.94] };
const VIEW = '[data-section="viewport"]', PROPERTIES = '[data-section="properties"]';
// The middle of the 3D Viewport, where the lamp stands once View Selected framed it.
const FIGURE = { part: [0.2, 0.05, 0.8, 0.95] };

await record("rigging", { example: "cube", node: "Cube" }, async (r) => {
  const { app } = r;
  const pick = async (...labels) => {
    for (const label of labels) await app.frame().getByRole("menuitem", { name: new RegExp(`^${label}`) }).last().click();
    await app.settled();
  };
  const type = async (...keys) => { for (const key of keys) await r.keys(key, key.toLowerCase()); };
  await r.gif("build", undefined, async () => {
    await app.hover();
    await r.keys("Delete");
    await r.keys("Shift A", "Shift+a");
    await pick("Armature");
    await r.keys("Tab");
    await type("E", "Z", "1");
    await r.keys("Enter");
    await type("E", "Z", "1");
    await r.keys("Enter");
    await r.keys("Tab");
  });
  await r.gif("skin", undefined, async () => {
    await app.hover();
    await r.keys("Shift A", "Shift+a");
    await pick("Mesh", "Cylinder");
    await type("S", ".", "3");
    await r.keys("Enter");
    await type("S", "Z", "5");
    await r.keys("Enter");
    await type("G", "Z", "1", ".", "5");
    await r.keys("Enter");
    await r.outliner("Armature", ["Control"]);
    await app.hover();
    await r.keys("Ctrl P", "Control+p");
    await pick("With Automatic Weights");
    await app.hover();
    await r.keys("Ctrl Tab", "Control+Tab");
    await r.keys("A", "a");
    await type("R", "X", "3", "0");
    await r.keys("Enter");
  });
});

await record("rigging", { example: "desk-lamp", node: "Rig" }, async (r) => {
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
  await r.keys("Numpad 3", "Numpad3");
  await r.keys("Numpad .", "NumpadDecimal");
  await r.pause(1000);

  await r.gif("pose-mode", VIEW, () => r.keys("Ctrl Tab", "Control+Tab"), FIGURE);
  await r.gif("select", VIEW, async () => {
    await clickBone("Upper Arm");
    await r.pause(400);
    await clickBone("Lower Arm", ["Shift"]);
  }, FIGURE);
  await r.gif("select-box", VIEW, async () => {
    const [upper, head] = [await r.boneAt("Rig", "Upper Arm"), await r.boneAt("Rig", "Head")];
    await r.drag([Math.min(upper[0], head[0]) - 30, Math.min(upper[1], head[1]) - 30], [Math.max(upper[0], head[0]) + 30, Math.max(upper[1], head[1]) + 30]);
    await app.settled();
    await r.pause(400);
    await page.mouse.move(...(await r.boneAt("Rig", "Base")), { steps: 8 });
    await r.keys("L", "l");
  }, FIGURE);
  await clickBone("Upper Arm");
  await r.gif("rotate", VIEW, async () => {
    await r.keys("R");
    for (const key of ["4", "5"]) await r.keys(key);
    await r.keys("Enter");
  }, FIGURE);
  await r.gif("pose-library", VIEW, async () => {
    await app.hover();
    await r.keys("A", "a");
    await r.menu("VIEW3D_MT_pose", "Create Pose Asset...");
    const name = app.locator(`xpath=//*[normalize-space(text())="Pose Name"]/following::input[1]`).first();
    await name.fill("Wave");
    await name.press("Tab");
    await app.frame().getByRole("button", { name: "Create" }).last().click();
    await app.settled();
    await r.menu("VIEW3D_MT_view", "Asset Shelf");
    await r.pause(600);
    await app.hover();
    await r.keys("Alt R", "Alt+r");
    const tile = app.locator(".bl-grid-tile").first();
    await tile.click();
    await app.settled();
    await r.pause(600);
    await r.keys("Alt R", "Alt+r");
    const box = await tile.boundingBox(), from = [box.x + box.width / 2, box.y + box.height / 2];
    await r.drag(from, [from[0] + 60, from[1]]);
  });
  await r.menu("VIEW3D_MT_view", "Asset Shelf");
  await app.hover();
  await r.keys("Alt R", "Alt+r");
  await clickBone("Upper Arm");
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
  await r.gif("weight-paint", VIEW, async () => {
    await app.hover();
    await r.keys("Ctrl Tab", "Control+Tab");
    await app.bylonder((b) => { const find = (name) => b.world.objects.find((n) => n.name === name); b.editor.selection.replace([find("Rig"), find("Lamp")]); });
    await app.settled();
    await app.bylonder((b) => b.runOperator("object.mode_set", { mode: "WEIGHT_PAINT" }));
    await app.settled();
    await r.pause(400);
    const arm = await r.boneAt("Rig", "Lower Arm");
    await page.keyboard.down("Alt");
    await clickBone("Lower Arm");
    await page.keyboard.up("Alt");
    await r.pause(400);
    await r.drag([arm[0] - 40, arm[1] + 10], [arm[0] + 40, arm[1] + 10]);
    await app.settled();
  }, FIGURE);
});

await record("rigging", { example: "desk-lamp", node: "Rig" }, async (r) => {
  const { app, page } = r;
  await rendered(r);
  await r.shot("thumbnail", VIEW, SCENE);
  await r.gif("aim", VIEW, async () => {
    await app.hover();
    await r.keys("Ctrl Tab", "Control+Tab");
    const head = await r.boneAt("Rig", "Head");
    await page.mouse.click(...head);
    await app.settled();
    await app.hover();
    for (const key of ["R", "X", "-", "4", "0"]) await r.keys(key, key.toLowerCase());
    await r.keys("Enter");
    await r.pause(1500);
  }, SCENE);
});
