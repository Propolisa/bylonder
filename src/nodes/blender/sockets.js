// Blender's socket types against Babylon's connection point types, and the implicit conversions Blender's shader
// code generation makes between them (gpu_shader_codegen_lib.glsl: float_from_float4 and its kin), so a Blender
// node links to any Babylon block whose type it converts to, as two Blender nodes would link.
import { NodeMaterialBlockConnectionPointTypes as T } from '@babylonjs/core';

// The scene linear luminance Blender's default color management gives a color read as a value (Rec. 709).
export const LUMINANCE = [0.2126729, 0.7151522, 0.072175];

// A Blender socket type as its GPU node stack passes it: GLSL type, kind and Babylon connection point type. Integers,
// booleans and menus are floats on the GPU, as in Blender.
export const SOCKETS = {
  VALUE: { glsl: 'float', kind: 'float', babylon: T.Float },
  INT: { glsl: 'float', kind: 'float', babylon: T.Float },
  BOOLEAN: { glsl: 'float', kind: 'float', babylon: T.Float },
  MENU: { glsl: 'float', kind: 'float' },
  VECTOR: { glsl: 'vec3', kind: 'vec3', babylon: T.Vector3 },
  RGBA: { glsl: 'vec4', kind: 'color4', babylon: T.Color4 },
  // A closure as the radiance it leaves toward the view, and its alpha (shader-nodes.js).
  SHADER: { glsl: 'vec4', kind: 'closure', babylon: T.Color4 },
};
export const socketType = (type) => SOCKETS[type];

// A Babylon connection point type as a kind: its GLSL type and whether it holds a color.
const KINDS = {
  [T.Float]: 'float', [T.Int]: 'int', [T.Vector2]: 'vec2', [T.Vector3]: 'vec3', [T.Vector4]: 'vec4',
  [T.Color3]: 'color3', [T.Color4]: 'color4',
};
export const kindOf = (type) => KINDS[type];
export const BABYLON_TYPES = Object.keys(KINDS).map(Number);
const GLSL = { float: 'float', int: 'int', vec2: 'vec2', vec3: 'vec3', vec4: 'vec4', color3: 'vec3', color4: 'vec4', closure: 'vec4' };
export const glslType = (kind) => GLSL[kind];
const size = (kind) => ({ float: 1, int: 1, vec2: 2, vec3: 3, color3: 3, vec4: 4, color4: 4, closure: 4 })[kind];
const isColor = (kind) => kind === 'color3' || kind === 'color4';
const literal = (v) => (Number.isInteger(v) ? v.toFixed(1) : String(v));

// The expression converting `e` of kind `from` to kind `to`, as Blender converts linked sockets.
export function convert(e, from, to) {
  const n = size(from), m = size(to);
  if (from === to || (n === m && n > 1)) return e;
  if (from === 'int') return convert(`float(${e})`, 'float', to);
  if (m === 1) {
    if (to === 'int') return `int(${convert(e, from, 'float')})`;
    if (isColor(from)) return `dot(${e}.rgb, vec3(${LUMINANCE.map(literal).join(', ')}))`;
    return n === 2 ? `((${e}.x + ${e}.y) * 0.5)` : `((${e}.x + ${e}.y + ${e}.z) * (1.0 / 3.0))`;
  }
  if (n === 1) return m === 4 ? `vec4(vec3(${e}), 1.0)` : `${glslType(to)}(${e})`;
  if (m === 4) return n === 3 ? `vec4(${e}, 1.0)` : `vec4(${e}.xy, 0.0, 1.0)`;
  if (m === 3) return n === 4 ? `${e}.rgb` : `vec3(${e}.xy, 0.0)`;
  return `${e}.xy`;
}

// Whether Blender converts between the kinds (all but matrices and objects, and closures only to closures).
export const converts = (from, to) => !!size(from) && !!size(to) && (from === 'closure') === (to === 'closure');

// A GLSL literal of a socket value of a kind.
export function glslValue(value, kind) {
  const values = Array.isArray(value) ? value : [value];
  if (size(kind) === 1) return literal(Number(values[0]));
  return `${glslType(kind)}(${values.slice(0, size(kind)).map((v) => literal(Number(v))).join(', ')})`;
}
