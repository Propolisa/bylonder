// @ts-check
// SPDX-License-Identifier: MIT OR Apache-2.0
// Bylonder's blocks library: a compositor as a Babylon NodeRenderGraph of one generic pass block. Each pass is a Blender
// compositor node whose code and plan the export made: a fragment shader on the images linked into it with its values as
// uniforms, or a recorded plan of passes replayed on Babylon's frame graph. The graph runs on a camera's render before
// its display transform, as Blender's viewport compositor does, and writes its composite back there.
import { Constants } from '@babylonjs/core/Engines/constants.js';
import { EffectRenderer, EffectWrapper } from '@babylonjs/core/Materials/effectRenderer.js';
import { FrameGraphPostProcessTask } from '@babylonjs/core/FrameGraph/Tasks/PostProcesses/postProcessTask.js';
import { FrameGraphTask } from '@babylonjs/core/FrameGraph/frameGraphTask.js';
import { Matrix } from '@babylonjs/core/Maths/math.vector.js';
import { NodeRenderGraph } from '@babylonjs/core/FrameGraph/Node/nodeRenderGraph.js';
import { NodeRenderGraphBlock } from '@babylonjs/core/FrameGraph/Node/nodeRenderGraphBlock.js';
import { NodeRenderGraphBlockConnectionPointTypes as T } from '@babylonjs/core/FrameGraph/Node/Types/nodeRenderGraphTypes.js';
import { NodeRenderGraphOutputBlock } from '@babylonjs/core/FrameGraph/Node/Blocks/outputBlock.js';
import { PassPostProcess } from '@babylonjs/core/PostProcesses/passPostProcess.js';
import { RawTexture } from '@babylonjs/core/Materials/Textures/rawTexture.js';
import { RegisterClass } from '@babylonjs/core/Misc/typeStore.js';

/** @typedef {import('@babylonjs/core').AbstractEngine} AbstractEngine */
/** @typedef {import('@babylonjs/core').Scene} Scene */
/** @typedef {import('@babylonjs/core').Camera} Camera */
/** @typedef {import('@babylonjs/core').PostProcess} PostProcess */
/** @typedef {import('@babylonjs/core').FrameGraph} FrameGraph */
/** @typedef {import('@babylonjs/core').Effect} Effect */
/** @typedef {import('@babylonjs/core').FrameGraphRenderContext} FrameGraphRenderContext */
/** @typedef {number} TextureHandle */

/**
 * A uniform of a fragment pass: its GLSL name and kind ('float', 'vec2', 'vec3', 'vec4', 'mat4') and its value.
 * @typedef {{ name: string, kind: string, value: number[] }} Uniform
 */
/**
 * A pass's fragment shader on the images linked into its inputs: `samplers` names each image's sampler and input,
 * `bands` the data textures (RGBA floats, one row) it samples.
 * @typedef {object} Fragment
 * @property {string} code
 * @property {Uniform[]} uniforms
 * @property {[string, string][]} samplers
 * @property {{ name: string, pixels: number[] }[]} bands
 */
/**
 * A recorded plan: textures by id with their size and format, the steps that clear, copy, upload to or draw into them,
 * which textures the inputs are and which the outputs are; `data` holds the uploads' bytes, base64.
 * @typedef {object} Plan
 * @property {{ id: number, size: number[], format: string }[]} textures
 * @property {any[]} steps
 * @property {Record<string, number>} inputs
 * @property {Record<string, { texture?: number, value?: number[] }>} outputs
 * @property {string} data
 */
/**
 * A pass: its image inputs and outputs by identifier, the input its own image is, the output its image is, and its
 * fragment shader or its plan (neither: it passes its image through).
 * @typedef {object} Pass
 * @property {string[]} inputs
 * @property {string[]} outputs
 * @property {string} [image]
 * @property {string} [result]
 * @property {Fragment} [fragment]
 * @property {Plan} [plan]
 */

/**
 * The bytes of an upload as RGBA floats, as a texture of its format holds them.
 * @param {Uint8Array} bytes
 * @param {string} format
 * @param {number[]} extent
 * @param {number} channels
 */
