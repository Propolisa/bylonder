// Blender's GPU compositor in a view: a node's operation recorded in the module as Blender's own code runs it on the GPU
// (tools/blender-port/wasm/compositor-api.cc compositor_record_node, on the recording GPU backend gpu-record.cc), and
// replayed here on Babylon's frame graph. Each compute dispatch runs as fragment passes of Blender's GLSL for the shader
// (compositor-shaders.js), one per image it writes: a fragment is a texel of that image, the invocation that writes
// it is found from how the shader's imageStore addresses the image (imageStores), and the shader's main runs for it,
// its stores to other texels or images dropped. Shaders whose writes cannot be found that way, or that share memory
// between invocations, are not replayed (the node passes its image through).
import { compute } from './compositor-shaders.js';
import { blenderMain, blenderModule } from '../bmesh/bmesh-wasm.js';
import { withScratchNode } from '../nodes/blender/gpu-graph.js';
import { glsl as libraries } from '../nodes/blender/gpu-library.js';
import { engineGLSL, glslShader } from '../nodes/blender/glsl.js';
import { implicitConversions } from '../nodes/blender/glsl-conversions.js';
import { ReplayTask, formatChannels, uploadFloats } from '../io_scene_babylon/runtime/blocks.js';

export { formatChannels, uploadFloats };

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

// The app's replay task: its passes' GLSL specialized for the engine (WebGPU's samplers).
export class BlenderReplayTask extends ReplayTask {
  shaderCode(code) { return engineGLSL(this._frameGraph.engine, code); }
}
