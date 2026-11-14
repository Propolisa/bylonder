// The Package View's core (editors/space_package/package-preview.js): Reload exports the scene and loads its page; each
// change after (an edit, then its undo) reaches the page as a patch once idle, with no reload, and the page shows what
// a new export would.
import assert from 'node:assert/strict';
import { NullEngine } from '@babylonjs/core';
import { blendData } from '../src/python/bpy_rna.js';
import { createPackagePreview } from '../src/editors/space_package/package-preview.js';
import { writePackage } from './export-package.js';
import { openExample } from './open-example.js';

const { world, sync } = openExample('rigged-character');
sync.view();
let page = null, written = null;
const statuses = [];
const preview = createPackagePreview({
  world, idle: (run) => run(), report: (status) => statuses.push(status),
  publish: async (files) => { written = writePackage(files); return written.url; },
  post: (patch) => { page = page.then((blend) => blend.patch(patch)); },
});
const url = await preview.reload();
page = (await import(url)).load(new NullEngine());
const blend = await page;
const key = () => +blend.scene.getTransformNodeByName('Key rig').position.x.toFixed(5);
const at = key();

sync.undoInit();
const before = sync.undoPush('Before');
blendData().objects.get('Key').location[0] += 0.5;
sync.undoPush('Move');
preview.changed();
await preview.settled();
assert.equal(await page, blend, 'the change reaches the page as a patch, not a reload');
assert.equal(key(), +(at + 0.5).toFixed(5), 'the page shows the light moved');
assert.match(statuses.at(-1), /^Patched: .*nodes/, 'and says what the patch changed');

sync.undoLoad(before);
preview.changed();
await preview.settled();
assert.equal(key(), at, 'an undo reaches it too');
preview.changed();
await preview.settled();
assert.equal(statuses.at(-1), 'Up to date', 'an export that changes nothing sends nothing');
written.remove();
console.log('Package preview: Reload loads the export; each edit and undo reaches the page as a patch');
process.exit(0);
