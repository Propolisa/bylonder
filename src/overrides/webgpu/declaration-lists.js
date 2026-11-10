// SPDX-License-Identifier: MIT OR Apache-2.0
// Override of Babylon's WebGPU GLSL processor (preProcessShaderCode): a uniform, attribute or varying declaration naming several variables (uniform vec3 deep, shallow;) becomes one declaration per variable, as Babylon reads one name per line and takes the rest for a uniform buffer's opening, which leaves the shader without its body; goes when Babylon reads declaration lists.

const LIST = /^([ \t]*(?:flat[ \t]+)?(?:uniform|attribute|varying)[ \t]+(?:(?:highp|mediump|lowp)[ \t]+)?\w+)[ \t]+([^;(){}\n]*,[^;(){}\n]*);/gm;

/** @param {string} glsl */
export const splitDeclarationLists = (glsl) =>
  glsl.replace(LIST, (_, type, names) => names.split(',').map((name) => `${type} ${name.trim()};`).join('\n'));

export function declarationLists(engine) {
  const processor = engine._getShaderProcessor(0), preProcess = processor.preProcessShaderCode.bind(processor);
  processor.preProcessShaderCode = (code, isFragment) => preProcess(splitDeclarationLists(code), isFragment);
  return engine;
}
