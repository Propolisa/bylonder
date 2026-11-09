// Blender's GLSL (gpu-library.js) as WebGL 2 GLSL ES, one function at a time with what it calls. Blender writes its
// shaders in a C++-compatible dialect that its shader preprocessor and gpu_shader_compat_glsl.glsl turn into GLSL;
// this does the same for the part its node functions use: Blender's own macros (float3 as vec3, constexpr as const,
// float_array as float[]), references as inout parameters, swizzle calls (v.xyz()) as swizzles, and literals without
// the f suffix GLSL ES lacks. Library symbols get a bl_ prefix so they cannot meet Babylon's (square, wrap).
import { glsl as libraries } from './gpu-library.js';
import { callArguments, specializeSamplers } from '../../overrides/webgpu/samplers.js';

// Where GLSL ES differs from the desktop GLSL Blender targets: (function, or null for any it is found in, text or
// pattern, replacement, reason), applied to each of the function's overloads it is found in.
const INT_TO_FLOAT = 'GLSL ES has no implicit int to float conversion';
const FIXES = [
  [null, /\bfloat (\w+) = ([ijk])\b/g, 'float $1 = float($2)', INT_TO_FLOAT],
  [null, /\bi <= (ceil\()?params\.detail/g, 'float(i) <= $1params.detail', INT_TO_FLOAT],
  ['calc_gradient', /(\d\.\d+) \* 2\)/, '$1 * 2.0)', INT_TO_FLOAT],
  ['node_tex_magic', /depth > (\d+)\)/g, 'depth > $1.0)', INT_TO_FLOAT],
  [/^compute_[23]d_gabor_standard_deviation$/, 'sqrt(8 * ', 'sqrt(8.0 * ', INT_TO_FLOAT],
  ['calc_brick_texture', /(brick_width|row_height) \* (bricknum|rownum)/g, '$1 * float($2)', INT_TO_FLOAT],
  ['node_tex_checker', /mod\((\w+), 2\)/g, '($1 % 2)', 'GLSL ES has no integer mod()'],
  ['node_normal_map', 'OBJECT_NEGATIVE_SCALE) != 0 ?', 'OBJECT_NEGATIVE_SCALE) != 0u ?', 'GLSL ES has no implicit int to uint conversion'],
  ['compatible_mod', 'a - N * b', 'a - float(N) * b', 'GLSL ES has no implicit int to float conversion'],
  ['noise_grad', 'float g = 1u + (h & 7u);', 'float g = float(1u + (h & 7u));', 'GLSL ES has no implicit uint to float conversion'],
  ['noise_perlin', /\b(f[xyzw]) - 1(?![.\d])/g, '$1 - 1.0', 'GLSL ES has no implicit int to float conversion'],
  ['valtorgb_nearest', 'fac * (textureSize(colormap, 0).x - 1)', 'fac * float(textureSize(colormap, 0).x - 1)', 'GLSL ES has no implicit int to float conversion'],
  ['curves_segment_get', 'drw_curves.vertex_per_segment - 1)', 'drw_curves.vertex_per_segment - 1u)', 'GLSL ES has no implicit int to uint conversion'],
  ['alpha_threshold', '1.0 / (2 * a * one_a)', '1.0 / (2.0 * a * one_a)', INT_TO_FLOAT],
  ['alpha_threshold', 'float one_x = (1 - x);', 'float one_x = (1.0 - x);', INT_TO_FLOAT],
  ['curves_point_get', 'vec3(uintBitsToFloat(0x7FC00000u))', 'vec3(uintBitsToFloat(floatBitsToUint(pos_rad.w) & 0u | 0x7FC00000u))',
    'WGSL has no NaN constant: the NaN that restarts a strip is made at run time'],
  ['line_unit_sphere_intersect_dist', 'dot(line_origin, line_origin) - 1;', 'dot(line_origin, line_origin) - 1.0;', INT_TO_FLOAT],
  ['line_unit_sphere_intersect_dist', 'determinant >= 0)', 'determinant >= 0.0)', INT_TO_FLOAT],
];

const PREFIX = 'bl_';
const IDENT = /[A-Za-z_]\w*/y;

const stripComments = (text) => text.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/.*$/gm, '');

