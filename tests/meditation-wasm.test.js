// tags: lightmaps, animation, shadows
// Meditation (examples/meditation/meditation.py): the seated mannequin's life is the rig's own action, breathing keyed
// over one breath and repeated by Cycles modifiers, sway and settles from Noise modifiers blended in and out over the
// loop; the room's light is baked into lightmaps, each the object's Bylonder lightmap setting. The exported page breathes
// as Main does (the chest rises and falls about a centimetre each breath, and the noise makes no two breaths alike), the
// lightmapped meshes draw with Babylon's lightmapTexture on their second UV set, and the room's shadow shapes the sun on the figure.
import assert from 'node:assert/strict';
import { NullEngine, PBRMaterial, ShadowGenerator } from '@babylonjs/core';
import { blendData } from '../src/python/bpy_rna.js';
import { exportModule } from '../src/io_scene_babylon/js-export.js';
import { openExample } from './open-example.js';
import { writePackage } from './export-package.js';

const { world, sync } = openExample('meditation');
const rig = blendData().objects.get('Meditator'), scene = blendData().scenes.get('Meditation');
const fcurves = [...rig.animation_data.action.layers[0].strips[0].channelbags[0].fcurves];
const modified = (type) => fcurves.filter((fc) => [...fc.modifiers].some((m) => m.type === type));
assert.ok(modified('CYCLES').some((fc) => fc.data_path.includes('DEF-spine.003')), 'the chest breathes by keys a Cycles modifier repeats');
const noise = modified('NOISE').flatMap((fc) => [...fc.modifiers].filter((m) => m.type === 'NOISE'));
assert.ok(noise.length >= 9 && noise.every((m) => m.use_restricted_range && m.blend_in > 0 && m.blend_out > 0 && m.frame_end === scene.frame_end),
  'sway and micro-shifts are Noise modifiers faded in and out over the loop, so it repeats without a seam');
const lightmapped = [...blendData().objects].filter((ob) => ob.bylonder?.lightmap?.image);
assert.ok(lightmapped.some((ob) => ob.name === 'Room' && ob.bylonder.lightmap.direct) && lightmapped.some((ob) => ob.name === 'Mannequin' && !ob.bylonder.lightmap.direct),
  'the floor\'s lightmap holds all its light, the figure\'s what reaches it besides the sun\'s direct light');

// Main's chest over the loop: the height of the left shoulder joint (the rig stands upright at the floor), each frame.
const chest = () => rig.pose.bones.get('DEF-upper_arm.L').head[2];
sync.view();
const FRAMES = Array.from({ length: 90 }, (_, i) => 1 + i * 6);
const main = FRAMES.map((frame) => { sync.frameChanged(frame); return chest(); });
sync.frameChanged(1);
const files = await exportModule(world, {});
// The package's sun shadow is the one the scene's settings choose (PCSS, finest with three shadow rays), though Node's
// Null engine draws neither: an export does not depend on the engine that made it.
const sunShadow = Object.values(JSON.parse(/^const SHADOW_GENERATORS = (.*);$/m.exec(files['scene.js'])[1]))[0];
assert.ok(sunShadow.useContactHardeningShadow && !sunShadow.usePoissonSampling && sunShadow.filteringQuality === ShadowGenerator.QUALITY_HIGH,
  "the page filters the sun's shadow with contact hardening at high quality");
const written = writePackage(files);
const blend = await (await import(written.url)).load(new NullEngine());
await blend.settled();
blend.playhead.pause();
const meshes = blend.scene.meshes;
for (const name of ['Room', 'Turtle', 'Cushion', 'Bench', 'Mannequin']) {
  const mesh = meshes.find((m) => m.name === name), materials = mesh.material.subMaterials ?? [mesh.material];
  assert.ok(materials.every((m) => m instanceof PBRMaterial && m.lightmapTexture?.coordinatesIndex === 1), `${name} draws with its lightmap on its second UV set`);
  assert.ok(mesh.isVerticesDataPresent('uv2'), `${name} has its lightmap's UV set`);
}
const room = meshes.find((m) => m.name === 'Room').material, turtle = meshes.find((m) => m.name === 'Turtle').material;
assert.ok(room.unlit && room.useLightmapAsShadowmap && room.lightmapTexture, 'the room is its colour times its lightmap, no live light');
assert.ok(turtle.albedoColor.g > 2 * turtle.albedoColor.r, 'the turtle keeps its green: the lightmap holds light, not colour');
const body = meshes.find((m) => m.name === 'Mannequin').material.subMaterials[0];
assert.ok(!body.unlit && !body.useLightmapAsShadowmap && body.environmentIntensity === 0, 'the sun lights the figure live, its baked bounce added in place of the environment');
const generator = blend.scene.lights.find((l) => l.name === 'Sun')?.getShadowGenerator();
const casters = generator?.getShadowMap().renderList.map((m) => m.name) ?? [];
assert.ok(casters.includes('Room') && meshes.find((m) => m.name === 'Mannequin').receiveShadows, 'the sun reaches the figure through the window: the room casts its shadow on him');

// The page's chest at the same frames: it breathes as Main does.
const bone = blend.scene.skeletons.flatMap((s) => s.bones).find((b) => b.name === 'DEF-upper_arm.L');
const page = [];
for (const frame of FRAMES) {
  blend.playhead.seek(frame);
  blend.scene.render();
  await blend.settled();
  page.push(bone.getAbsolutePosition(meshes.find((m) => m.name === 'Mannequin')).y);
}
const worst = Math.max(...page.map((y, i) => Math.abs(y - main[i])));
const rise = Math.max(...main) - Math.min(...main);
assert.ok(rise > 0.005 && rise < 0.03, `the chest rises and falls about a centimetre (${(rise * 1000).toFixed(1)} mm)`);
assert.ok(worst < 1e-3, `the page's chest is ${(worst * 1000).toFixed(2)} mm from Main's at worst`);
blend.dispose();
written.remove();
console.log(`Meditation: ${lightmapped.length} lightmapped objects, ${noise.length} Noise modifiers; the page's chest rises ${(rise * 1000).toFixed(1)} mm and keeps within ${(worst * 1000).toFixed(2)} mm of Main`);
process.exit(0);
