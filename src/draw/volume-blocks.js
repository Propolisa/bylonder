// SPDX-License-Identifier: GPL-3.0-or-later
// The node material blocks that store a material's Volume in EEVEE's froxels (eevee_surf_volume.bsl.hh
// SurfVolume::write_froxel), shared by the app (shader-nodes.js ShaderNodeOutputVolume) and an exported page, which
// ships them with the volume passes in bylonder-volumes/. The mesh drawn is a slab of the view's froxel slices in its
// domain's object space (draw/volume-passes.js), each slice at its tile of the froxel atlas (`blFroxelClip`), so the
// nodes read each froxel's point as they read a surface's. The four property textures are written additively:
// scattering, extinction, emission, and the phase (anisotropy, weight). A point outside the domain's bounds
// (`blVolumeBounds` of the mesh, in its local space) holds nothing.
import { Constants, NodeMaterialBlock, NodeMaterialBlockConnectionPointTypes as T, NodeMaterialBlockTargets as Targets, RegisterClass } from '@babylonjs/core';
import { FROXEL_JITTER } from './volume-shaders.js';

export const FROXEL_CLIP = 'blFroxelClip', FROXEL_SLICE = 'blFroxelSlice', FROXEL_CORNER = 'blFroxelCorner';

// Each froxel's point, found per fragment from the slab's fixed geometry (each vertex its slice, `blFroxelSlice`, and
// its corner of the grid in volume uv, `blFroxelCorner`) and the view's state as uniforms (the mesh's `blFroxel`
// metadata: the view's inverse projection, the view to the mesh's space, the depth distribution, the grid's width,
// height, slices and the sample's noise offset, its coordinate scale), so the slab never changes and its material never
// prepares again; moved along its view ray within its slice by the sample's noise, as EEVEE's eval_froxel jitters it.
export class BlenderFroxelPositionBlock extends NodeMaterialBlock {
  constructor(name) {
    super(name, Targets.Fragment);
    this.registerInput('corner', T.Vector2);
    this.registerInput('slice', T.Float);
    this.registerOutput('output', T.Vector3);
  }
  getClassName() { return 'BlenderFroxelPositionBlock'; }
  bind(effect, nodeMaterial, mesh) {
    const froxel = mesh?.metadata?.blFroxel;
    if (!froxel) return;
    effect.setMatrix('bl_froxel_inverse_projection', froxel.inverseProjection);
    effect.setMatrix('bl_froxel_to_local', froxel.toLocal);
    effect.setFloat4('bl_froxel_depth', ...froxel.depth, froxel.perspective ? 1 : 0);
    effect.setFloat4('bl_froxel_grid', ...froxel.grid);
    effect.setFloat2('bl_froxel_scale', ...froxel.coordScale);
  }
  _buildBlock(state) {
    super._buildBlock(state);
    if (!state.sharedData.bindableBlocks.includes(this)) state.sharedData.bindableBlocks.push(this);
    for (const [name, type] of [['bl_froxel_inverse_projection', T.Matrix], ['bl_froxel_to_local', T.Matrix], ['bl_froxel_depth', T.Vector4],
      ['bl_froxel_grid', T.Vector4], ['bl_froxel_scale', T.Vector2]]) state._emitUniformFromString(name, type);
    state._emitFunction('bl_froxel_jitter', FROXEL_JITTER, '');
    const [corner, slice] = this._inputs.map((input) => input.associatedVariableName), out = this._outputs[0];
    // As volume-shaders.js volume_view_point finds a froxel's point in the view, then in the mesh's space.
    state.compilationString += `${state._declareOutput(out)};
{
  float jitter = bl_froxel_jitter(mod(floor(gl_FragCoord.xy), bl_froxel_grid.xy), bl_froxel_grid.w);
  float view_z = bl_volume_z_to_view_z(bl_froxel_depth.xyz, bl_froxel_depth.w, (floor(${slice} + 0.5) + 0.5 - jitter) / bl_froxel_grid.z);
  vec2 ndc = ${corner} / bl_froxel_scale * 2.0 - 1.0;
  vec4 a = bl_froxel_inverse_projection * vec4(ndc, 0.0, 1.0), b = bl_froxel_inverse_projection * vec4(ndc, 0.5, 1.0);
  vec3 view_point = mix(a.xyz / a.w, b.xyz / b.w, (-view_z - a.z / a.w) / (b.z / b.w - a.z / a.w));
  ${out.associatedVariableName} = (bl_froxel_to_local * vec4(view_point, 1.0)).xyz;
}
`;
    return this;
  }
}
RegisterClass('BABYLON.BlenderFroxelPositionBlock', BlenderFroxelPositionBlock);