// #if conditions as Blender's libraries use them: 0, 1, defined(X) and their negations and combinations.
const condition = (expression, macros) => {
  const js = expression.replace(/defined\s*\(\s*(\w+)\s*\)|defined\s+(\w+)/g, (_, a, b) => (macros.has(a ?? b) ? '1' : '0'))
    .replace(/[A-Za-z_]\w*/g, (name) => (macros.has(name) && macros.get(name).params === null ? macros.get(name).body || '0' : '0'));
  try { return !!Function(`return (${js});`)(); } catch { return false; }
};

// A file's code outside preprocessor lines, with conditional blocks resolved and its macros expanded as they stand
// where the code is (a library can #undef what it defined for itself, as the hash library's mix); `macros` takes
// what it defines.
function preprocess(text, macros) {
  const lines = stripComments(text).replace(/\\\r?\n/g, ' ').split('\n');
  // Per open conditional: whether its current branch is on, and whether one of its branches was.
  const code = [], active = [];
  const on = () => active.every((c) => c.on);
  const open = (value) => active.push({ on: value, taken: value });
  const branch = (value) => { const c = active.at(-1); c.on = !c.taken && value; c.taken ||= c.on; };
  let pending = [];
  const flush = () => { code.push(expand(pending.join('\n'), macros)); pending = []; };
  for (const line of lines) {
    const directive = /^\s*#\s*(\w+)\s*(.*)$/.exec(line);
    if (!directive) { if (on()) pending.push(line); continue; }
    flush();
    const [, name, rest] = directive;
    if (name === 'if') open(condition(rest, macros));
    else if (name === 'ifdef') open(macros.has(rest.trim()));
    else if (name === 'ifndef') open(!macros.has(rest.trim()));
    else if (name === 'elif') branch(condition(rest, macros));
    else if (name === 'else') branch(true);
    else if (name === 'endif') active.pop();
    else if (name === 'define' && on()) {
      const [, id, params, body] = /^(\w+)(?:\(([^)]*)\))?\s*(.*)$/.exec(rest);
      macros.set(id, { params: params === undefined ? null : params.split(',').map((p) => p.trim()).filter(Boolean), body: body.trim() });
    } else if (name === 'undef' && on()) macros.delete(rest.trim());
  }
  flush();
  return code.join('\n');
}

