// Blender's driver and F-Curve results as a black box for clean-room work (scripts/cleanroom-oracle.mjs bundles it):
// each request is answered by Blender's own code in the module, through RNA as Python's bpy would set it up.
import { BlenderMain } from '../../src/bmesh/bmesh-wasm.js';
import { BlenderAnimation, setCustomProperty } from '../../src/blenkernel/animation/anim-blender.js';
import { idStruct, pointerStruct, structFind, setContextPointer } from '../../src/python/bpy_rna.js';

const main = new BlenderMain(), anim = new BlenderAnimation(main);
setContextPointer(main.C);
const FCURVE = structFind('FCurve');
const fcurveStruct = (id, fcurve) => pointerStruct(FCURVE, id, fcurve.pointer);

// One curve for plain requests, one whose first modifier is Cycles (Blender treats a curve cyclic only then).
const curves = main.add('EMPTY', 'Curves');
const plain = anim.fcurve(curves, 'location', 0);
const cyclic = anim.fcurve(curves, 'location', 2);
const cycles = fcurveStruct(curves, cyclic).modifiers.new('CYCLES');
const CYCLES_DEFAULTS = { mode_before: 'REPEAT', mode_after: 'REPEAT', cycles_before: 0, cycles_after: 0 };

const KEY_FIELDS = ['co', 'handle_left', 'handle_right', 'handle_left_type', 'handle_right_type', 'interpolation', 'easing', 'back', 'amplitude', 'period', 'select'];
const pick = (object, keys) => Object.fromEntries(keys.filter((k) => object[k] !== undefined).map((k) => [k, object[k]]));

function fcurve({ keyframes = [], extrapolation = 'CONSTANT', cycles: cyclesSettings = false, auto_smoothing = 'NONE', times = [] }) {
  const fc = cyclesSettings ? cyclic : plain;
  if (cyclesSettings) Object.assign(cycles, CYCLES_DEFAULTS, cyclesSettings === true ? {} : cyclesSettings);
  fc.extrapolation = extrapolation;
  fcurveStruct(curves, fc).auto_smoothing = auto_smoothing;
  fc.keys = keyframes.map((key) => pick(key, KEY_FIELDS));
  return {
    values: times.map((t) => fc.evaluate(t)),
    handles: fc.keys.map((k) => pick(k, ['co', 'handle_left', 'handle_right', 'handle_left_type', 'handle_right_type'])),
  };
}

const TRANSFORM_PROPS = ['rotation_mode', 'location', 'rotation_euler', 'rotation_quaternion', 'rotation_axis_angle', 'scale',
  'delta_location', 'delta_rotation_euler', 'delta_rotation_quaternion', 'delta_scale'];

// Empties made for one request, removed after it.
class Scene {
  objects = [];
  named = new Map();
  constructor(objects = {}) { this.definitions = objects; }
  add(name) {
    const ob = main.add('EMPTY', name);
    this.objects.push(ob);
    return ob;
  }
  // An empty from its description, or the request's named one ("objects": { name: description }).
  object(description) {
    if (typeof description === 'string') {
      if (!this.named.has(description)) this.named.set(description, this.object(this.definitions[description] ?? {}));
      return this.named.get(description);
    }
    const ob = this.add('Target'), rna = idStruct(ob);
    if (description.parent) rna.parent = idStruct(this.object(description.parent));
    for (const prop of TRANSFORM_PROPS) if (description[prop] !== undefined) rna[prop] = description[prop];
    // Given in rows as Python's Matrix, stored by columns.
    const inverse = description.matrix_parent_inverse;
    if (inverse) rna.matrix_parent_inverse = [0, 1, 2, 3].flatMap((column) => inverse.map((row) => row[column]));
    for (const [name, value] of Object.entries(description.properties ?? {})) setCustomProperty(ob, name, value);
    return ob;
  }
  dispose() { this.objects.toReversed().forEach((ob) => main.remove(ob)); }
}

const TARGET_PROPS = ['data_path', 'transform_type', 'transform_space', 'rotation_mode'];

// A driver on an empty's Y location, as Python's driver_add makes it, without the F-Curve's keys: its value is the
// driver's own. Returns its value at the frame, or why Blender gives none.
function driver({ type = 'SCRIPTED', expression = '', variables = [], frame = 1, objects }) {
  const scene = new Scene(objects);
  try {
    const owner = scene.add('Owner'), fc = anim.addDriver(owner, 'location', 1, 0), d = fcurveStruct(owner, fc).driver;
    fc.keys = [];
    d.type = type;
    d.expression = expression;
    for (const variable of variables) {
      const v = d.variables.new();
      v.name = variable.name;
      v.type = variable.type ?? 'SINGLE_PROP';
      (variable.targets ?? []).forEach((target, i) => {
        const t = v.targets[i];
        if (target.object !== undefined) t.id = idStruct(scene.object(target.object));
        for (const prop of TARGET_PROPS) if (target[prop] !== undefined) t[prop] = target[prop];
      });
    }
    // Blender gives an empty or invalid expression 0, and hands what its simple evaluator cannot parse to Python.
    if (type === 'SCRIPTED' && expression && d.is_valid && !d.is_simple_expression) return { error: 'python-only' };
    main.relationsChanged();
    main.frame = frame;
    main.evaluate();
    const value = main.transform(owner).location[1];
    return d.is_valid ? { value } : { value, valid: false };
  } finally {
    scene.dispose();
  }
}

// A simple expression with variables of given values (through single-property variables, as Blender reads them).
function expression({ expression, variables = {}, frame = 1 }) {
  const properties = Object.fromEntries(Object.entries(variables).map(([name, value], i) => [`v${i}`, value]));
  return driver({ expression, frame, objects: { holder: { properties } },
    variables: Object.keys(variables).map((name, i) => ({ name, type: 'SINGLE_PROP', targets: [{ object: 'holder', data_path: `["v${i}"]` }] })) });
}

const KINDS = { expression, driver, fcurve };
export function answer(request) {
  const kind = KINDS[request?.kind];
  if (!kind) return { error: `unknown kind: ${request?.kind}` };
  try {
    return kind(request);
  } catch (error) {
    return { error: String(error?.message ?? error) };
  }
}
