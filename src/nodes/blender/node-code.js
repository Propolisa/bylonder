// A Blender node's GPU code as its C++ links it (GPU_stack_link and GPU_link in node_shader_*.cc and
// node_composite_*.cc), for the blocks that run Blender nodes in Babylon's graphs. A node links steps of
// [function, arguments, outputs]: an argument is an input socket's identifier, an output's as '@identifier' (its link so
// far), a value of the shaded point as '$name' (shader-nodes.js), or a constant (a number, an array for a vector,
// { glsl } for anything else, { texture } for a sampler of an RGBA table, as GPU_color_band); each output listed is
// written by the call and links to its result from then on.
import { glslFunction, glslName } from './glsl.js';
import { convert, converts, glslType, glslValue, socketType } from './sockets.js';

// GPU_stack_link: all inputs, then the extra arguments, then all outputs.
export const stack = (name, decl, extra = []) =>
  [name, [...decl.inputs.map((s) => s.identifier), ...extra], decl.outputs.map((s) => '@' + s.identifier)];

export const glslIdentifier = (name) => ('bl_' + name.replace(/\W+/g, '_')).replace(/_{2,}/g, '_');

const socketOf = (decl, id) => (id.startsWith('@') ? decl.outputs.find((s) => '@' + s.identifier === id) : decl.inputs.find((s) => s.identifier === id));
export const kindOfSocket = (decl, id) => socketType(socketOf(decl, id).type)?.kind;

const constant = (arg, sampler) => {
  if (typeof arg === 'number') return glslValue(arg, 'float');
  if (Array.isArray(arg)) return glslValue(arg, arg.length === 4 ? 'vec4' : arg.length === 2 ? 'vec2' : 'vec3');
  if (arg?.texture) return sampler(arg.texture);
  return arg?.glsl;
};

// The statements running the steps; `links` gives and takes the GLSL of socket links, `emit(name, code)` declares a
// function once, `free(prefix)` gives a fresh variable name, `sampler(table)` a sampler of a texture of the table, and
// `functions` GLSL of the caller's own (Bylonder's stand-ins for Blender's engine code) by name.
export function compileSteps(decl, steps, links, { emit, free, sampler, functions = {} }) {
  let code = '';
  for (const [name, args, outs] of steps.filter(Boolean)) {
    if (functions[name]) emit(name, functions[name]);
    else for (const [key, text] of glslFunction(name)) emit(key, text);
    const results = outs.map((out) => {
      const kind = kindOfSocket(decl, out), v = free(glslIdentifier(out));
      code += `${glslType(kind)} ${v} = ${glslValue(0, kind)};\n`;
      return [out, v];
    });
    code += `${functions[name] ? name : glslName(name)}(${[...args.map((a) => constant(a, sampler) ?? links.get(a)), ...results.map(([, v]) => v)].join(', ')});\n`;
    for (const [out, v] of results) links.set(out, v);
  }
  return code;
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
