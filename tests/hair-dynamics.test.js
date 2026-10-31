// Hair Dynamics (Blender's Essentials node group: simulation zones and the XPBD solver), run by Blender's geometry nodes
// in the module against Blender 5.2's results (tools/blender-reference/hair-dynamics-fixtures.py): the same operators,
// with the assets read from the module's Essentials library once its asset list loads, and the evaluated control
// points at frames played from the start; the view draws the Curves object's evaluated curves (main-view.js drawCurves).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { NullEngine, Scene } from '@babylonjs/core';
import { blenderModule, datafiles } from '../src/bmesh/bmesh-wasm.js';
import { blendData, contextStruct, inPythonContext, setContextPointer } from '../src/python/bpy_rna.js';
import { sceneMain } from './scene-main.js';

const { case: CASE, frames } = JSON.parse(fs.readFileSync(new URL('./fixtures/hair-dynamics.json', import.meta.url)));
await datafiles;
const scene = new Scene(new NullEngine()), objects = Object.assign([], { scene });
const sync = sceneMain({ scene, objects });
sync.flush();
const { blender } = sync, x = blenderModule.exports;
setContextPointer(blender.C);
const python = (fn) => inPythonContext(blender.C, fn);

// Each operator is picked from a menu, as the Add Modifier menu's asset catalogs show them: drawing it loads the asset
// list (again after Main changes), which the window's ticks finish.
const openMenu = () => {
  assert(blender.menu('OBJECT_MT_modifier_add_root_catalogs'));
  for (let ticks = 0; x.wm_timers_active(blender.C); ticks++) {
    assert(ticks < 100, 'the asset list loads');
    x.wm_tick(blender.C);
  }
};

for (const [idname, props] of CASE.operators) {
  openMenu();
  const { status, report } = blender.run(idname, props);
  assert.equal(status, 4, `${idname}: ${report}`);
}
const hair = python(() => blendData().objects.get('Curves'));
python(() => {
  assert.deepEqual([...hair.modifiers].map((m) => m.name), ['Generate Hair Curves', 'Hair Dynamics']);
  for (const [modifier, inputs] of Object.entries(CASE.inputs)) {
    for (const [identifier, value] of Object.entries(inputs)) {
      hair.modifiers.get(modifier).properties.inputs[identifier].value = blendData().objects.get(value) ?? value;
    }
  }
  hair.update_tag();
});

const evaluated = () => python(() => {
  const curves = hair.evaluated_get(contextStruct().evaluated_depsgraph_get()).data;
  return { count: curves.curves.length, positions: [...curves.points].flatMap((point) => [...point.position]) };
});
sync.view();
const node = scene.getNodeByName('Curves');
assert.equal(node?.metadata.wbType, 'CURVES', 'the view places the Curves object');
const strands = () => scene.meshes.find((mesh) => mesh.name.startsWith('__curves overlay'));
for (let frame = 1, at = 0; frame <= CASE.frames.at(-1); frame++) {
  sync.frameChanged(frame);
  if (frame !== CASE.frames[at]) continue;
  at++;
  const expected = frames[frame], { count, positions } = evaluated();
  assert.equal(count, expected.curves, `frame ${frame}: hairs`);
  assert.equal(positions.length, expected.positions.length, `frame ${frame}: points`);
  const error = Math.max(...positions.map((value, i) => Math.abs(value - expected.positions[i])));
  assert(error < 1e-5, `frame ${frame}: control points within 1e-5 of Blender's (${error})`);
  const record = blender.curves().find((r) => r.system === -1);
  assert.equal(record?.length.length, expected.curves, `frame ${frame}: the view draws each hair`);
  assert(strands(), `frame ${frame}: the overlay draws the strands`);
}
