// File > Export > JavaScript with Animations set to Clips or Both: an animation group per Blender action, named by it,
// normalized to start at 0 and not started, as Babylon's glTF loader gives a .glb's actions. The NLA example's Slide
// plays alone as Main evaluates Slide alone; its Hop strip (Add) is an additive clip adding Hop to what the box does, its
// Turn strip (Combine, half influence) an additive clip at weight 0.5; Both keeps the timeline's group, which leaves a
// clip's targets to it. An action's pose markers and the scene's markers are told by blend.onMarker as they are passed.
// The Desk Lamp's rig action is a skeleton clip whose bones pose the lamp as Main does, loaded as an asset too.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { FreeCamera, NullEngine, Scene, Vector3 } from '@babylonjs/core';
import { babylonMatrix } from '../src/blenkernel/main-view.js';
import { blendData } from '../src/python/bpy_rna.js';
import { sceneOf } from '../src/io_scene_babylon/controls-export.js';
import { withAction } from '../src/io_scene_babylon/clip-export.js';
import { exportModule } from '../src/io_scene_babylon/js-export.js';
import { openExample } from './open-example.js';
import { writePackage } from './export-package.js';

const near = (a, b, what) => a.forEach((v, i) => assert.ok(Math.abs(v - b[i]) < 1e-4, `${what}: ${v} is not ${b[i]} at ${i}`));
const groupsOf = (files) => JSON.parse(/const ANIMATION_GROUPS = (.*);\n/.exec(files['scene.js'])[1]);
// A clip held at a frame of its action, drawn.
function at(blend, name, frame) {
  const group = blend.clips().find((c) => c.name === name).group;
  group.pause();
  group.goToFrame(frame - group.metadata.bylonder.frame_start, true);
  blend.scene.render();
}
// Renders until `done` holds, at a constant step.
function run(scene, done, frames = 200) {
  scene.useConstantAnimationDeltaTime = true;
  for (let i = 0; i < frames && !done(); i++) scene.render();
}

