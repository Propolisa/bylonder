// The 3D Viewport's "(frame) Collection | Object" line names the active collection, as Blender's draw_selected_name
// does (CTX_data_collection), not the collection the active object is in.
import assert from 'node:assert/strict';
import { createViewportStatus } from '../src/editors/space_view3d/viewport-ui.js';

const names = { pizzas: 'pizzas', pavement: 'pavement.01' };
const stack = { name: 'Pizza Stack', metadata: { wbId: 'stack' }, isEnabled: () => true, isDisposed: () => false, getTotalVertices: () => 8, getTotalIndices: () => 36 };
const world = {
  objects: [stack], engine: { getFps: () => 60 }, animation: { time: { frame: 0 } },
  collections: { MASTER: 'scene', active: 'pavement', byId: (id) => ({ name: names[id] }), memberships: () => ['pizzas'], viewLayers: () => [], layer: () => ({ id: 'ViewLayer' }) },
};
let detail = null;
const views = { idle: true, all: [{ setDetail: (text) => { detail = text; } }] };
const editor = { selection: { nodes: [stack], active: stack, size: 1 } };
createViewportStatus({ world, editor, views, send: () => {} }).tick();
assert.equal(detail, '(0) pavement.01 | Pizza Stack', 'the active collection, then the active object');
console.log('Viewport status: the 3D Viewport names the active collection before the active object, as Blender does');
