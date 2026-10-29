import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { scanSource, scanImplemented } from '../scripts/blender-coverage.mjs';
import { computeCoverage, runtimeAvailable } from '../src/coverage/coverage.js';
import { registerOperator, operatorIds, spaceOperatorIds } from '../src/windowmanager/wm-operators.js';

const scanned = [...scanSource(`
  const KEYMAPS = { GRAPH_EDITOR: ['Graph Editor', 'Screen'] };
  menuButton('Object', items, { blender: 'VIEW3D_MT_object' });
  const keys = createKeymap([{ blender: 'object.delete', keys: ['X', 'Delete'], run }], ['Object Mode']);
  const other = { blender: ['object.select_all', 'object.select_all:SELECT'], label: 'All' };
  registerOperators({ 'object.duplicate_move': op });
  registerOperator('graph.select_all', op, 'GRAPH_EDITOR');
  const handler = keymapHandler(KEYMAPS[space]), area = areaUI({ area, keymaps: ['Text'] });
`)].sort();
assert.deepEqual(scanned, ['*@keymap:Graph Editor', '*@keymap:Screen', '*@keymap:Text', 'VIEW3D_MT_object', 'object.delete', 'object.delete|Delete@keymap:Object Mode',
  'object.delete|X@keymap:Object Mode', 'object.duplicate_move', 'object.duplicate_move@registry', 'object.select_all', 'object.select_all:SELECT'],
  'dispatched keymaps through module literals; operators registered for a space count at run time');

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

const blender = JSON.parse(await readFile('src/coverage/blender-surface.json', 'utf8')), implemented = await scanImplemented('src'), notesMarkdown = await readFile('docs/blender-coverage.md', 'utf8');
const real = computeCoverage(blender, implemented, notesMarkdown);
assert.deepEqual(real.unmatched, [], 'every Blender id in the source exists in Blender');
assert.ok(real.score > 0 && real.score < real.total);
for (const keymap of ['Object Mode', 'Mesh', '3D View', 'Outliner', 'Dopesheet', 'Graph Editor', 'Markers', 'Text', 'Console', 'Info']) {
  assert.ok(implemented.includes('*@keymap:' + keymap), `the ${keymap} keymap is dispatched`);
}

// Run time: an operator registered for a space type counts in that space's editors (and in the keymaps they share,
// kept with the Top Bar), and its bindings with it.
const run = { run() {} };
registerOperator('action.select_all', run, 'DOPESHEET_EDITOR');
registerOperator('marker.add', run, 'DOPESHEET_EDITOR');
registerOperator('graph.select_all', run, 'GRAPH_EDITOR');
const live = computeCoverage(blender, implemented, notesMarkdown, runtimeAvailable({ operators: operatorIds(), spaceOperators: spaceOperatorIds() }));
const binding = (result, area, keymap, id, keys) => result.tree.find((a) => a.id === area).c.find((n) => n.id === 'keymap:' + keymap).c.find((n) => n.id === id && n.x === keys).status;
const statuses = (result) => [
  binding(result, 'TIMELINE', 'Dopesheet', 'action.select_all', 'A'), binding(result, 'DOPESHEET', 'Dopesheet', 'action.select_all', 'A'),
  binding(result, 'DOPESHEET', 'Dopesheet', 'marker.add', 'M'), binding(result, 'TOPBAR', 'Markers', 'marker.add', 'M'),
  binding(result, 'FCURVES', 'Graph Editor', 'graph.select_all', 'A'), binding(result, 'DRIVERS', 'Graph Editor', 'graph.select_all', 'A'),
  binding(result, 'FCURVES', 'Graph Editor', 'marker.add', 'M'), binding(result, 'SEQUENCE_EDITOR', 'Sequencer', 'marker.add', 'M'),
];
assert.deepEqual(statuses(real), ['missing', 'missing', 'missing', 'missing', 'missing', 'missing', 'missing', 'missing']);
assert.deepEqual(statuses(live), ['done', 'done', 'done', 'done', 'done', 'done', 'missing', 'missing'], 'only where the space registers it');
assert.ok(live.score > real.score);
console.log(`Coverage: scan, keymaps, notes, subtree notes and space operators passed (${Math.round((real.score / real.total) * 100)}% of Blender ${real.blender})`);
