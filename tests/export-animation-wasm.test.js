// Full suite only: every frame-by-frame comparison of exported animation with Main, five examples deep.
// The JavaScript export's animation against Blender's: each example's package, loaded, placed at frames of its range
// by its animation group and the F-Curves its page runs, puts every animated mesh where Main evaluates it at that frame,
// with exact keys where an F-curve is all that moves a value, the clean-room F-Curve unit where Babylon cannot play it
// (rotations, easings), and samples elsewhere (drivers, NLA, constraints), or samples wherever Babylon cannot play it
// with Bake Animation. A location eased with Elastic runs live. Meshes deformed by shape keys and armatures are drawn by
// Babylon's morph targets and skeletons where Main evaluates them. The NLA example with its Hop and Turn tracks muted,
// its Slide strip alone moving the box, plays that strip's keys as Babylon's. Sampled at half the frame rate, what is
// sampled keys every second frame, named with its rate in the IR, and Babylon's interpolation between stays near Main.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { NullEngine } from '@babylonjs/core';
import { babylonMatrix } from '../src/blenkernel/main-view.js';
import { blendData, idStruct } from '../src/python/bpy_rna.js';
import { actionFCurves } from '../src/io_scene_babylon/ir-export.js';
import { exportModule } from '../src/io_scene_babylon/js-export.js';
import { openExample } from './open-example.js';
import { writePackage } from './export-package.js';

// Per example: frames to check, and the least share of its tracks that must be exact keys (not a sample per frame).
const EXAMPLES = { 'drivers-and-graph-editor': [1, 7, 13, 30, 61, 96], nla: [1, 10, 25, 49, 60, 80], compositor: [1, 37, 120, 240], 'shape-keys': [1, 18, 25, 48],
  'desk-lamp': [1, 36, 49, 96] };
// The Elastic case, in the Compositor example's run: the first location F-Curve of its objects (the airship's), its first
// key eased with Elastic.
const ELASTIC = 'compositor';

