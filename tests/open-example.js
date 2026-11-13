// An example opened as a project opens it (sdk.openBlend), in a world with the slices the view reads, for the export
// tests: one per process, as Blender's module holds one Main.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { register } from 'node:module';
import { NullEngine, Scene } from '@babylonjs/core';
import { blenderMain } from '../src/bmesh/bmesh-wasm.js';
import '../src/python/bpy_interface.js';
import { setContextPointer } from '../src/python/bpy_rna.js';
import { files } from '../src/port/wasm.js';
import { LIBRARY_FOLDER } from '../src/blenkernel/libraries.js';
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
import { createLightShadows } from '../src/blenkernel/light/light-shadows.js';
import { createSelection } from '../src/editors/object/selection.js';
import { createRNA } from '../src/makesrna/rna-bylonder.js';
import { createMainSync } from '../src/blenkernel/main-sync.js';
import { registerRuntimeTypes } from '../src/runtimes/runtimes.js';
import '../src/runtimes/armature.js';
import '../src/runtimes/image.js';
import '../src/runtimes/grease-pencil.js';
import '../src/runtimes/shape-keys.js';
import { bylonderIcon } from '../src/python/bpy_icons.js';
import { hasMesh, identify } from '../src/editors/object/identity.js';

// The runtimes the app registers (main.js): what an export writes of shape keys, armatures and images.
registerRuntimeTypes(bylonderIcon());

// An example's .blend: <id>.blend, else the one .blend its folder holds.
export function exampleBlend(id) {
  const dir = new URL(`../examples/${id}/`, import.meta.url), blends = readdirSync(dir).filter((f) => f.endsWith('.blend'));
  return blends.includes(`${id}.blend`) ? new URL(`${id}.blend`, dir) : blends.length === 1 ? new URL(blends[0], dir) : null;
}

// `id`: an example's, or a .blend file's path or URL.
let opened = null;
export function openExample(id) {
  // A second file would leave the first's world on its freed Main: wrong exports, then a corrupted heap.
  if (opened) throw new Error(`openExample(${JSON.stringify(id)}): ${opened} is open already; Blender's module holds one Main, so open one file per process (spawn a child process for the next)`);
  opened = JSON.stringify(String(id));
  // NullEngine has no GL to upload an image's pixels to.
  const engine = Object.assign(new NullEngine(), { updateTextureData() {} }), scene = new Scene(engine);
  const animation = createAnimationModel(() => {}, { ids: createBlenderIDs(blenderMain()) });
  const objects = Object.assign([], { scene });
  const world = { scene, objects, animation };
  // The example's libraries in the module's file system before its .blend is read, as a project opens (libraries.js).
  const libraries = new URL(`../examples/${id}/libraries/`, import.meta.url);
  if (existsSync(libraries)) for (const name of readdirSync(libraries).filter((f) => f.endsWith('.blend'))) files.set(`${LIBRARY_FOLDER}/${name}`, readFileSync(new URL(name, libraries)));
  const opening = createMainSync({ rna: createRNA({ world: { scene, objects: [] } }), ids: animation.ids });
  objects.push(...opening.readBlend(readFileSync(id instanceof URL || id.endsWith('.blend') ? id : exampleBlend(id)), scene).nodes);
  return withSlices(world);
}

// An example built by its code (examples/<id>/index.js), as the app runs it (examples.test.js): its createScene with the
// project SDK on a NullEngine, then the same slices.
export async function openCodeExample(id) {
  register('./fixtures/example-loader.mjs', import.meta.url);
  // A project's files (sdk.asset) are its example folder's.
  const fetchURL = globalThis.fetch;
  globalThis.location ??= { origin: '' };
  globalThis.fetch = (url, ...rest) => (String(url).startsWith('file:') ? Promise.resolve(new Response(readFileSync(new URL(url)))) : fetchURL(url, ...rest));
  const BABYLON = await import('@babylonjs/core'), { createSDK } = await import('../src/runtime/sdk.js');
  const engine = Object.assign(new NullEngine(), { updateTextureData() {} }), base = new URL(`../examples/${id}/`, import.meta.url);
  const sdk = createSDK(base.href, {}, () => {});
  sdk.animation.ids ??= createBlenderIDs(blenderMain());
  Object.assign(globalThis, { BABYLON: { ...BABYLON }, engine, canvas: null, workbench: sdk });
  const scene = await (await import(new URL('index.js', base))).createScene();
  const objects = Object.assign(scene.meshes.filter((m) => hasMesh(m) && m.metadata?.editable !== false), { scene });
  objects.forEach(identify);
  return withSlices({ scene, objects, animation: sdk.animation }, { authored: sdk.authoredRender });
}

// The slices the view reads, on a world of a scene and its objects; and its Main.
function withSlices(world, render) {
  const { scene, objects, animation } = world;
  let camera = scene.activeCamera;
  world.sceneSettings = createSceneSettings(world, { cameras: { list: () => scene.cameras, get: () => camera, set: (c) => { camera = c; } } });
  world.renderSettings = createRenderSettings(world, render);
  world.collections = createCollections(world);
  world.materials = createMaterialLibrary(world);
  world.worlds = createWorlds(world);
  world.modifiers = createModifierSystem(world, { notify: (message) => { throw Error(message); } });
  world.curves = createCurveObjects(world);
  // Lights' shadows and how many lights each material takes, as a rendered view sets them (runtime/world.js).
  world.shadows = createLightShadows(scene);
  registerObjects(animation, objects);
  const sync = createMainSync({ rna: createRNA({ world, selection: createSelection(scene, objects) }), ids: animation.ids });
  setContextPointer(sync.blender.C);
  return { world, scene, sync, objects, node: (name) => objects.find((n) => n.name === name) };
}
