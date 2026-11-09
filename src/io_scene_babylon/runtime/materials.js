// @ts-check
// SPDX-License-Identifier: MIT OR Apache-2.0
// Materials on the IR (docs/ir.md Graphs): a shader graph's nodes as one GLSL body. Each node resolves by its type key
// (`node:<idname>`) through the registry: a unit's piece first, else the piece the package ships for that node (its own
// file, made at export). A piece is one GLSL function of the node's inputs, outputs and what it reads of the drawn point;
// the body calls them in link order. The body fills an exported material's node block before it is parsed
// (fillMaterials), or a NodeMaterial of Babylon's own blocks is made around it from the IR alone (buildNodeMaterial).
import {
  AddBlock, ColorSplitterBlock, Constants, CustomBlock, FragmentOutputBlock, ImageSourceBlock, InputBlock, NodeMaterial,
  NodeMaterialBlockConnectionPointTypes as T, NodeMaterialSystemValues as System, PBRMetallicRoughnessBlock, RawTexture, ScaleBlock, Texture,
  TransformBlock, Vector3, Vector4, VertexOutputBlock,
} from '@babylonjs/core';
import { unitFor } from './units.js';
import { webgpuSamplers } from '../../overrides/webgpu/samplers.js';

/** @typedef {import('./ir.js').IR} IR */
/** @typedef {import('./ir.js').Graph} Graph */
/** @typedef {import('./ir.js').GraphNode} GraphNode */
/** @typedef {import('@babylonjs/core').Scene} Scene */
/** @typedef {import('@babylonjs/core').NodeMaterialConnectionPoint} Point */

/**
 * A parameter of a piece's function, in order: a node input by socket identifier (linked, its value, else `fallback`),
 * an output by socket identifier, a value of the drawn point (`geometry`: `__position`, `__normal`, `__uv`, `__world`,
 * `__view`, `__viewProjection`, `__cameraPosition`, `__tangent`), a per-mesh value (`mesh`: `$model`, `$texspace_size`)
 * or the node's `texture` by index. `type` is GLSL's: float, vec2, vec3, vec4, mat4, sampler2D or BlClosure.
 * @typedef {{ type: string, input?: string, output?: string, geometry?: string, mesh?: string, texture?: number, fallback?: string }} Param
 */
/**
 * A node's GLSL: the helper functions it calls by key, its own function's name and code, and its parameters.
 * @typedef {{ functions: Record<string, string>, call: string, code: string, params: Param[] }} Piece
 */
/**
 * A unit for a shader node: its piece for a node of the graph (its settings and inputs).
 * @typedef {{ shader(node: GraphNode): Piece }} ShaderUnit
 */
/**
 * The pieces a package ships (its GPL file): helper functions by key in emission order, node functions by name, and
 * per graph the output node drawn and each node's function with the per-mesh values and textures it was made with.
 * @typedef {object} Kernels
 * @property {Record<string, string>} functions
 * @property {Record<string, { functions: string[], code: string, params: Param[] }>} pieces
 * @property {Record<string, { output: string, nodes: Record<string, { piece: string, mesh?: Record<string, number[]>, textures?: any[] }> }>} graphs
 */
/**
 * What a body reads from outside it, by source key (`geometry:__position`, `value:<node>:<socket>`,
 * `texture:<node>:<index>`, `system:world`), answered with the GLSL name of a parameter of the body, or null.
 * @typedef {(key: string, type: string) => string | null} Sources
 */

const SIZE = /** @type {Record<string, number>} */ ({ float: 1, vec2: 2, vec3: 3, vec4: 4 });
const LUMINANCE = 'vec3(0.2126729, 0.7151522, 0.072175)';
const float = (/** @type {number} */ v) => (Number.isInteger(v) ? v.toFixed(1) : String(v));

/**
 * `e` of GLSL type `from` as type `to`, as linked sockets convert: a color (vec4) to a value by its luminance, a vector
 * by its mean, a value to all components.
 * @param {string} e @param {string} from @param {string} to
 */
export function convert(e, from, to) {
  const n = SIZE[from], m = SIZE[to];
  if (from === to || (n > 1 && n === m)) return e;
  if (!n || !m) return null;
  if (m === 1) return n === 4 ? `dot(${e}.rgb, ${LUMINANCE})` : n === 3 ? `((${e}.x + ${e}.y + ${e}.z) / 3.0)` : `((${e}.x + ${e}.y) * 0.5)`;
  if (n === 1) return m === 4 ? `vec4(vec3(${e}), 1.0)` : `${to}(${e})`;
  if (m === 4) return n === 3 ? `vec4(${e}, 1.0)` : `vec4(${e}, 0.0, 1.0)`;
  if (m === 3) return n === 4 ? `${e}.rgb` : `vec3(${e}, 0.0)`;
  return `${e}.xy`;
}

