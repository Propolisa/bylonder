// UDIM images (Images of source TILED) as Blender's shaders sample them (imbuf/tiled-image-textures.js): two tiles that
// are not neighbours (1001 and 1011) opened from their files as one image, packed as the layers of an array with a
// tile map, which Blender's tiled_image_lookup reads: UV (0.5, 0.5) samples tile 1001, (0.5, 1.5) tile 1011, and
// (1.5, 0.5), a tile the image lacks, none.
import assert from 'node:assert/strict';
import { BlenderMain } from '../src/bmesh/bmesh-wasm.js';
import { blendData, setContextPointer } from '../src/python/bpy_rna.js';
import { tileLayers } from '../src/imbuf/tiled-image-textures.js';

await import('../src/python/bpy_interface.js');
const main = new BlenderMain();
setContextPointer(main.C);

const COLORS = { 1001: [1, 0, 0, 1], 1011: [0, 1, 0, 1] };
for (const [number, color] of Object.entries(COLORS)) {
  main.run('image.new', { name: `tile ${number}`, width: 8, height: 4, color });
  const tile = blendData().images.get(`tile ${number}`);
  Object.assign(tile, { file_format: 'PNG', filepath_raw: `/udim/skin.${number}.png` });
  tile.save();
}
assert.equal(main.run('image.open', { filepath: '/udim/skin.1001.png', use_udim_detecting: true }).status, 4, 'the tiles open as one image');
const image = [...blendData().images].find((i) => i.source === 'TILED');
assert.ok(image, 'a tiled image');
assert.deepEqual([...image.tiles].map((t) => t.number).sort(), [1001, 1011]);

const packed = tileLayers(image);
assert.equal(packed.depth, 2, 'a layer per tile');
assert.ok(packed.srgb, 'byte tiles in sRGB stay sRGB');

// blender-port: gpu_shader_tiled_image_lookup_lib.glsl tiled_image_lookup, then a texel of the layer it gives.
function sample([u, v]) {
  const [tx, ty] = [Math.floor(u), Math.floor(v)];
  if (tx < 0 || ty < 0 || tx >= 10) return null;
  const tile = 10 * ty + tx;
  if (tile >= packed.mapWidth) return null;
  const layer = packed.map[tile * 4];
  if (layer < 0) return null;
  const [, , sx, sy] = packed.map.subarray((packed.mapWidth + tile) * 4, (packed.mapWidth + tile) * 4 + 4);
  const x = Math.floor((u - tx) * sx * packed.width), y = Math.floor((v - ty) * sy * packed.height);
  const at = ((layer * packed.height + y) * packed.width + x) * 4;
  return [...packed.layers.subarray(at, at + 4)];
}
assert.deepEqual(sample([0.5, 0.5]), [255, 0, 0, 255], 'UV (0.5, 0.5) samples tile 1001');
assert.deepEqual(sample([0.5, 1.5]), [0, 255, 0, 255], 'UV (0.5, 1.5) samples tile 1011');
assert.equal(sample([1.5, 0.5]), null, 'a tile the image lacks samples none (pink in the shader)');
console.log('UDIM: tiles 1001 and 1011 open as one image, packed as array layers with Blender\'s tile map, each UV sampling its tile');
