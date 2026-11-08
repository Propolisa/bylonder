// Blender's GPU compositor in a view: a node's operation recorded in the module as Blender's own code runs it on the GPU
// (tools/blender-port/wasm/compositor-api.cc compositor_record_node, on the recording GPU backend gpu-record.cc), and
// replayed here on Babylon's frame graph. Each compute dispatch runs as fragment passes of Blender's GLSL for the shader
// (compositor-shaders.js), one per image it writes: a fragment is a texel of that image, the invocation that writes
// it is found from how the shader's imageStore addresses the image (imageStores), and the shader's main runs for it,
// its stores to other texels or images dropped. Shaders whose writes cannot be found that way, or that share memory
// between invocations, are not replayed (the node passes its image through).
import { Constants, EffectWrapper, FrameGraphTask, Matrix, RawTexture } from '@babylonjs/core';
import { compute } from './compositor-shaders.js';
import { blenderMain, blenderModule } from '../bmesh/bmesh-wasm.js';
import { withScratchNode } from '../nodes/blender/gpu-graph.js';
import { glsl as libraries } from '../nodes/blender/gpu-library.js';
import { glslShader } from '../nodes/blender/glsl.js';
import { implicitConversions } from '../nodes/blender/glsl-conversions.js';

const { exports: x, withString, withArrays, cString } = blenderModule;
const SOURCES = { ...libraries, ...compute };