export function uploadFloats(bytes, format, extent, channels) {
  const count = extent[0] * Math.max(1, extent[1]) * Math.max(1, extent[2]);
  const values = format === 'float' ? new Float32Array(bytes.buffer, bytes.byteOffset, count * channels)
    : format === 'int' ? Float32Array.from(new Int32Array(bytes.buffer, bytes.byteOffset, count * channels))
      : format === 'uint' ? Float32Array.from(new Uint32Array(bytes.buffer, bytes.byteOffset, count * channels))
        : format === 'ubyte' ? Float32Array.from(bytes.subarray(0, count * channels), (v) => v / 255) : null;
  if (!values) throw Error(`an upload of ${format} data is not replayed`);
  const rgba = new Float32Array(count * 4);
  for (let i = 0; i < count; i++) for (let c = 0; c < 4; c++) rgba[i * 4 + c] = c < channels ? values[i * channels + c] : c === 3 ? 1 : 0;
  return rgba;
}

/**
 * The channels of a texture of a GPU format Blender names (RGBA16F, RG32F, R8I).
 * @param {string} format
 */
export const formatChannels = (format) => (/^RGBA/.test(format) ? 4 : /^RGB/.test(format) ? 3 : /^RG/.test(format) ? 2 : 1);

/** @param {string} format */
const textureType = (format) => (/32F/.test(format) ? Constants.TEXTURETYPE_FLOAT : Constants.TEXTURETYPE_HALF_FLOAT);
/** @type {Record<string, number>} */
const EXTEND = { extend: Constants.TEXTURE_CLAMP_ADDRESSMODE, repeat: Constants.TEXTURE_WRAP_ADDRESSMODE,
  mirrored_repeat: Constants.TEXTURE_MIRROR_ADDRESSMODE, clamp_to_border: Constants.TEXTURE_CLAMP_ADDRESSMODE };
const HALF = { createMipMaps: false, types: [Constants.TEXTURETYPE_HALF_FLOAT], formats: [Constants.TEXTUREFORMAT_RGBA], samples: 1, useSRGBBuffers: [false] };

/**
 * Sets a uniform of a kind on an effect.
 * @param {Effect} effect
 * @param {string} name
 * @param {string} type GLSL ('vec3') or Blender's create info type ('float3')
 * @param {number[]} v
 * @param {number} [array] the length of a uniform array
 */
export function setUniform(effect, name, type, v, array = 0) {
  if (array > 0) return /^int/.test(type) ? effect.setIntArray(name, Int32Array.from(v)) : effect.setFloatArray(name, Float32Array.from(v));
  switch (type) {
    case 'float': return effect.setFloat(name, v[0]);
    case 'vec2': case 'float2': return effect.setFloat2(name, v[0], v[1]);
    case 'vec3': case 'float3': return effect.setFloat3(name, v[0], v[1], v[2]);
    case 'vec4': case 'color4': case 'float4': return effect.setFloat4(name, v[0], v[1], v[2], v[3]);
    case 'int': case 'uint': case 'bool': return effect.setInt(name, v[0]);
    case 'int2': return effect.setInt2(name, v[0], v[1]);
    case 'int3': return effect.setInt3(name, v[0], v[1], v[2]);
    case 'int4': return effect.setInt4(name, v[0], v[1], v[2], v[3]);
    case 'mat4': case 'float4x4': return effect.setMatrix(name, Matrix.FromArray(v));
    case 'mat3': case 'float3x3': return effect.setMatrix3x3(name, new Float32Array(v));
    default: throw Error(`a ${type} uniform is not set`);
  }
}

/**
 * Babylon's post process task, which samples its source image, also binding the images linked into its other inputs,
 * as Babylon's own multi-input tasks do (FrameGraphBloomMergeTask).
 */
export class ImagesPostProcessTask extends FrameGraphPostProcessTask {
  /** Each sampler's texture. @type {Map<string, TextureHandle>} */
  inputTextures = new Map();

  /** @param {boolean} [skipCreationOfDisabledPasses] */
  record(skipCreationOfDisabledPasses = false) {
    const pass = super.record(skipCreationOfDisabledPasses, undefined, (context) => {
      const effect = /** @type {Effect} */ (this._postProcessDrawWrapper.effect);
      for (const [sampler, texture] of this.inputTextures) context.bindTextureHandle(effect, sampler, texture);
    });
    for (const texture of this.inputTextures.values()) pass.addDependencies(texture);
    return pass;
  }
}

