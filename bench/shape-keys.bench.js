// Shape keys on a dense mesh (a 256 x 128 UV sphere, 32k vertices) with two animated keys: a frame's evaluation and
// drawing on Blender (Main's evaluated mesh extracted and drawn again) against Babylon (mapped) (influences set, the
// GPU blends). Babylon runs on a NullEngine, so the times are the CPU's. usage: node bench/shape-keys.bench.js [frames]
import { NullEngine, Scene } from '@babylonjs/core';
import { blenderMain, blenderModule } from '../src/bmesh/bmesh-wasm.js';
import '../src/python/bpy_interface.js';
import { contextStruct, setContextPointer, pointerOf } from '../src/python/bpy_rna.js';
import { createBlenderIDs } from '../src/blenkernel/blender-ids.js';
import { createAnimationModel } from '../src/blenkernel/animation/model.js';
import { createRNA } from '../src/makesrna/rna-bylonder.js';
import { createMainSync } from '../src/blenkernel/main-sync.js';
import { createSelection } from '../src/editors/object/selection.js';
import { createSceneSettings } from '../src/blenkernel/scene/settings.js';
import { createRenderSettings } from '../src/blenkernel/scene/render.js';
import { createCollections } from '../src/blenkernel/scene/collections.js';
import { createMaterialLibrary } from '../src/blenkernel/material/library.js';
import { createWorlds } from '../src/blenkernel/scene/world.js';
import { createModifierSystem } from '../src/modifiers/stack.js';
import { BlenderAnimation } from '../src/blenkernel/animation/anim-blender.js';
import { registerRuntimeTypes } from '../src/runtimes/runtimes.js';
import '../src/runtimes/shape-keys.js';
import { bylonderIcon } from '../src/python/bpy_icons.js';

registerRuntimeTypes(bylonderIcon());
const frames = Number(process.argv[2] ?? 48);
const scene = new Scene(new NullEngine());
const animation = createAnimationModel(() => {}, { ids: createBlenderIDs(blenderMain()) });
const objects = Object.assign([], { scene });
const world = { scene, objects, animation };
world.sceneSettings = createSceneSettings(world, { cameras: { list: () => [], get: () => null, set() {} } });
world.renderSettings = createRenderSettings(world);
world.collections = createCollections(world);
world.materials = createMaterialLibrary(world);
world.worlds = createWorlds(world);
world.modifiers = createModifierSystem(world, { notify: (message) => { throw Error(message); } });
const sync = createMainSync({ rna: createRNA({ world, selection: createSelection(scene, objects) }), ids: animation.ids });
const { blender } = sync;
setContextPointer(blender.C);
blender.run('mesh.primitive_uv_sphere_add', { segments: 256, ring_count: 128 });
sync.view();
const ob = contextStruct().object, id = pointerOf(ob)[2];
blender.run('object.shape_key_add', { from_mix: false });
const keying = new BlenderAnimation(blender), count = ob.data.vertices.length;
for (const [name, scale] of [['Squash', [1.3, 1.3, 0.6]], ['Stretch', [0.8, 0.8, 1.4]]]) {
  blender.run('object.shape_key_add', { from_mix: false });
  const kb = [...ob.data.shape_keys.key_blocks].at(-1);
  kb.name = name;
  const data = new Float32Array(blenderModule.exports.memory.buffer, pointerOf(kb.data[0])[2], count * 3);
  for (let i = 0; i < data.length; i++) data[i] *= scale[i % 3];
  for (const [frame, value] of [[1, 0], [frames / 2, 1], [frames, 0]]) {
    sync.frameChanged(frame);
    kb.value = value;
    keying.keyInsert(pointerOf(ob.data.shape_keys)[2], `key_blocks["${name}"].value`);
  }
}
blender.tag(id, 2);
sync.view();

function play(runtime) {
  ob.data.shape_keys.bylonder.runtime = runtime;
  sync.frameChanged(1);
  const start = performance.now();
  for (let frame = 2; frame <= frames; frame++) sync.frameChanged(frame);
  return (performance.now() - start) / (frames - 1);
}
play('BLENDER');
const blenderMs = play('BLENDER'), mappedMs = play('MAPPED');
console.log(`${count} vertices, ${frames} frames: Blender ${blenderMs.toFixed(1)} ms a frame, Babylon (mapped) ${mappedMs.toFixed(1)} ms a frame`);
