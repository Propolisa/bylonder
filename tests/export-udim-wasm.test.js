// A UDIM image in an exported package (runtime/tiled-images.js): the Framed Print's image texture given an image of two
// tiles that are not neighbours (1001 and 1011). The package writes each tile as an image file, and the material
// samples them through a TileBlock per sampler (the tiles' array and the tile map), named as the globals its node code
// reads. The page's packing of the tiles, from their files, gives the layers and the map the app's packing gives.
import assert from 'node:assert/strict';
import { NullEngine } from '@babylonjs/core';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { blendData } from '../src/python/bpy_rna.js';
import { exportModule } from '../src/io_scene_babylon/js-export.js';
import { packTiles } from '../src/io_scene_babylon/runtime/tiled-images.js';
import { tileLayers, imageTiles } from '../src/imbuf/tiled-image-textures.js';
import { openExample } from './open-example.js';
import { writePackage } from './export-package.js';

// The Framed Print with its print's image made UDIM, packed and saved as a .blend (one Main a process: made in a process
// of its own).
if (process.argv[2] === '--make') {
  const { sync } = openExample('framed-print');
  for (const [number, color] of Object.entries({ 1001: [1, 0, 0, 1], 1011: [0, 1, 0, 1] })) {
    sync.blender.run('image.new', { name: `tile ${number}`, width: 8, height: 4, color });
    Object.assign(blendData().images.get(`tile ${number}`), { file_format: 'PNG', filepath_raw: `/udim/print.${number}.png` }).save();
  }
  assert.equal(sync.blender.run('image.open', { filepath: '/udim/print.1001.png', use_udim_detecting: true }).status, 4);
  const tiled = [...blendData().images].find((i) => i.source === 'TILED');
  tiled.pack();
  blendData().materials.get('Print').node_tree.nodes.get('Image Texture').image = tiled;
  writeFileSync(process.argv[3], sync.writeBlend('/udim.blend'));
  process.exit(0);
}
const dir = mkdtempSync(join(tmpdir(), 'udim-')), file = join(dir, 'udim.blend');
execFileSync(process.execPath, [fileURLToPath(import.meta.url), '--make', file], { stdio: 'inherit' });
const { world, sync } = openExample(file);
sync.view();
const tiled = [...blendData().images].find((i) => i.source === 'TILED');
assert.deepEqual([...tiled.tiles].map((t) => t.number).sort(), [1001, 1011], 'the image keeps its two tiles');
const files = await exportModule(world);
const blocks = [...files['scene.js'].matchAll(/"samplerName":"([^"]+)","part":"(array|map)"/g)].map(([, name, part]) => ({ name, part }));
assert.deepEqual(blocks.map((b) => b.part).sort(), ['array', 'map'], 'a TileBlock for the array and one for the map');
const urls = [...new Set([...files['scene.js'].matchAll(/"number":(10\d\d),"srgb":(true|false),"name":"(images\/[^"]+)"/g)].map(([, n, , url]) => `${n} ${url}`))];
assert.equal(urls.length, 2, `each tile is a file: ${urls.join(', ')}`);
for (const entry of urls) assert.ok(files[entry.split(' ')[1]]?.length, `${entry} is in the package`);

// The page's packing from the tiles' pixels gives the app's layers and map.
const page = packTiles(imageTiles(tiled)), app = tileLayers(tiled);
assert.deepEqual([page.width, page.height, page.depth, [...page.map]], [app.width, app.height, app.depth, [...app.map]]);

// The page loads: its material holds both TileBlocks (the package's own copy of the class), named as its code reads them.
const written = writePackage(files);
const blend = await (await import(written.url)).load(new NullEngine());
const material = blend.scene.materials.find((m) => m.getClassName() === 'NodeMaterial' && m.attachedBlocks.some((b) => b.getClassName() === 'TileBlock'));
assert.ok(material, 'a node material with TileBlocks');
const tileBlocks = material.attachedBlocks.filter((b) => b.getClassName() === 'TileBlock');
assert.deepEqual(tileBlocks.map((b) => b.part).sort(), ['array', 'map']);
assert.ok(tileBlocks.every((b) => blocks.some((s) => s.name === b.samplerName)), 'the blocks keep their sampler names');
const code = material.attachedBlocks.map((b) => (b.options?.code ?? []).join('\n')).join('\n');
const [array, map] = ['array', 'map'].map((part) => tileBlocks.find((b) => b.part === part).samplerName);
assert.ok(code.includes('node_tex_tile_linear('), "the node code samples through Blender's tiled lookup");
assert.ok(code.includes(`, ${array}, ${map},`), 'and passes it the array and the map by their global names');
blend.dispose();
written.remove();
rmSync(dir, { recursive: true, force: true });
console.log(`Export UDIM: two tiles as files (${urls.join(', ')}), sampled through TileBlocks for the array and the map`);