// A GLSL file with what it includes, each file once, in include order (Blender's gpu_shader_dependency.cc
// resolution); the create infos it includes are the recording's.
export function resolveSource(name, seen = new Set()) {
  if (seen.has(name)) return '';
  seen.add(name);
  const text = SOURCES[name];
  if (text === undefined) throw Error(`Blender GLSL has no ${name}`);
  return text.replace(/^\s*#\s*include\s+"([^"]+)".*$/gm, (_, file) => (file.endsWith('.glsl') ? resolveSource(file, seen) : ''))
    .replace(/^\s*#\s*pragma\s+once.*$/gm, '').replace(/^\s*\w+_SHADER_CREATE_INFO\(\w+\)\s*$/gm, '');
}

const stripComments = (text) => text.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/.*$/gm, '');

// The arguments of the call whose '(' is at `open`, split at its top level commas.
function callArguments(text, open) {
  const args = [];
  let depth = 0, start = open + 1;
  for (let i = open; i < text.length; i++) {
    const c = text[i];
    if (c === '(' || c === '[') depth++;
    else if (c === ')' || c === ']') {
      if (--depth === 0) { args.push(text.slice(start, i).trim()); return args; }
    } else if (c === ',' && depth === 1) { args.push(text.slice(start, i).trim()); start = i + 1; }
  }
  return args;
}

// How a shader addresses each image it stores to, from its GLSL: 'texel' when a store's texel is the invocation's
// (int2(gl_GlobalInvocationID.xy), or a variable holding it), 'transposed' when it is that with x and y swapped
// (texel.yx, as the separable blurs write), else the store's texel expression (not replayed). An image stored to by
// stores of different kinds is listed with all of them. Also whether invocations share memory (shared variables,
// barriers, atomics), which no fragment pass can.
export function imageStores(code) {
  const text = stripComments(code), stores = {};
  const invocation = /^(int2|ivec2)\(\s*gl_GlobalInvocationID\.xy\s*\)$/;
  const texels = new Set([...text.matchAll(/\b(?:int2|ivec2)\s+(\w+)\s*=\s*([^;]+);/g)].filter((m) => invocation.test(m[2].trim())).map((m) => m[1]));
  const kind = (expression) => {
    const e = expression.replace(/\s+/g, '');
    if (invocation.test(e) || texels.has(e)) return 'texel';
    const swizzled = /^(\w+)\.yx$/.exec(e);
    if (swizzled && texels.has(swizzled[1])) return 'transposed';
    return e;
  };
  for (const match of text.matchAll(/\bimageStore\s*\(/g)) {
    const [image, texel] = callArguments(text, match.index + match[0].length - 1);
    (stores[image] ??= new Set()).add(kind(texel));
  }
  const shares = /\bshared\s+\w|\bbarrier\s*\(|\batomic\w*\s*\(|\bimageAtomic\w*\s*\(/.test(text);
  return { stores: Object.fromEntries(Object.entries(stores).map(([image, kinds]) => [image, [...kinds]])), shares };
}

// A create info's compute shader as GLSL ES, its defines applied.
const shaderCode = (info) => glslShader(resolveSource(info.source), 'fragment', Object.fromEntries(info.defines));

// Whether a recorded shader can be replayed, and why not.
export function replayable(info) {
  const { stores, shares } = imageStores(shaderCode(info));
  if (shares) return { ok: false, reason: 'invocations share memory' };
  for (const image of info.images) {
    if (image.type !== 'image2D') return { ok: false, reason: `${image.name} is an ${image.type}` };
    const kinds = stores[image.name] ?? [];
    if (kinds.some((k) => k !== 'texel' && k !== 'transposed') || new Set(kinds).size > 1) return { ok: false, reason: `${image.name} is written at ${kinds.join(', ')}` };
  }
  for (const sampler of info.samplers) if (!['sampler2D', 'isampler2D', 'usampler2D', 'sampler2DArray'].includes(sampler.type)) return { ok: false, reason: `${sampler.name} is a ${sampler.type}` };
  return { ok: true };
}

// The image's sampler holding what it held before the pass, for the shader's reads and the texels it does not write.
const before = (image) => `bl_before_${image}`;
// A push constant's or sampler's uniform, named apart from Babylon's own (its post process vertex shader's scale).
const uniformName = (name) => `bl_u_${name}`;

// A sampler read outside the texture as zero (Blender's GPU_SAMPLER_EXTEND_MODE_CLAMP_TO_BORDER, which WebGL 2 lacks):
// its texture() as the texels it filters, those outside zero.
const borderTexture = (name, linear) => `vec4 bl_border_${name}(vec2 uv) {
  ivec2 size = textureSize(${name}, 0);
  vec2 at = uv * vec2(size) - ${linear ? '0.5' : '0.0'};
  ivec2 corner = ivec2(floor(at));
  vec4 sum = vec4(0.0);
  for (int i = 0; i < ${linear ? 4 : 1}; i++) {
    ivec2 texel = corner + ivec2(i & 1, i >> 1);
    vec2 f = at - vec2(corner);
    float weight = ${linear ? '(i & 1) == 1 ? f.x : 1.0 - f.x' : '1.0'};
    weight *= ${linear ? '(i >> 1) == 1 ? f.y : 1.0 - f.y' : '1.0'};
    bool inside = all(greaterThanEqual(texel, ivec2(0))) && all(lessThan(texel, size));
    sum += inside ? texelFetch(${name}, texel, 0) * weight : vec4(0.0);
  }
  return sum;
}`;

// The fragment shader (GLSL ES 3.0 in Babylon's dialect) of a dispatch of `info` as the pass that writes `target`, one of
// its images: Blender's shader, its push constants, samplers and images declared as the create info declares them;
// `samplers` are the dispatch's (their filtering and extension).
export function passShader(info, target, samplers = []) {
  const border = samplers.filter((s) => s.extend?.includes('clamp_to_border'));
  const code = shaderCode(info), kind = imageStores(code).stores[target]?.[0] ?? 'texel';
  const [gx, gy, gz] = info.group, size = `uvec3(${gx}u, ${gy}u, ${gz}u)`;
  const declarations = glslShader([
    ...info.constants.map((c) => `const ${c.type} ${c.name} = ${c.value};`),
    ...info.push_constants.map((c) => `uniform ${c.type} ${uniformName(c.name)}${c.array > 0 ? `[${c.array}]` : ''};`),
    ...info.samplers.map((s) => `uniform ${s.type} ${uniformName(s.name)};`),
    ...info.images.map((i) => `uniform sampler2D ${before(i.name)};`),
  ].join('\n'), 'fragment');
  const images = info.images.map(({ name }) => `void bl_store_${name}(ivec2 texel, vec4 value) {${name === target ? ' if (texel == bl_texel) { bl_value = value; bl_stored = true; }' : ''} }
vec4 bl_load_${name}(ivec2 texel) { return texelFetch(${before(name)}, texel, 0); }`);
  const renamed = [...info.push_constants, ...info.samplers].reduce((text, { name }) => text.replace(new RegExp(`(?<![.\\w])${name}\\b`, 'g'), uniformName(name)), code);
  const body = border.reduce((text, s) => text.replace(new RegExp(`\\btexture\\s*\\(\\s*${s.name}\\s*,`, 'g'), `bl_border_${s.name}(`), renamed)
    .replace(/\bimageStore\s*\(\s*(\w+)\s*,/g, (_, image) => `bl_store_${image}(`)
    .replace(/\bimageLoad\s*\(\s*(\w+)\s*,/g, (_, image) => `bl_load_${image}(`)
    .replace(/\bimageSize\s*\(\s*(\w+)\s*\)/g, (_, image) => `textureSize(${before(image)}, 0)`)
    .replace(/\bgl_GlobalInvocationID\b/g, 'bl_invocation')
    .replace(/\bgl_LocalInvocationID\b/g, `(bl_invocation % ${size})`)
    .replace(/\bgl_WorkGroupID\b/g, `(bl_invocation / ${size})`)
    .replace(/\bgl_WorkGroupSize\b/g, size)
    .replace(/\bgl_NumWorkGroups\b/g, `(uvec3(bl_domain) / ${size})`)
    .replace(/\bvoid\s+main\s*\(/, 'void bl_main(');
  return implicitConversions(`precision highp float;
precision highp int;
precision highp sampler2D;
precision highp isampler2D;
precision highp usampler2D;
precision highp sampler2DArray;
uniform ivec3 bl_domain;
ivec2 bl_texel;
vec4 bl_value;
bool bl_stored;
uvec3 bl_invocation;
${declarations}
${images.join('\n')}
${border.map((s) => borderTexture(s.name, s.linear)).join('\n')}
${body}
void main(void) {
  bl_texel = ivec2(gl_FragCoord.xy);
  ivec2 invocation = ${kind === 'transposed' ? 'bl_texel.yx' : 'bl_texel'};
  if (any(greaterThanEqual(invocation, bl_domain.xy))) discard;
  bl_invocation = uvec3(invocation, 0);
  bl_stored = false;
  bl_main();
  gl_FragColor = bl_stored ? bl_value : texelFetch(${before(target)}, bl_texel, 0);
}`);
}

// A recording (compositor_record_node's JSON) as passes on textures by recorded id: each texture's size and format,
// what is uploaded to it, and in order the clears, copies and shader passes, each pass with its shader code, target
// and bindings. Null with the reasons when a part of it cannot be replayed.
export function replayPlan(recording) {
  const reasons = [...recording.unsupported];
  const shaders = new Map();
  for (const [name, info] of Object.entries(recording.shaders)) {
    const check = replayable(info);
    if (!check.ok) reasons.push(`${name}: ${check.reason}`);
    shaders.set(name, info);
  }
  const steps = [];
  for (const command of recording.commands) {
    if (command.op === 'dispatch') {
      const info = shaders.get(command.shader);
      for (const image of info.images) {
        const target = command.images[image.slot];
        steps.push({
          op: 'pass', shader: command.shader, target, code: reasons.length ? null : passShader(info, image.name, info.samplers.map((s) => ({ name: uniformName(s.name), ...command.samplers[s.slot] }))),
          domain: command.groups.map((n, i) => n * info.group[i]),
          pushConstants: info.push_constants.map((c) => ({ ...c, name: uniformName(c.name), value: command.push_constants[c.name] })),
          samplers: info.samplers.map((s) => ({ name: uniformName(s.name), ...command.samplers[s.slot] })),
          before: info.images.map((i) => ({ name: before(i.name), texture: command.images[i.slot] })),
        });
      }
    } else if (command.op === 'update' || command.op === 'clear' || command.op === 'copy') steps.push(command);
    else reasons.push(`${command.op} is not replayed`);
  }
  return reasons.length ? { reasons } : { textures: recording.textures, steps, inputs: recording.inputs, outputs: recording.outputs };
}

// The bytes of an upload as RGBA floats, as a texture of its format holds them.
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

// The channels of a texture of a GPU format Blender names (GPU_texture_format_name).
export const formatChannels = (format) => (/^RGBA/.test(format) ? 4 : /^RGB/.test(format) ? 3 : /^RG/.test(format) ? 2 : 1);

// Whether a node type runs as an operation of its own, which views replay (not GPU code, compositor-nodes.js).
const operations = new Map();
export const nodeTypeHasOperation = (idname) => {
  if (!operations.has(idname)) operations.set(idname, !!withString(idname, (p) => x.node_type_has_operation(p)));
  return operations.get(idname);
};

// A node type's operation with its properties and values, those in `linked` linked from images of `width` by `height`,
// as Blender's GPU compositor runs it, recorded in the module: { plan (replayPlan's), data (the uploads' bytes) }.
const recordings = new Map();
export function nodeRecording(idname, { properties = {}, values = {}, linked = [] }, width, height) {
  const key = JSON.stringify([idname, properties, values, linked, width, height]);
  if (!recordings.has(key)) {
    const blender = blenderMain();
    recordings.set(key, withScratchNode('CompositorNodeTree', idname, { properties, values }, (group, node) => {
      const text = withString(linked.join('\n'), (l) => x.compositor_record_node(blender.bmain, blender.scene, group.as_pointer(), node.as_pointer(), l, width, height));
      if (!text) return null;
      const recording = JSON.parse(cString(text));
      const size = withArrays([new Int32Array(1)], ([pointer]) => {
        const data = x.compositor_recorded_data(pointer);
        return { data, bytes: new Int32Array(x.memory.buffer, pointer >>> 0, 1)[0] };
      });
      return { plan: replayPlan(recording), data: new Uint8Array(x.memory.buffer, size.data >>> 0, size.bytes).slice() };
    }));
    if (recordings.size > 64) recordings.delete(recordings.keys().next().value);
  }
  return recordings.get(key);
}

// Babylon's texture type for a GPU format Blender names.
const textureType = (format) => (/32F/.test(format) ? Constants.TEXTURETYPE_FLOAT : Constants.TEXTURETYPE_HALF_FLOAT);
const EXTEND = { extend: Constants.TEXTURE_CLAMP_ADDRESSMODE, repeat: Constants.TEXTURE_WRAP_ADDRESSMODE,
  mirrored_repeat: Constants.TEXTURE_MIRROR_ADDRESSMODE, clamp_to_border: Constants.TEXTURE_CLAMP_ADDRESSMODE };

// A push constant set on the effect, as its create info types it.
function setPushConstant(effect, { name, type, array, value = [] }) {
  const v = [value].flat();
  if (array > 0) {
    if (/^int/.test(type)) effect.setIntArray(name, v);
    else effect.setFloatArray(name, v);
    return;
  }
  switch (type) {
    case 'float': return effect.setFloat(name, v[0]);
    case 'float2': return effect.setFloat2(name, v[0], v[1]);
    case 'float3': return effect.setFloat3(name, v[0], v[1], v[2]);
    case 'float4': return effect.setFloat4(name, v[0], v[1], v[2], v[3]);
    case 'int': case 'uint': case 'bool': return effect.setInt(name, v[0]);
    case 'int2': return effect.setInt2(name, v[0], v[1]);
    case 'int3': return effect.setInt3(name, v[0], v[1], v[2]);
    case 'int4': return effect.setInt4(name, v[0], v[1], v[2], v[3]);
    case 'float4x4': return effect.setMatrix(name, Matrix.FromArray(v));
    case 'float3x3': return effect.setMatrix3x3(name, new Float32Array(v));
    default: throw Error(`a ${type} push constant is not replayed`);
  }
}

// A node's recorded operation as a frame graph task: its passes in order, each writing a new version of the texture it
// writes (a pass samples the version before it), on its linked images (`inputTextures`, by input identifier), giving
// `outputTextures` (by output identifier). Disabled, or with a plan that cannot be replayed, it passes `sourceTexture`
// through.
export class BlenderReplayTask extends FrameGraphTask {
  // The recording for an image size (nodeRecording's), the size the task last recorded at, and that recording's plan
  // and uploads.
  recorder = () => null;
  size = null;
  plan = null;
  data = null;
  inputTextures = new Map();
  sourceTexture = undefined;
  outputTextures = new Map();
  #effects = new Map();
  #raw = [];

  constructor(name, frameGraph, outputs) {
    super(name, frameGraph);
    for (const id of outputs) this.outputTextures.set(id, frameGraph.textureManager.createDanglingHandle());
  }

  isReady() { return [...this.#effects.values()].every((e) => e.isReady()); }

  #effect(code, step) {
    let wrapper = this.#effects.get(code);
    if (!wrapper) {
      wrapper = new EffectWrapper({ name: this.name, engine: this._frameGraph.engine, fragmentShader: code, useAsPostProcess: true,
        uniforms: ['bl_domain', ...step.pushConstants.map((c) => c.name)], samplers: [...step.samplers.map((s) => s.name), ...step.before.map((b) => b.name)] });
      this.#effects.set(code, wrapper);
    }
    return wrapper;
  }

  record() {
    const manager = this._frameGraph.textureManager, engine = this._frameGraph.engine;
    for (const raw of this.#raw.splice(0)) raw.dispose();
    const source = this.sourceTexture !== undefined ? manager.getTextureDescription(this.sourceTexture).size : manager.getAbsoluteDimensions({ width: 100, height: 100 });
    this.size = [source.width, source.height];
    ({ plan: this.plan = null, data: this.data = null } = this.recorder(this.size) ?? {});
    const plan = this.plan?.steps ? this.plan : null;
    if (!plan) return this.#passThrough(false);
    const specs = new Map(plan.textures.map((t) => [t.id, t]));
    const current = new Map(Object.entries(plan.inputs).map(([id, texture]) => [texture, this.inputTextures.get(id)]));
    let versions = 0;
    const version = (id) => manager.createRenderTargetTexture(`${this.name} ${id}.${versions++}`, {
      size: { width: specs.get(id).size[0], height: specs.get(id).size[1] }, sizeIsPercentage: false, isHistoryTexture: false,
      options: { createMipMaps: false, types: [textureType(specs.get(id).format)], formats: [Constants.TEXTUREFORMAT_RGBA], samples: 1, useSRGBBuffers: [false] } });
    // Uploaded textures hold their data from the start (Blender uploads weights and single values before its passes).
    const uploads = new Map();
    for (const step of plan.steps.filter((s) => s.op === 'update')) {
      const spec = specs.get(step.texture), [w, h] = spec.size;
      const pixels = uploads.get(step.texture) ?? new Float32Array(w * h * 4);
      const floats = uploadFloats(this.data.subarray(step.data, step.data + step.bytes), step.format, step.extent, formatChannels(spec.format));
      for (let y = 0; y < Math.max(1, step.extent[1]); y++) pixels.set(floats.subarray(y * step.extent[0] * 4, (y + 1) * step.extent[0] * 4), ((step.offset[1] + y) * w + step.offset[0]) * 4);
      uploads.set(step.texture, pixels);
    }
    for (const [id, pixels] of uploads) {
      const [w, h] = specs.get(id).size;
      const raw = RawTexture.CreateRGBATexture(pixels, w, h, this._frameGraph.scene, false, false, Constants.TEXTURE_NEAREST_SAMPLINGMODE, Constants.TEXTURETYPE_FLOAT);
      this.#raw.push(raw);
      current.set(id, manager.importTexture(`${this.name} upload ${id}`, raw.getInternalTexture()));
    }
    const read = (id) => {
      if (!current.has(id)) {
        const cleared = version(id);
        const pass = this._frameGraph.addRenderPass(`${this.name} new ${id}`);
        pass.setRenderTarget(cleared);
        pass.setExecuteFunc((context) => context.clear({ r: 0, g: 0, b: 0, a: 0 }, true, false, false));
        current.set(id, cleared);
      }
      return current.get(id);
    };
    plan.steps.forEach((step, i) => {
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
        const samplers = step.samplers.map((s) => ({ ...s, handle: read(s.texture) })), before = step.before.map((b) => ({ ...b, handle: read(b.texture) }));
        pass.addDependencies([...samplers, ...before].map((s) => s.handle));
        pass.setExecuteFunc((context) => {
          for (const s of samplers) {
            context.setTextureSamplingMode(s.handle, s.linear ? Constants.TEXTURE_BILINEAR_SAMPLINGMODE : Constants.TEXTURE_NEAREST_SAMPLINGMODE);
            const texture = manager.getTextureFromHandle(s.handle);
            if (texture) engine.updateTextureWrappingMode(texture, EXTEND[s.extend[0]], EXTEND[s.extend[1]]);
          }
          context.applyFullScreenEffect(wrapper.drawWrapper, () => {
            const effect = wrapper.drawWrapper.effect;
            effect.setInt3('bl_domain', step.domain[0], step.domain[1], step.domain[2]);
            step.pushConstants.forEach((c) => setPushConstant(effect, c));
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
        const [r, g, b, a] = output?.value ?? [0, 0, 0, 0], size = Object.values(plan.inputs).map((t) => specs.get(t)?.size).find(Boolean);
        const image = manager.createRenderTargetTexture(`${this.name} ${id}`, { size: size ? { width: size[0], height: size[1] } : { width: 100, height: 100 },
          sizeIsPercentage: !size, isHistoryTexture: false, options: { createMipMaps: false, types: [Constants.TEXTURETYPE_HALF_FLOAT], formats: [Constants.TEXTUREFORMAT_RGBA], samples: 1, useSRGBBuffers: [false] } });
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

  // The disabled pass (or, `disabledOnly` false, the pass) giving the source as each output.
  #passThrough(disabledOnly) {
    const manager = this._frameGraph.textureManager;
    const outputs = [...this.outputTextures.values()];
    if (!disabledOnly) for (const handle of outputs) manager.resolveDanglingHandle(handle, this.sourceTexture);
    if (disabledOnly) {
      const pass = this._frameGraph.addRenderPass(this.name + '_disabled', true);
      pass.addDependencies(this.sourceTexture);
      pass.setRenderTarget(outputs[0]);
      pass.setExecuteFunc((context) => this.sourceTexture !== undefined && context.copyTexture(this.sourceTexture));
    }
  }

  dispose() {
    for (const wrapper of this.#effects.values()) wrapper.dispose();
    for (const raw of this.#raw) raw.dispose();
    super.dispose();
  }
}