/**
 * A GLSL literal of a value for a type, or null.
 * @param {any} value @param {string} type
 */
export function literal(value, type) {
  const size = SIZE[type];
  if (!size || value === null || value === undefined || typeof value === 'object' && !Array.isArray(value)) return null;
  const values = (Array.isArray(value) ? value : [value]).map(Number);
  if (size === 1) return float(values[0]);
  return `${type}(${Array.from({ length: size }, (_, i) => float(values[i] ?? (i === 3 ? 1 : 0))).join(', ')})`;
}

const OUTPUTS = ['ShaderNodeOutputMaterial', 'ShaderNodeOutputWorld'];
const idname = (/** @type {GraphNode} */ node) => node.type.replace(/^node:/, '');
/**
 * The output node a graph draws: of its Material (or World) Outputs, one for EEVEE before one for all renderers, the
 * active one among equals, else the first.
 * @param {Graph} graph
 */
export function outputNode(graph) {
  const type = OUTPUTS.find((t) => graph.nodes.some((n) => idname(n) === t));
  const rank = (/** @type {GraphNode} */ n) => /** @type {Record<string, number>} */ ({ EEVEE: 2, ALL: 1 })[n.settings?.target ?? 'ALL'] ?? 0;
  const outputs = graph.nodes.filter((n) => idname(n) === type && rank(n));
  return outputs.sort((a, b) => rank(b) - rank(a) || Number(!!b.settings?.is_active_output) - Number(!!a.settings?.is_active_output))[0] ?? null;
}

/**
 * The piece that implements a node: a registered unit's, else the package's.
 * @param {GraphNode} node @param {string} graph @param {Kernels | undefined} kernels
 * @returns {Piece & { instance?: { mesh?: Record<string, number[]>, textures?: any[] } }}
 */
function pieceFor(node, graph, kernels) {
  const unit = /** @type {Partial<ShaderUnit> | undefined} */ (unitFor(node.type));
  if (unit?.shader) return unit.shader(node);
  const instance = kernels?.graphs[graph]?.nodes[node.name], piece = instance && kernels?.pieces[instance.piece];
  if (!piece || !kernels) throw Error(`no implementation of ${node.type} for "${node.name}"`);
  const functions = Object.fromEntries(piece.functions.map((key) => [key, kernels.functions[key]]));
  return { functions, call: instance.piece, code: piece.code, params: piece.params, instance };
}

// Blender's matrices of the drawn object and view from Babylon's: Blender's axes swap y and z (S), its view looks down
// -z (F).
const S = 'mat4(1.0, 0.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 0.0, 1.0)';
const F = 'mat4(1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, -1.0, 0.0, 0.0, 0.0, 0.0, 1.0)';
/** @type {Record<string, (m: (name: string) => string) => string>} */
const MATRICES = {
  $model: (m) => `${S} * ${m('world')} * ${S}`, $model_inverse: (m) => `inverse(${S} * ${m('world')} * ${S})`,
  $viewmat: (m) => `${F} * ${m('view')} * ${S}`, $viewinv: (m) => `inverse(${F} * ${m('view')} * ${S})`, $winmat: (m) => `${m('projection')} * ${F}`,
};

/**
 * A graph's nodes as one GLSL body, `bl_nodes`, taking what `sources` gives (in the order asked, `inputs`) and giving
 * the output node's outputs: the code of its helper and node functions, then the body.
 * @param {IR} ir
 * @param {string} key the graph's key in `ir.graphs`
 * @param {{ kernels?: Kernels, sources: Sources, outputs?: string[] }} options `outputs`: the output node's outputs the
 * body gives, by socket identifier (all by default)
 */
