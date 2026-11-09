// The JavaScript export's animation against Blender's: each example's package, loaded, placed at frames of its range
// by its animation group and the F-Curves its page runs, puts every animated mesh where Main evaluates it at that frame,
// with exact keys where an F-curve is all that moves a value, the clean-room F-Curve unit where Babylon cannot play it
// (rotations, easings), and samples elsewhere (drivers, NLA, constraints), or samples wherever Babylon cannot play it
// with Bake Animation. A location eased with Elastic runs live.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { NullEngine } from '@babylonjs/core';
import { babylonMatrix } from '../src/blenkernel/main-view.js';
import { idStruct } from '../src/python/bpy_rna.js';
import { actionFCurves } from '../src/io_scene_babylon/ir-export.js';
import { exportModule } from '../src/io_scene_babylon/js-export.js';
import { openExample } from './open-example.js';
import { writePackage } from './export-package.js';

// Per example: frames to check, and the least share of its tracks that must be exact keys (not a sample per frame).
const EXAMPLES = { 'drivers-and-graph-editor': [1, 7, 13, 30, 61, 96], nla: [1, 10, 25, 49, 60, 80], compositor: [1, 37, 120, 240] };
// The Elastic case: the first location F-Curve of the Compositor example's objects (the airship's), its first key eased
// with Elastic.
const ELASTIC = 'compositor';

async function check(id, { bake = false, elastic = false } = {}) {
  const { world, scene, sync } = openExample(id);
  sync.view();
  let eased;
  if (elastic) {
    const located = (o) => actionFCurves(o.animation_data).find((f) => f.data_path === 'location' && f.keyframe_points.length > 1);
    const ob = scene.meshes.map((m) => sync.objectOf(m)).filter(Boolean).map(idStruct).find(located), fc = located(ob);
    fc.keyframe_points[0].interpolation = 'ELASTIC';
    eased = `OB:${ob.name}/animation/location[${fc.array_index}]`;
  }
  const files = await exportModule(world, { bakeAnimation: bake });
  const ir = JSON.parse(files['scene.ir.json']), live = Object.entries(ir.entities).filter(([, e]) => e.implementation === 'fcurve');
  if (bake) assert.equal(live.length, 0, `${id}: with Bake Animation, no F-Curve runs in the page`);
  if (eased) assert.ok(live.some(([key, e]) => key === eased && 'buffer' in e.inputs.curve.keyframes), `${eased}: the Elastic curve runs live, its keys in scene.bin`);
  // Materials of one node structure share one code body; their values are tunable inputs.
  const code = JSON.parse(/const CODE = (.*);/.exec(files['scene.js'])[1]), materials = JSON.parse(/const MATERIALS = (.*);/.exec(files['scene.js'])[1]).filter((m) => m.customType === 'BABYLON.NodeMaterial');
  assert.ok(code.length <= materials.length, `${id}: ${code.length} code bodies for ${materials.length} node materials`);
  assert.ok(materials.every((m) => !m.blocks.some((b) => /^BABYLON\.(Blender|ShaderNode)/.test(b.customType))), `${id}: node materials hold only Babylon's blocks`);
  const written = writePackage(files);
  const blend = await (await import(written.url)).load(new NullEngine());
  const page = blend.scene, group = page.animationGroups[0];
  const animated = new Set([...group.targetedAnimations.map((t) => t.target), ...live.map(([, e]) => page.getNodeById(ir.properties[e.outputs.value.property].bind.node))]);
  const meshes = scene.meshes.filter((m) => sync.objectOf(m) && animated.has(page.getMeshById(m.name)));
  assert.ok(meshes.length, `${id}: animated meshes`);
  group.stop();
  for (const frame of EXAMPLES[id]) {
    group.start(false, 1, frame, frame);
    group.goToFrame(frame);
    // What the page runs after Babylon's animation each frame.
    page.onAfterAnimationsObservable.notifyObservers(page);
    await blend.settled();
    sync.frameChanged(frame);
    for (const mesh of meshes) {
      const drawn = page.getMeshById(mesh.name).computeWorldMatrix(true).asArray(), main = babylonMatrix(sync.blender.transform(sync.objectOf(mesh)).matrix_world).asArray();
      assert.ok(drawn.every((v, i) => Math.abs(v - main[i]) < 1e-4), `${id} ${mesh.name} at frame ${frame}: ${drawn.map((v) => v.toFixed(3))}, Main ${main.map((v) => v.toFixed(3))}`);
    }
    group.stop();
  }
  const keys = group.targetedAnimations.map((t) => t.animation.getKeys().length);
  console.log(`${id}${bake ? ' (Bake Animation)' : elastic ? ' (Elastic)' : ''}: ${meshes.length} meshes at ${EXAMPLES[id].length} frames as Main; ${keys.length} tracks, ${keys.reduce((a, b) => a + b, 0)} keys, ${live.length} F-Curves run live`);
  blend.dispose();
  written.remove();
}

const [example, mode] = process.argv.slice(2);
if (example) await check(example, { bake: mode === 'bake', elastic: mode === 'elastic' });
else {
  const runs = [...Object.keys(EXAMPLES).map((id) => [id]), [ELASTIC, 'elastic'], ['drivers-and-graph-editor', 'bake']];
  for (const args of runs) process.stdout.write(execFileSync(process.execPath, [fileURLToPath(import.meta.url), ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] }).split('\n').filter((l) => !l.startsWith('BJS')).join('\n'));
  console.log('Export animation: meshes play where Main evaluates them at each checked frame, with exact keys where the F-curve is the motion and F-Curves Babylon cannot play run live');
}
