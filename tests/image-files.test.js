// A package's images as files (io_scene_babylon/image-files.js): textures' data URLs become images/<n> files, a second
// pass (materials made again from their own code) numbers on from the first, and the same image under any data URL
// is written once.
import assert from 'node:assert/strict';
import { imageFiles } from '../src/io_scene_babylon/image-files.js';

const png = (bytes) => `data:image/png;base64,${Buffer.from([0x89, 0x50, 0x4e, 0x47, ...bytes]).toString('base64')}`;
const data = { materials: [{ name: 'a', texture: { base64String: png([1, 2, 3]) } }, { name: 'b', texture: { base64String: png([4, 5]) } }] };
const files = imageFiles(data);
assert.deepEqual(Object.keys(files), ['images/0.png', 'images/1.png']);
assert.match(data.materials[0].texture.url, /^images\/0\.png\?v=\d+\.\d+$/, "named by its path and its content's version");
const remade = { materials: [{ name: 'c', blocks: [{ texture: { base64String: png([4, 5]) } }, { texture: { base64String: `data:image/png;charset=x;base64,${png([6]).split(',')[1]}` } }] }] };
imageFiles(remade, files);
assert.deepEqual(Object.keys(files), ['images/0.png', 'images/1.png', 'images/2.png'], 'numbered on, the repeated image written once');
assert.equal(remade.materials[0].blocks[0].texture.url, data.materials[1].texture.url, 'the same image as before');
assert.match(remade.materials[0].blocks[1].texture.url, /^images\/2\.png\?v=/);
console.log('Image files: numbered on across passes, each image written once and named by its version');
