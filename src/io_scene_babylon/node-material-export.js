// A node material of Blender's shader nodes (nodes/blender/shader-nodes.js) as Babylon's own blocks, so an exported
// scene loads in plain Babylon.js: the Blender nodes become one CustomBlock whose code is what their build wrote (the
// closure they gather, given as the PBR block's inputs), Bylonder's surface, display and output blocks Babylon's PBR,
// image processing and fragment output blocks, and Babylon's blocks stay as they are. With EEVEE Parity (an export
// option), the view's direction is EEVEE's and a material's reflection lobes light as Babylon's clearcoat; without
// it, the lobes merge into the base, as Bylonder draws with EEVEE Parity off.
import {
  AddBlock, ClampBlock, ClearCoatBlock, ColorMergerBlock, ColorSplitterBlock, CustomBlock, DivideBlock, LerpBlock, MaxBlock, MultiplyBlock, FragmentOutputBlock, ImageProcessingBlock, ImageSourceBlock, InputBlock, NodeMaterial, PBRMetallicRoughnessBlock, ScaleBlock, SubtractBlock,
  NodeMaterialBlockConnectionPointTypes as T, NodeMaterialSystemValues as System, Vector3, Vector4,
} from '@babylonjs/core';
import { zlibSync } from 'fflate';
import {
  BlenderClosureNormalBlock, BlenderDisplayBlock, BlenderFarPlaneBlock, BlenderWorldProbeClampBlock, BlenderSurfaceBlock, BlenderUnlitSurfaceBlock, BlenderViewEyeBlock, isBlenderShader, meshValue,
  ShaderNodeOutputMaterial, STAND_INS,
} from '../nodes/blender/shader-nodes.js';
import { CurvesGeometryBlock, CurvesNormalBlock } from '../draw/curves.js';
import { glslValue, LUMINANCE } from '../nodes/blender/sockets.js';
import { straightImageData } from '../imbuf/image-textures.js';

const GLSL = { [T.Float]: 'float', [T.Vector2]: 'vec2', [T.Vector3]: 'vec3', [T.Vector4]: 'vec4', [T.Color3]: 'vec3', [T.Color4]: 'vec4', [T.Matrix]: 'mat4' };
const typeName = (type) => T[type];

const COAT_F0 = 0.9;
const COAT_IOR = (1 + Math.sqrt(COAT_F0)) / (1 - Math.sqrt(COAT_F0));
// What the closure gives Babylon's blocks: [name, type, GLSL from the closure `c` (lobes merged as the export draws
// them) and its lobes merged into one `l`].
const CLOSURE_OUTPUTS = [
  ['baseColor', T.Color3, 'bl_closure_base_color(c)'], ['metallic', T.Float, 'bl_closure_metallic(c)'],
  ['roughness', T.Float, 'bl_closure_parameter(c, c.roughness, 0.5)'], ['ior', T.Float, 'bl_closure_parameter(c, c.ior, 1.5)'],
  ['transmission', T.Float, 'bl_closure_transmission(c)'], ['tint', T.Color3, 'bl_closure_transmission_tint(c)'], ['weight', T.Float, 'bl_closure_weight(c)'],
  ['normal', T.Vector4, 'vec4(bl_closure_normal(c).xzy, 0.0)'], ['emission', T.Color4, 'bl_closure_radiance(c, vec3(0.0))'],
  // Babylon's clearcoat is a dielectric of one IOR (COAT_F0): as much of it as reflects the lobe's color's luminance
  // at normal incidence.
  ['lobeIntensity', T.Float, `l.weight * min(dot(bl_lobe_color(l), vec3(${LUMINANCE.join(', ')})) / ${COAT_F0}, 1.0)`], ['lobeRoughness', T.Float, 'bl_lobe_roughness(l)'],
];
// Bylonder's inputs given from the closure (BlenderSurfaceBlock _values), by the export block's input.
const CLOSURE_INPUTS = { baseColor: 'baseColor', metallic: 'metallic', roughness: 'roughness', indexOfRefraction: 'ior', tintColor: 'tint', intensity: 'transmission',
  volumeIndexOfRefraction: 'ior' };