export function fuse(ir, key, { kernels, sources, outputs: wanted }) {
  const graph = ir.graphs[key];
  if (graph?.type !== 'SHADER') throw Error(`${key} is not a shader graph`);
  const nodes = new Map(graph.nodes.map((n) => [n.name, n]));
  const into = new Map(graph.links.map(([from, output, to, input]) => [`${to}\0${input}`, [from, output]]));
  const output = kernels?.graphs[key]?.output ? nodes.get(kernels.graphs[key].output) : outputNode(graph);
  if (!output) throw Error(`${key} has no output node`);
  const helpers = new Map(), calls = new Map(), lines = /** @type {string[]} */ ([]);
  /** @type {Map<string, Map<string, [string, string]>>} each node's outputs by socket: their variable and GLSL type */
  const done = new Map();
  const value = (/** @type {any} */ v) => ('property' in (v ?? {}) ? ir.properties[v.property]?.default : v);

  /** @param {GraphNode} node @returns {Map<string, [string, string]>} */
  function emit(node) {
    const emitted = done.get(node.name);
    if (emitted) return emitted;
    const outs = /** @type {Map<string, [string, string]>} */ (new Map()), n = done.size;
    done.set(node.name, outs);
    const piece = pieceFor(node, key, kernels), args = [];
    for (const [name, code] of Object.entries(piece.functions)) if (!helpers.has(name)) helpers.set(name, code);
    calls.set(piece.call, piece.code);
    for (const param of piece.params) {
      if (param.output !== undefined) {
        const name = `bl_n${n}_${outs.size}`;
        outs.set(param.output, [name, param.type]);
        lines.push(`${param.type} ${name};`);
        args.push(name);
      } else args.push(argument(node, param, piece.instance));
    }
    lines.push(`${piece.call}(${args.join(', ')});`);
    return outs;
  }

  // A data output linked to a closure input is an Emission of that color (a virtual node the package names so).
  /** @param {string} from @param {string} socket @param {string} type */
  function linked(from, socket, type) {
    const node = nodes.get(from);
    if (!node) return null;
    const out = emit(node).get(socket);
    if (!out) return null;
    if (type === 'BlClosure' && out[1] !== 'BlClosure') {
      const name = `${from} ${socket} Emission`;
      if (!nodes.has(name)) {
        nodes.set(name, { name, type: 'node:ShaderNodeEmission', settings: {}, inputs: { Strength: 1 } });
        into.set(`${name}\0Color`, [from, socket]);
      }
      return linked(name, 'Emission', type);
    }
    if (type !== 'BlClosure' && out[1] === 'BlClosure') return null;
    return convert(out[0], out[1], type);
  }

  /** @param {GraphNode} node @param {Param} param @param {any} instance */
  function argument(node, param, instance) {
    const { type } = param;
    if (param.input !== undefined) {
      const link = into.get(`${node.name}\0${param.input}`);
      return (link && linked(link[0], link[1], type)) ?? sources(`value:${node.name}:${param.input}`, type) ?? literal(value(node.inputs?.[param.input]), type)
        ?? param.fallback ?? literal(0, type) ?? `${type}(0.0)`;
    }
    if (param.geometry !== undefined) return need(`geometry:${param.geometry}`, type);
    if (param.texture !== undefined) return need(`texture:${node.name}:${param.texture}`, type);
    if (param.mesh !== undefined) {
      const matrix = MATRICES[param.mesh];
      return matrix ? matrix((name) => need(`system:${name}`, 'mat4')) : literal(instance?.mesh?.[param.mesh] ?? 0, type) ?? `${type}(0.0)`;
    }
    throw Error(`${node.name}: a parameter of no kind`);
  }
  /** @param {string} source @param {string} type */
  function need(source, type) {
    const name = sources(source, type);
    if (!name) throw Error(`${key}: nothing gives ${source}`);
    return name;
  }

  const results = emit(output), body = lines.slice();
  const names = wanted ?? [...results.keys()];
  const outputs = names.map((name) => [name, results.get(name)?.[1] ?? 'float']);
  return {
    outputs,
    /** @param {[string, string][]} inputs the body's parameters, GLSL name and type, in order */
    code: (inputs) => [...helpers.values(), ...calls.values(),
      `void bl_nodes(${[...inputs.map(([name, type]) => `${type} ${name}`), ...outputs.map(([name, type]) => `out ${type} ${name}_out`)].join(', ')}) {`,
      ...body, ...names.map((name) => `${name}_out = ${results.get(name)?.[0] ?? '0.0'};`), '}'].join('\n').split('\n'),
  };
}

const BABYLON_TYPE = /** @type {Record<string, string>} */ ({ float: 'Float', vec2: 'Vector2', vec3: 'Vector3', vec4: 'Vector4', mat4: 'Matrix', sampler2D: 'sampler2D' });

/**
 * Fills each exported material's node block (a CustomBlock with `blender` sources: its graph's key and what each of its
 * parameters carries) with the body made from the IR, before the material is parsed.
 * @param {any[]} materials NodeMaterial serializations
 * @param {IR} ir
 * @param {Kernels} [kernels]
 */
