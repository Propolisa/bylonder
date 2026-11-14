// File > Export > JavaScript with Scope Selected Objects: the Compositor example's woman on her tea break, her rig and
// cup, loaded into a scene of the page's own as a .glb is: under "__root__", turned as glTF's root, with none of the
// scene's settings, and as copies each with its own controller.
import assert from 'node:assert/strict';
import { NullEngine, Scene, TransformNode } from '@babylonjs/core';
import { openExample } from './open-example.js';
import { writePackage } from './export-package.js';
import { exportModule } from '../src/io_scene_babylon/js-export.js';

const { world, node, sync } = openExample('compositor');
sync.view();
// Only her sip is sampled, as each frame costs Blender a share of a second: the cup rises from frame 150 to her lips by 172.
world.animation.time.configure({ frameStart: 150, frameEnd: 180 });
const selected = ['Tea Break', 'Tea Cup'].map(node);
const files = await exportModule(world, { scope: 'SELECTED', selected, target: 'WEBGL2', runtimes: { ARMATURE: { runtime: 'MAPPED', instances: {} } } });
const pkg = writePackage(files);
try {
  const { load, loadAssetContainer } = await import(pkg.url);
  assert.ok(files['scene.bylonder'], 'a scene.bylonder for SceneLoader');
  assert.doesNotMatch(files['scene.js'], /bylonder-blocks\.js|viewTransform/, 'no compositor or view transform');

  const scene = new Scene(new NullEngine());
  const girl = await load({ scene });
  const names = girl.entries.meshes.map((m) => m.name);
  assert.equal(names[0], '__root__');
  assert.deepEqual(names.filter((n) => !n.startsWith('__')).sort(), ['Tea Break', 'Tea Break Rig', 'Tea Cup'], 'the selection and the rig it hangs from');
  assert.equal(girl.entries.root.rotationQuaternion.y, 1, "glTF's half turn into a left-handed scene");
  // Her rig's skeleton, which clips and the page pose, and the skin of the bones she weights, which follows it.
  const rigOf = (blend) => blend.entries.skeletons.find((k) => !k.rigId), skinOf = (blend) => blend.entries.skeletons.find((k) => k.rigId);
  assert.ok(rigOf(girl) && skinOf(girl)?.rigId === rigOf(girl).id, `a rig skeleton and its skin: ${girl.entries.skeletons.map((k) => k.name)}`);
  assert.equal(girl.entries.meshes.find((m) => m.name === 'Tea Break').skeleton, skinOf(girl), 'the skin skins her');
  assert.equal(scene.lights.length, 0, "none of the scene's lights");
  assert.equal(scene.environmentTexture, null, "none of the scene's settings");

  // Her cup, parented to her hand's bone, hangs from the bone: where Blender places it as she sips, under a moved root too.
  const cup = (blend) => blend.entries.meshes.find((m) => m.name === 'Tea Cup');
  assert.equal(cup(girl).parent.name, 'LeftHand', 'the cup hangs from her hand');
  assert.equal(cup(girl).parent.getSkeleton(), rigOf(girl), "a bone of her rig's skeleton, which the page poses");
  girl.entries.root.position.set(3, 0, -2);
  for (const frame of [150, 180]) {
    sync.frameChanged(frame);
    girl.playhead.seek(frame);
    rigOf(girl).prepare(true);
    for (const mesh of girl.entries.meshes) mesh.computeWorldMatrix(true);
    const placed = cup(girl).getWorldMatrix().multiply(girl.entries.root.getWorldMatrix().clone().invert());
    assert.ok(placed.getTranslation().subtract(sync.worldMatrix(node('Tea Cup')).getTranslation()).length() < 1e-3, `the cup in her hand at frame ${frame}`);
  }
  girl.entries.root.position.set(0, 0, 0);

  // A copy in a container, and one hung from a node of the page's own: each its own objects and controller.
  const container = await loadAssetContainer(scene);
  assert.equal(scene.meshes.length, names.length, 'a container holds its copy out of the scene');
  const player = new TransformNode('player', scene), copy = await load({ scene, root: player });
  assert.equal(copy.entries.root.parent, player);
  assert.equal(copy.scene.animationGroups.length, 1, "a copy's controller sees its own animation alone");
  assert.notEqual(copy.scene.getNodeById('Tea Cup'), girl.scene.getNodeById('Tea Cup'));
  copy.playhead.seek(165);
  assert.equal(girl.playhead.frame !== 165, true, 'each copy has its own playhead');
  const before = scene.meshes.length;
  copy.dispose();
  assert.equal(scene.meshes.length, before - names.length, 'dispose removes the copy alone');
  // Copies of a container share its geometry and materials, with nodes, skeletons and a controller of their own.
  const twin = await container.instantiate(), body = (blend) => blend.entries.meshes.find((m) => m.name === 'Tea Break');
  assert.equal(body(twin).geometry, body(container.blend).geometry, 'shared geometry');
  assert.equal(body(twin).material, body(container.blend).material, 'shared material');
  assert.notEqual(body(twin).skeleton, body(container.blend).skeleton, 'a skeleton of its own');
  assert.equal(twin.scene.getMeshById('Tea Break'), body(twin));
  assert.equal(twin.entries.animationGroups.length, 1);
  assert.equal(cup(twin).parent, rigOf(twin).bones[cup(container.blend).parent.getIndex()], "a copy's cup hangs from its own hand");
  assert.equal(skinOf(twin).rigId, rigOf(twin).id, "and its skin follows its own rig");

  // Her cup alone: it hangs from her rig's hand, but nothing selected is skinned by the rig, so the page has no skeleton
  // to hang it from and plays where Blender places it instead.
  const cupFiles = await exportModule(world, { scope: 'SELECTED', selected: [node('Tea Cup')], target: 'WEBGL2', runtimes: { ARMATURE: { runtime: 'MAPPED', instances: {} } } });
  const cupPkg = writePackage(cupFiles);
  try {
    const alone = await (await import(cupPkg.url)).load({ scene: new Scene(new NullEngine()) });
    assert.deepEqual(alone.entries.meshes.map((m) => m.name).filter((n) => !n.startsWith('__')).sort(), ['Tea Break Rig', 'Tea Cup'], 'the cup and the rig it hangs from');
    assert.equal(alone.entries.skeletons.length, 0, 'no skeleton without a mesh it skins');
    for (const frame of [150, 180]) {
      sync.frameChanged(frame);
      alone.playhead.seek(frame);
      for (const mesh of alone.entries.meshes) mesh.computeWorldMatrix(true);
      const placed = cup(alone).getWorldMatrix().multiply(alone.entries.root.getWorldMatrix().clone().invert());
      assert.ok(placed.getTranslation().subtract(sync.worldMatrix(node('Tea Cup')).getTranslation()).length() < 1e-3, `the cup alone where Blender places it at frame ${frame}`);
    }
  } finally {
    cupPkg.remove();
  }

  const mirrored = new Scene(new NullEngine());
  mirrored.useRightHandedSystem = true;
  assert.equal((await load({ scene: mirrored })).entries.root.scaling.z, -1, 'mirrored into a right-handed scene');
} finally {
  pkg.remove();
}
console.log("Export asset: Selected Objects load into a scene of the page's own under __root__, as copies with their own controllers");
process.exit(0);
