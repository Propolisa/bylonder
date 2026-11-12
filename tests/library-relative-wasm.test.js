// A .blend linking a library by a path relative to itself (`//libraries/library.blend`, as Blender writes links) opens
// with its links resolved: the module reads the file at the path main-sync writes the project to, so `//` is the
// project's folder, where its libraries/ are (blenkernel/libraries.js), and a project keeps the library.
import assert from 'node:assert/strict';
import { blendData } from '../src/python/bpy_rna.js';
import { unkeptLibraries } from '../src/blenkernel/libraries.js';
import { openExample } from './open-example.js';

const { sync } = openExample('link-append');
const linked = () => [...blendData().objects].filter((o) => o.library).map((o) => o.name).sort();
const absolute = linked();
assert.ok(absolute.length, 'the example links its lamp');

[...blendData().libraries][0].filepath = '//libraries/library.blend';
sync.readBlend(sync.blender.writeBlend('/relative.blend'));
assert.deepEqual([...blendData().libraries].map((l) => l.filepath), ['//libraries/library.blend'], 'the link stays relative');
assert.deepEqual(linked(), absolute, 'its linked objects are read from the project libraries');
assert.deepEqual(unkeptLibraries(new Set()).map(([path]) => path), ['libraries/library.blend'], 'and the project keeps the library');
console.log('Libraries: a link relative to the .blend resolves to the project libraries');
