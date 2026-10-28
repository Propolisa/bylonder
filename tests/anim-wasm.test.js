// Blender's Graph Editor and Dope Sheet operators in the module match Blender 5.2: each fixture
// (tools/blender-reference/anim-fixtures.py) inserts an empty's keys as keyframe_insert does, selects some, runs an
// operator in the editor's main region at the region's size and view, and records every F-Curve's keys.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { BlenderMain, newOperator, blenderModule } from '../src/bmesh/bmesh-wasm.js';
import { BlenderAnimation, animatedProperty } from '../src/blenkernel/animation/anim-blender.js';
import { AnimArea, SPACE_GRAPH, SPACE_ACTION, RGN_TYPE_WINDOW, ACTION_MODES, GRAPH_MODES, OPERATOR_FINISHED, OPERATOR_RUNNING_MODAL } from '../src/editors/animation/anim-area.js';
import { FCURVE } from '../src/blenkernel/animation/anim-blender.js';
import { moduleStruct } from '../src/makesrna/rna-module.js';

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

const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort();
const cases = files.filter((f) => !/^(panel|marker|fmod|driver)-/.test(f)), panels = files.filter((f) => f.startsWith('panel-')), markers = files.filter((f) => f.startsWith('marker-'));
const fmods = files.filter((f) => f.startsWith('fmod-'));
for (const file of cases) {
  const name = file.replace('.json', ''), fixture = read(name), { anim, ob, area } = setup(fixture, name);
  if (fixture.operator) {
    const status = area.run(newOperator(fixture.operator, fixture.props), RGN_TYPE_WINDOW);
    assert.ok(status & OPERATOR_FINISHED, `${name}: ${fixture.operator} finished (${status})`);
  }
  compare(state(anim, ob), fixture.after, name);
  area.dispose();
}

// The Graph Editor's Active Keyframe panel (graph_buttons.cc, recorded) edits the active key: co_ui through its raw
// buttons, whose update callbacks sort the keys and recalculate handles, other properties through the module's RNA
// and then FCurve.update(), as the fixtures set them.
const recordedNodes = (node, out = []) => { out.push(node); (node.children ?? []).forEach((child) => recordedNodes(child, out)); return out; };
for (const file of panels) {
  const name = file.replace('.json', ''), fixture = read(name), [curve, key, prop, value] = fixture.panel;
  const view = { width: 800, height: 400, min: [0, -5], max: [40, 5] };
  const { anim, ob, area } = setup({ ...fixture, space: 'GRAPH_EDITOR', selection: [], frame: 12, view }, name);
  const fcurve = anim.fcurves(ob)[curve];
  // The panel edits the active key while it is selected (BKE_fcurve_active_keyframe_index); the selection goes after.
  const select = (on) => { fcurve.keys = fcurve.keys.map((k, j) => (j === key ? { ...k, select: [on, on, on] } : k)); };
  for (const other of anim.fcurves(ob)) other.flag &= ~FCURVE.ACTIVE;
  fcurve.flag |= FCURVE.ACTIVE | FCURVE.SELECTED;
  select(true);
  fcurve.active_key = key;
  const nodes = area.sidebarPanels().flatMap(({ panel }) => recordedNodes(panel));
  const buttons = nodes.filter((n) => n.button?.prop === prop).map((n) => n.button);
  if (prop === 'co_ui') {
    assert.equal(buttons.length, 2, `${name}: the panel's Key Frame and Value buttons`);
    for (const button of buttons) {
      const keyframe = moduleStruct(button.owner, button.pointer, { C: area.main.C, changed: () => area.panelButtonApplied(button.index) });
      keyframe[prop] = keyframe[prop].map((v, i) => (i === button.element ? value[i] : v));
    }
  } else {
    const { owner, pointer } = nodes.find((n) => n.owner === 'Keyframe' && n.pointer);
    moduleStruct(owner, pointer, { C: area.main.C })[prop] = value;
    blenderModule.exports.rna_fcurve_update(area.main.C, ob, fcurve.pointer);
  }
  select(false);
  compare(state(anim, ob), fixture.after, name);
  area.dispose();
}

// F-Modifiers added by graph.fmodifier_add to the active F-Curve, then set as their panels (fmodifier_ui.cc, recorded) set
// them through the module's RNA (rna_fcurve.cc's set functions and updates): their properties and the F-Curve's values.
const near = (a, b) => (Array.isArray(a) ? a.length === b.length && a.every((v, i) => near(v, b[i])) : typeof a === 'number' ? Math.abs(a - b) < 2e-3 : a === b);
const recordedPointer = (node) => node.pointer ? node : node.children?.map(recordedPointer).find(Boolean);
for (const file of fmods) {
  const name = file.replace('.json', ''), fixture = read(name);
  const view = { width: 800, height: 400, min: [0, -5], max: [40, 5] };
  const { anim, ob, area } = setup({ ...fixture, space: 'GRAPH_EDITOR', selection: [], frame: 12, view }, name);
  const fcurve = anim.fcurves(ob)[0];
  fcurve.flag |= FCURVE.ACTIVE | FCURVE.SELECTED;
  for (const type of fixture.modifiers) {
    assert.ok(area.run(newOperator('graph.fmodifier_add', { type, only_active: true }), RGN_TYPE_WINDOW) & OPERATOR_FINISHED, `${name}: add ${type}`);
  }
  const modifiers = area.sidebarPanels().filter(({ data }) => data).map(({ panel }) => {
    const { owner, pointer } = recordedPointer(panel);
    return moduleStruct(owner, pointer, { C: area.main.C });
  });
  for (const [index, prop, value] of fixture.edits) modifiers[index][prop] = value;
  fixture.after.forEach((expected, i) => {
    for (const [prop, value] of Object.entries(expected)) assert.ok(near(modifiers[i][prop], value), `${name}: modifier ${i} ${prop}: ${modifiers[i][prop]} != ${value}`);
  });
  fixture.frames.forEach((frame, i) => close(fcurve.evaluate(frame), fixture.values[i], `${name}: value at ${frame}`));
  area.dispose();
}