export function fillMaterials(materials, ir, kernels) {
  for (const entry of materials) for (const block of entry.blocks ?? []) {
    const graph = block.options?.blender?.graph;
    if (!graph) continue;
    const { inputs } = block.options.blender, params = block.options.inParameters;
    const byKey = new Map(params.map((/** @type {any} */ p, /** @type {number} */ i) => [inputs[i], `bl_in${i}`]));
    const outputs = block.options.outParameters.map((/** @type {any} */ p) => p.name);
    const { code } = fuse(ir, graph, { kernels, sources: (key) => byKey.get(key) ?? null, outputs });
    block.options.code = code(params.map((/** @type {any} */ p, /** @type {number} */ i) => [`bl_in${i}`, glslOf(p.type)]));
  }
  return materials;
}
const glslOf = (/** @type {string} */ babylon) => Object.keys(BABYLON_TYPE).find((k) => BABYLON_TYPE[k] === babylon) ?? 'vec4';

// The drawn point's values as Babylon's blocks: attributes and system values.
/** @type {Record<string, [string, number] | [System, number]>} */
const GEOMETRY = {
  __position: ['position', T.Vector3], __normal: ['normal', T.Vector3], __uv: ['uv', T.Vector2], __tangent: ['tangent', T.Vector4],
  __world: [System.World, T.Matrix], __view: [System.View, T.Matrix], __viewProjection: [System.ViewProjection, T.Matrix],
  __cameraPosition: [System.CameraPosition, T.Vector3],
};
/** @type {Record<string, System>} */
const SYSTEM = { world: System.World, view: System.View, projection: System.Projection };

/**
 * A NodeMaterial of Babylon's own blocks for a shader graph of the IR: its nodes as one CustomBlock, unlinked inputs as
 * InputBlocks named by their property path, images as ImageSourceBlocks, the output node's closure lit by Babylon's PBR
 * block (base color, metallic, roughness and normal; its lighting weighed and its emission added).
 * @param {IR} ir
 * @param {string} key
 * @param {Scene} scene
 * @param {{ kernels?: Kernels, name?: string, image?: (name: string) => Texture | null }} [options]
 */
export function buildNodeMaterial(ir, key, scene, { kernels, name = key, image = () => null } = {}) {
  const material = new NodeMaterial(name, scene), made = new Map(), inputs = /** @type {[string, string, Point, string][]} */ ([]);
  const graph = ir.graphs[key];
  const block = (/** @type {string} */ k, /** @type {() => any} */ make) => made.get(k) ?? made.set(k, make()).get(k);
  const attribute = (/** @type {string} */ kind, /** @type {number} */ type) => block(`attribute:${kind}`, () => new InputBlock(kind, undefined, type).setAsAttribute(kind));
  const system = (/** @type {System} */ value, type = T.Matrix) => block(`system:${value}`, () => Object.assign(new InputBlock(`blender:${System[value]}`, undefined, type), { systemValue: value }));
  const geometry = (/** @type {string} */ name) => {
    const [value, type] = GEOMETRY[name] ?? [];
    if (value === undefined) return null;
    return typeof value === 'string' ? attribute(value, type) : system(value, type);
  };
  /** @type {Sources} */
  const sources = (source, type) => {
    const given = inputs.find(([k]) => k === source);
    if (given) return given[3];
    const [kind, ...rest] = source.split(':');
    // A mesh is no curve: a strand's values are zero.
    if (kind === 'geometry' && rest[0].startsWith('__hair_') || source === 'geometry:__is_strand') return literal(0, type);
    let point = null;
    if (kind === 'geometry') point = geometry(rest[0])?.output;
    else if (kind === 'system') point = system(SYSTEM[rest[0]]).output;
    else if (kind === 'value') point = valueBlock(ir, graph, rest.slice(0, -1).join(':'), rest.at(-1) ?? '', type)?.output;
    else if (kind === 'texture') point = textureBlock(kernels?.graphs[key]?.nodes[rest.slice(0, -1).join(':')]?.textures?.[Number(rest.at(-1))], scene, image)?.source;
    if (!point) return null;
    inputs.push([source, type, point, `bl_in${inputs.length}`]);
    return `bl_in${inputs.length - 1}`;
  };
  const { outputs, code } = fuse(ir, key, { kernels, sources });
  // Images last, as Babylon's WebGPU shader processor takes a sampler argument.
  inputs.sort(([, a], [, b]) => Number(a === 'sampler2D') - Number(b === 'sampler2D'));
  const nodes = new CustomBlock('blender:nodes');
  nodes.options = { name: 'blender:nodes', target: 'Fragment', functionName: 'bl_nodes', code: code(inputs.map(([, type, , param]) => [param, type])),
    inParameters: inputs.map(([, type, , param]) => ({ name: param, type: BABYLON_TYPE[type] })),
    outParameters: outputs.map(([name, type]) => ({ name, type: BABYLON_TYPE[type] })) };
  inputs.forEach(([, , point, param]) => point.connectTo(/** @type {Point} */ (nodes.getInputByName(param))));
  surface(material, nodes, geometry);
  webgpuSamplers(material).build();
  return material;
}

