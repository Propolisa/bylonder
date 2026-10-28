// Blender's Graph Editor and Dope Sheet operators in the module match Blender 5.2: each fixture
// (tools/blender-reference/anim-fixtures.py) inserts an empty's keys as keyframe_insert does, selects some, runs an
// operator in the editor's main region at the region's size and view, and records every F-Curve's keys.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { BlenderMain, newOperator } from '../src/bmesh/bmesh-wasm.js';
import { BlenderAnimation, animatedProperty } from '../src/blenkernel/animation/anim-blender.js';
import { AnimArea, SPACE_GRAPH, SPACE_ACTION, RGN_TYPE_WINDOW, ACTION_MODES, OPERATOR_FINISHED, OPERATOR_RUNNING_MODAL } from '../src/editors/animation/anim-area.js';

const dir = new URL('./fixtures/anim/', import.meta.url);
const close = (a, b, label) => assert.ok(Math.abs(a - b) < 2e-3, `${label}: ${a} != ${b}`);

function state(anim, ob) {
  return anim.fcurves(ob).map((fc) => ({
    rna_path: fc.rna_path, index: fc.array_index, group: fc.group, extrapolation: fc.extrapolation,
    keys: fc.keys.map((k) => ({ co: k.co, left: k.handle_left, right: k.handle_right, interpolation: k.interpolation, left_type: k.handle_left_type,
      right_type: k.handle_right_type, easing: k.easing, type: k.type, select: k.select })),
  }));
}

function compare(ours, theirs, name) {
  assert.equal(ours.length, theirs.length, `${name}: F-Curve count`);
  ours.forEach((fc, i) => {
    const ref = theirs[i], label = `${name} ${ref.rna_path}[${ref.index}]`;
    for (const key of ['rna_path', 'index', 'group', 'extrapolation']) assert.equal(fc[key], ref[key], `${label} ${key}`);
    assert.equal(fc.keys.length, ref.keys.length, `${label}: key count`);
    fc.keys.forEach((k, j) => {
      const r = ref.keys[j], at = `${label} key ${j}`;
      for (const v of ['co', 'left', 'right']) k[v].forEach((c, n) => close(c, r[v][n], `${at} ${v}`));
      for (const v of ['interpolation', 'left_type', 'right_type', 'easing', 'type']) assert.equal(k[v], r[v], `${at} ${v}`);
      assert.deepEqual(k.select, r.select, `${at} select`);
    });
  });
}

// The fixture's scene: its keys inserted, its selection made, and its editor's area at its region's size and view.
function setup(fixture, name) {
  const main = new BlenderMain(), anim = new BlenderAnimation(main), ob = main.add('EMPTY', 'Empty');
  main.setBase(ob, { select: true, active: true });
  anim.setTime({ frame: 1, start: 1, end: 250, previewStart: 0, previewEnd: 0, preview: false, fps: 24 });
  for (const [path, index, points] of fixture.keys) {
    const { type, subtype } = animatedProperty('Object', path);
    const fc = anim.fcurve(ob, path, index, { group: 'Object Transforms', type, subtype });
    for (const [frame, value] of points) assert.ok(anim.insert(fc, frame, value), `${name}: insert ${path}[${index}] at ${frame}`);
  }
  anim.setTime({ frame: fixture.frame, start: 1, end: 250, previewStart: 0, previewEnd: 0, preview: false, fps: 24 });
  anim.fcurves(ob).forEach((fc, i) => {
    fc.keys = fc.keys.map((k, j) => {
      const parts = fixture.selection.filter(([c, kk]) => c === i && kk === j).map(([, , part]) => part);
      return { ...k, select: [['left', 'all'], ['key', 'all'], ['right', 'all']].map((p) => parts.some((part) => p.includes(part))) };
    });
  });
  compare(state(anim, ob), fixture.before, `${name} (before)`);
  const area = new AnimArea(main, fixture.space === 'GRAPH_EDITOR' ? SPACE_GRAPH : SPACE_ACTION);
  if (area.spacetype === SPACE_ACTION) area.subtype = ACTION_MODES.DOPESHEET;
  area.layout(RGN_TYPE_WINDOW, 0, 0, fixture.view.width, fixture.view.height);
  const [[xmin, ymin], [xmax, ymax]] = [fixture.view.min, fixture.view.max];
  area.v2d().cur = { xmin, xmax, ymin, ymax };
  return { anim, ob, area };
}
const read = (name) => JSON.parse(fs.readFileSync(new URL(name + '.json', dir)));

const cases = fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort();
for (const file of cases) {
  const name = file.replace('.json', ''), fixture = read(name), { anim, ob, area } = setup(fixture, name);
  if (fixture.operator) {
    const status = area.run(newOperator(fixture.operator, fixture.props), RGN_TYPE_WINDOW);
    assert.ok(status & OPERATOR_FINISHED, `${name}: ${fixture.operator} finished (${status})`);
  }
  compare(state(anim, ob), fixture.after, name);
  area.dispose();
}

// Blender's modal transform from events: the key, an axis, a typed value and Enter give what the operator's exec with
// that value gives (with snapping to frames toggled off for scaling, which the exec does not snap).
const DIGITS = ['ZERO', 'ONE', 'TWO', 'THREE', 'FOUR', 'FIVE', 'SIX', 'SEVEN', 'EIGHT', 'NINE'];
const MODAL = [['graph-translate', 'transform.translate', 'G', ['AXIS_X'], '5'], ['graph-translate-y', 'transform.translate', 'G', ['AXIS_Y'], '1.5'],
  ['graph-resize-x', 'transform.resize', 'S', ['SNAP_TOGGLE', 'AXIS_X'], '2'], ['dopesheet-time-translate', 'transform.transform', 'T', [], '4']];
for (const [name, idname, key, axes, typed] of MODAL) {
  const fixture = read(name), { anim, ob, area } = setup(fixture, name), at = { x: 600, y: 400 };
  const props = idname === 'transform.transform' ? { mode: 'TIME_TRANSLATE' } : {};
  assert.equal(area.run(newOperator(idname, props), RGN_TYPE_WINDOW, { type: key, ...at }) & OPERATOR_RUNNING_MODAL, OPERATOR_RUNNING_MODAL, `${name}: modal`);
  for (const axis of axes) area.handle({ modal: area.modalItem(axis), ...at });
  for (const c of typed) area.handle({ type: c === '.' ? 'PERIOD' : DIGITS[c], text: c, ...at });
  assert.ok(area.handle({ modal: area.modalItem('CONFIRM'), ...at }) & OPERATOR_FINISHED, `${name}: confirmed`);
  compare(state(anim, ob), fixture.after, `${name} (modal)`);
  area.dispose();
}
console.log(`Animation editors: ${cases.length} Graph Editor and Dope Sheet operator results and ${MODAL.length} modal transforms match Blender 5.2`);
