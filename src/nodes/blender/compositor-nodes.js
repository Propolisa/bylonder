// Blender's compositor nodes as Babylon render graph blocks, inline with Babylon's post-process blocks in one
// NodeRenderGraph. Blender runs a pixel node's GLSL function on each pixel (its compositor's pixel operations); here
// the block is a post process whose fragment shader calls that function on the texels of the images linked into its
// inputs, with unlinked inputs as uniforms. A muted node passes its image through, as Babylon's disabled task does.
import { Constants, EffectWrapper, FrameGraphPostProcessTask, NodeRenderGraphBlock, NodeRenderGraphBlockConnectionPointTypes as T, RegisterClass } from '@babylonjs/core';
import { availability, declaration, declarations, defaults } from './declarations.js';
import { compileSteps, glslIdentifier, kindOfSocket, menuValue, muteLinks, setUniforms, stack } from './node-code.js';
import { convert, glslType, glslValue, socketType } from './sockets.js';
import '../graph-roots.js';

// Scene linear Rec. 709 to CIE XYZ (D65) and back, the matrices Blender's default color management gives
// IMB_colormanagement_get_scene_linear_to_xyz, as GLSL's column-major mat4.
const REC709_TO_XYZ = [[0.4123908, 0.3575843, 0.1804808], [0.212639, 0.7151687, 0.0721923], [0.0193308, 0.1191948, 0.9505322]];
const XYZ_TO_REC709 = [[3.2409699, -1.5373832, -0.4986108], [-0.9692436, 1.8759675, 0.0415551], [0.0556301, -0.203977, 1.0569715]];
const mat4 = (m) => ({ glsl: `mat4(${[0, 1, 2].map((c) => [0, 1, 2].map((r) => m[r][c]).concat(0)).flat().concat(0, 0, 0, 1).join(', ')})` });

// Each node's steps from its properties (see node-code.js), as its C++ GPU function links them.
export const COMPOSITOR_NODES = {
  // node_composite_color_balance.cc, node_gpu_material
  CompositorNodeColorBalance: (p, decl) => [stack('node_composite_color_balance', decl, [mat4(REC709_TO_XYZ), mat4(XYZ_TO_REC709)])],
};

class BlenderEffect extends EffectWrapper {
  bind(noDefaultBindings) {
    super.bind(noDefaultBindings);
    setUniforms(this.drawWrapper.effect, this.uniformList, this.values);
  }
}

// A compositor node's task: Babylon's post process task, which samples the node's image input, also binding the images
// linked into its other inputs, as Babylon's own multi-input tasks do (FrameGraphBloomMergeTask).
class BlenderCompositorTask extends FrameGraphPostProcessTask {
  inputTextures = new Map(); // sampler -> texture handle
  record(skipCreationOfDisabledPasses = false) {
    const pass = super.record(skipCreationOfDisabledPasses, undefined, (context) => {
      for (const [sampler, texture] of this.inputTextures) context.bindTextureHandle(this._postProcessDrawWrapper.effect, sampler, texture);
    });
    for (const texture of this.inputTextures.values()) pass.addDependencies(texture);
    return pass;
  }
}

// A compositor image holding a socket's value as Blender's GPU compositor stores it: a value in red, a vector in RGB.
const fromImage = (texel, kind) => (kind === 'float' ? `${texel}.r` : kind === 'vec3' ? `${texel}.rgb` : texel);
const toImage = (value, kind) => (kind === 'float' ? `vec4(${value}, 0.0, 0.0, 1.0)` : kind === 'vec3' ? `vec4(${value}, 1.0)` : value);
const imageKind = (point) => {
  const block = point?.ownerBlock;
  return block instanceof BlenderCompositorBlock ? kindOfSocket(block.declaration, '@' + point.name) : 'color4';
};
// A full size image, for a node no image is linked into (a mask's).
const IMAGE = { size: { width: 100, height: 100 }, sizeIsPercentage: true, options: { createMipMaps: false, types: [Constants.TEXTURETYPE_HALF_FLOAT], formats: [Constants.TEXTUREFORMAT_RGBA], useSRGBBuffers: [false], samples: 1 } };

// Any of Blender's compositor nodes, its sockets from its declaration: each input links an image or takes its value, its
// first output (its image) is the task's. A node Bylonder has no GPU code for passes its input through, as muted.
export class BlenderCompositorBlock extends NodeRenderGraphBlock {
  constructor(name, frameGraph, scene, idname) {
    super(name, frameGraph, scene);
    this.idname = idname;
    this.declaration = declaration('compositor', idname);
    Object.assign(this, defaults(this.declaration));
    const { inputs, outputs } = this.declaration, linkable = inputs.filter((s) => socketType(s.type) && s.type !== 'MENU');
    this.image = linkable.find((s) => s.type === 'RGBA') ?? linkable[0];
    this.result = outputs.find((s) => s.type === 'RGBA') ?? outputs[0];
    for (const s of linkable) {
      this.registerInput(s.identifier, T.AutoDetect, true);
      this.getInputByName(s.identifier).addExcludedConnectionPointFromAllowedTypes(T.TextureAllButBackBuffer);
    }
    this._addDependenciesInput();
    for (const s of outputs) this.registerOutput(s.identifier, T.Texture);
    this._frameGraphTask = new BlenderCompositorTask(this.name, frameGraph, this._effect());
  }

