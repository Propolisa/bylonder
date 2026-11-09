// @ts-check
// SPDX-License-Identifier: MIT OR Apache-2.0
// Override of WebGPU's rules for GLSL: an identifier GLSL allows and WGSL reserves (a parameter named from, a variable named let) takes a bl_ prefix in the GLSL Babylon converts, as it keeps its name through the conversion, which WebGPU then rejects; goes when Babylon renames them itself.
// Not mod, a GLSL built-in, nor set and column_major, which layout qualifiers take.

export const WGSL_RESERVED = `alias const_assert continuing diagnostic enable fn let loop override requires var array atomic f16 f32 i32
  u32 ptr sampler_comparison texture_1d texture_2d texture_2d_array texture_3d texture_cube texture_cube_array
  texture_multisampled_2d texture_storage_1d texture_storage_2d texture_storage_2d_array texture_storage_3d
  texture_depth_2d texture_depth_2d_array texture_depth_cube texture_depth_cube_array texture_depth_multisampled_2d
  texture_external NULL Self abstract alignas alignof as asm_fragment async auto await become binding_array catch co_await
  co_return co_yield compile compile_fragment concept const_cast consteval constexpr constinit crate debugger
  decltype delete demote demote_to_helper dynamic_cast explicit export extends fallthrough final finally friend from
  fxgroup get groupshared impl implements import instanceof macro macro_rules match meta module move mut mutable new nil
  noexcept nointerpolation null nullptr of operator package packoffset pass pixelfragment premerge priv protected pub ref
  regardless register reinterpret_cast require self snorm static_assert static_cast std super target thread_local throw
  trait try type typeid typename typeof unless unorm unsafe unsized use virtual wgsl where with yield`.split(/\s+/);
const RESERVED = new RegExp(`(?<!\\w)(${WGSL_RESERVED.join('|')})\\b`, 'g');

/** @param {string} glsl */
export const wgslNames = (glsl) => glsl.replace(RESERVED, 'bl_$1');

/**
 * The engine, renaming what WGSL reserves in the GLSL it converts, once Babylon has bound every input by name; any
 * other engine as it is.
 * @param {import('@babylonjs/core').AbstractEngine} engine
 */
export function reservedNames(engine) {
  if (!engine.isWebGPU) return engine;
  const gpu = /** @type {any} */ (engine), compile = gpu._compileRawShaderToSpirV.bind(gpu);
  gpu._compileRawShaderToSpirV = (/** @type {string} */ source, /** @type {string} */ type) => compile(wgslNames(source), type);
  return engine;
}