/**
 * A recorded plan as a frame graph task: its passes in order, each writing a new version of the texture it writes (a
 * pass samples the version before it), on the images linked into it (`inputTextures`, by input identifier), giving
 * `outputTextures` (by output identifier). Disabled, or with no plan, it passes `sourceTexture` through.
 */
export class ReplayTask extends FrameGraphTask {
  /** The plan for an image size, and its uploads' bytes. @type {(size: number[]) => { plan: any, data: Uint8Array } | null} */
  recorder = () => null;
  /** The size the task last recorded at. @type {number[] | null} */
  size = null;
  /** @type {any} */
  plan = null;
  /** @type {Uint8Array | null} */
  data = null;
  /** @type {Map<string, TextureHandle>} */
  inputTextures = new Map();
  /** @type {TextureHandle | undefined} */
  sourceTexture = undefined;
  /** @type {Map<string, TextureHandle>} */
  outputTextures = new Map();
  /** @type {Map<string, EffectWrapper>} */
  #effects = new Map();
  /** Each uploaded texture by id. @type {Map<number, RawTexture>} */
  #uploads = new Map();

  /**
   * @param {string} name
   * @param {FrameGraph} frameGraph
   * @param {string[]} outputs
   */
  constructor(name, frameGraph, outputs) {
    super(name, frameGraph);
    for (const id of outputs) this.outputTextures.set(id, frameGraph.textureManager.createDanglingHandle());
  }

  isReady() { return [...this.#effects.values()].every((e) => e.isReady()); }

  /**
   * A pass's GLSL for the engine (the app specializes its samplers for WebGPU).
   * @param {string} code
   */
  shaderCode(code) { return code; }

  /**
   * @param {string} code
   * @param {any} step
   */
  #effect(code, step) {
    let wrapper = this.#effects.get(code);
    if (!wrapper) {
      wrapper = new EffectWrapper({ name: this.name, engine: this._frameGraph.engine, fragmentShader: this.shaderCode(code), useAsPostProcess: true,
        uniforms: ['bl_domain', ...step.pushConstants.map((/** @type {any} */ c) => c.name)], samplers: [...step.samplers.map((/** @type {any} */ s) => s.name), ...step.before.map((/** @type {any} */ b) => b.name)] });
      this.#effects.set(code, wrapper);
    }
    return wrapper;
  }

  /**
   * The pixels the plan uploads to each texture, by id.
   * @returns {Map<number, Float32Array>}
   */
  #uploadedPixels() {
    const plan = this.plan, data = /** @type {Uint8Array} */ (this.data), pixels = new Map();
    const specs = new Map(plan.textures.map((/** @type {any} */ t) => [t.id, t]));
    for (const step of plan.steps.filter((/** @type {any} */ s) => s.op === 'update')) {
      const spec = specs.get(step.texture), [w, h] = spec.size;
      const into = pixels.get(step.texture) ?? new Float32Array(w * Math.max(1, h) * 4);
      const floats = uploadFloats(data.subarray(step.data, step.data + step.bytes), step.format, step.extent, formatChannels(spec.format));
      for (let y = 0; y < Math.max(1, step.extent[1]); y++) into.set(floats.subarray(y * step.extent[0] * 4, (y + 1) * step.extent[0] * 4), ((step.offset[1] + y) * w + step.offset[0]) * 4);
      pixels.set(step.texture, into);
    }
    return pixels;
  }

