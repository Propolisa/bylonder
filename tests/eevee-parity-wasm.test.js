// EEVEE Parity (src/draw/eevee-parity.js): a setting of Blender's scene, on by default; turned off through RNA as the
// Render tab's checkbox turns it off, the view draws plain Babylon PBR, and a saved .blend opens with it still off.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { NullEngine, Scene } from '@babylonjs/core';
import { blenderMain } from '../src/bmesh/bmesh-wasm.js';
import '../src/python/bpy_interface.js';
import { idStruct, setContextPointer } from '../src/python/bpy_rna.js';
import { createBlenderIDs } from '../src/blenkernel/blender-ids.js';
import { createAnimationModel } from '../src/blenkernel/animation/model.js';
import { createRNA } from '../src/makesrna/rna-bylonder.js';
import { createMainSync } from '../src/blenkernel/main-sync.js';
import { bylonderIcon } from '../src/python/bpy_icons.js';
import { eeveeParity, pullEeveeParity, registerEeveeParityTypes } from '../src/draw/eevee-parity.js';

registerEeveeParityTypes(bylonderIcon());
const open = (bytes) => {
  const scene = new Scene(new NullEngine());
  const animation = createAnimationModel(() => {}, { ids: createBlenderIDs(blenderMain()) });
  const sync = createMainSync({ rna: createRNA({ world: { scene, objects: [] } }), ids: animation.ids });
  sync.readBlend(bytes, scene);
  setContextPointer(sync.blender.C);
  return { scene, sync, settings: idStruct(sync.blender.scene).bylonder_render };
};

const first = open(readFileSync(new URL('../examples/shader-gallery/shader_gallery.blend', import.meta.url)));
assert.equal(first.settings.use_eevee_parity, true, 'on by default');
first.settings.use_eevee_parity = false;
pullEeveeParity(first.scene, first.sync.blender.scene);
assert.equal(eeveeParity(first.scene), false, 'the view follows the setting (main-view.js, on an update of the scene)');

const reopened = open(first.sync.blender.writeBlend('/parity.blend'));
assert.equal(reopened.settings.use_eevee_parity, false, 'saved in the .blend');
console.log('EEVEE Parity: a scene setting, on by default, read by the view and saved in the .blend');