// The text with macros expanded, as the C preprocessor does (## pastes, a macro does not expand inside itself).
function expand(text, macros, busy = new Set()) {
  let out = '', i = 0;
  while (i < text.length) {
    IDENT.lastIndex = i;
    const match = /[A-Za-z_]/.test(text[i]) && !/\w/.test(text[i - 1] ?? '') ? IDENT.exec(text) : null;
    if (!match) { out += text[i++]; continue; }
    const name = match[0], macro = macros.get(name);
    i += name.length;
    if (!macro || busy.has(name) || text[match.index - 1] === '.') { out += name; continue; }
    if (macro.params === null) { out += expand(macro.body, macros, new Set([...busy, name])); continue; }
    let j = i;
    while (/\s/.test(text[j] ?? '')) j++;
    if (text[j] !== '(') { out += name; continue; }
    const args = [];
    let depth = 0, start = j + 1;
    for (j = j + 1; j < text.length; j++) {
      const c = text[j];
      if (c === '(') depth++;
      else if (c === ')' && depth-- === 0) { args.push(text.slice(start, j)); break; }
      else if (c === ',' && depth === 0) { args.push(text.slice(start, j)); start = j + 1; }
    }
    i = j + 1;
    const values = Object.fromEntries(macro.params.map((p, k) => [p, (args[k] ?? '').trim()]));
    const body = macro.body.replace(/[A-Za-z_]\w*/g, (id) => values[id] ?? id).replace(/\s*##\s*/g, '');
    out += expand(body, macros, new Set([...busy, name]));
  }
  return out;
}

// Top-level declarations: functions (with their overloads), structs and constants, by name.
function declarations(code) {
  const chunks = [];
  let depth = 0, start = 0;
  for (let i = 0; i < code.length; i++) {
    const c = code[i];
    if (c === '{') depth++;
    else if (c === '}' && --depth === 0) { chunks.push(code.slice(start, i + 1)); start = i + 1; }
    else if (c === ';' && depth === 0) { chunks.push(code.slice(start, i + 1)); start = i + 1; }
  }
  const found = [], templates = new Map();
  for (let chunk of chunks) {
    chunk = chunk.replace(/\[\[\w+\]\]/g, '').trim();
    if (!chunk || chunk === ';') continue;
    // A template is GLSL once instantiated (template float3 f<float3>(float3);): its parameters replaced by the
    // instantiation's types; a specialization (template<> float3 f<float3>(...) {...}) is a function of its own.
    const template = /^template\s*<([^>]*)>\s*([\s\S]*)$/.exec(chunk);
    if (template && template[1].trim()) {
      const name = /\b(\w+)\s*\(/.exec(template[2])?.[1], params = template[1].split(',').map((p) => p.trim().split(/\s+/));
      templates.set(name, { params: params.map((p) => p.at(-1)), values: params.some((p) => p[0] !== 'typename'), text: template[2] });
      if (templates.get(name).values) valueTemplates.add(name);
      continue;
    }
    if (template) chunk = template[2].replace(/^([\w\s]*?\b\w+)\s*<[^>(]*>\s*\(/, '$1(');
    const instance = /^template\s+[\w\s]*?\b(\w+)\s*<([^>]*)>\s*\([^)]*\)\s*;$/.exec(chunk);
    if (instance) {
      const { params, values, text } = templates.get(instance[1]) ?? {};
      if (!text) continue;
      const types = instance[2].split(',').map((t) => t.trim());
      chunk = params.reduce((t, p, i) => t.replace(new RegExp(`\\b${p}\\b`, 'g'), types[i]), text);
      // One with values among its parameters (to_scale<float3x3, true>) is a function of its own, as its calls name it.
      if (values) chunk = chunk.replace(new RegExp(`\\b${instance[1]}\\s*\\(`), `${instanceName(instance[1], types)}(`);
    }
    const struct = /^struct\s+(\w+)/.exec(chunk);
    if (struct) {
      const [definition, methods] = structMethods(struct[1], chunk);
      found.push([struct[1], definition], ...methods);
      continue;
    }
    const fn = /^[\w\s]*?\b(\w+)\s*\(([^)]*)\)\s*\{/.exec(chunk);
    const constant = /^const\s+\w+\s+(\w+)\s*(\[\d*\])?\s*=/.exec(chunk);
    const name = struct?.[1] ?? (fn && !/^(if|for|while|switch|return)$/.test(fn[1]) ? fn[1] : null) ?? constant?.[1];
    if (name) found.push([name, fn ? glslFunctionText(chunk) : chunk]);
  }
  return found;
}

// Blender's shader preprocessor lowers a struct's methods to functions: a static one (EulerXYZ::identity()) to
// EulerXYZ_identity(), one of a value (v.as_float3()) to as_float3(v), its `this` the first parameter (the compatibility
// macros leave no `static` to tell them apart: each method is both, and a caller links the one it calls). The struct's
// member types make its brace initializers constructors.
const structs = new Map(), methods = new Set();
function structMethods(name, chunk) {
  const open = chunk.indexOf('{'), found = [];
  let body = chunk.slice(open + 1, chunk.lastIndexOf('}'));
  for (let match; (match = /(\w+)\s+(\w+)\s*\(([^)]*)\)\s*(?:const\s*)?\{/.exec(body));) {
    let depth = 0, end = match.index + match[0].length - 1;
    for (; end < body.length; end++) if ((depth += { '{': 1, '}': -1 }[body[end]] ?? 0) === 0) break;
    const [, type, method, params] = match, code = body.slice(match.index + match[0].length - 1, end + 1);
    methods.add(method);
    found.push([`${name}_${method}`, `${type} ${name}_${method}(${params}) ${code}`],
      [method, `${type} ${method}(${name} this_${params.trim() ? ', ' + params : ''}) ${code.replace(/\bthis->/g, 'this_.')}`]);
    body = body.slice(0, match.index) + body.slice(end + 1);
  }
  structs.set(name, [...body.matchAll(/(\w+)\s+([\w\s,]+);/g)].flatMap(([, type, names]) => names.split(',').map(() => type)));
  return [`struct ${name} {${body}};`, found.map(([symbol, text]) => [symbol, glslFunctionText(text)])];
}
// A brace initializer of a struct (return {0, 1};) as its constructor, integer literals made floats where its
// members are.
const braceInitializers = (type, body) => (!structs.has(type) ? body : body.replace(/\breturn\s*\{([^;]*)\}\s*;/g, (_, list) => {
  const args = callArguments(list + ')', 0)[0];
  return `return ${type}(${args.map((a, i) => (structs.get(type)[i] === 'float' && /^-?\d+$/.test(a) ? a + '.0' : a)).join(', ')});`;
}));
// A function with its parameters passed by reference (float &x, const float4 &x) as GLSL's inout, and its local
// constants as variables: GLSL ES wants a constant expression where desktop GLSL takes any value.
// Parameters passed by reference (float &x, const float4 &x) as GLSL's inout.
const references = (params) => params.replace(/(?:\bconst\s+)?(\w+)\s*&\s*(\w+)/g, 'inout $1 $2');
const glslFunctionText = (chunk) => {
  const at = chunk.indexOf('{');
  const head = chunk.slice(0, at).replace(/\(([^)]*)\)/, (_, params) => `(${references(params)})`);
  return head + braceInitializers(/^\s*(\w+)/.exec(head)?.[1], chunk.slice(at).replace(/([;{}]\s*)const\s+/g, '$1'));
};
const instanceName = (name, types) => `${name}_${types.join('_')}`, valueTemplates = new Set();
// Calls of struct methods as the lowered functions' (structMethods), and of templates with values as their instances'.
const methodCalls = (text) => text.replace(/\b(\w+)::(\w+)\s*\(/g, '$1_$2(')
  .replace(/\b(\w+)<([\w\s,]+)>\s*\(/g, (all, name, types) => (valueTemplates.has(name) ? `${instanceName(name, types.split(',').map((t) => t.trim()))}(` : all))
  .replace(/(\b[A-Za-z_][\w.]*)\.(\w+)\s*\(\s*(\)?)/g, (all, value, method, empty) => (methods.has(method) ? `${method}(${value}${empty ? ')' : ', '}` : all));

// WebGL 2 has no buffer textures: a buffer read (texelFetch(buffer, index)) reads the texel at that index of a 2D
// texture laid out in rows (bl_buffer_fetch, which a shader reading buffers defines).
function bufferReads(text) {
  let out = '', i = 0;
  for (let at; (at = text.indexOf('texelFetch(', i)) !== -1;) {
    const [args, end] = callArguments(text, at + 'texelFetch('.length);
    out += text.slice(i, at) + (args.length === 2 ? `bl_buffer_fetch(${args.map(bufferReads).join(', ')})` : text.slice(at, end));
    i = end;
  }
  return out + text.slice(i);
}

// WebGL 2 has no 1D textures: a color band (GPU_color_band) is a 2D texture one texel high. C++ attributes
// ([[maybe_unused]]) go, as Blender's shader tool removes them. A name that WGSL reserves (Blender's parameters named
// type), which WebGPU's compilation to WGSL rejects, takes a bl_ prefix.
const dialect = (text) => bufferReads(text)
  .replace(/\[\[\w+\]\]\s*/g, '')
  .replace(/\btype\b/g, 'bl_type')
  .replace(/\bsampler1DArray\b/g, 'sampler2D')
  .replace(/\.([xyzwrgba]{1,4})\(\)/g, '.$1')
  .replace(/\b(\d+\.\d*|\.\d+|\d+)([eE][+-]?\d+)?[fF]\b/g, '$1$2');

// What Blender's shader preprocessor makes of C++ its GLSL uses: a namespace's names prefixed with it (curves::point_get
// as curves_point_get), and a resource accessor's local alias of a resource (const auto &buf = buffer_get(info, buf),
// which the compatibility macros make `const auto &buf = buf;`) left out, the resource being global.
function flatten(code) {
  let out = code.replace(/^\s*const\s+auto\s*&\s*(\w+)\s*=\s*\1\s*;\s*$/gm, '');
  for (let match; (match = /\bnamespace\s+(\w+)\s*\{/.exec(out));) {
    const [, name] = match, open = match.index + match[0].length;
    let depth = 1, close = open;
    while (depth) depth += { '{': 1, '}': -1 }[out[++close]] ?? 0;
    const inner = out.slice(open, close), names = declarations(inner).map(([n]) => n);
    const renamed = names.reduce((text, n) => text.replace(new RegExp(`(?<![.\\w:])${n}\\b`, 'g'), `${name}_${n}`), inner);
    out = out.slice(0, match.index) + renamed + out.slice(close + 1);
    out = out.replaceAll(`${name}::`, `${name}_`);
  }
  return out;
}

// The libraries each after what it includes, the compatibility macros (gpu_shader_compat.hh's) first.
function includeOrder() {
  const order = [], seen = new Set();
  const visit = (file) => {
    if (seen.has(file) || !libraries[file]) return;
    seen.add(file);
    for (const [, name] of libraries[file].matchAll(/^\s*#include "([^"]+)"/gm)) visit(name);
    order.push(file);
  };
  ['gpu_shader_compat_glsl.glsl', ...Object.keys(libraries)].forEach(visit);
  return order;
}

function parse() {
  // Every function Bylonder links runs in a fragment shader (a material's, or a compositor node's pass), on WebGL 2:
  // Blender's OpenGL backend's code paths (its overloads of built-ins, such as normalize's).
  const macros = new Map([['GPU_FRAGMENT_SHADER', { params: null, body: '1' }], ['GPU_OPENGL', { params: null, body: '1' }]]);
  const codes = includeOrder().map((file) => [file, flatten(preprocess(libraries[file], macros))]);
  const symbols = new Map();
  for (const [, code] of codes) for (const [name, text] of declarations(code)) {
    if (!symbols.has(name)) symbols.set(name, []);
    symbols.get(name).push(methodCalls(dialect(text)));
  }
  for (const [name, text, replacement, reason] of FIXES) {
    const matches = (t) => (typeof text === 'string' ? t.includes(text) : t.match(text));
    const lists = [...symbols].filter(([symbol]) => (name === null ? true : typeof name === 'string' ? symbol === name : name.test(symbol))).map(([, list]) => list);
    if (!lists.some((list) => list.some(matches))) throw Error(`glsl.js: the fix for ${name} (${reason}) no longer applies`);
    for (const list of lists) for (let i = 0; i < list.length; i++) if (matches(list[i])) list[i] = list[i].replace(text, replacement);
  }
  return symbols;
}

let symbols;
const library = () => (symbols ??= parse());
// A function's own names (its parameters and locals), which may be a library symbol's (a parameter named invert).
const locals = (text) => new Set([...text.matchAll(/\b(?:inout\s+|out\s+)?(?:float|int|uint|bool|[iu]?vec[234]|mat[234](?:x[234])?|sampler2D)\s+(\w+)\s*(?=[=;,)\[])/g)].map((m) => m[1]));
// A library symbol at a name: always where it is called (or declared), else unless the function names a local so.
const symbolAt = (text) => {
  const own = locals(text);
  return (name, at) => library().has(name) && (!own.has(name) || /^\s*\(/.test(text.slice(at + name.length)));
};
const NAMES = /(?<![.\w])[A-Za-z_]\w*/g;
const used = (text, self) => { const isSymbol = symbolAt(text); return [...new Set([...text.matchAll(NAMES)].filter((m) => m[0] !== self && isSymbol(m[0], m.index)).map((m) => m[0]))]; };
const prefixed = (text) => { const isSymbol = symbolAt(text); return text.replace(NAMES, (n, at) => (isSymbol(n, at) ? glslName(n) : n)); };

// A whole shader of Blender's (a draw engine's, gpu-library.js `draw`) as GLSL ES for its stage: its includes and
// create info left to `macros`, which stand in for what they declare (as name to body, or to [params, body]), after
// Blender's compatibility macros.
export function glslShader(source, stage, macros = {}) {
  const defined = new Map([[stage === 'vertex' ? 'GPU_VERTEX_SHADER' : 'GPU_FRAGMENT_SHADER', { params: null, body: '1' }]]);
  preprocess(libraries['gpu_shader_compat_glsl.glsl'], defined);
  for (const [name, value] of Object.entries(macros)) defined.set(name, Array.isArray(value) ? { params: value[0], body: value[1] } : { params: null, body: value });
  return dialect(localConstants(instantiateTemplates(withoutOneDimensional(preprocess(source, defined))))).replace(/\b(\w+\s+\w+\s*)\(([^()]*)\)(\s*\{)/g, (_, head, params, brace) => `${head}(${references(params)})${brace}`);
}

// The source with Blender's function templates instantiated, as its shader tool does: each explicit instantiation
// (template int2 f<int2>(int2, int2);) becomes the template's function with its type parameters replaced, a
// specialization (template<> float f<float>(...) {...}) a function of its own, and the templates themselves go.
function instantiateTemplates(source) {
  const chunks = [];
  let depth = 0, start = 0;
  for (let i = 0; i < source.length; i++) {
    const c = source[i];
    if (c === '{') depth++;
    else if ((c === '}' && --depth === 0) || (c === ';' && depth === 0)) { chunks.push(source.slice(start, i + 1)); start = i + 1; }
  }
  chunks.push(source.slice(start));
  const templates = new Map();
  return chunks.map((chunk) => {
    const definition = /^(\s*)template\s*<([^>]+)>\s*([\s\S]*)$/.exec(chunk);
    if (definition) {
      const name = /\b(\w+)\s*\(/.exec(definition[3])?.[1];
      templates.set(name, { params: definition[2].split(',').map((p) => p.trim().split(/\s+/).at(-1)), text: definition[3] });
      return definition[1];
    }
    const specialization = /^(\s*)template\s*<\s*>\s*([\s\S]*)$/.exec(chunk);
    if (specialization) return specialization[1] + specialization[2].replace(/^([\w\s]*?\b\w+)\s*<[^>(]*>\s*\(/, '$1(');
    const instance = /^(\s*)template\s+[\w\s]*?\b(\w+)\s*<([^>]*)>\s*\([^)]*\)\s*;$/.exec(chunk);
    if (instance && templates.has(instance[2])) {
      const { params, text } = templates.get(instance[2]), types = instance[3].split(',').map((t) => t.trim());
      return instance[1] + params.reduce((t, p, i) => t.replace(new RegExp(`\\b${p}\\b`, 'g'), types[i]), text);
    }
    return chunk;
  }).join('');
}

// The source with its functions' local constants that are not constant expressions as variables: GLSL ES's const takes
// constant expressions only, the desktop GLSL Blender writes any value (const int2 bounds = texture_size(tx) - 1). One of
// literals, constructors and other constants stays a constant, which an array's size may be.
const CONSTRUCTOR = /^(int|uint|float|bool|true|false|[iub]?vec[234]|mat[234](x[234])?)$/;
function localConstants(source) {
  const constants = new Set([...source.matchAll(/\bconst\s+\w+\s+(\w+)\s*=/g)].map((m) => m[1]));
  const constant = (expression) => [...expression.replace(/\.\w+/g, '').matchAll(/\b[A-Za-z_]\w*\b/g)].every(([name]) => CONSTRUCTOR.test(name) || constants.has(name));
  let out = '', depth = 0;
  for (const part of source.split(/([{}])/)) {
    depth += part === '{' ? 1 : part === '}' ? -1 : 0;
    out += depth > 0 ? part.replace(/\bconst\s+(\w+\s+(\w+)\s*=([^;]*);)/g, (all, declaration, name, value) => {
      if (constant(value)) return all;
      constants.delete(name);
      return declaration;
    }) : part;
  }
  return out;
}

// The source without the functions that take a 1D sampler, which GLSL ES does not have (overloads a shader of
// 2D images does not call: the compositor's texture_size and texture_load).
function withoutOneDimensional(source) {
  let out = source;
  for (let match; (match = /^[^\S\n]*\w[\w ]*\s+\w+\s*\([^)]*\bi?u?sampler1D\b[^)]*\)\s*\{/m.exec(out));) {
    let depth = 1, close = match.index + match[0].length;
    while (depth) depth += { '{': 1, '}': -1 }[out[close++]] ?? 0;
    out = out.slice(0, match.index) + out.slice(close);
  }
  return out;
}

// Definitions ([key, GLSL], as glslFunction gives them) that several codes injected into one shader can each bring
// (Babylon material plugins' custom code, which no build state dedupes): each kept once, by its key, by the
// preprocessor.
export const guardedDefinitions = (definitions) => definitions.map(([key, glsl]) => {
  const guard = `BL_DEFINED_${key.replace(/\W/g, '_')}`;
  return `#ifndef ${guard}\n#define ${guard}\n${glsl}\n#endif\n`;
}).join('');

// GLSL ES reserves names with two underscores in a row.
export const glslName = (name) => (PREFIX + name).replace(/_{2,}/g, '_');
export const hasFunction = (name) => library().has(name);

// The functions (with their overloads), structs and constants a function needs, itself last, as [name, GLSL ES].
export function glslFunction(name) {
  const order = [], seen = new Set();
  const visit = (symbol) => {
    if (seen.has(symbol)) return;
    seen.add(symbol);
    const texts = library().get(symbol);
    if (!texts) throw Error(`Blender GLSL has no ${symbol}`);
    for (const text of texts) used(text, symbol).forEach(visit);
    order.push([glslName(symbol), texts.map(prefixed).join('\n')]);
  };
  visit(name);
  return order;
}

export const engineGLSL = (engine, source) => (engine.isWebGPU ? specializeSamplers(source) : source);
export { specializeSamplers };
