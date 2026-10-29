// The window manager's reports (wm->reports, BKE_report): what operators and scripts report, kept by Blender's window
// manager (tools/blender-port/wasm/reports.cc), whose Info editor lists them. A finished operator with the REGISTER
// option reports its call as Python (wm_operator_reports).
import registerOperators from './operator-register.json' with { type: 'json' };
import rnaOperators from '../makesrna/rna-operators.json' with { type: 'json' };
import { blenderMain, blenderModule } from '../bmesh/bmesh-wasm.js';

const { exports: x, withString } = blenderModule;
const REGISTER = new Set(registerOperators);
const listeners = new Set();

// BKE_report: type is one of DEBUG, INFO, OPERATOR, PROPERTY, WARNING, ERROR, ERROR_INVALID_INPUT, ...
export function report(type, message) {
  withString(type, (t) => withString(String(message), (m) => x.wm_report(blenderMain().C, t, m)));
  listeners.forEach((fn) => fn({ type, message: String(message) }));
}
export const subscribeReports = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };

// RNA_property_as_string: Python literals as Blender writes them.
const literal = (value, enumProperty) => {
  if (typeof value === 'boolean') return value ? 'True' : 'False';
  if (typeof value === 'number') return Number.isInteger(value) ? String(value) : String(Number(value.toPrecision(6)));
  if (typeof value === 'string') return enumProperty ? `'${value}'` : JSON.stringify(value);
  if (Array.isArray(value) || ArrayBuffer.isView(value) || value instanceof Set) {
    const items = [...value].map((item) => literal(item, enumProperty));
    return enumProperty ? `{${items.join(', ')}}` : `(${items.join(', ')})`;
  }
  // A macro's properties of one of its operators.
  if (value && typeof value === 'object') {
    return `{${Object.entries(value).filter(([, v]) => typeof v !== 'function').map(([k, v]) => `"${k}":${literal(v)}`).join(', ')}}`;
  }
  return value == null ? 'None' : String(value);
};

// WM_operator_pystring: bpy.ops.mesh.primitive_cube_add(size=2), with the properties set.
export function operatorPystring(idname, props = {}) {
  const defs = rnaOperators[idname]?.properties ?? {};
  const args = Object.entries(props).filter(([name, value]) => defs[name] && !defs[name].hidden && value !== undefined)
    .map(([name, value]) => `${name}=${literal(value, defs[name].type === 'ENUM')}`);
  return `bpy.ops.${idname}(${args.join(', ')})`;
}

export function operatorFinished(idname, props) {
  if (REGISTER.has(idname)) report('OPERATOR', operatorPystring(idname, props));
}
