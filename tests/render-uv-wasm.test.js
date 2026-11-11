// A mesh with two UV maps shades through its render one, as Blender's image textures read it with nothing linked into
// their Vector (mesh_cd_calc_used_gpu_layers): the app's mesh and so an exported page take that map, not the one
// active for editing (Snow's head: UVMap to render, tattoo_light_map active).
import assert from 'node:assert/strict';
import { VertexBuffer } from '@babylonjs/core';
import { openExample } from './open-example.js';
import { blendData } from '../src/python/bpy_rna.js';

const { sync, node } = openExample('shader-gallery');
const object = [...blendData().objects].find((ob) => ob.type === 'MESH' && ob.data.uv_layers.length === 1);
const mesh = object.data, render = mesh.uv_layers[0], other = mesh.uv_layers.new('Other');
for (const corner of other.data) corner.uv = [0.9, 0.9];
other.active = true;
render.active_render = true;
mesh.update();
sync.view();
const uvs = node(object.name).getVerticesData(VertexBuffer.UVKind);
const onOther = (u, v) => Math.abs(u - 0.9) < 1e-4 && (Math.abs(v - 0.9) < 1e-4 || Math.abs(v - 0.1) < 1e-4);
assert.ok(uvs.length && !Array.from({ length: uvs.length / 2 }, (_, i) => onOther(uvs[2 * i], uvs[2 * i + 1])).every(Boolean),
  'the mesh takes its render UV map, not the active one');
console.log('Render UV: a mesh with two UV maps shades through its render one');
process.exit(0);