async function nla() {
  const { world, sync } = openExample('nla');
  sync.view();
  const box = blendData().objects.get('Box'), hop = blendData().actions.get('Hop');
  sceneOf(sync).timeline_markers.new('Step', 10);
  hop.pose_markers.new('Peak').frame = 8;
  // Main with one action alone on the box at a frame: its world matrix, in Babylon's axes.
  const alone = (action, frame) => withAction([box], blendData().actions.get(action), () => {
    sync.frameChanged(frame);
    return babylonMatrix(sync.blender.transform(sync.objectOf(world.objects.find((n) => n.name === 'Box'))).matrix_world).asArray();
  });

  const files = await exportModule(world, { animations: 'CLIPS' });
  const groups = groupsOf(files), ir = JSON.parse(files['scene.ir.json']);
  assert.deepEqual(groups.map((g) => g.name).sort(), ['Hop', 'Slide', 'Turn'], 'a group per action, named by it, and no timeline group');
  for (const g of groups) assert.ok(g.from === 0 && g.loopAnimation && g.metadata.bylonder.clip, `${g.name}: normalized to start at 0, looping, marked a clip`);
  const byName = Object.fromEntries(groups.map((g) => [g.name, g]));
  assert.ok(byName.Hop.isAdditive && byName.Hop.weight === 1, 'Hop (an Add strip) is additive');
  assert.ok(byName.Turn.isAdditive && byName.Turn.weight === 0.5, 'Turn (Combine at half influence) is additive at weight 0.5');
  assert.ok(!byName.Slide.isAdditive && byName.Slide.weight === -1, 'Slide replaces');
  assert.deepEqual(ir.scene.time.clips.Hop, { action: 'Hop', frame_start: 1, frame_end: 16, blend: 'ADD', influence: 1, speed: 1, repeat: 3, markers: [{ name: 'Peak', frame: 8 }] });
  assert.deepEqual(ir.scene.time.markers, [{ name: 'Step', frame: 10 }]);

  const written = writePackage(files);
  const blend = await (await import(written.url)).load(new NullEngine()), page = blend.scene, pageBox = page.getMeshById('Box');
  assert.ok(blend.clips().every(({ group }) => !group.isStarted), 'clips wait to be played');
  assert.ok(!blend.playhead.playing, 'with clips alone, nothing plays on the timeline');
  assert.throws(() => blend.play('Run'), /No clip "Run": the scene's clips are "Slide", "Hop", "Turn"/);

  blend.play('Slide');
  for (const frame of [1, 30, 61, 96]) {
    at(blend, 'Slide', frame);
    near(pageBox.computeWorldMatrix(true).asArray(), alone('Slide', frame), `Slide at frame ${frame}`);
  }
  blend.stop('Slide');
  // Hop adds its height to where the box is.
  const y = pageBox.position.y;
  blend.play('Hop');
  for (const frame of [4, 8, 12]) {
    at(blend, 'Hop', frame);
    assert.ok(Math.abs(pageBox.position.y - (y + alone('Hop', frame)[13])) < 1e-4, `Hop at frame ${frame} adds its height (${pageBox.position.y} from ${y})`);
  }

  const told = [];
  blend.onMarker.add((m) => told.push(m));
  blend.play('Hop', { loop: false });
  run(page, () => !blend.clips().find((c) => c.name === 'Hop').group.isPlaying);
  assert.deepEqual(told, [{ name: 'Peak', frame: 8, clip: 'Hop' }], "Hop's pose marker is told as it plays past it, once when played once");
  told.length = 0;
  blend.playhead.seek(5);
  blend.playhead.play();
  run(page, () => blend.playhead.frame > 12);
  assert.deepEqual(told, [{ name: 'Step', frame: 10, clip: null }], "the scene's marker is told as the playhead passes it");
  blend.dispose();
  written.remove();

  // Both: the timeline's group too, held by the playhead; a clip playing takes the box from it.
  const both = groupsOf(await exportModule(world, { animations: 'BOTH' }));
  assert.equal(both.filter((g) => !g.metadata?.bylonder?.clip).length, 1, "the timeline's group");
  assert.equal(both.length, 4);
  const bothFiles = await exportModule(world, { animations: 'BOTH' }), bothPackage = writePackage(bothFiles);
  const second = await (await import(bothPackage.url)).load(new NullEngine()), timeline = second.scene.animationGroups.find((g) => !g.metadata?.bylonder?.clip);
  assert.ok(timeline.isStarted && second.clips().every(({ group }) => !group.isStarted), 'the timeline is held by the playhead, the clips wait');
  second.playhead.pause();
  second.play('Slide');
  at(second, 'Slide', 30);
  second.playhead.seek(60);
  second.scene.render();
  near(second.scene.getMeshById('Box').computeWorldMatrix(true).asArray().slice(12, 13), alone('Slide', 30).slice(12, 13), 'Slide sets the box, not the timeline');
  second.dispose();
  bothPackage.remove();
  console.log('Export clips (NLA): Slide, Hop and Turn as clips, Slide playing as Main, Hop adding, markers told, Both keeping the timeline');
}

async function deskLamp() {
  const { world, sync, node } = openExample('desk-lamp');
  sync.view();
  const lamp = node('Lamp');
  // Exact clips, which pose the lamp as Main does; tests/clip-compression.test.js checks the compressed ones' bounds. Its
  // skeleton has only the bones that skin (Deform Bones Only).
  const files = await exportModule(world, { animations: 'CLIPS', clipCompression: 'OFF', deformBonesOnly: true, scope: 'SELECTED', selected: [lamp], runtimes: { ARMATURE: { runtime: 'MAPPED', instances: {} } } });
  const groups = groupsOf(files);
  assert.deepEqual(groups.map((g) => g.name), ['RigAction']);
  const table = groups[0].bylonderTracks;
  assert.ok(table?.targets.length && table.property === '_matrix', "the rig's bones, in one table of scene.bin, not JSON");
  
  // Only bones that skin, or have bones that skin below them: the rig's constraints are sampled, not run in the page.
  const rig = [...blendData().objects].find((ob) => ob.type === 'ARMATURE'), skins = (bone) => bone.use_deform || [...bone.children].some(skins);
  const tracked = [...table.targets, ...groups[0].targetedAnimations.map((t) => t.targetId)].map((id) => id.slice(rig.name.length + 1).split('#')[0]);
  assert.ok(tracked.every((name) => skins(rig.data.bones.get(name))), `tracks of bones that skin: ${tracked.join(', ')}`);
  const written = writePackage(files);
  try {
    const { load, loadAssetContainer } = await import(written.url);
    const scene = new Scene(new NullEngine()), blend = await load({ scene });
    new FreeCamera('Eye', Vector3.Zero(), scene);
    assert.ok(scene.animationGroups.length === 1 && !scene.animationGroups[0].isStarted, "loaded into the page's scene, the clip waits");
    const mesh = blend.entries.meshes.find((m) => m.name === 'Lamp');
    assert.ok(mesh.skeleton.bones.every((b) => skins(rig.data.bones.get(b.name.split('#')[0]))), 'a skeleton of the bones that skin');
    // Main's corners of the lamp at a frame (Babylon's axes), and the page's, skinned on the CPU.
    const corners = (frame) => {
      sync.frameChanged(frame);
      const evaluated = sync.blender.evaluatedMesh(sync.objectOf(lamp)), p = evaluated.vert_positions, verts = evaluated.corner_verts;
      return Array.from({ length: evaluated.corners_num * 3 }, (_, i) => p[verts[Math.floor(i / 3)] * 3 + [0, 2, 1][i % 3]]);
    };
    assert.ok(mesh.metadata?.bylonderBounds, "the lamp's bounds over its clip's poses are exported");
    blend.play('RigAction');
    for (const frame of [1, 36, 49, 96]) {
      at(blend, 'RigAction', frame);
      const posed = [...mesh.getPositionData(true, true)];
      near(posed, corners(frame), `the lamp posed by RigAction at frame ${frame}`);
      // Its bounds hold every pose of its clips, so it is culled where it can be.
      const { minimum, maximum } = mesh.getBoundingInfo().boundingBox;
      for (let i = 0; i < posed.length; i += 3) assert.ok([0, 1, 2].every((k) => posed[i + k] >= minimum.asArray()[k] - 1e-4 && posed[i + k] <= maximum.asArray()[k] + 1e-4), `the lamp's bounds hold its pose at frame ${frame}`);
    }
    const container = await loadAssetContainer(scene), copy = await container.instantiate();
    const copied = copy.clips()[0].group;
    assert.ok(copied !== blend.clips()[0].group && !copied.isStarted, 'a copy has a clip of its own, waiting');
    copy.play('RigAction');
    assert.ok(copied.isPlaying && !blend.clips()[0].group.isPlaying, 'the copy plays, the first held where it was');
    assert.notEqual(copied.targetedAnimations[0].target, blend.clips()[0].group.targetedAnimations[0].target, "the copy's clip poses the copy's bones");
  } finally {
    written.remove();
  }
  console.log('Export clips (Desk Lamp): its rig action a skeleton clip posing the lamp as Main, loaded as an asset and copied');
}

const example = process.argv[2];
if (example === 'nla') await nla();
else if (example === 'desk-lamp') await deskLamp();
else for (const id of ['nla', 'desk-lamp']) process.stdout.write(execFileSync(process.execPath, [fileURLToPath(import.meta.url), id], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] }).split('\n').filter((l) => !l.startsWith('BJS')).join('\n'));
process.exit(0);
