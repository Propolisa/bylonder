// The examples of docs/features/rendering.md, mesh-modeling.md, drivers-and-graph-editor.md,
// vertex-and-weight-paint.md and compositor.md, opened with Blender's reader: what each page's steps rely on is in Main,
// and the Steam Engine's drivers move its crosshead as the slider-crank does.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { NullEngine, Scene } from '@babylonjs/core';
import { blenderMain } from '../src/bmesh/bmesh-wasm.js';
import '../src/python/bpy_interface.js';
import { idStruct, setContextPointer } from '../src/python/bpy_rna.js';
import { createBlenderIDs } from '../src/blenkernel/blender-ids.js';
import { createAnimationModel } from '../src/blenkernel/animation/model.js';
import { createRNA } from '../src/makesrna/rna-bylonder.js';
import { createMainSync } from '../src/blenkernel/main-sync.js';
import { createSelection } from '../src/editors/object/selection.js';
import { visible } from '../src/editors/object/identity.js';

// Main's objects of examples/<id>/<id>.blend by name, and the sync that read it.
function open(id) {
  const scene = new Scene(new NullEngine());
  const animation = createAnimationModel(() => {}, { ids: createBlenderIDs(blenderMain()) });
  const objects = Object.assign([], { scene }), selection = createSelection(scene, objects);
  const sync = createMainSync({ rna: createRNA({ world: { scene, objects }, selection }), ids: animation.ids });
  objects.push(...sync.readBlend(readFileSync(new URL(`../examples/${id}/${id}.blend`, import.meta.url)), scene).nodes);
  setContextPointer(sync.blender.C);
  return { objects: new Map(objects.map((node) => [node.name, idStruct(sync.objectOf(node))])), nodes: new Map(objects.map((node) => [node.name, node])), sync };
}
const names = (collection) => [...collection].map((item) => item.name);

{
  const { objects } = open('rendering');
  const sun = objects.get('Sun').data;
  assert.equal(sun.type, 'SUN');
  assert.ok(sun.use_shadow, 'the sun casts shadows');
  assert.equal(objects.get('Fill').data.type, 'POINT');
  const glass = objects.get('Carafe').data.materials[0];
  assert.ok([...glass.node_tree.nodes].some((n) => n.type === 'BSDF_GLASS'), 'the carafe is glass');
}
{
  const { objects } = open('mesh-modeling');
  const body = objects.get('Camera Body').data, lens = objects.get('Lens').data;
  assert.ok(body.polygons.length > 200, `the body is modeled (${body.polygons.length} faces)`);
  assert.ok([...lens.polygons].every((p) => p.loop_total <= 4), 'the spun lens has no n-gons');
}
{
  const { objects, sync } = open('drivers-and-graph-editor');
  const crosshead = objects.get('Crosshead'), wheel = objects.get('Flywheel');
  assert.match(crosshead.animation_data.drivers[0].driver.expression, /sqrt/);
  for (const frame of [1, 13, 30]) {
    sync.blender.frame = frame;
    const a = wheel.rotation_euler[1];
    const travel = 0.45 * Math.cos(a) + Math.sqrt(1.5 ** 2 - (0.45 * Math.sin(a)) ** 2);
    assert.ok(Math.abs(crosshead.location[0] - travel) < 1e-4, `frame ${frame}: the crosshead at ${crosshead.location[0]}, not ${travel}`);
  }
}
{
  const { objects } = open('vertex-and-weight-paint');
  for (const name of ['Kohaku', 'Showa']) {
    const fish = objects.get(name);
    assert.ok(names(fish.data.color_attributes).includes('Markings'), `${name} has its Markings`);
    assert.ok(names(fish.vertex_groups).includes('Tail'), `${name} has its Tail group`);
    assert.equal(fish.modifiers.get('Tail Swing').vertex_group, 'Tail');
  }
}
{
  // Akari Noodle House opens with the tea break's rig hidden (H), its bones undrawn, while her body shows and the rig still
  // poses it.
  const { objects, nodes, sync } = open('compositor');
  const rig = objects.get('Tea Break Rig');
  assert.equal(rig.hide_get(), true, 'the rig is hidden in the viewport');
  assert.equal(visible(nodes.get('Tea Break Rig')), false, 'so its bones are not drawn');
  assert.equal(visible(nodes.get('Tea Break')), true, 'her body shows');
  const chest = () => [...rig.pose.bones.get('Spine2').rotation_quaternion];
  sync.blender.frame = 1;
  const breathing = chest();
  sync.blender.frame = 61;
  assert.notDeepEqual(chest(), breathing, 'she breathes: the hidden rig still plays its animation');
  nodes.get('Tea Break').getScene().getEngine().dispose();
}
console.log('feature examples ok');