  get runs() { return this.idname in COMPOSITOR_NODES; }
  get availability() { return availability(this.declaration, this.properties, this.values); }
  get mute() { return this.disabled; }
  set mute(value) { this.disabled = value; }
  // The images linked into the node's inputs, by input identifier.
  get linked() { return new Map(this.inputs.filter((i) => i.connectedPoint && i.name !== 'dependencies').map((i) => [i.name, i.connectedPoint])); }

  // The fragment shader: the node's steps on its linked images' texels and its unlinked inputs' values (uniforms).
  _fragment() {
    const functions = new Map(), uniforms = [], samplers = [], linked = this.linked;
    let count = 0;
    const links = new Map();
    const input = (id) => {
      const s = this.declaration.inputs.find((d) => d.identifier === id), type = socketType(s.type);
      if (s.type === 'MENU') return menuValue(s, this.values[id]);
      const name = glslIdentifier(id);
      if (!linked.has(id)) { uniforms.push([name, id, type.kind]); return name; }
      const sampler = id === this.image.identifier ? 'textureSampler' : `${name}_image`, from = imageKind(linked.get(id));
      if (sampler !== 'textureSampler') samplers.push([sampler, id]);
      return convert(fromImage(`texture2D(${sampler}, vUV)`, from), from, type.kind);
    };
    const access = {
      get: (id) => (links.has(id) || id.startsWith('@') ? links.get(id) : links.set(id, input(id)).get(id)),
      set: (id, v) => links.set(id, v),
    };
    let body = '';
    if (this.runs) body = compileSteps(this.declaration, COMPOSITOR_NODES[this.idname](this.properties, this.declaration), access, { emit: (key, code) => functions.set(key, code), free: (prefix) => `${prefix}_${count++}` });
    else {
      for (const s of this.declaration.inputs) if (this.availability.inputs.has(s.identifier) && socketType(s.type)) access.get(s.identifier);
      muteLinks(this.declaration, this.availability.inputs, access);
    }
    const kind = this.result ? kindOfSocket(this.declaration, '@' + this.result.identifier) : 'color4', result = (this.result && links.get('@' + this.result.identifier)) ?? glslValue(0, kind);
    const code = ['varying vec2 vUV;', 'uniform sampler2D textureSampler;', ...samplers.map(([n]) => `uniform sampler2D ${n};`), ...uniforms.map(([n, , k]) => `uniform ${glslType(k)} ${n};`),
      ...functions.values(), 'void main(void) {', body + `gl_FragColor = ${toImage(result, kind)};`, '}'].join('\n');
    return { code, uniforms, samplers };
  }

  _effect() {
    const { code, uniforms, samplers } = this._fragment();
    const effect = new BlenderEffect({ name: this.name, engine: this._engine, fragmentShader: code, useAsPostProcess: true, uniforms: uniforms.map(([n]) => n), samplers: samplers.map(([n]) => n) });
    return Object.assign(effect, { code, uniformList: uniforms, samplerList: samplers, values: this.values });
  }

  _buildBlock(state) {
    super._buildBlock(state);
    const task = this._frameGraphTask;
    if (this._fragment().code !== task.postProcess.code) {
      task.postProcess.dispose();
      task.postProcess = this._effect();
      task._postProcessDrawWrapper = task.postProcess.drawWrapper;
    }
    task.postProcess.values = this.values;
    const linked = this.linked;
    task.inputTextures = new Map(task.postProcess.samplerList.map(([sampler, id]) => [sampler, linked.get(id).value]));
    task.sourceTexture = this.image && linked.get(this.image.identifier)?.value;
    task.targetTexture = task.sourceTexture === undefined ? this._frameGraph.textureManager.createRenderTargetTexture(this.name, IMAGE) : undefined;
    if (this.result) this.getOutputByName(this.result.identifier).value = task.outputTexture;
  }

  serialize() {
    return { ...super.serialize(), blender: { properties: this.properties, values: this.values, mute: this.mute } };
  }

  _deserialize(serialized) {
    super._deserialize(serialized);
    const { properties, values, mute } = serialized.blender ?? {};
    Object.assign(this.properties, properties);
    Object.assign(this.values, values);
    this.mute = !!mute;
  }
}

// A block class per Blender compositor node, registered for Babylon's serialization (a node shared with shader trees,
// ShaderNodeMix, by a class name of its own); `compositorNodeClasses` are those Bylonder has GPU code for.
const LAYOUT = ['NodeFrame', 'NodeReroute', 'NodeGroupInput', 'NodeGroupOutput', 'NodeImplicitConversion', 'NodeEnableOutput'];
export const compositorBlockClasses = Object.fromEntries(Object.keys(declarations('compositor')).filter((idname) => !LAYOUT.includes(idname)).map((idname) => {
  const label = declaration('compositor', idname).name, className = idname.startsWith('CompositorNode') ? idname : 'Compositor' + idname;
  const Block = { [idname]: class extends BlenderCompositorBlock {
    constructor(name, frameGraph, scene) { super(name || label, frameGraph, scene, idname); }
    getClassName() { return className; }
  } }[idname];
  RegisterClass('BABYLON.' + className, Block);
  return [idname, Block];
}));
export const compositorNodeClasses = Object.fromEntries(Object.keys(COMPOSITOR_NODES).map((idname) => [idname, compositorBlockClasses[idname]]));