const PBR_SETTINGS = ['lightFalloff', 'useAlphaTest', 'alphaTestCutoff', 'useAlphaBlending', 'useRadianceOverAlpha', 'useSpecularOverAlpha', 'enableSpecularAntiAliasing',
  'realTimeFiltering', 'realTimeFilteringQuality', 'useEnergyConservation', 'useRadianceOcclusion', 'useHorizonOcclusion', 'unlit', 'forceNormalForward',
  'directIntensity', 'environmentIntensity', 'specularIntensity', 'generateOnlyFragmentCode'];
const MATERIAL_SETTINGS = ['alphaMode', 'backFaceCulling', 'separateCullingPass', 'transparencyMode', 'needDepthPrePass', 'forceDepthWrite', 'alpha'];

// Blender's matrices of the drawn object and view from Babylon's (shader-nodes.js MESH_VALUES): Blender's axes swap y
// and z (S), and its view looks down -z (F).
const S = 'mat4(1.0, 0.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 0.0, 1.0)';
const F = 'mat4(1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, -1.0, 0.0, 0.0, 0.0, 0.0, 1.0)';
const MATRICES = {
  $model: `${S} * bl_world * ${S}`, $model_inverse: `inverse(${S} * bl_world * ${S})`, $viewmat: `${F} * bl_view * ${S}`,
  $viewinv: `inverse(${F} * bl_view * ${S})`, $winmat: `bl_projection * ${F}`,
};

// A node's unlinked input as the export's tunable value: a Babylon InputBlock named by the input's RNA path from its
// material (`node_tree.nodes["Noise Texture"].inputs[2].default_value`), which the package's controls set.
const uniformType = (kind) => ({ float: T.Float, vec3: T.Vector3 })[kind] ?? T.Vector4;
// An Image Texture's image as the export's swappable texture: its ImageSourceBlock named by the node's image's RNA path.
const IMAGE_NODES = new Set(['ShaderNodeTexImage', 'ShaderNodeTexEnvironment']);
const nodePath = (node) => `node_tree.nodes["${node.name.replace(/["\\]/g, (c) => '\\' + c)}"]`;
const imagePath = (node) => `${nodePath(node)}.image`;
const socketPath = (node, id) => `${nodePath(node)}.inputs[${node.declaration.inputs.findIndex((s) => s.identifier === id)}].default_value`;
function valueBlock({ kind, value, path }) {
  const type = uniformType(kind), block = new InputBlock(path, undefined, type);
  block.value = type === T.Float ? Number(value) : type === T.Vector3 ? Vector3.FromArray(value) : Vector4.FromArray(value);
  return block;
}

const literal = (value) => (Array.isArray(value) ? `vec${value.length}(${value.map((v) => glslValue(v, 'float')).join(', ')})` : glslValue(value, 'float'));

// The material as Babylon's NodeMaterial serialization of Babylon's blocks, or null for one not of Blender's nodes.
export async function exportNodeMaterial(material, { parity = false } = {}) {
  if (!blenderOutput(material)) return null;
  await built(material);
  const scene = material.getScene();
  const out = new NodeMaterial(material.name, scene);
  try {
    const textures = new Map();
    const graph = exportGraph(material, out, { parity, textures });
    for (const node of [...material._vertexOutputNodes, ...material._fragmentOutputNodes]) out.addOutputNode(graph.block(node));
    for (const key of MATERIAL_SETTINGS) if (key in material) out[key] = material[key];
    const json = out.serialize();
    for (const entry of json.blocks) {
      const texture = textures.get(entry.id);
      if (texture) entry.texture = await textureJson(texture);
    }
    return Object.assign(json, { name: material.name, id: material.id, uniqueId: material.uniqueId });
  } finally {
    out.dispose();
  }
}

// The material built, its Blender nodes' code written (a material no view has drawn yet builds for the export; a build
// waits for its nodes' code).
async function built(material) {
  const current = () => material.attachedBlocks.some((b) => isBlenderShader(b) && b.built?.shared === material._sharedData);
  // A build may queue another as it ends (shader-nodes.js buildMaterial): waited for until one is current.
  for (let builds = 0; builds < 8 && (material._buildIsInProgress || !current()); builds++) {
    if (!material._buildIsInProgress) material.build();
    if (material._buildIsInProgress) await new Promise((resolve) => { material.onBuildObservable.addOnce(resolve); material.onBuildErrorObservable.addOnce(resolve); });
    await new Promise((resolve) => setTimeout(resolve));
  }
}

