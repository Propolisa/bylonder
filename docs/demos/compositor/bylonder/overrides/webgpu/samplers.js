// @ts-check
// SPDX-License-Identifier: MIT OR Apache-2.0
// Override of WebGPU's rules for GLSL: a function that takes an image as an argument gets a copy for each image it is called with, as WebGPU's GLSL (Vulkan's) takes a sampler only where it samples it; for the app's node materials and an exported page's; goes when Babylon's conversion does this itself.

import { ShaderStore } from '@babylonjs/core/Engines/shaderStore.js';

// Babylon's area light function, which takes the LTC images as arguments, marked `#define inline` so Babylon's WebGPU
// engine inlines it (ShaderCodeInliner), sampling them in place; in a node material its include is written out marked.
export const AREA_PRE_LIGHTING = { search: /preLightingInfo computeAreaPreLightingInfo\(/, replace: '\n#define inline\n$&' };
const AREA_SETUP = 'pbrDirectLightingSetupFunctions';
/** @param {string} text */
const inlineAreaLights = (text) => {
  const setup = ShaderStore.GetIncludesShadersStore(0)[AREA_SETUP];
  return setup ? text.replace(`#include<${AREA_SETUP}>`, () => setup.replace(AREA_PRE_LIGHTING.search, AREA_PRE_LIGHTING.replace)) : text;
};

// A call's arguments from the text after its opening parenthesis: [arguments, the index after its closing one].
/**
 * @param {string} text @param {number} at
 * @returns {[string[], number]}
 */
export function callArguments(text, at) {
  /** @type {string[]} */
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

// The shader with each call that passes sampler uniforms to a function (node_tex_image_linear(co, ima, ...)) calling the
// function's copy for those samplers, which samples the uniforms themselves: WebGPU's GLSL (Vulkan's) takes a sampler
// only where it samples it, never as an argument. The app applies it for an engine that needs it (glsl.js engineGLSL), an
// exported page through webgpuSamplers.
const SAMPLER_PARAMETER = /^(?:(?:const|in|highp|mediump|lowp)\s+)*([iu]?sampler\w+)\s+(\w+)$/;
// Babylon inlines the functions marked so (ShaderCodeInliner on WebGPU), sampler arguments and all.
const INLINED = /#define inline\s*$/;
/** @param {string} text */
const samplerFunctions = (text) => [...text.matchAll(/^([^\S\n]*\w+\s+)(\w+)\s*\(([^)]*)\)\s*\{/gm)].map((m) => {
  const params = m[3].split(',').map((p) => p.trim()).filter(Boolean);
  return { at: m.index, type: m[1], name: m[2], header: m[0], params, samplers: params.map((p) => SAMPLER_PARAMETER.exec(p)) };
}).filter((f) => f.samplers.some(Boolean) && !INLINED.test(text.slice(0, f.at)));
/** @param {string} text @param {number} open */
const bodyEnd = (text, open) => {
  for (let i = open, depth = 0; i < text.length; i++) if (text[i] === '{') depth++; else if (text[i] === '}' && --depth === 0) return i + 1;
  return text.length;
};
// The preprocessor branches open at `at`: each chain's directives up to the branch taken, so code elsewhere written
// inside them is compiled when that place is.
/** @param {string} text @param {number} at */
const openBranches = (text, at) => {
  /** @type {string[][]} */
  const chains = [];
  for (const [line, directive] of text.slice(0, at).matchAll(/^[^\S\n]*#\s*(if|ifdef|ifndef|elif|else|endif)\b.*$/gm)) {
    if (directive.startsWith('if')) chains.push([line.trim()]);
    else if (directive === 'endif') chains.pop();
    else chains.at(-1)?.push(line.trim());
  }
  return chains;
};
/** @param {string} source */
export function specializeSamplers(source) {
  const uniforms = new Map([...source.matchAll(/\buniform\s+(?:(?:highp|mediump|lowp)\s+)?([iu]?sampler\w+)\s+(\w+)\s*;/g)].map(([, type, name]) => [name, type]));
  let text = source;
  for (let functions = samplerFunctions(text); functions.length; functions = samplerFunctions(text)) {
    const headers = new Set(functions.map((f) => f.at + f.header.indexOf(f.name)));
    const calls = new RegExp(`(?<![\\w.])(${[...new Set(functions.map((f) => f.name))].join('|')})\\s*\\(`, 'g');
    const call = [...text.matchAll(calls)].map((m) => ({ m, args: callArguments(text, m.index + m[0].length) })).find(({ m, args: [args] }) => !headers.has(m.index)
      && functions.some((f) => f.name === m[1] && f.params.length === args.length && f.samplers.every((s, i) => !s || uniforms.get(args[i]) === s[1])));
    if (!call) break;
    const { m, args: [args, end] } = call;
    const f = /** @type {ReturnType<typeof samplerFunctions>[number]} */ (functions.find((g) => g.name === m[1] && g.params.length === args.length && g.samplers.every((s, i) => !s || uniforms.get(args[i]) === s[1])));
    const name = [f.name, ...args.filter((_, i) => f.samplers[i])].join('_');
    const copy = () => {
      const body = text.slice(f.at + f.header.length - 1, bodyEnd(text, f.at + f.header.length - 1));
      const sampled = f.samplers.reduce((b, s, i) => (s ? b.replace(new RegExp(`(?<![\\w.])${s[2]}\\b`, 'g'), args[i]) : b), body);
      // Under the call's preprocessor branches: the images it samples may be declared only there.
      const chains = openBranches(text, m.index), open = chains.flat().map((line) => `${line}\n`).join('');
      return `${open}${f.type}${name}(${f.params.filter((_, i) => !f.samplers[i]).join(', ')}) ${sampled}\n${'#endif\n'.repeat(chains.length)}`;
    };
    const defined = new RegExp(`^[^\\S\\n]*\\w+\\s+${name}\\s*\\(`, 'm').test(text);
    text = text.slice(0, m.index) + `${name}(${args.filter((_, i) => !f.samplers[i]).join(', ')})` + text.slice(end);
    if (!defined) text = text.slice(0, f.at) + copy() + text.slice(f.at);
  }
  // The functions taking samplers, now uncalled.
  const left = samplerFunctions(text), headers = new Set(left.map((f) => f.at + f.header.indexOf(f.name)));
  for (const f of left.reverse()) {
    if (![...text.matchAll(new RegExp(`(?<![\\w.])${f.name}\\s*\\(`, 'g'))].some((c) => !headers.has(c.index))) text = text.slice(0, f.at) + text.slice(bodyEnd(text, f.at + f.header.length - 1));
  }
  return text;
}

/**
 * A node material whose built shaders pass images to functions, drawn on WebGPU: its shaders specialized as each build
 * ends, as the app's are (shader-nodes.js BlenderNodeMaterial).
 * @param {import('@babylonjs/core').NodeMaterial} material
 */
export function webgpuSamplers(material) {
  if (!material.getScene().getEngine().isWebGPU) return material;
  const built = /** @type {any} */ (material);
  const specialize = () => {
    for (const state of [built._vertexCompilationState, built._fragmentCompilationState]) {
      if (state?._builtCompilationString) state._builtCompilationString = specializeSamplers(inlineAreaLights(state._builtCompilationString));
    }
  };
  // Parsing built it already.
  if (built._buildWasSuccessful) specialize();
  material.onBuildObservable.add(specialize);
  return material;
}