/** An unlinked input as an InputBlock named by its property path (or node and socket), holding its value. */
function valueBlock(/** @type {IR} */ ir, /** @type {Graph} */ graph, /** @type {string} */ node, /** @type {string} */ socket, /** @type {string} */ type) {
  const input = graph.nodes.find((n) => n.name === node)?.inputs?.[socket];
  const path = input?.property, v = path ? ir.properties[path]?.default : input;
  const kind = ({ float: T.Float, vec2: T.Vector2, vec3: T.Vector3, vec4: T.Vector4 })[type];
  if (kind === undefined || typeof v === 'string') return null;
  const block = new InputBlock(path ?? `${node}:${socket}`, undefined, kind), values = Array.isArray(v) ? v : [v ?? 0];
  block.value = kind === T.Float ? Number(values[0]) : kind === T.Vector3 ? Vector3.FromArray(values) : kind === T.Vector4 ? Vector4.FromArray([...values, 0, 0, 0, 1].slice(0, 4)) : block.value;
  return block;
}

/** A node's texture: an image by name, or a table (RGBA floats, one row). */
function textureBlock(/** @type {any} */ texture, /** @type {Scene} */ scene, /** @type {(name: string) => Texture | null} */ image) {
  if (!texture) return null;
  const block = new ImageSourceBlock(texture.image ? `image:${texture.image}` : 'blender:table');
  if (texture.table) {
    const table = Float32Array.from(texture.table);
    block.texture = new RawTexture(table, table.length / 4, 1, Constants.TEXTUREFORMAT_RGBA, scene, false, false, Texture.BILINEAR_SAMPLINGMODE, Constants.TEXTURETYPE_FLOAT);
    block.texture.wrapU = block.texture.wrapV = Texture.CLAMP_ADDRESSMODE;
  } else block.texture = image(texture.image);
  return block;
}

/**
 * The closure the output node gives, lit as Babylon's PBR block lights a surface, and the vertex stage.
 * @param {NodeMaterial} material @param {CustomBlock} nodes @param {(name: string) => InputBlock | null} geometry
 */
function surface(material, nodes, geometry) {
  const geo = (/** @type {string} */ name) => /** @type {InputBlock} */ (geometry(name)).output;
  const transform = (/** @type {Point} */ vector, /** @type {Point} */ by, w = 1) => {
    const block = Object.assign(new TransformBlock('blender:transform'), { complementW: w });
    vector.connectTo(block.vector);
    by.connectTo(block.transform);
    return block.output;
  };
  const worldPosition = transform(geo('__position'), geo('__world'));
  const vertex = new VertexOutputBlock('blender:vertexOutput');
  transform(worldPosition, geo('__viewProjection')).connectTo(vertex.vector);
  const pbr = Object.assign(new PBRMetallicRoughnessBlock('blender:surface'), { baseDiffuseModel: Constants.MATERIAL_DIFFUSE_MODEL_LAMBERT });
  worldPosition.connectTo(pbr.worldPosition);
  transform(geo('__normal'), geo('__world'), 0).connectTo(pbr.worldNormal);
  geo('__view').connectTo(pbr.view);
  geo('__cameraPosition').connectTo(pbr.cameraPosition);
  const out = (/** @type {string} */ name) => nodes.getOutputByName(name);
  for (const [from, to] of /** @type {[string, Point][]} */ ([['baseColor', pbr.baseColor], ['metallic', pbr.metallic], ['roughness', pbr.roughness], ['normal', pbr.perturbedNormal]])) out(from)?.connectTo(to);
  const fragment = new FragmentOutputBlock('blender:fragmentOutput');
  const emission = out('emission');
  let lit = pbr.lighting;
  if (out('weight')) {
    const scale = new ScaleBlock('blender:weight');
    pbr.lighting.connectTo(scale.input);
    out('weight')?.connectTo(scale.factor);
    lit = scale.output;
  }
  if (emission) {
    const split = new ColorSplitterBlock('blender:emission'), add = new AddBlock('blender:radiance');
    emission.connectTo(split.rgba);
    lit.connectTo(add.left);
    split.rgbOut.connectTo(add.right);
    add.output.connectTo(fragment.rgb);
  } else lit.connectTo(fragment.rgb);
  material.addOutputNode(vertex);
  material.addOutputNode(fragment);
}