// The Material Output the material draws from (the one EEVEE uses, shader-nodes.js eeveeOutput).
const blenderOutput = (material) => material._fragmentOutputNodes?.find((block) => block instanceof ShaderNodeOutputMaterial) ?? null;

function exportGraph(material, out, { parity, textures }) {
  const blocks = new Map(), scene = material.getScene();
  const system = new Map();
  const systemValue = (value) => system.get(value) ?? system.set(value, Object.assign(new InputBlock(`blender:${System[value]}`, undefined, T.Matrix), { systemValue: value })).get(value);
  const zero = (type) => Object.assign(new InputBlock('blender:zero', undefined, type), { value: type === T.Float ? 0 : type === T.Vector4 ? Vector4.Zero() : Vector3.Zero(), isConstant: true });
  const wire = (from, to) => from.connectTo(to);
  const closureOutput = blenderOutput(material).getInputByName('Surface').connectedPoint ?? null;
  const lobes = parity && material.attachedBlocks.some((b) => b instanceof BlenderSurfaceBlock && b.lobe && b.closure.connectedPoint === closureOutput);
  const nodes = blenderNodes(material, { closure: closureOutput, merge: !parity, scene, textures, systemValue });
  let surface = null;

  // The export's output for one of the material's outputs.
  function source(point) {
    const owner = point.ownerBlock;
    if (isBlenderShader(owner) && !(owner instanceof ShaderNodeOutputMaterial)) return nodes.output(point);
    if (owner instanceof CurvesGeometryBlock) {
      const mesh = { position: 'meshPosition', normal: 'meshNormal' }[point.name];
      return mesh ? source(owner.getInputByName(mesh).connectedPoint) : zero(point.type).output;
    }
    if (owner instanceof CurvesNormalBlock) return source(owner.getInputByName('normal').connectedPoint);
    if (owner instanceof BlenderViewEyeBlock) return parity ? viewEye(owner) : source(owner.eye.connectedPoint);
    if (owner instanceof BlenderWorldProbeClampBlock) return probeClamp(owner);
    if (owner instanceof BlenderFarPlaneBlock) return farPlane(owner);
    if (owner instanceof BlenderClosureNormalBlock) return nodes.closure('normal');
    if (owner instanceof BlenderUnlitSurfaceBlock) return nodes.closure('emission');
    if (owner instanceof BlenderSurfaceBlock) return radiance();
    if (owner instanceof BlenderDisplayBlock) return block(owner).getOutputByName(point.name === 'displayRgb' ? 'rgb' : point.name === 'displayRgba' ? 'output' : point.name);
    return block(owner).getOutputByName(point.name);
  }

  // A Babylon block of the export for one of the material's, its inputs linked.
  function block(original) {
    if (blocks.has(original)) return blocks.get(original);
    const copy = original instanceof ShaderNodeOutputMaterial ? new FragmentOutputBlock(original.name)
      : original instanceof BlenderDisplayBlock ? Object.assign(new ImageProcessingBlock(original.name), { convertInputToLinearSpace: false })
        : original instanceof BlenderSurfaceBlock ? pbr(original) : original.clone(scene);
    blocks.set(original, copy);
    for (const input of original.inputs) {
      const target = copy.getInputByName(input.name);
      if (!target) continue;
      if (input._blenderValue) wire(nodes.closure(CLOSURE_INPUTS[input.name]), target);
      else if (input.connectedPoint) wire(source(input.connectedPoint), target);
    }
    return copy;
  }

  // The base surface as Babylon's PBR block, and its lobes as Babylon's clearcoat.
  function pbr(original) {
    const copy = new PBRMetallicRoughnessBlock(original.name);
    for (const key of PBR_SETTINGS) if (key in original) copy[key] = original[key];
    if (lobes) {
      const coat = new ClearCoatBlock('blender:clearcoat');
      coat.remapF0OnInterfaceChange = false;
      wire(nodes.closure('lobeIntensity'), coat.intensity);
      wire(nodes.closure('lobeRoughness'), coat.roughness);
      wire(Object.assign(new InputBlock('blender:coatIor', undefined, T.Float), { value: COAT_IOR, isConstant: true }).output, coat.indexOfRefraction);
      wire(coat.clearcoat, copy.clearcoat);
    }
    return copy;
  }

  // The surface's radiance (shader-nodes.js bl_closure_radiance) in Babylon's math blocks: its lighting as the closure
  // weighs its base, the clearcoat's as it is, and the emission over the coverage.
  function radiance() {
    if (surface) return surface;
    const base = material.attachedBlocks.find((b) => b instanceof BlenderSurfaceBlock && !b.lobe && b.closure.connectedPoint === closureOutput);
    const lit = block(base), emission = math(ColorSplitterBlock, { rgba: nodes.closure('emission') });
    if (!lobes) {
      const rgb = math(AddBlock, { left: math(ScaleBlock, { input: lit.lighting, factor: nodes.closure('weight') }).output, right: emission.getOutputByName('rgb') }).output;
      return (surface = math(ColorMergerBlock, { 'rgb ': rgb, a: emission.getOutputByName('a') }).getOutputByName('rgba'));
    }
    const coat = math(AddBlock, { left: lit.clearcoatDir, right: lit.clearcoatInd }).output;
    const under = math(ScaleBlock, { input: math(SubtractBlock, { left: lit.lighting, right: coat }).output, factor: nodes.closure('weight') }).output;
    const rgb = math(AddBlock, { left: math(AddBlock, { left: under, right: coat }).output, right: emission.getOutputByName('rgb') }).output;
    return (surface = math(ColorMergerBlock, { 'rgb ': rgb, a: emission.getOutputByName('a') }).getOutputByName('rgba'));
  }
  function math(Block, inputs) {
    const made = new Block(`blender:${Block.name}`);
    for (const [name, from] of Object.entries(inputs)) wire(from, made.getInputByName(name));
    return made;
  }

  // blender-port: draw_view_lib.glsl drw_world_incident_vector (draw-view.js viewEye): an orthographic view's point
  // one unit back along its axis, from Babylon's view and projection matrices.
  function viewEye(original) {
    const forward = scene.useRightHandedSystem ? '-' : '';
    const eye = customBlock('blender:viewEye', 'bl_view_eye', [['position', 'Vector4'], ['eye', 'Vector3'], ['view', 'Matrix'], ['projection', 'Matrix']], [['output', 'Vector3']], [
      'void bl_view_eye(vec4 position, vec3 eye, mat4 view, mat4 projection, out vec3 result) {',
      `  vec3 forward = ${forward}vec3(view[0][2], view[1][2], view[2][2]);`,
      '  result = projection[3][3] > 0.5 ? position.xyz - forward : eye;', '}']);
    wire(source(original.position.connectedPoint), eye.position);
    wire(source(original.eye.connectedPoint), eye.eye);
    wire(systemValue(System.View).output, eye.view);
    wire(systemValue(System.Projection).output, eye.projection);
    return eye.output;
  }

  // A world's light as its probe takes it, in Babylon's math blocks: as Blender's manual describes the Sun Threshold and
  // the indirect clamp (the most the world contributes to its light probe), its color scaled down until its brightest
  // component is at most each (the material's blenderProbeClamp; 0 is none), while `world:probe` is 1 (runtime/world.js
  // sets it as it bakes); the view sees it unclamped.
  function probeClamp(original) {
    const radiance = source(original.radiance.connectedPoint), [sun = 0, indirect = 0] = material.blenderProbeClamp ?? [];
    const constant = (name, value) => Object.assign(new InputBlock(`blender:${name}`, undefined, T.Float), { value: value > 0 ? value : 1e20, isConstant: true }).output;
    const split = math(ColorSplitterBlock, { rgba: radiance }), floor = constant('epsilon', 1e-8);
    const brightest = math(MaxBlock, { left: math(MaxBlock, { left: split.r, right: split.g }).output, right: split.b }).output;
    const factor = (limit, value) => math(ClampBlock, { value: math(DivideBlock, { left: limit, right: math(MaxBlock, { left: value, right: floor }).output }).output }).output;
    const sunFactor = factor(constant('sunThreshold', sun), brightest);
    const indirectFactor = factor(constant('indirectClamp', indirect), math(MultiplyBlock, { left: brightest, right: sunFactor }).output);
    const scaled = math(ScaleBlock, { input: split.rgbOut, factor: math(MultiplyBlock, { left: sunFactor, right: indirectFactor }).output }).output;
    const clamped = math(ColorMergerBlock, { 'rgb ': scaled, a: split.a }).getOutputByName('rgba');
    const probe = Object.assign(new InputBlock('world:probe', undefined, T.Float), { value: 0 }).output;
    return math(LerpBlock, { left: radiance, right: clamped, gradient: probe }).output;
  }

  // A world's box drawn on the far plane, behind everything else.
  function farPlane(original) {
    const far = customBlock('blender:farPlane', 'bl_far_plane', [['vector', 'Vector4']], [['output', 'Vector4']],
      ['void bl_far_plane(vec4 v, out vec4 result) {', '  result = vec4(v.xy, v.w * 0.99999, v.w);', '}'], 'Vertex');
    wire(source(original.vector.connectedPoint), far.vector);
    return far.output;
  }

  nodes.connect(source);
  return { block };
}

