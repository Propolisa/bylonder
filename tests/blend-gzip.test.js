// A .blend saved gzip-compressed (Blender before 3.0 compressed that way) opens as its uncompressed bytes do, and a
// file Blender cannot read throws its reason.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { gzipSync } from 'fflate';
import { BlenderMain, datafiles } from '../src/bmesh/bmesh-wasm.js';
import { ID_OB } from '../src/blenkernel/main-view.js';

await datafiles;
const main = new BlenderMain();
const objects = () => main.ids(ID_OB).map((id) => main.name(id)).sort();
main.readBlend(await readFile(new URL('./fixtures/io/no-camera.blend', import.meta.url)));
const expected = objects(), plain = main.writeBlend();

main.readBlend(gzipSync(plain));
assert.deepEqual(objects(), expected);
assert.throws(() => main.readBlend(gzipSync(new Uint8Array(64))), /Not a .blend file/);
console.log('blend gzip: ok', expected.join(', '));
