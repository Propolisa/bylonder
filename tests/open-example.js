// An example opened as a project opens it (sdk.openBlend), in a world with the slices the view reads, for the export
// tests: one per process, as Blender's module holds one Main.
import { readdirSync, readFileSync } from 'node:fs';
import { NullEngine, Scene } from '@babylonjs/core';
import { blenderMain } from '../src/bmesh/bmesh-wasm.js';
import '../src/python/bpy_interface.js';
import { setContextPointer } from '../src/python/bpy_rna.js';
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
import { registerRuntimeTypes } from '../src/runtimes/runtimes.js';
import '../src/runtimes/armature.js';
import '../src/runtimes/image.js';
import '../src/runtimes/grease-pencil.js';
import '../src/runtimes/shape-keys.js';
import { bylonderIcon } from '../src/python/bpy_icons.js';

// The runtimes the app registers (main.js): what an export writes of shape keys, armatures and images.
registerRuntimeTypes(bylonderIcon());

// An example's .blend: <id>.blend, else the one .blend its folder holds.
export function exampleBlend(id) {
  const dir = new URL(`../examples/${id}/`, import.meta.url), blends = readdirSync(dir).filter((f) => f.endsWith('.blend'));
  return blends.includes(`${id}.blend`) ? new URL(`${id}.blend`, dir) : blends.length === 1 ? new URL(blends[0], dir) : null;
}

// `id`: an example's, or a .blend file's path or URL.
export function openExample(id) {
  // NullEngine has no GL to upload an image's pixels to.
  const engine = Object.assign(new NullEngine(), { updateTextureData() {} }), scene = new Scene(engine);
  const animation = createAnimationModel(() => {}, { ids: createBlenderIDs(blenderMain()) });
  const objects = Object.assign([], { scene });
  const world = { scene, objects, animation };
  const opening = createMainSync({ rna: createRNA({ world: { scene, objects: [] } }), ids: animation.ids });
  objects.push(...opening.readBlend(readFileSync(id instanceof URL || id.endsWith('.blend') ? id : exampleBlend(id)), scene).nodes);
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
  return { world, scene, sync, objects, node: (name) => objects.find((n) => n.name === name) };
}