function customBlock(name, functionName, inputs, outputs, code, target = 'Fragment') {
  const block = new CustomBlock(name);
  block.options = { name, target, functionName, code,
    inParameters: inputs.map(([input, type]) => ({ name: input, type })), outParameters: outputs.map(([output, type]) => ({ name: output, type })) };
  return block;
}

// The material's Blender nodes as one CustomBlock: their functions, then one function of the values they read from
// other blocks (the variables their code read) and the images they sample, running their code and giving the closure's
// values and the outputs other blocks read.
function blenderNodes(material, { closure, merge, scene, textures, systemValue }) {
  const built = material.attachedBlocks.filter((b) => isBlenderShader(b) && b.built?.shared === material._sharedData).sort((a, b) => a.built.order - b.built.order);
  const functions = new Map([['bl_closure', STAND_INS.bl_closure]]);
  const params = new Map(), samplers = [], locals = [], uniforms = [], outputs = new Map();
  let matrices = false;
  const mesh = material.getScene().meshes.find((m) => m.material === material) ?? null;
  for (const node of built) {
    for (const [key, code] of node.built.functions) if (!functions.has(key)) functions.set(key, code);
    for (const [input, name] of node.built.inputs) {
      if (!isBlenderShader(input.connectedPoint.ownerBlock) && !params.has(name)) params.set(name, input.connectedPoint);
    }
    for (const [name, id, kind] of node._uniforms ?? []) uniforms.push({ name, kind, value: node.values[id], path: socketPath(node, id) });
    for (const [name, texture] of node._textures ?? []) samplers.push([name, texture, IMAGE_NODES.has(node.idname) && !texture.metadata?.table ? imagePath(node) : null]);
    for (const [name, id] of node._meshUniforms ?? []) {
      if (MATRICES[id]) { matrices = true; locals.push(`mat4 ${name} = ${MATRICES[id]};`); continue; }
      const [type, value] = meshValue(id);
      locals.push(`${GLSL[type]} ${name} = ${literal(Array.from(mesh ? value(mesh, scene) : type === T.Vector3 ? [0, 0, 0] : [0, 0, 0, 0]))};`);
    }
  }
  // The outputs other blocks read: the closure's values, and data outputs linked to Babylon's blocks.
  for (const node of built) {
    for (const point of node.outputs) {
      if (node.declaration.outputs.find((s) => s.identifier === point.name)?.type === 'SHADER') continue;
      if (point.endpoints.some((e) => !isBlenderShader(e.ownerBlock))) outputs.set(point, `bl_out${outputs.size}`);
    }
  }
  const c = closure ? closure.associatedVariableName : 'bl_closure_empty()';
  const inputs = [...params].map(([name, point], i) => [`in${i}`, typeName(point.type), name])
    .concat(uniforms.map(({ name, kind }, i) => [`value${i}`, typeName(uniformType(kind)), name]));
  if (matrices) inputs.push(['world', 'Matrix', 'bl_world'], ['view', 'Matrix', 'bl_view'], ['projection', 'Matrix', 'bl_projection']);
  const sampled = samplers.map(([name], i) => [`image${i}`, 'sampler2D', name]);
  const outParameters = [...CLOSURE_OUTPUTS.map(([name, type]) => [name, typeName(type)]), ...[...outputs].map(([point, name]) => [name, typeName(point.type)])];
  const signature = [...inputs, ...sampled].map(([, type, name]) => `${type === 'sampler2D' ? 'sampler2D' : GLSL[T[type]]} ${name}`)
    .concat(outParameters.map(([name, type]) => `out ${GLSL[T[type]]} ${name}`)).join(', ');
  // Whether a face is drawn reversed (shader-nodes.js REVERSED_FACES): a uniform of the app's separate culling pass, set
  // between its passes; the export draws faces once, never reversed.
  const reversed = [...functions.values()].some((f) => f.includes('bl_reversed_faces')) ? ['const float bl_reversed_faces = 0.0;'] : [];
  const code = [...reversed, ...functions.values(), `void bl_nodes(${signature}) {`, ...locals, ...built.map((node) => node.built.code),
    `BlClosure c = ${merge ? `bl_closure_merge_lobes(${c})` : c};`, `BlLobe l = bl_lobe_add((${c}).lobe1, (${c}).lobe2);`,
    ...CLOSURE_OUTPUTS.map(([name, , value]) => `${name} = ${value};`), ...[...outputs].map(([point, name]) => `${name} = ${point.associatedVariableName};`), '}'];
  const block = customBlock('blender:nodes', 'bl_nodes', [...inputs, ...sampled], outParameters, code.join('\n').split('\n'));
  return {
    closure: (name) => block.getOutputByName(name),
    output: (point) => block.getOutputByName(outputs.get(point)),
    connect(source) {
      [...params.values()].forEach((point, i) => source(point).connectTo(block.getInputByName(`in${i}`)));
      uniforms.forEach((uniform, i) => valueBlock(uniform).output.connectTo(block.getInputByName(`value${i}`)));
      if (matrices) for (const [name, value] of [['world', System.World], ['view', System.View], ['projection', System.Projection]]) systemValue(value).output.connectTo(block.getInputByName(name));
      samplers.forEach(([, texture, path], i) => {
        const image = new ImageSourceBlock(path ?? `blender:image${i}`);
        textures.set(image.uniqueId, texture);
        image.source.connectTo(block.getInputByName(`image${i}`));
      });
    },
  };
}

