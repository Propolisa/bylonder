// A node's GPU code as Blender's own C++ builds it (tools/blender-port/wasm/gpu-material-api.cc): the node's GPU
// function runs in the module on Blender's GPU node graph, its inputs linked as Blender's compositor links them, and
// the graph comes back as calls of Blender's GLSL functions (gpu-library.js). `nodeGraph` records it for a node type
// with properties and values, cached per state, and `graphCode` writes it as GLSL ES, as Blender's codegen
// (gpu_codegen.cc node_serialize) writes a pass.
import { provided } from '../../port/wasm.js';
import { blenderMain, blenderModule } from '../../bmesh/bmesh-wasm.js';
import { blendData } from '../../python/bpy_rna.js';
// RNA in Blender's context, which menu sockets' items need.
import '../../python/bpy_interface.js';
import { glsl as libraries } from './gpu-library.js';
import { glslFunction, glslName } from './glsl.js';
import { convert, glslType, glslValue } from './sockets.js';

const { exports: x, withString, cString } = blenderModule;

// Blender's GLSL function signatures, as its shader tool reads a node function's (shader_tool/processor.cc
// parse_library_functions): a parameter's qualifier is in, out or inout, a reference (`T &name`) being out; its type
// as GPUType (GPU_material.hh).
const GPU_TYPES = { float: 1, float2: 2, vec2: 2, float3: 3, vec3: 3, float4: 4, vec4: 4, float3x3: 9, mat3: 9, float4x4: 16, mat4: 16,
  sampler1DArray: 1001, sampler2D: 1002, sampler2DArray: 1003, sampler3D: 1004, Closure: 1007 };
const QUALIFIERS = { in: 0, out: 1, inout: 2 };
const signatures = new Map();
export function signature(name) {
  if (!signatures.has(name)) {
    const pattern = new RegExp(`\\bvoid\\s+${name}\\s*\\(([^)]*)\\)\\s*\\{`);
    const params = Object.values(libraries).map((text) => pattern.exec(text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, ''))).find(Boolean)?.[1];
    signatures.set(name, params === undefined ? null : params.split(',').map((p) => p.trim()).filter(Boolean).map((p) => {
      const tokens = p.match(/\w+|&/g), reference = tokens.at(-2) === '&', type = tokens.at(reference ? -3 : -2), before = tokens.at(reference ? -4 : -3);
      return { type: GPU_TYPES[type] ?? 1, qualifier: QUALIFIERS[before] ?? (reference ? QUALIFIERS.out : QUALIFIERS.in) };
    }));
  }
  return signatures.get(name);
}
provided.gpu_function_signature = (namePointer, types, quals, max) => {
  const params = signature(cString(namePointer));
  if (!params) return -1;
  const memory = new Int32Array(x.memory.buffer);
  params.slice(0, max).forEach(({ type, qualifier }, i) => { memory[(types >>> 2) + i] = type; memory[(quals >>> 2) + i] = qualifier; });
  return Math.min(params.length, max);
};

// The graph of a node type (in a tree of `treeType`) with its properties and input values, those in `linked` linked
// from images: { nodes: [{ name, inputs: [{ type, source, ... }], outputs: [{ type, id }] }], outputs: { socket: id },
// bands: [pixels] }, or null when the node has no GPU code.
const graphs = new Map();
export function nodeGraph(treeType, idname, { properties = {}, values = {}, linked = [] }) {
  const key = JSON.stringify([treeType, idname, properties, values, linked]);
  if (graphs.has(key)) return graphs.get(key);
  // A node group of Main's holding the node, made and removed through RNA as Blender's Python would, so its tree updates
  // (socket availability, menu items) are Blender's.
  const data = blendData(blenderMain().C), group = data.node_groups.new('GPU Scratch', treeType);
  try {
    const node = group.nodes.new(idname);
    for (const [name, value] of Object.entries(properties)) try { if (name === 'mapping') setMapping(node.mapping, value); else node[name] = value; } catch { /* read only */ }
    for (const [id, value] of Object.entries(values)) {
      const input = [...node.inputs].find((s) => s.identifier === id);
      if (input && value !== null && 'default_value' in input) try { input.default_value = value; } catch { /* not settable */ }
    }
    const graph = JSON.parse(withString(linked.join('\n'), (l) => cString(x.node_gpu_graph(group.as_pointer(), node.as_pointer(), l))));
    graphs.set(key, graph.nodes.length ? graph : null);
  } finally {
    data.node_groups.remove(group);
  }
  return graphs.get(key);
}

// A curve mapping's settings and points (colortools.js plainCurveMapping) on a node's, through RNA.
function setMapping(target, { use_clip, extend, clip, curves }) {
  Object.assign(target, { use_clip, extend });
  [target.clip_min_x, target.clip_min_y, target.clip_max_x, target.clip_max_y] = clip;
  curves.forEach((points, i) => {
    const curve = target.curves[i];
    while (curve.points.length < points.length) curve.points.new(0.5, 0.5);
    points.forEach(({ location, handle_type }, j) => Object.assign(curve.points[j], { location, handle_type }));
  });
}

// A GPUType as the kind sockets.js converts between, a 4 float value being a color as Blender's codegen converts it
// (float_from_float4 takes the luminance).
const KINDS = { 1: 'float', 2: 'vec2', 3: 'vec3', 4: 'color4', 9: 'mat3', 16: 'mat4' };
export const gpuKind = (type) => KINDS[type];
const literal = (values, type) => (type === 9 || type === 16 ? `${type === 9 ? 'mat3' : 'mat4'}(${values.map((v) => glslValue(v, 'float')).join(', ')})` : glslValue(values, gpuKind(type)));

// The graph's statements: each node a call of its function, as node_serialize writes it. `image(name, kind)` gives the
// GLSL of an image input's texel as the kind, `uniform(values, kind)` a uniform's name, `band(index)` a band's sampler;
// `emit(key, code)` declares a function once. Returns the code and the GLSL of each output id.
export function graphCode(graph, { image, uniform, band, emit }) {
  const outputs = new Map();
  let code = '';
  for (const node of graph.nodes) {
    for (const [key, text] of glslFunction(node.name)) emit(key, text);
    const args = node.inputs.map((input) => {
      const kind = gpuKind(input.type);
      if (input.source === 'output') { const [e, from] = outputs.get(input.from); return convert(e, from, kind); }
      if (input.source === 'constant') return literal(input.value, input.type);
      if (input.source === 'uniform') return uniform(input.value, kind);
      if (input.source === 'image') return image(input.name, kind);
      if (input.source === 'band') return band(input.band);
      throw Error(`Blender's ${node.name} reads a ${input.source} Bylonder does not give`);
    });
    for (const output of node.outputs) {
      const kind = gpuKind(output.type), name = `bl_v${output.id}`;
      code += `${glslType(kind) ?? kind} ${name} = ${glslValue(0, kind)};\n`;
      outputs.set(output.id, [name, kind]);
    }
    code += `${glslName(node.name)}(${[...args, ...node.outputs.map((o) => outputs.get(o.id)[0])].join(', ')});\n`;
  }
  return { code, outputs };
}

// Whether a node type has GPU code Blender's compositor or EEVEE runs.
export const nodeTypeHasGpu = (idname) => !!withString(idname, (p) => x.node_type_has_gpu(p));
