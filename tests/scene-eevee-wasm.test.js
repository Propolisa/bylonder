// A .blend's EEVEE settings are the scene's (main-sync.js sceneRecords: SceneEEVEE and its RaytraceEEVEE): a file with
// Raytracing on opens with it on, with its samples and screen tracing, and an edit in Bylonder reaches Main.
import assert from 'node:assert/strict';
import { NullEngine, Scene } from '@babylonjs/core';
import { createAnimationModel } from '../src/blenkernel/animation/model.js';
import { createSceneSettings } from '../src/blenkernel/scene/settings.js';
import { createRenderSettings } from '../src/blenkernel/scene/render.js';
import { createCollections } from '../src/blenkernel/scene/collections.js';
import { createRNA } from '../src/makesrna/rna-bylonder.js';
import { createMainSync } from '../src/blenkernel/main-sync.js';
import { idStruct } from '../src/python/bpy_rna.js';
import '../src/python/bpy_interface.js';

const open = (bytes) => {
  const scene = new Scene(new NullEngine()), animation = createAnimationModel();
  const world = { scene, objects: Object.assign([], { scene }), animation };
  world.sceneSettings = createSceneSettings(world);
  world.renderSettings = createRenderSettings(world);
  world.collections = createCollections(world);
  const sync = createMainSync({ rna: createRNA({ world, selection: { nodes: [], active: null } }), ids: animation.ids });
  if (bytes) sync.readBlend(bytes, scene);
  return { world, sync };
};

const { sync } = open();
const eevee = idStruct(sync.blender.scene).eevee;
eevee.use_raytracing = true;
eevee.taa_render_samples = 48;
eevee.ray_tracing_options.screen_trace_thickness = 0.9;
const { world, sync: read } = open(sync.blender.writeBlend('/eevee.blend'));
const { useRaytracing, taaRenderSamples, screenTraceThickness } = world.renderSettings.state.eevee;
assert.deepEqual({ useRaytracing, taaRenderSamples, screenTraceThickness: Math.round(screenTraceThickness * 100) / 100 },
  { useRaytracing: true, taaRenderSamples: 48, screenTraceThickness: 0.9 }, "the file's EEVEE settings");
world.renderSettings.set('eevee.useRaytracing', false);
read.flush();
assert.equal(idStruct(read.blender.scene).eevee.use_raytracing, false, 'an edit reaches Main');
console.log("Scene EEVEE: a file's Raytracing, samples and screen tracing open as the file's");
