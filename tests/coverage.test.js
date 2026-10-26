import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { scanSource, scanImplemented } from '../scripts/blender-coverage.mjs';
import { computeCoverage } from '../src/coverage/coverage.js';

const scanned = [...scanSource(`
  menuButton('Object', items, { blender: 'VIEW3D_MT_object' });
  const keys = createKeymap([{ blender: 'object.delete', keys: ['X', 'Delete'], run }], ['Object Mode']);
  const other = { blender: ['object.select_all', 'object.select_all:SELECT'], label: 'All' };
`)].sort();
assert.deepEqual(scanned, ['VIEW3D_MT_object', 'object.delete', 'object.delete|Delete@keymap:Object Mode', 'object.delete|X@keymap:Object Mode', 'object.select_all', 'object.select_all:SELECT']);

const op = (id, l) => ({ k: 'op', id, l });
const surface = {
  blender: 'test', ids: ['VIEW3D_MT_object', 'VIEW3D_MT_add', 'object.delete', 'object.duplicate_move', 'object.select_all'],
  tree: [
    { k: 'area', id: 'VIEW_3D', l: '3D Viewport', c: [
      { k: 'menu', id: 'VIEW3D_MT_object', l: 'Object', c: [op('object.delete', 'Delete'), op('object.duplicate_move', 'Duplicate Objects'), op('object.shade_flat', 'Shade Flat')] },
      { k: 'menu', id: 'VIEW3D_MT_add', l: 'Add', c: [op('object.delete', 'Delete')] },
      { k: 'keymap', id: 'keymap:Object Mode', l: 'Object Mode', c: [{ k: 'key', id: 'object.delete', l: 'Delete', x: 'Del' }, { k: 'key', id: 'object.delete', l: 'Delete', x: 'Shift X' }] },
      { k: 'keymap', id: 'keymap:Clip Editor', l: 'Clip Editor', c: [{ k: 'key', id: 'object.delete', l: 'Delete', x: 'X' }] },
    ] },
    { k: 'area', id: 'CONSOLE', l: 'Python Console', c: [op('console.execute', 'Execute')] },
  ],
};
const notes = `
### Format
## VIEW3D_MT_object > object.shade_flat
See: VIEW3D_MT_object > object.duplicate_move
Use Duplicate.
## CONSOLE > *
Status: replaced
Browser console.
`;
const result = computeCoverage(surface, [...scanned, 'object.duplicate_move'], notes);
const find = (path) => path.reduce((nodes, id, i) => (i ? nodes.c : nodes).find((n) => n.id === id), result.tree);
assert.equal(find(['VIEW_3D', 'VIEW3D_MT_object', 'object.delete']).status, 'done');
assert.equal(find(['VIEW_3D', 'VIEW3D_MT_add', 'object.delete']).status, 'missing', 'an operator counts only inside implemented menus');
assert.equal(find(['VIEW_3D', 'VIEW3D_MT_object', 'object.shade_flat']).status, 'equivalent');
assert.equal(find(['VIEW_3D', 'keymap:Object Mode']).c[0].status, 'done', 'Delete and Del are one key');
assert.equal(find(['VIEW_3D', 'keymap:Object Mode']).c[1].status, 'missing');
assert.equal(find(['VIEW_3D', 'keymap:Clip Editor']).c[0].status, 'missing', 'bindings count only in their keymaps');
assert.equal(find(['CONSOLE', 'console.execute']).status, 'replaced');
assert.equal(find(['CONSOLE']).inherited.text, 'Browser console.');
assert.equal(result.total, 10);
assert.deepEqual(result.unmatched, []);

const real = computeCoverage(JSON.parse(await readFile('src/coverage/blender-surface.json', 'utf8')), await scanImplemented('src'), await readFile('docs/blender-coverage.md', 'utf8'));
assert.deepEqual(real.unmatched, [], 'every Blender id in the source exists in Blender');
assert.ok(real.score > 0 && real.score < real.total);
console.log(`Coverage: scan, keymaps, notes and subtree notes passed (${Math.round((real.score / real.total) * 100)}% of Blender ${real.blender})`);