// A texture as Babylon's serialization of one: its pixels as a PNG data URL (Blender's straight pixels for an image, a
// color ramp's table at 8 bits).
async function textureJson(texture) {
  const table = texture.metadata?.table;
  const data = table ? pngDataUrl(table, table.length / 4, 1) : straightImageData(texture) ?? null;
  const forced = texture._forceSerialize;
  texture._forceSerialize = !data;
  let json;
  try { json = texture.serialize() ?? {}; } finally { texture._forceSerialize = forced; }
  const base64String = data ?? (await json.base64String);
  return { ...json, name: texture.name || 'blender', url: '', base64String, wrapU: texture.wrapU, wrapV: texture.wrapV, samplingMode: texture.samplingMode, invertY: false,
    noMipmap: !!table };
}

// RGBA floats in [0, 1] as an 8 bit PNG.
function pngDataUrl(values, width, height) {
  const rows = new Uint8Array((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width * 4; x++) rows[y * (width * 4 + 1) + 1 + x] = Math.round(Math.min(1, Math.max(0, values[y * width * 4 + x])) * 255);
  const chunk = (type, data) => {
    const body = new Uint8Array(4 + data.length);
    body.set([...type].map((ch) => ch.charCodeAt(0)));
    body.set(data, 4);
    const out = new Uint8Array(12 + data.length), view = new DataView(out.buffer);
    view.setUint32(0, data.length);
    out.set(body, 4);
    view.setUint32(8 + data.length, crc32(body));
    return out;
  };
  const header = new Uint8Array(13), view = new DataView(header.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  header.set([8, 6, 0, 0, 0], 8);
  const parts = [Uint8Array.of(137, 80, 78, 71, 13, 10, 26, 10), chunk('IHDR', header), chunk('IDAT', zlibSync(rows)), chunk('IEND', new Uint8Array())];
  const png = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  parts.reduce((at, p) => (png.set(p, at), at + p.length), 0);
  let text = '';
  for (const byte of png) text += String.fromCharCode(byte);
  return 'data:image/png;base64,' + btoa(text);
}
function crc32(bytes) {
  let crc = ~0;
  for (const byte of bytes) {
    crc ^= byte;
    for (let k = 0; k < 8; k++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return ~crc >>> 0;
}
