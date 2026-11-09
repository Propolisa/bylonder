// Blender's compositor nodes as Babylon render graph blocks, inline with Babylon's post-process blocks in one
// NodeRenderGraph. Blender runs a pixel node's GPU code on each pixel (its compositor's pixel operations); here the
// block is a post process whose fragment shader is that code as Blender's own C++ builds it (gpu-graph.js), on the
// texels of the images linked into its inputs. A muted node passes its image through, as Babylon's disabled task does.
import { Constants, EffectWrapper, FrameGraphPostProcessTask, Matrix, NodeRenderGraphBlock, NodeRenderGraphBlockConnectionPointTypes as T, RegisterClass } from '@babylonjs/core';
import { availability, declaration, declarations, defaults } from './declarations.js';
import { glslIdentifier, kindOfSocket, muteLinks } from './node-code.js';
import { convert, glslType, glslValue, socketType } from './sockets.js';
import { engineGLSL } from './glsl.js';
import { graphCode, nodeGraph, nodeTypeHasGpu } from './gpu-graph.js';
import { rampTexture } from './shader-nodes.js';
import { BlenderReplayTask, nodeRecording, nodeTypeHasOperation } from '../../compositor/compositor-replay.js';
import '../graph-roots.js';

// The block's sampler of an image linked into an input (Blender's compositor declares one per linked output, named as
// the operation's input; the node's image is Babylon's post process source).
const samplerOf = (block, id) => (id === block.image?.identifier ? 'textureSampler' : `${glslIdentifier(id)}_image`);

class BlenderEffect extends EffectWrapper {
  bind(noDefaultBindings) {
    super.bind(noDefaultBindings);
    const effect = this.drawWrapper.effect, values = this.block._uniformValues();
    this.uniformList.forEach(([name, kind], i) => setUniform(effect, name, kind, values[i]));
    this.bandList.forEach(([name, pixels]) => effect.setTexture(name, rampTexture(pixels, this.block._scene)));
  }
}
const setUniform = (effect, name, kind, v) => (kind === 'float' ? effect.setFloat(name, v[0]) : kind === 'vec2' ? effect.setFloat2(name, v[0], v[1])
  : kind === 'vec3' ? effect.setFloat3(name, v[0], v[1], v[2]) : kind === 'mat4' ? effect.setMatrix(name, Matrix.FromArray(v)) : effect.setFloat4(name, v[0], v[1], v[2], v[3]));

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