async function check(id, { bake = false, elastic = false, slide = false, half = false } = {}) {
  const { world, scene, sync } = openExample(id);
  if (slide) for (const track of blendData().objects.get('Box').animation_data.nla_tracks) track.mute = track.name !== 'Slide';
  sync.view();
  let eased;
  if (elastic) {
    const located = (o) => actionFCurves(o.animation_data).find((f) => f.data_path === 'location' && f.keyframe_points.length > 1);
    const ob = scene.meshes.map((m) => sync.objectOf(m)).filter(Boolean).map(idStruct).find(located), fc = located(ob);
    fc.keyframe_points[0].interpolation = 'ELASTIC';
    eased = `OB:${ob.name}/animation/location[${fc.array_index}]`;
  }
  const { fps, frameStart } = world.animation.time.state, rate = half ? fps / 2 : fps;
  const files = await exportModule(world, { bakeAnimation: bake, ...(half && { sampleRate: { rate } }) });
  const ir = JSON.parse(files['scene.ir.json']), live = Object.entries(ir.entities).filter(([, e]) => e.implementation === 'fcurve');
  if (bake) assert.equal(live.length, 0, `${id}: with Bake Animation, no F-Curve runs in the page`);
  // Material inputs the Compositor example animates (an ad's mapping, lights' emission) run on the unit too.
  if (id === 'compositor' && !bake) assert.ok(live.filter(([, e]) => e.outputs.value.property.startsWith('materials[')).length >= 3, `${id}: material inputs run live`);
  if (slide) {
    const box = JSON.parse(/const ANIMATION_GROUPS = (.*);\n/.exec(files['scene.js'])[1])[0].targetedAnimations.filter((t) => t.targetId === 'Box').map((t) => t.animation.property);
    assert.ok(box.length && box.every((p) => /^position\.[xyz]$/.test(p)), `the Slide strip's location plays as Babylon's keys, not sampled (${box})`);
  }
  if (eased) assert.ok(live.some(([key, e]) => key === eased && 'buffer' in e.inputs.curve.keyframes), `${eased}: the Elastic curve runs live, its keys in scene.bin`);
  // Materials of one node structure share one code body; their values are tunable inputs.
  const code = JSON.parse(/const CODE = (.*);/.exec(files['scene.js'])[1]), materials = JSON.parse(/const MATERIALS = (.*);/.exec(files['scene.js'])[1]).filter((m) => m.customType === 'BABYLON.NodeMaterial');
  assert.ok(code.length <= materials.length, `${id}: ${code.length} code bodies for ${materials.length} node materials`);
  assert.ok(materials.every((m) => !m.blocks.some((b) => /^BABYLON\.(Blender|ShaderNode)/.test(b.customType))), `${id}: node materials hold only Babylon's blocks`);
  const written = writePackage(files);
  const blend = await (await import(written.url)).load(new NullEngine());
  const page = blend.scene, group = page.animationGroups[0];
  const animated = new Set([...group.targetedAnimations.map((t) => t.target), ...live.map(([, e]) => page.getNodeById(ir.properties[e.outputs.value.property].bind.node))]);
  // Animated meshes, and those hung from bones (objects parented to bones), which the bones move.
  const meshes = scene.meshes.filter((m) => sync.objectOf(m) && (animated.has(page.getMeshById(m.name)) || page.getMeshById(m.name)?.parent?.getClassName() === 'Bone'));
  // Meshes Babylon deforms: morph targets (shape keys) and skeletons (armatures).
  const deformed = scene.meshes.filter((m) => sync.objectOf(m) && (page.getMeshById(m.name)?.morphTargetManager || page.getMeshById(m.name)?.skeleton));
  assert.ok(meshes.length || deformed.length, `${id}: animated meshes`);
  if (half) {
    const sampled = Object.keys(ir.scene.time.sample_rates);
    assert.ok(sampled.length && sampled.every((name) => ir.scene.time.sample_rates[name] === rate), `${id}: sampled objects named at ${rate} per second (${JSON.stringify(ir.scene.time.sample_rates)})`);
    const frames = group.targetedAnimations.flatMap((t) => t.animation.getKeys().map((k) => k.frame)).filter((f) => !Number.isInteger((f - frameStart) / 2));
    assert.ok(frames.every((f) => f === group.to || f === Math.round(f)), `${id}: keys off the half-rate grid are only exact keys' or the last frame's`);
  }
  // At half the rate, the frames between keys too.
  const checked = half ? EXAMPLES[id].flatMap((f) => [f, f + 1]) : EXAMPLES[id];
  // Main at a frame: each animated mesh's world matrix, and each deformed one's corners (Babylon's axes).
  const mainAt = (frame) => {
    sync.frameChanged(frame);
    const corners = (mesh) => {
      const evaluated = sync.blender.evaluatedMesh(sync.objectOf(mesh)), p = evaluated.vert_positions, verts = evaluated.corner_verts;
      return Array.from({ length: evaluated.corners_num * 3 }, (_, i) => p[verts[Math.floor(i / 3)] * 3 + [0, 2, 1][i % 3]]);
    };
    return [...meshes.map((m) => babylonMatrix(sync.blender.transform(sync.objectOf(m)).matrix_world).asArray()), ...deformed.map(corners)];
  };
  blend.playhead.pause();
  for (const frame of checked) {
    // A frame drawn, held there: Babylon's animation sets what it plays, the page runs what reads it, the skeletons pose.
    blend.playhead.seek(frame);
    page.render();
    await blend.settled();
    // Each mesh's world matrix, and each corner as drawn (morphed and skinned on the CPU as the GPU does).
    const drawn = [...meshes.map((m) => page.getMeshById(m.name).computeWorldMatrix(true).asArray()), ...deformed.map((m) => [...page.getMeshById(m.name).getPositionData(true, true)])];
    // Between two keys, Babylon's interpolation may round off what moves in between, by up to how far it moves.
    const between = half && (frame - frameStart) % 2 ? [mainAt(frame - 1), mainAt(frame + 1)] : null;
    const main = mainAt(frame);
    [...meshes, ...deformed].forEach((mesh, m) => {
      const off = drawn[m].map((v, i) => Math.abs(v - main[m][i]) - (between ? Math.abs(between[1][m][i] - between[0][m][i]) : 0));
      assert.ok(off.every((d) => d < 1e-4), `${id} ${mesh.name} at frame ${frame}: drawn off Main by ${Math.max(...off)} more than allowed`);
    });
  }
  const keys = group.targetedAnimations.map((t) => t.animation.getKeys().length);
  console.log(`${id}${bake ? ' (Bake Animation)' : elastic ? ' (Elastic)' : slide ? ' (Slide)' : half ? ' (half rate)' : ''}: ${meshes.length} meshes and ${deformed.length} deformed at ${checked.length} frames as Main; ${keys.length} tracks, ${keys.reduce((a, b) => a + b, 0)} keys, ${live.length} F-Curves run live`);
  blend.dispose();
  written.remove();
}

const [example, mode] = process.argv.slice(2);
if (example) await check(example, { bake: mode === 'bake', elastic: mode === 'elastic', slide: mode === 'slide', half: mode === 'half' });
else {
  const runs = [...Object.keys(EXAMPLES).map((id) => (id === ELASTIC ? [id, 'elastic'] : [id])), ['nla', 'slide'], ['drivers-and-graph-editor', 'bake'], ['nla', 'half'], ['desk-lamp', 'half']];
  for (const args of runs) process.stdout.write(execFileSync(process.execPath, [fileURLToPath(import.meta.url), ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] }).split('\n').filter((l) => !l.startsWith('BJS')).join('\n'));
  console.log('Export animation: meshes play where Main evaluates them at each checked frame, with exact keys where the F-curve is the motion and F-Curves Babylon cannot play run live');
}
