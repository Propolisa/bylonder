// Blender's GLSL (gpu-library.js) as WebGL 2 GLSL ES, one function at a time with what it calls. Blender writes its
// shaders in a C++-compatible dialect that its shader preprocessor and gpu_shader_compat_glsl.glsl turn into GLSL;
// this does the same for the part its node functions use: Blender's own macros (float3 as vec3, constexpr as const,
// float_array as float[]), references as inout parameters, swizzle calls (v.xyz()) as swizzles, and literals without
// the f suffix GLSL ES lacks. Library symbols get a bl_ prefix so they cannot meet Babylon's (square, wrap).
import { glsl as libraries } from './gpu-library.js';

// Where GLSL ES differs from the desktop GLSL Blender targets: (function, text or pattern, replacement, reason), applied
// to each of the function's overloads it is found in.
const FIXES = [
  ['compatible_mod', 'a - N * b', 'a - float(N) * b', 'GLSL ES has no implicit int to float conversion'],
  ['noise_grad', 'float g = 1u + (h & 7u);', 'float g = float(1u + (h & 7u));', 'GLSL ES has no implicit uint to float conversion'],
  ['noise_perlin', /\b(f[xyzw]) - 1(?![.\d])/g, '$1 - 1.0', 'GLSL ES has no implicit int to float conversion'],
  ['valtorgb_nearest', 'fac * (textureSize(colormap, 0).x - 1)', 'fac * float(textureSize(colormap, 0).x - 1)', 'GLSL ES has no implicit int to float conversion'],
  ['valtorgb', 'sampler1DArray', 'sampler2D', 'WebGL 2 has no 1D textures: a color map is a 2D texture one texel high'],
  ['valtorgb_nearest', 'sampler1DArray', 'sampler2D', 'WebGL 2 has no 1D textures: a color map is a 2D texture one texel high'],
  ['curves_segment_get', 'drw_curves.vertex_per_segment - 1)', 'drw_curves.vertex_per_segment - 1u)', 'GLSL ES has no implicit int to uint conversion'],
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
  const found = [];
  for (let chunk of chunks) {
    chunk = chunk.replace(/\[\[\w+\]\]/g, '').trim();
    if (!chunk || chunk === ';' || chunk.startsWith('template')) continue;
    const fn = /^[\w\s]*?\b(\w+)\s*\(([^)]*)\)\s*\{/.exec(chunk);
    const struct = /^struct\s+(\w+)/.exec(chunk);
    const constant = /^const\s+\w+\s+(\w+)\s*(\[\d*\])?\s*=/.exec(chunk);
    const name = struct?.[1] ?? (fn && !/^(if|for|while|switch|return)$/.test(fn[1]) ? fn[1] : null) ?? constant?.[1];
    if (name) found.push([name, fn && !struct ? glslFunctionText(chunk) : struct ? chunk + ';' : chunk]);
  }
  return found;
}

// A function with its parameters passed by reference (float &x, const float4 &x) as GLSL's inout, and its local
// constants as variables: GLSL ES wants a constant expression where desktop GLSL takes any value.
// Parameters passed by reference (float &x, const float4 &x) as GLSL's inout.
const references = (params) => params.replace(/(?:\bconst\s+)?(\w+)\s*&\s*(\w+)/g, 'inout $1 $2');
const glslFunctionText = (chunk) => {
  const at = chunk.indexOf('{');
  const head = chunk.slice(0, at).replace(/\(([^)]*)\)/, (_, params) => `(${references(params)})`);
  return head + chunk.slice(at).replace(/([;{}]\s*)const\s+/g, '$1');
};

// A call's arguments from the text after its opening parenthesis: [arguments, the index after its closing one].
function callArguments(text, at) {
  const args = [];
  let depth = 0, start = at;
  for (let i = at; i < text.length; i++) {
    const c = text[i];
    if (c === '(') depth++;
    else if (c === ')' && depth-- === 0) return [[...args, text.slice(start, i)].map((a) => a.trim()), i + 1];
    else if (c === ',' && depth === 0) { args.push(text.slice(start, i)); start = i + 1; }
  }
  return [args, text.length];
}
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

const dialect = (text) => bufferReads(text)
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
  // Every function Bylonder links runs in a fragment shader (a material's, or a compositor node's pass).
  const macros = new Map([['GPU_FRAGMENT_SHADER', { params: null, body: '1' }]]);
  const codes = includeOrder().map((file) => [file, flatten(preprocess(libraries[file], macros))]);
  const symbols = new Map();
  for (const [, code] of codes) for (const [name, text] of declarations(code)) {
    if (!symbols.has(name)) symbols.set(name, []);
    symbols.get(name).push(dialect(text));
  }
  for (const [name, text, replacement, reason] of FIXES) {
    const list = symbols.get(name) ?? [], matches = (t) => (typeof text === 'string' ? t.includes(text) : t.match(text));
    if (!list.some(matches)) throw Error(`glsl.js: the fix for ${name} (${reason}) no longer applies`);
    for (let i = 0; i < list.length; i++) if (matches(list[i])) list[i] = list[i].replace(text, replacement);
  }
  return symbols;
}

let symbols;
const library = () => (symbols ??= parse());
const used = (text, self) => [...new Set(text.match(/(?<![.\w])[A-Za-z_]\w*/g))].filter((n) => n !== self && library().has(n));
const prefixed = (text) => text.replace(/(?<![.\w])[A-Za-z_]\w*/g, (n) => (library().has(n) ? glslName(n) : n));

// A whole shader of Blender's (a draw engine's, gpu-library.js `draw`) as GLSL ES for its stage: its includes and
// create info left to `macros`, which stand in for what they declare (as name to body, or to [params, body]), after
// Blender's compatibility macros.
export function glslShader(source, stage, macros = {}) {
  const defined = new Map([[stage === 'vertex' ? 'GPU_VERTEX_SHADER' : 'GPU_FRAGMENT_SHADER', { params: null, body: '1' }]]);
  preprocess(libraries['gpu_shader_compat_glsl.glsl'], defined);
  for (const [name, value] of Object.entries(macros)) defined.set(name, Array.isArray(value) ? { params: value[0], body: value[1] } : { params: null, body: value });
  return dialect(preprocess(source, defined)).replace(/\b(\w+\s+\w+\s*)\(([^()]*)\)(\s*\{)/g, (_, head, params, brace) => `${head}(${references(params)})${brace}`);
}

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
