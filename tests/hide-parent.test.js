// Hiding an object hides it alone, as in Blender: an empty, an armature or a mesh hidden with H (object.hide_view_set)
// keeps its children drawn, which Babylon's setEnabled on its node would hide too; Alt H shows it again, and undo
// restores it.
import assert from 'node:assert/strict';
import { NullEngine, Scene, MeshBuilder, TransformNode } from '@babylonjs/core';
import { createSelection } from '../src/editors/object/selection.js';
import { createHistory } from '../src/editors/undo/storage.js';
import { hidden, visible } from '../src/editors/object/identity.js';
import { sceneMain } from './scene-main.js';

const engine = new NullEngine(), scene = new Scene(engine);
const rig = new TransformNode('Rig', scene), body = MeshBuilder.CreateBox('Body', {}, scene);
rig.metadata = { wbId: 'rig' };
body.metadata = { wbId: 'body', wbCreation: { operator: 'mesh.primitive_cube_add', options: {} } };
body.parent = rig;
const objects = Object.assign([rig, body], { scene });
const selection = createSelection(scene, objects);
const main = sceneMain({ scene, objects }, selection);
const history = createHistory(objects, () => {}, { main });
main.redraw();
assert.equal(main.blender.parent(main.objectOf(body)), main.objectOf(rig), 'the body is the rig\'s child in Main');

const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
main.blender.view = { viewmat: identity, winmat: identity, winx: 100, winy: 100, persp: false };
selection.replace([rig]);
main.run(() => main.blender.run('object.hide_view_set'));
history.commit();
assert.ok(hidden(rig) && !visible(rig), 'H hides the rig');
assert.ok(body.isEnabled() && visible(body), 'and leaves its child shown');
assert.equal(main.blender.base(main.objectOf(rig)).hidden, true, 'Main keeps it hidden after a sync');
main.redraw();
assert.ok(hidden(rig), 'and so does Bylonder');

history.undo();
assert.ok(!hidden(rig), 'undo shows it again');
history.redo();
assert.ok(hidden(rig) && visible(body), 'redo hides it alone again');

main.run(() => main.blender.run('object.hide_view_clear'));
assert.ok(!hidden(rig) && visible(rig), 'Alt H shows it');

// A mesh hidden with H stops drawing (isVisible), its child mesh stays drawn, and Alt H brings back what it showed.
const cup = MeshBuilder.CreateBox('Cup', {}, scene);
cup.metadata = { wbId: 'cup', wbCreation: { operator: 'mesh.primitive_cube_add', options: {} } };
cup.parent = body;
objects.push(cup);
main.redraw();
selection.replace([body]);
main.run(() => main.blender.run('object.hide_view_set'));
assert.ok(hidden(body) && !visible(body) && !body.isVisible, 'H hides a mesh');
assert.ok(body.isEnabled() && cup.isEnabled() && cup.isVisible && visible(cup), 'and leaves its child mesh drawn');
main.redraw();
assert.ok(hidden(body) && !body.isVisible, 'Main keeps the mesh hidden');
history.commit();
main.run(() => main.blender.run('object.hide_view_clear'));
assert.ok(!hidden(body) && body.isVisible, 'Alt H shows it again');
history.commit();
history.undo();
assert.ok(hidden(body) && !body.isVisible && cup.isVisible, 'undo hides it alone again');

console.log('hide parent tests passed');
