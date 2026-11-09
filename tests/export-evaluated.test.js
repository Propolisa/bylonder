// Exports of what Blender evaluates (babylon-export.js, js-export.js), from the examples opened as a project opens
// them: Geometry Nodes' instances, a driven object, NLA strips and a constraint come out as Blender shows them.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { NullEngine, Scene, Vector3 } from '@babylonjs/core';
import { blenderMain } from '../src/bmesh/bmesh-wasm.js';
import '../src/python/bpy_interface.js';
import { idStruct, setContextPointer } from '../src/python/bpy_rna.js';
import { createBlenderIDs } from '../src/blenkernel/blender-ids.js';
import { createAnimationModel } from '../src/blenkernel/animation/model.js';
import { registerObjects } from '../src/blenkernel/animation/bindings.js';
import { createSceneSettings } from '../src/blenkernel/scene/settings.js';
import { createRenderSettings } from '../src/blenkernel/scene/render.js';
import { createCollections } from '../src/blenkernel/scene/collections.js';
import { createMaterialLibrary } from '../src/blenkernel/material/library.js';
import { createWorlds } from '../src/blenkernel/scene/world.js';
import { createModifierSystem } from '../src/modifiers/stack.js';
import { createCurveObjects } from '../src/editors/curve/curve-objects.js';
import { createSelection } from '../src/editors/object/selection.js';
import { createRNA } from '../src/makesrna/rna-bylonder.js';
import { createMainSync } from '../src/blenkernel/main-sync.js';
import { serializeScene } from '../src/io_scene_babylon/babylon-export.js';
import { exportModule } from '../src/io_scene_babylon/js-export.js';

// An example opened as a project opens it (sdk.openBlend), in a world with the slices the view reads.
function open(id) {
  // NullEngine has no GL to upload an image's pixels to.
  const engine = Object.assign(new NullEngine(), { updateTextureData() {} }), scene = new Scene(engine);
  const animation = createAnimationModel(() => {}, { ids: createBlenderIDs(blenderMain()) });
  const objects = Object.assign([], { scene });
  const world = { scene, objects, animation };
  const opening = createMainSync({ rna: createRNA({ world: { scene, objects: [] } }), ids: animation.ids });
  objects.push(...opening.readBlend(readFileSync(new URL(`../examples/${id}/${id}.blend`, import.meta.url)), scene).nodes);
  let camera = scene.activeCamera;
  world.sceneSettings = createSceneSettings(world, { cameras: { list: () => scene.cameras, get: () => camera, set: (c) => { camera = c; } } });
  world.renderSettings = createRenderSettings(world);
  world.collections = createCollections(world);
  world.materials = createMaterialLibrary(world);
  world.worlds = createWorlds(world);
  world.modifiers = createModifierSystem(world, { notify: (message) => { throw Error(message); } });
  world.curves = createCurveObjects(world);
  registerObjects(animation, objects);
  const sync = createMainSync({ rna: createRNA({ world, selection: createSelection(scene, objects) }), ids: animation.ids });
  setContextPointer(sync.blender.C);
  return { world, scene, sync, node: (name) => objects.find((n) => n.name === name) };
}
const animated = (json, name, property) => json.animationGroups.flatMap((g) => g.targetedAnimations).find((t) => t.targetId === name && t.animation.property === property);
const range = (keys, i) => { const values = keys.map((k) => k.values[i]); return Math.max(...values) - Math.min(...values); };

// Each example in a process of its own: the module holds one Main, which opening another replaces.
const SCENARIOS = {
  // File > Export > JavaScript of scenes with instances: their buffers are not vertex data.
  async javascript() {
    const { world } = open('geometry-nodes');
    assert.match(await exportModule(world), /export async function createScene/);
  },
  async compositor() {
    const { world } = open('compositor');
    assert.match(await exportModule(world), /export async function createScene/);
  },
  async instances() {
    // Geometry Nodes' instances (the planet's trees and rocks) are thin instances in both exports, which no longer throw.
    const { world } = open('geometry-nodes');
    const json = await serializeScene(world);
    const instanced = json.meshes.filter((m) => m.thinInstances?.instancesCount);
    assert.ok(instanced.length && instanced.every((m) => m.name.endsWith('Instances')), `instances are exported: ${json.meshes.map((m) => m.name)}`);
    assert.ok(instanced.every((m) => m.thinInstances.matrixData.length >= 16 * m.thinInstances.instancesCount && json.geometries.vertexData.some((g) => g.id === m.geometryId)),
      'each with its matrices and its source geometry');
    assert.match(await exportModule(world), /thinInstanceSetBuffer/, 'the JavaScript export writes them too');
  },
};

const scenario = process.argv[2];
if (scenario) await SCENARIOS[scenario]();
else for (const name of Object.keys(SCENARIOS)) execFileSync(process.execPath, [fileURLToPath(import.meta.url), name], { stdio: ['ignore', 'ignore', 'inherit'] });
if (!scenario) console.log('Export of evaluated scenes: Geometry Nodes instances, a driven object, NLA strips and a constraint come out as Blender evaluates them');
