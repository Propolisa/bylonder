// A Blender node's GPU code as its C++ links it (GPU_stack_link and GPU_link in node_shader_*.cc and
// node_composite_*.cc), for the blocks that run Blender nodes in Babylon's graphs. A node links steps of
// [function, arguments, outputs]: an argument is an input socket's identifier, an output's as '@identifier' (its link so
// far), an output socket's own value as '=identifier', a value of the shaded point as '$name' (shader-nodes.js), a
// local value a step wrote as '#name', or a constant (a number, an array for a vector, { glsl } for anything else,
// { texture } for a sampler of an RGBA table, as GPU_color_band, { image } for one of an Image, as GPU_image); each
// output listed (a socket, or [#name, kind] for a local value) is written by the call and links to its result from then
// on. An argument is converted to its parameter's type, as GPU_link converts it.
import { glslFunction, glslName } from './glsl.js';
import { convert, converts, glslType, glslValue, socketType } from './sockets.js';

// GPU_stack_link: all inputs, then the extra arguments, then all outputs.
export const stack = (name, decl, extra = []) =>
  [name, [...decl.inputs.map((s) => s.identifier), ...extra], decl.outputs.map((s) => '@' + s.identifier)];

export const glslIdentifier = (name) => ('bl_' + name.replace(/\W+/g, '_')).replace(/_{2,}/g, '_');

// A step's socket: an output ('@identifier'), an output's own value ('=identifier', as a Value node holds it) or an input.
export const socketOf = (decl, id) => (id[0] === '@' || id[0] === '=' ? decl.outputs.find((s) => id.slice(1) === s.identifier) : decl.inputs.find((s) => s.identifier === id));
export const kindOfSocket = (decl, id) => socketType(socketOf(decl, id).type)?.kind;

const constant = (arg, sampler) => {
  if (typeof arg === 'number') return glslValue(arg, 'float');
  if (Array.isArray(arg)) return glslValue(arg, arg.length === 4 ? 'vec4' : arg.length === 2 ? 'vec2' : 'vec3');
  if (arg?.texture || arg?.image || arg?.sky) return sampler(arg);
  return arg?.glsl;
};

// The statements running the steps; `links` gives and takes the GLSL of socket links, `emit(name, code)` declares a
// function once, `free(prefix)` gives a fresh variable name, `sampler(arg)` a sampler of its table or image, and
// `functions` GLSL of the caller's own (Bylonder's stand-ins for Blender's engine code) by name; `pointKind(name)`
// the kind of a value of the shaded point, where it may differ from its parameter's.
export function compileSteps(decl, steps, links, { emit, free, sampler, functions = {}, pointKind = () => undefined }) {
  let code = '';
  const locals = new Map();
  const kindOfArg = (a) => (typeof a !== 'string' ? undefined : a[0] === '#' ? locals.get(a) : a[0] === '$' ? pointKind(a) : socketOf(decl, a) && kindOfSocket(decl, a));
  for (const [name, args, outs] of steps.filter(Boolean)) {
    let text = functions[name];
    if (text) emit(name, text);
    else for (const [key, glsl] of glslFunction(name)) {
      // Bylonder's stand-ins for engine functions Blender's GLSL calls, before their callers.
      for (const [standIn, standInGlsl] of Object.entries(functions)) if (new RegExp(`\\b${standIn}\\(`).test(glsl)) emit(standIn, standInGlsl);
      emit(key, glsl);
      text = glsl;
    }
    const params = parameterKinds(text, functions[name] ? name : glslName(name), args.length + outs.length);
    const results = outs.map((out) => {
      const [id, kind] = Array.isArray(out) ? out : [out, kindOfSocket(decl, out)], v = free(glslIdentifier(id));
      if (Array.isArray(out)) locals.set(id, kind);
      code += `${glslType(kind)} ${v} = ${glslValue(0, kind)};\n`;
      return [id, v];
    });
    const values = args.map((a, i) => {
      const e = constant(a, sampler) ?? links.get(a), from = kindOfArg(a);
      return from && params[i] ? convert(e, from, params[i]) : e;
    });
    code += `${functions[name] ? name : glslName(name)}(${[...values, ...results.map(([, v]) => v)].join(', ')});\n`;
    for (const [id, v] of results) links.set(id, v);
  }
  return code;
}

// The kinds of a function's parameters (of its overload taking `count`), as its GLSL declares them.
const PARAMETER_KINDS = { float: 'float', vec2: 'vec2', vec3: 'vec3', vec4: 'vec4' };
function parameterKinds(text, name, count) {
  for (const [, list] of text.matchAll(new RegExp(`\\b${name}\\s*\\(([^)]*)\\)\\s*\\{`, 'g'))) {
    const params = list.split(',').map((p) => p.trim()).filter(Boolean);
    if (params.length === count) return params.map((p) => PARAMETER_KINDS[/^(?:(?:inout|out|in|const)\s+)*(\w+)/.exec(p)?.[1]]);
  }
  return [];
}

// A muted node (node_internal_links): each output takes the first available input of its type, else of a type it
// converts from.
export function muteLinks(decl, available, links) {
  const candidates = decl.inputs.filter((s) => available.has(s.identifier) && socketType(s.type) && s.type !== 'MENU');
  for (const out of decl.outputs) {
    const kind = socketType(out.type)?.kind;
    if (!kind) continue;
    const from = candidates.find((s) => s.type === out.type) ?? candidates.find((s) => converts(socketType(s.type).kind, kind));
    links.set('@' + out.identifier, from ? convert(links.get(from.identifier), socketType(from.type).kind, kind) : glslValue(0, kind));
  }
}

// A menu socket's value as its item index, as Blender passes menus to its GPU functions.
export const menuValue = (socket, value) => glslValue(Math.max(0, socket.items?.indexOf(value) ?? 0), 'float');

// Unlinked inputs' uniforms: [uniform, input identifier, kind], set from the node's values.
export function setUniforms(effect, uniforms, values) {
  for (const [name, id, kind] of uniforms) {
    const v = values[id];
    if (kind === 'float') effect.setFloat(name, Number(v));
    else if (kind === 'vec3') effect.setFloat3(name, v[0], v[1], v[2]);
    else effect.setFloat4(name, v[0], v[1], v[2], v[3]);
  }
}