// What a volume output declares and writes: the property targets, the domain's bounds, and the write of a closure's
// volume (its scattering, absorption, emission and anisotropy) at the froxel's point `local`.
export const VOLUME_TARGETS = `#extension GL_EXT_draw_buffers : require
layout(location = 0) out highp vec4 glFragData[4];
highp vec4 gl_FragColor;`;
export const VOLUME_BOUNDS = ['bl_volume_min', 'bl_volume_max'];
export const volumeWrite = (local, scattering, absorption, emission, anisotropy) => `if (any(lessThan(${local}, bl_volume_min)) || any(greaterThan(${local}, bl_volume_max))) discard;
vec3 bl_scattering = max(${scattering}, 0.0);
float bl_phase_weight = any(greaterThan(bl_scattering, vec3(0.0))) ? 1.0 : 0.0;
glFragData[0] = vec4(bl_scattering, 0.0);
glFragData[1] = vec4(bl_scattering + max(${absorption}, 0.0), 0.0);
glFragData[2] = vec4(max(${emission}, 0.0), 0.0);
glFragData[3] = vec4(${anisotropy} * bl_phase_weight, bl_phase_weight, 0.0, 0.0);
`;
// The material state of a volume output: drawn additively over every slice, never culled or depth tested.
export const VOLUME_MATERIAL = { alphaMode: Constants.ALPHA_ONEONE, forceAlphaBlending: true, backFaceCulling: false, disableDepthWrite: true,
  depthFunction: Constants.ALWAYS, separateCullingPass: false };
export function bindVolumeBounds(effect, mesh) {
  const [min, max] = mesh?.metadata?.blVolumeBounds ?? [[0, 0, 0], [0, 0, 0]];
  effect.setFloat3('bl_volume_min', ...min);
  effect.setFloat3('bl_volume_max', ...max);
}

// A volume's output of Babylon's blocks, as an exported page draws it: the closure's volume as its values (the export's
// node block gives them), written as ShaderNodeOutputVolume writes them.
export class BlenderVolumeOutputBlock extends NodeMaterialBlock {
  constructor(name) {
    super(name, Targets.Fragment, true);
    for (const [input, type] of [['local', T.Vector3], ['scattering', T.Vector3], ['absorption', T.Vector3], ['emission', T.Vector3], ['anisotropy', T.Float]]) {
      this.registerInput(input, type);
    }
  }
  getClassName() { return 'BlenderVolumeOutputBlock'; }
  initialize(state) { Object.assign(state.sharedData.nodeMaterial, VOLUME_MATERIAL); }
  bind(effect, nodeMaterial, mesh) { bindVolumeBounds(effect, mesh); }
  _buildBlock(state) {
    super._buildBlock(state);
    if (!state.sharedData.bindableBlocks.includes(this) && !state.sharedData.forcedBindableBlocks.includes(this)) state.sharedData.forcedBindableBlocks.push(this);
    state._emitExtension('bl_volume_targets', VOLUME_TARGETS);
    for (const name of VOLUME_BOUNDS) state._emitUniformFromString(name, T.Vector3);
    state.compilationString += volumeWrite(...this._inputs.map((input) => input.associatedVariableName));
    return this;
  }
}
RegisterClass('BABYLON.BlenderVolumeOutputBlock', BlenderVolumeOutputBlock);
