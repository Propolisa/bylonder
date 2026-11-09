// What an example uses, by feature, and what of it its package lacks: the objects, materials and settings of each
// feature in Main, and those the exported page has no node, material or texture for. Prints one JSON line:
// { id, features: { <feature>: { used: [names], missing: [names] } } }.
//   node tests/export-parity/features.mjs <example> <package dir>
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { NullEngine } from '@babylonjs/core';
import { openExample } from '../open-example.js';
import { blendData, idStruct } from '../../src/python/bpy_rna.js';
import { rigId } from '../../src/io_scene_babylon/area-lights.js';

const [id, dir] = process.argv.slice(2);
const { sync, scene: app } = openExample(id);
sync.view();
const blend = await (await import(pathToFileURL(join(dir, 'scene.js')).href)).load(new NullEngine());
const page = blend.scene, data = blendData(), scene = idStruct(sync.blender.scene);
const objects = [...scene.objects];
const list = (iterable) => [...(iterable ?? [])];
// Each feature's objects by a test of the object.
const BY_OBJECT = {
  lights: (ob) => ob.type === 'LIGHT', cameras: (ob) => ob.type === 'CAMERA', armature: (ob) => ob.type === 'ARMATURE',
  'grease pencil': (ob) => /^(GREASEPENCIL|GPENCIL)$/.test(ob.type), volumes: (ob) => ob.type === 'VOLUME',
  'curves/text': (ob) => /^(CURVE|FONT|SURFACE)$/.test(ob.type), 'particles/hair': (ob) => ob.type === 'CURVES' || list(ob.particle_systems).length > 0,
  modifiers: (ob) => list(ob.modifiers).some((m) => m.type !== 'NODES'), 'geometry nodes': (ob) => list(ob.modifiers).some((m) => m.type === 'NODES'),
  'shape keys': (ob) => !!ob.data?.shape_keys, animation: (ob) => !!ob.animation_data?.action || list(ob.animation_data?.nla_tracks).length > 0,
  drivers: (ob) => list(ob.animation_data?.drivers).length > 0, instances: (ob) => ob.instance_type && ob.instance_type !== 'NONE',
};
const nodeOf = (ob) => page.getNodeById(ob.name) ?? page.getNodeById(rigId(ob.name)) ?? page.getLightById?.(ob.name) ?? page.getCameraById?.(ob.name);
// An object the app draws but the page lacks.
const drawn = (ob) => !!app.getNodeById(ob.name);
const features = Object.fromEntries(Object.entries(BY_OBJECT).map(([name, test]) => {
  const used = objects.filter(test);
  return [name, { used: used.map((ob) => ob.name), missing: used.filter((ob) => drawn(ob) && !nodeOf(ob)).map((ob) => ob.name) }];
}));
const materials = [...new Set(objects.flatMap((ob) => list(ob.material_slots).map((s) => s.material?.name).filter(Boolean)))];
features.materials = { used: materials, missing: materials.filter((name) => app.getMaterialByName(name) && !page.getMaterialByName(name)) };
features.world = { used: scene.world ? [scene.world.name] : [], missing: scene.world && !page.environmentTexture && !page.clearColor ? [scene.world.name] : [] };
const compositing = scene.compositing_node_group ?? (scene.use_nodes ? scene.node_tree : null);
features.compositor = { used: compositing ? ['Compositing'] : [], missing: compositing && !blend.compositor ? ['Compositing'] : [] };
const images = list(data.images).filter((image) => image.source !== 'VIEWER' && image.type !== 'RENDER_RESULT' && image.users > 0).map((image) => image.name);
features.images = { used: images, missing: images.length && !page.textures.length ? images : [] };
blend.dispose();
console.log(JSON.stringify({ id, features }));
process.exit(0);