// A compositor image holding a socket's value as a color, as Blender converts a value or vector to one (float4_from_float,
// float4_from_float3), read back by its first channel or channels.
const fromImage = (texel, kind) => (kind === 'float' ? `${texel}.r` : kind === 'vec3' ? `${texel}.rgb` : texel);
const toImage = (value, kind) => convert(value, kind, 'color4');
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
    for (const s of linkable) {
      this.registerInput(s.identifier, T.AutoDetect, true);
      this.getInputByName(s.identifier).addExcludedConnectionPointFromAllowedTypes(T.TextureAllButBackBuffer);
    }
    this._addDependenciesInput();
    for (const s of outputs) this.registerOutput(s.identifier, T.Texture);
    // A node that runs as an operation of its own replays it as Blender's GPU compositor records it.
    this.replays = nodeTypeHasOperation(idname);
    this._frameGraphTask = this.replays ? new BlenderReplayTask(this.name, frameGraph, outputs.map((s) => s.identifier))
      : new BlenderCompositorTask(this.name, frameGraph, this._effect());
  }

  // The output the node's image is: the one set (`output`), else one that is linked, else its first available one.
  get result() {
    const outputs = this.declaration.outputs, shown = this.availability.outputs;
    return outputs.find((s) => s.identifier === this.output) ?? outputs.find((s) => this.getOutputByName(s.identifier)?.hasEndpoints)
      ?? outputs.find((s) => shown.has(s.identifier)) ?? outputs[0];
  }
  // A replayed node runs at the size of the images it last ran on (a view's render; 1920 by 1080 before it has run).
  get runs() { return this.replays ? !!this._recording(this._frameGraphTask.size ?? [1920, 1080])?.plan.steps : !!this._graph(); }
  // The node's operation as Blender's GPU compositor runs it on images of `size` (compositor-replay.js).
  _recording([width, height]) {
    return nodeRecording(this.idname, { properties: this.properties, values: this.values, linked: [...this.linked.keys()] }, width, height);
  }
  // Whether the node's recorded passes differ from those the graph was built with (a value they depend on changed).
  get stale() {
    const task = this._frameGraphTask;
    return this.replays && !this.mute && !!task.size && task.plan !== (this._recording(task.size)?.plan ?? null);
  }
  // The node's GPU code as Blender builds it for its properties, values and linked inputs (gpu-graph.js).
  _graph() {
    return nodeGraph('CompositorNodeTree', this.idname, { properties: this.properties, values: this.values, linked: [...this.linked.keys()] });
  }
  _uniformValues() { return (this._graph()?.nodes ?? []).flatMap((n) => n.inputs.filter((i) => i.source === 'uniform').map((i) => i.value)); }
  get availability() { return availability(this.declaration, this.properties, this.values); }
  get mute() { return this.disabled; }
  set mute(value) { this.disabled = value; }
  // The images linked into the node's inputs, by input identifier.
  get linked() { return new Map(this.inputs.filter((i) => i.connectedPoint && i.name !== 'dependencies').map((i) => [i.name, i.connectedPoint])); }

  // The fragment shader: the node's GPU code on its linked images' texels, its unlinked inputs' values as uniforms
  // (Blender's own split: menus and booleans are constants, which rebuild); muted or without GPU code, its input.
  _fragment() {
    const functions = new Map(), uniforms = [], samplers = new Map(), bands = [], linked = this.linked, graph = !this.mute && this._graph();
    const texel = (id, kind) => {
      const sampler = samplerOf(this, id), from = imageKind(linked.get(id));
      if (sampler !== 'textureSampler') samplers.set(sampler, id);
      return convert(fromImage(`texture2D(${sampler}, vUV)`, from), from, kind);
    };
    let body = '', result, kind = this.result ? kindOfSocket(this.declaration, '@' + this.result.identifier) : 'color4';
    if (graph) {
      const { code, outputs } = graphCode(graph, {
        image: texel,
        uniform: (values, k) => { const name = `bl_u${uniforms.length}`; uniforms.push([name, k]); return name; },
        band: (index) => { const name = `bl_band${index}`; bands.push([name, graph.bands[index]]); return name; },
        emit: (key, code) => functions.set(key, code),
      });
      body = code;
      const out = this.result && outputs.get(graph.outputs[this.result.identifier]);
      if (out) [result, kind] = out;
    } else if (this.result) {
      const kindOf = (s) => socketType(s.type).kind;
      const links = new Map([...linked.keys()].map((id) => [id, texel(id, kindOf(this.declaration.inputs.find((s) => s.identifier === id)))]));
      for (const s of this.declaration.inputs) if (!links.has(s.identifier) && socketType(s.type) && s.type !== 'MENU') links.set(s.identifier, glslValue(this.values[s.identifier] ?? 0, kindOf(s)));
      muteLinks(this.declaration, this.availability.inputs, links);
      result = links.get('@' + this.result.identifier);
    }
    const code = ['precision highp int;', 'varying vec2 vUV;', 'uniform sampler2D textureSampler;', ...[...samplers.keys(), ...bands.map(([n]) => n)].map((n) => `uniform sampler2D ${n};`),
      ...uniforms.map(([n, k]) => `uniform ${glslType(k) ?? k} ${n};`), ...functions.values(), 'void main(void) {',
      body + `gl_FragColor = ${toImage(result ?? glslValue(0, kind), kind)};`, '}'].join('\n');
    return { code, uniforms, samplers: [...samplers], bands };
  }

  _effect() {
    const { code, uniforms, samplers, bands } = this._fragment();
    const effect = new BlenderEffect({ name: this.name, engine: this._engine, fragmentShader: engineGLSL(this._engine, code), useAsPostProcess: true, uniforms: uniforms.map(([n]) => n),
      samplers: [...samplers.map(([n]) => n), ...bands.map(([n]) => n)] });
    return Object.assign(effect, { code, uniformList: uniforms, samplerList: samplers, bandList: bands, block: this });
  }

  _buildBlock(state) {
    super._buildBlock(state);
    if (this.replays) { this._buildReplay(); return; }
    const task = this._frameGraphTask;
    if (this._fragment().code !== task.postProcess.code) {
      task.postProcess.dispose();
      task.postProcess = this._effect();
      task._postProcessDrawWrapper = task.postProcess.drawWrapper;
    }
    task.postProcess.bandList = this._fragment().bands;
    const linked = this.linked;
    task.inputTextures = new Map(task.postProcess.samplerList.map(([sampler, id]) => [sampler, linked.get(id).value]));
    task.sourceTexture = this.image && linked.get(this.image.identifier)?.value;
    task.targetTexture = task.sourceTexture === undefined ? this._frameGraph.textureManager.createRenderTargetTexture(this.name, IMAGE) : undefined;
    if (this.result) this.getOutputByName(this.result.identifier).value = task.outputTexture;
  }

  _buildReplay() {
    const task = this._frameGraphTask, linked = this.linked;
    task.inputTextures = new Map([...linked].map(([id, point]) => [id, point.value]));
    task.sourceTexture = this.image && linked.get(this.image.identifier)?.value;
    task.recorder = (size) => (this.mute ? null : this._recording(size));
    for (const [id, handle] of task.outputTextures) this.getOutputByName(id).value = handle;
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
export const compositorNodeClasses = Object.fromEntries(Object.entries(compositorBlockClasses).filter(([idname]) => nodeTypeHasGpu(idname)));