// A driver added on the empty's Y location (ANIM_add_driver, as Python's driver_add), then edited in the Drivers editor's
// Driver panel (graph_buttons.cc, recorded): its Add Input Variable button, and its properties through the module's
// RNA (rna_fcurve.cc's set functions and updates). Its settings, variables and their targets as the panel shows them.
const drivers = files.filter((f) => f.startsWith('driver-'));
const DRIVER_TARGET = ['id_type', 'data_path', 'bone_target', 'transform_type', 'rotation_mode', 'transform_space', 'use_fallback_value', 'fallback_value'];
for (const file of drivers) {
  const name = file.replace('.json', ''), fixture = read(name);
  const view = { width: 800, height: 400, min: [0, -5], max: [40, 5] };
  const { anim, ob, area } = setup({ ...fixture, space: 'GRAPH_EDITOR', selection: [], frame: 12, view }, name);
  area.subtype = GRAPH_MODES.DRIVERS;
  const fcurve = anim.addDriver(ob, ...fixture.driver, 0);
  fcurve.flag |= FCURVE.ACTIVE | FCURVE.SELECTED;
  // The panel's nodes, and the structs its properties show by owner, in the panel's order.
  const panel = () => area.sidebarPanels().filter(({ category }) => category === 'Drivers').flatMap(({ panel: p }) => recordedNodes(p));
  const structs = (owner) => {
    const seen = new Map();
    for (const node of panel()) if (node.owner === owner && node.pointer && !seen.has(node.pointer[2])) seen.set(node.pointer[2], node.pointer);
    return [...seen.values()].map((pointer) => moduleStruct(owner, pointer, { C: area.main.C }));
  };
  for (const [kind, ...edit] of fixture.edits) {
    if (kind === 'add_variable') area.pressPanelButton(panel().find((n) => n.button?.text === 'Add Input Variable').button.index);
    else if (kind === 'driver') structs('Driver')[0][edit[0]] = edit[1];
    else if (kind === 'var') structs('DriverVariable')[edit[0]][edit[1]] = edit[2];
    else structs('DriverTarget')[edit[0] + edit[1]][edit[2]] = edit[3];
  }
  const [driver] = structs('Driver'), variables = structs('DriverVariable'), targets = structs('DriverTarget');
  const ours = { type: driver.type, expression: driver.expression, use_self: driver.use_self,
    variables: variables.map((v, i) => ({ name: v.name, type: v.type, is_name_valid: v.is_name_valid,
      targets: targets.slice(i, i + fixture.after.variables[i].targets.length).map((t) => Object.fromEntries(DRIVER_TARGET.map((p) => [p, t[p]]))) })),
    keys: fcurve.keys.map((k) => k.co) };
  const { modifiers, ...expected } = fixture.after, rounded = (v) => (typeof v === 'number' ? Math.round(v * 1e4) / 1e4 : v);
  assert.deepEqual(modifiers, [], `${name}: no F-Modifiers`);
  assert.deepEqual(JSON.parse(JSON.stringify(ours, (k, v) => rounded(v))), expected, name);
  area.dispose();
}

// Marker operators in the Dope Sheet (anim_markers.cc), on the scene's markers.
for (const file of markers) {
  const name = file.replace('.json', ''), fixture = read(name), main = new BlenderMain(), anim = new BlenderAnimation(main);
  anim.setTime({ frame: fixture.frame, start: 1, end: 250, previewStart: 0, previewEnd: 0, preview: false, fps: 24 });
  anim.markers = fixture.before;
  const area = new AnimArea(main, SPACE_ACTION);
  area.subtype = ACTION_MODES.DOPESHEET;
  area.layout(RGN_TYPE_WINDOW, 0, 0, 800, 400);
  assert.ok(area.run(newOperator(fixture.markers_operator, fixture.props), RGN_TYPE_WINDOW) & OPERATOR_FINISHED, `${name}: finished`);
  assert.deepEqual(anim.markers, fixture.after, name);
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
console.log(`Animation editors: ${cases.length} Graph Editor and Dope Sheet operator results, ${panels.length} sidebar panel edits, ${fmods.length} F-Modifier stacks, ${drivers.length} drivers, ${markers.length} marker operators and ${MODAL.length} modal transforms match Blender 5.2`);
