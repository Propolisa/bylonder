// SPDX-License-Identifier: MIT OR Apache-2.0
// Override of Babylon's light declarations on WebGPU: a light's uniform block is left out of a vertex stage that reads none of it, as Babylon declares every light's block in both stages and WebGPU binds each as a uniform buffer of the stage, at most 12 on many adapters, so a material lit by 8 lights does not compile (Compositor's city); goes when Babylon declares a light's block only where it is read.
const BLOCK = /\buniform\s+Light(\d+)\s*\{[^}]*\}\s*light\1\s*;/g;

// A vertex stage's code after its includes, without the blocks of the lights it does not read.
export function vertexLightBlocks(shaderType, code) {
  if (shaderType !== 'vertex') return code;
  return code.replace(BLOCK, (block, light) => (code.includes(`light${light}.`) ? block : ''));
}

// The engine, its GLSL effects' vertex stages declaring only the light blocks they read (Babylon's
// processCodeAfterIncludes, after any the effect or another override has).
export function lightBlocksWhereRead(engine) {
  const create = engine.createEffect.bind(engine);
  engine.createEffect = (baseName, options, ...args) => {
    if (options?.attributes !== undefined && !options.shaderLanguage) {
      const after = options.processCodeAfterIncludes;
      options = { ...options, processCodeAfterIncludes: (type, code, defines) => vertexLightBlocks(type, after ? after(type, code, defines) : code) };
    }
    return create(baseName, options, ...args);
  };
  return engine;
}