  /** Uploads the plan's data again, after a value in it changed. */
  reupload() {
    for (const [id, pixels] of this.#uploadedPixels()) this.#uploads.get(id)?.update(pixels);
  }

  record() {
    const manager = this._frameGraph.textureManager, engine = this._frameGraph.engine;
    for (const raw of this.#uploads.values()) raw.dispose();
    this.#uploads.clear();
    const source = this.sourceTexture !== undefined ? manager.getTextureDescription(this.sourceTexture).size : manager.getAbsoluteDimensions({ width: 100, height: 100 });
    this.size = [source.width, source.height];
    ({ plan: this.plan = null, data: this.data = null } = this.recorder(this.size) ?? {});
    const plan = this.plan?.steps ? this.plan : null;
    if (!plan) return this.#passThrough(false);
    /** @type {Map<number, any>} */
    const specs = new Map(plan.textures.map((/** @type {any} */ t) => [t.id, t]));
    /** @type {Map<number, TextureHandle>} */
    const current = new Map();
    for (const [id, texture] of Object.entries(plan.inputs)) {
      const handle = this.inputTextures.get(id);
      if (handle !== undefined) current.set(/** @type {number} */ (texture), handle);
    }
    let versions = 0;
    /** @param {number} id */
    const version = (id) => manager.createRenderTargetTexture(`${this.name} ${id}.${versions++}`, {
      size: { width: specs.get(id).size[0], height: specs.get(id).size[1] }, sizeIsPercentage: false, isHistoryTexture: false,
      options: { ...HALF, types: [textureType(specs.get(id).format)] } });
    // Uploaded textures hold their data from the start (Blender uploads weights and single values before its passes).
    for (const [id, pixels] of this.#uploadedPixels()) {
      const [w, h] = specs.get(id).size;
      const raw = RawTexture.CreateRGBATexture(pixels, w, Math.max(1, h), this._frameGraph.scene, false, false, Constants.TEXTURE_NEAREST_SAMPLINGMODE, Constants.TEXTURETYPE_FLOAT);
      this.#uploads.set(id, raw);
      current.set(id, manager.importTexture(`${this.name} upload ${id}`, /** @type {any} */ (raw.getInternalTexture())));
    }
    /** @param {number} id */
    const read = (id) => {
      if (!current.has(id)) {
        const cleared = version(id);
        const pass = this._frameGraph.addRenderPass(`${this.name} new ${id}`);
        pass.setRenderTarget(cleared);
        pass.setExecuteFunc((context) => context.clear({ r: 0, g: 0, b: 0, a: 0 }, true, false, false));
        current.set(id, cleared);
      }
      return /** @type {TextureHandle} */ (current.get(id));
    };
    plan.steps.forEach((/** @type {any} */ step, /** @type {number} */ i) => {
      if (step.op === 'update') return;
      const target = step.op === 'clear' ? step.texture : step.op === 'copy' ? step.to : step.target;
      const output = version(target), pass = this._frameGraph.addRenderPass(`${this.name} ${i}`);
      pass.setRenderTarget(output);
      if (step.op === 'clear') {
        const [r, g, b, a] = step.value;
        pass.setExecuteFunc((context) => context.clear({ r, g, b, a }, true, false, false));
      } else if (step.op === 'copy') {
        const from = read(step.from);
        pass.addDependencies(from);
        pass.setExecuteFunc((context) => context.copyTexture(from));
      } else {
        const wrapper = this.#effect(step.code, step);
        const samplers = step.samplers.map((/** @type {any} */ s) => ({ ...s, handle: read(s.texture) }));
        const before = step.before.map((/** @type {any} */ b) => ({ ...b, handle: read(b.texture) }));
        pass.addDependencies([...samplers, ...before].map((s) => s.handle));
        pass.setExecuteFunc((context) => {
          for (const s of samplers) {
            context.setTextureSamplingMode(s.handle, s.linear ? Constants.TEXTURE_BILINEAR_SAMPLINGMODE : Constants.TEXTURE_NEAREST_SAMPLINGMODE);
            const texture = manager.getTextureFromHandle(s.handle);
            if (texture) engine.updateTextureWrappingMode(texture, EXTEND[s.extend[0]], EXTEND[s.extend[1]]);
          }
          context.applyFullScreenEffect(wrapper.drawWrapper, () => {
            const effect = /** @type {Effect} */ (wrapper.drawWrapper.effect);
            effect.setInt3('bl_domain', step.domain[0], step.domain[1], step.domain[2]);
            for (const c of step.pushConstants) setUniform(effect, c.name, c.type, [c.value ?? []].flat(), c.array);
            for (const s of [...samplers, ...before]) context.bindTextureHandle(effect, s.name, s.handle);
          });
        });
      }
      current.set(target, output);
    });
    for (const [id, handle] of this.outputTextures) {
      const output = plan.outputs[id];
      if (output?.texture !== undefined) manager.resolveDanglingHandle(handle, read(output.texture));
      else {
        // A single value (or nothing) as an image of the render's size.
        const [r, g, b, a] = output?.value ?? [0, 0, 0, 0];
        const size = Object.values(plan.inputs).map((t) => specs.get(/** @type {number} */ (t))?.size).find(Boolean);
        const image = manager.createRenderTargetTexture(`${this.name} ${id}`, { size: size ? { width: size[0], height: size[1] } : { width: 100, height: 100 },
          sizeIsPercentage: !size, isHistoryTexture: false, options: HALF });
        const pass = this._frameGraph.addRenderPass(`${this.name} ${id}`);
        pass.setRenderTarget(image);
        pass.setExecuteFunc((context) => context.clear({ r, g, b, a }, true, false, false));
        manager.resolveDanglingHandle(handle, image);
      }
    }
    // The frame graph checks that a task ends on the same target enabled as disabled: its first output.
    const last = this._frameGraph.addRenderPass(`${this.name} output`);
    last.setRenderTarget([...this.outputTextures.values()][0]);
    last.setExecuteFunc(() => {});
    this.#passThrough(true);
  }

  /**
   * The disabled pass (or, `disabledOnly` false, the pass) giving the source as each output.
   * @param {boolean} disabledOnly
   */
  #passThrough(disabledOnly) {
    const manager = this._frameGraph.textureManager, outputs = [...this.outputTextures.values()], source = this.sourceTexture;
    if (!disabledOnly) {
      for (const handle of outputs) manager.resolveDanglingHandle(handle, source);
      return;
    }
    const pass = this._frameGraph.addRenderPass(this.name + '_disabled', true);
    if (source !== undefined) pass.addDependencies(source);
    pass.setRenderTarget(outputs[0]);
    pass.setExecuteFunc((context) => { if (source !== undefined) context.copyTexture(source); });
  }

  dispose() {
    for (const wrapper of this.#effects.values()) wrapper.dispose();
    for (const raw of this.#uploads.values()) raw.dispose();
    super.dispose();
  }
}

/** A full size image, for a pass no image is linked into (a mask's). */
const IMAGE = { size: { width: 100, height: 100 }, sizeIsPercentage: true, options: HALF };

/** The fragment pass's effect, binding its uniforms' current values and its bands. */
class FragmentEffect extends EffectWrapper {
  /**
   * @param {AbstractEngine} engine
   * @param {string} name
   * @param {Fragment} fragment
   * @param {RawTexture[]} bands
   */
  constructor(engine, name, fragment, bands) {
    super({ name, engine, fragmentShader: fragment.code, useAsPostProcess: true, uniforms: fragment.uniforms.map((u) => u.name),
      samplers: [...fragment.samplers.map(([sampler]) => sampler), ...fragment.bands.map((b) => b.name)] });
    this.fragment = fragment;
    this.bands = bands;
  }

  /** @param {boolean} [noDefaultBindings] */
  bind(noDefaultBindings) {
    super.bind(noDefaultBindings);
    const effect = /** @type {Effect} */ (this.drawWrapper.effect);
    for (const u of this.fragment.uniforms) setUniform(effect, u.name, u.kind, u.value);
    this.fragment.bands.forEach((b, i) => effect.setTexture(b.name, this.bands[i]));
  }
}

/**
 * A pass of the export's compositor: one Blender node, its code and plan made at export (`pass`), its image inputs
 * linked as in Blender's tree. A disabled (muted) block passes its image through.
 */
export class BylonderPassBlock extends NodeRenderGraphBlock {
  /** @type {Pass} */
  pass = { inputs: [], outputs: [] };

  /**
   * @param {string} name
   * @param {FrameGraph} frameGraph
   * @param {Scene} scene
   */
  constructor(name, frameGraph, scene) {
    super(name, frameGraph, scene);
    this._addDependenciesInput();
  }

  getClassName() { return 'BylonderPassBlock'; }

  /**
   * Sets a uniform's value, or one of its components, without rebuilding the graph.
   * @param {number} index
   * @param {number} value
   * @param {number} [component]
   */
  setUniform(index, value, component = 0) {
    const uniform = this.pass.fragment?.uniforms[index];
    if (uniform) uniform.value[component] = value;
  }

  /**
   * Sets a value the plan uploads (a 32-bit float at `offset` in its data), without rebuilding the graph.
   * @param {number} offset
   * @param {number} value
   */
  setUpload(offset, value) {
    const task = this._frameGraphTask, data = this.#data;
    if (!data) return;
    new DataView(data.buffer, data.byteOffset).setFloat32(offset, value, true);
    if (task instanceof ReplayTask && task.data) task.reupload();
  }

  /** The plan's uploads. @type {Uint8Array | null} */
  #data = null;

  /** @param {Pass} pass */
  #setPass(pass) {
    this.pass = pass;
    for (const id of pass.inputs) {
      this.registerInput(id, T.AutoDetect, true);
      this.getInputByName(id)?.addExcludedConnectionPointFromAllowedTypes(T.TextureAllButBackBuffer);
    }
    for (const id of pass.outputs) this.registerOutput(id, T.Texture);
    if (pass.plan) {
      const { data, ...plan } = pass.plan, bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
      const task = new ReplayTask(this.name, this._frameGraph, pass.outputs);
      this.#data = bytes;
      task.recorder = () => (this.disabled ? null : { plan, data: bytes });
      this._frameGraphTask = task;
    } else {
      const fragment = pass.fragment ?? { code: 'varying vec2 vUV;\nuniform sampler2D textureSampler;\nvoid main(void) { gl_FragColor = texture2D(textureSampler, vUV); }', uniforms: [], samplers: [], bands: [] };
      const bands = fragment.bands.map((b) => {
        const texture = RawTexture.CreateRGBATexture(new Float32Array(b.pixels), b.pixels.length / 4, 1, this._scene, false, false, Constants.TEXTURE_BILINEAR_SAMPLINGMODE, Constants.TEXTURETYPE_FLOAT);
        texture.wrapU = texture.wrapV = Constants.TEXTURE_CLAMP_ADDRESSMODE;
        return texture;
      });
      this._frameGraphTask = new ImagesPostProcessTask(this.name, this._frameGraph, new FragmentEffect(this._engine, this.name, fragment, bands));
    }
  }

  /** The point linked into each input, by identifier. */
  get linked() {
    return new Map(this.inputs.filter((i) => i.connectedPoint && i.name !== 'dependencies').map((i) => [i.name, /** @type {any} */ (i.connectedPoint)]));
  }

  /** @param {any} state */
  _buildBlock(state) {
    super._buildBlock(state);
    const task = this._frameGraphTask, linked = this.linked, pass = this.pass;
    if (task instanceof ReplayTask) {
      task.inputTextures = new Map([...linked].map(([id, point]) => [id, point.value]));
      task.sourceTexture = pass.image === undefined ? undefined : linked.get(pass.image)?.value;
      for (const [id, handle] of task.outputTextures) /** @type {any} */ (this.getOutputByName(id)).value = handle;
      return;
    }
    if (!(task instanceof ImagesPostProcessTask)) return;
    task.inputTextures = new Map((pass.fragment?.samplers ?? []).map(([sampler, id]) => [sampler, linked.get(id)?.value]));
    task.sourceTexture = pass.image === undefined ? undefined : linked.get(pass.image)?.value;
    task.targetTexture = task.sourceTexture === undefined ? this._frameGraph.textureManager.createRenderTargetTexture(this.name, IMAGE) : undefined;
    const result = pass.result ?? pass.outputs[0];
    if (result !== undefined) /** @type {any} */ (this.getOutputByName(result)).value = task.outputTexture;
  }

  serialize() {
    return { ...super.serialize(), pass: this.pass };
  }

  /** @param {any} serialized */
  _deserialize(serialized) {
    // Its ports and task first: Babylon's part names them and sets the task's disabled state.
    this.#setPass(serialized.pass);
    super._deserialize(serialized);
    /** @type {any} */ (this._frameGraphTask).name = this.name;
  }
}
RegisterClass('BABYLON.BylonderPassBlock', BylonderPassBlock);

/**
 * The compositor's output: the composite's handle, which the view copies back over its render (`result`). As a frame
 * graph task it does nothing (Babylon's output block would copy to the canvas).
 */
export class CompositeOutputBlock extends NodeRenderGraphOutputBlock {
  /**
   * @param {string} name
   * @param {FrameGraph} frameGraph
   * @param {Scene} scene
   */
  constructor(name, frameGraph, scene) {
    super(name, frameGraph, scene);
    /** @type {any} */ (this)._frameGraphTask.disabled = true;
  }

  getClassName() { return 'BylonderCompositeOutputBlock'; }

  /** The composite's handle, null when nothing is linked. @returns {TextureHandle | null} */
  get result() { return /** @type {any} */ (this.texture.connectedPoint)?.value ?? null; }
}
RegisterClass('BABYLON.BylonderCompositeOutputBlock', CompositeOutputBlock);

/**
 * Draws `source` stretched over all of `target`, sampled linearly when their sizes differ.
 * @param {AbstractEngine} engine
 */
export function textureCopier(engine) {
  const renderer = new EffectRenderer(engine);
  const wrapper = new EffectWrapper({ engine, name: 'Composite copy', useShaderStore: false, samplers: ['source'],
    fragmentShader: 'varying vec2 vUV;\nuniform sampler2D source;\nvoid main(void) { gl_FragColor = texture2D(source, vUV); }' });
  /**
   * @param {any} source an InternalTexture
   * @param {any} target a RenderTargetWrapper
   */
  return (source, target) => {
    if (!wrapper.effect.isReady()) return;
    renderer.saveStates();
    engine.bindFramebuffer(target);
    renderer.setViewport();
    renderer.applyEffectWrapper(wrapper);
    wrapper.effect._bindTexture('source', source);
    renderer.draw();
    engine.unBindFramebuffer(target);
    renderer.restoreStates();
  };
}

/**
 * The export's compositor (`source`, a NodeRenderGraph's serialization whose Render Layers input is the render) on a
 * camera's render: it runs once the render is drawn, before `display` (the camera's display transform, a post process
 * of the camera), at the size its plans were recorded for (`width`, `height`), and writes its composite back.
 * @param {Scene} scene
 * @param {Camera} camera
 * @param {{ graph: any, width: number, height: number }} source
 * @param {PostProcess} display
 */
export async function compositor(scene, camera, { graph: json, width, height }, display) {
  const engine = scene.getEngine(), graph = new NodeRenderGraph('Compositing', scene, { rebuildGraphOnEngineResize: false });
  graph.parseSerializedObject(structuredClone(json));
  const layers = /** @type {any} */ (graph.getInputBlocks().find((b) => b.isAnyTexture()));
  // Headless (no canvas, as in Node): the graph only holds its controls.
  if (!engine.getRenderingCanvas()) return { graph, dispose: () => graph.dispose() };
  const target = engine.createRenderTargetTexture({ width, height }, { type: Constants.TEXTURETYPE_HALF_FLOAT, format: Constants.TEXTUREFORMAT_RGBA,
    generateMipMaps: false, generateDepthBuffer: false, samplingMode: Constants.TEXTURE_BILINEAR_SAMPLINGMODE });
  if (layers) layers.value = target.texture;
  graph.build();
  await graph.whenReadyAsync();
  const output = /** @type {CompositeOutputBlock} */ (graph.outputBlock), copy = textureCopier(engine);
  // The render as the display transform takes it, drawn by a pass of its own just before it.
  const render = new PassPostProcess('Render Layers', 1, null, Constants.TEXTURE_BILINEAR_SAMPLINGMODE, engine, false, Constants.TEXTURETYPE_HALF_FLOAT);
  camera.attachPostProcess(render, camera._postProcesses.indexOf(display));
  render.onAfterRenderObservable.add(() => {
    const into = display.inputTexture;
    if (!into?.texture) return;
    copy(into.texture, target);
    graph.frameGraph.execute();
    const result = output.result === null ? null : graph.frameGraph.textureManager.getTextureFromHandle(output.result);
    if (result && result !== target.texture) copy(result, into);
  });
  return { graph, dispose: () => { camera.detachPostProcess(render); render.dispose(); graph.dispose(); target.dispose(); } };
}
