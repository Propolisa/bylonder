// Blender's shader nodes as Babylon node material blocks: one block class per Blender node type, registered under its
// idname, so one NodeMaterial holds Babylon blocks and Blender nodes linked together. A block's sockets are the
// node's declaration; its code is Blender's GLSL, linked as the node's GPU function links it; unlinked inputs are
// uniforms, as Blender's GPU_uniform, so editing a value needs no rebuild.
//
// What Blender's GPU code reads of the point it shades (g_data, attributes, the object's texture space) comes from
// Babylon's geometry: hidden inputs (named `__...`) linked to Babylon blocks named `blender:...`, which Bylonder's
// editor does not draw. A closure (a SHADER socket) is what a surface reflects, emits and lets through, as EEVEE gathers
// it (STAND_INS bl_closure); Material Output lights it once with Babylon's PBR block (BlenderSurfaceBlock) and writes
// it through the scene's image processing (BlenderDisplayBlock).
import {
  BonesBlock, ClipPlanesBlock, Color4, ColorMergerBlock, ColorSplitterBlock, Constants, FogBlock, FragmentOutputBlock, ImageProcessingBlock, InputBlock,
  InstancesBlock, Matrix, MorphTargetsBlock, NodeMaterial, NodeMaterialBlock,
  NodeMaterialBlockConnectionPointTypes as T, NodeMaterialBlockTargets as Targets, NodeMaterialSystemValues as System, Observable, PBRMetallicRoughnessBlock,
  RawTexture, RawTexture2DArray, ReflectionBlock, RefractionBlock, RegisterClass, ShaderStore, SubSurfaceBlock, Texture, TransformBlock, VertexOutputBlock,
} from '@babylonjs/core';
import { attributeKind, requestedAttributes, TANGENT_KIND } from './attributes.js';
import { BlenderRepeatWriteBlock, repeatZoneBlocks } from './repeat-zone.js';
import { functions } from './gpu-library.js';
import { engineGLSL } from './glsl.js';
import { BABYLON_TYPES, convert, converts, glslType, glslValue, kindOf, LUMINANCE, socketType } from './sockets.js';
import { availability, declaration, defaults } from './declarations.js';
import { compileSteps, glslIdentifier, kindOfSocket, menuValue, muteLinks, setUniforms, socketOf, stack } from './node-code.js';
import { colorRampTable, defaultColorRamp, halfFloats } from '../../blenkernel/colorband.js';
import { blackbodyTable, curveMappingGPU, defaultCurveMapping, plainCurveMapping, wavelengthTable } from '../../blenkernel/colortools.js';
import { CurvesGeometryBlock, CurvesNormalBlock } from '../../draw/curves.js';
import { imageTexture } from '../../imbuf/image-textures.js';
import { skyTexture } from '../../blenkernel/sky.js';
import { blendData } from '../../python/bpy_rna.js';
import { VIEW_FORWARD, viewEye, viewForward } from '../../draw/draw-view.js';
import { eeveeParity, eeveeParityChanged } from '../../draw/eevee-parity.js';
import { DITHER_FUNCTIONS, ditherOffset } from '../../render/dither.js';
import { readsSceneDepth, sceneDepth } from '../../render/scene-depth.js';
import { FROXEL_JITTER } from '../../draw/volume-shaders.js';
import { AREA_PRE_LIGHTING, AREA_SPECULAR, LIGHT_SPECULAR, usesAreaLights } from '../../blenkernel/light/area-specular.js';
import '../graph-roots.js';
import { SharedShadowDepthWrapper } from '../../draw/shadow-depth-wrapper.js';

// A NodeMaterial of Blender's nodes. Babylon's walks a block's inputs again for each path that reaches the block as it
// prepares a build, which is exponential in a chain of shared values (an unrolled repeat zone's): this one prepares each
// block once per pass.
export class BlenderNodeMaterial extends NodeMaterial {
  #initialized = new WeakMap();
  #reset = new WeakMap();
  // Whether `node` is new to a pass (keyed by its compilation state) of a walk.
  static #first(walk, pass, node) {
    if (!walk.has(pass)) walk.set(pass, new WeakSet());
    const seen = walk.get(pass);
    return !seen.has(node) && !!seen.add(node);
  }
  _initializeBlock(node, state, ...rest) { if (BlenderNodeMaterial.#first(this.#initialized, state, node)) super._initializeBlock(node, state, ...rest); }
  _resetDualBlocks(node, id) { if (BlenderNodeMaterial.#first(this.#reset, this._fragmentCompilationState, node)) super._resetDualBlocks(node, id); }
  // On WebGPU, Blender's functions sample the images they are given in copies of their own (glsl.js specializeSamplers).
  constructor(...args) {
    super(...args);
    this.onBuildObservable.add(() => {
      const fragment = this._fragmentCompilationState;
      fragment._builtCompilationString = engineGLSL(this.getScene().getEngine(), fragment._builtCompilationString);
      // Babylon wipes the defines of the render pass current at the build only: another pass's (the shader compile
      // probe's, draw/shader-compile.js) would keep defines of blocks the build no longer has, for code without them.
      for (const mesh of this.getBindedMeshes()) for (const subMesh of mesh.subMeshes ?? []) for (const { defines } of subMesh._drawWrappers.filter(Boolean)) if (defines?.reset) { defines.markAllAsDirty(); defines.reset(); }
    });
  }
  // EEVEE's Dithered render method (the default): a surface that lets light through is hashed in the opaque pass,
  // depth-tested and depth-writing, not sorted and blended (ShaderNodeOutputMaterial sets blenderDithered).
  get #hashed() { return !!this.blenderDithered && this.transparencyMode == null; }
  needAlphaBlending() { return !this.#hashed && super.needAlphaBlending(); }
  needAlphaTesting() { return this.#hashed || super.needAlphaTesting(); }
}

const DIMENSIONS = ['1D', '2D', '3D', '4D'];
// The outputs whose socket holds the node's value ('=identifier' in its values), drawn on the node (custom_draw).
export const OUTPUT_VALUES = { ShaderNodeValue: ['Value'], ShaderNodeRGB: ['Color'], ShaderNodeNormal: ['Normal'] };
const sortedStops = (ramp) => [...ramp.elements].sort((a, b) => a.position - b.position);

// g_data as EEVEE's surface shaders fill it (eevee_surf_common.bsl.hh init_globals, init_globals_curves), and the
// object's and view's matrices and infos its draw manager binds (draw_resource.hh ObjectInfos, ObjectMatrices).
const G_DATA = ['bl_g_data', ['$P', '$N', '$camera_position', '$is_strand', '$hair_radius', '$hair_curve_N', '$hair_strand_id'], []];
const ENGINE = ['bl_engine', ['$model', '$model_inverse', '$viewmat', '$viewinv', '$winmat', '$object_color', '$object_info'], []];
const ENGINE_STEPS = [G_DATA, ENGINE];
// Each node's steps from its properties (see node-code.js), as its C++ GPU function links them. `connected(id)` tells
// whether an input is linked, `linked(id)` whether an output is (GPUNodeStack's link and hasoutput).
export const SHADER_NODES = {
  // node_shader_math.cc, gpu_shader_math
  ShaderNodeMath: (p, decl) => [
    stack(functions.math[p.operation], decl),
    p.use_clamp && ['clamp_value', ['@Value', 0, 1], ['@Value']],
  ],
  // node_shader_mix.cc, gpu_shader_mix
  ShaderNodeMix: (p) => {
    const type = { FLOAT: 'Float', VECTOR: 'Vector', RGBA: 'Color' }[p.data_type];
    if (!type) return [];
    const nonUniform = p.data_type === 'VECTOR' && p.factor_mode === 'NON_UNIFORM', factor = nonUniform ? 'Factor_Vector' : 'Factor_Float';
    const name = { FLOAT: 'node_mix_float', VECTOR: nonUniform ? 'node_mix_vector_non_uniform' : 'node_mix_vector', RGBA: functions.mix_color[p.blend_type] }[p.data_type];
    return [
      p.clamp_factor && (nonUniform ? ['node_mix_clamp_vector', [factor, [0, 0, 0], [1, 1, 1]], [factor]] : ['node_mix_clamp_value', [factor, 0, 1], [factor]]),
      [name, [factor, 'A_' + type, 'B_' + type], ['@Result_' + type]],
      p.data_type === 'RGBA' && p.clamp_result && ['node_mix_clamp_color', ['@Result_Color', [0, 0, 0, 0], [1, 1, 1, 1]], ['@Result_Color']],
    ];
  },
  // node_shader_tex_noise.cc, node_shader_gpu_tex_noise: an unlinked vector is Generated (node_shader_gpu_default_tex_coord).
  ShaderNodeTexNoise: (p, decl, context) =>
    texture(decl, context, functions.noise[p.noise_type][DIMENSIONS.indexOf(p.noise_dimensions)], [p.normalize ? 1 : 0, context.linked('Color') ? 1 : 0]),
  // node_shader_tex_image.cc, node_shader_gpu_tex_image: an unlinked vector is the default UV map; the Color output's
  // alpha as the Alpha output's use asks, from what the texture holds: a float buffer premultiplied, a byte buffer
  // straight (imbuf/image-textures.js imagePremultiplied), where Blender's holds a straight float image straight.
  ShaderNodeTexImage: (p, decl, { connected, linked, image }) => {
    const ima = image();
    if (!ima) return [['node_tex_image_empty', [], ['@Color', '@Alpha']]];
    const premul = ima.alpha_mode === 'PREMUL', alpha = linked('Alpha');
    const steps = ['CHANNEL_PACKED', 'NONE'].includes(ima.alpha_mode) || ima.colorspace_settings.is_data ? ['color_alpha_clear']
      : !ima.is_float ? [alpha ? 'color_alpha_clear' : 'color_alpha_premultiply']
      : alpha ? ['color_alpha_unpremultiply', !premul && 'color_alpha_clear'] : [premul && 'color_alpha_clear'];
    return [
      ...imageProjection(p, connected('Vector') ? 'Vector' : '$uv', { image: ima }, ['Cubic', 'Smart'].includes(p.interpolation)),
      ...(linked('Color') ? steps.filter(Boolean).map((name) => [name, ['@Color'], ['@Color']]) : []),
    ];
  },
  // node_shader_tex_environment.cc, node_shader_gpu_tex_environment: an unlinked vector is the shaded point's position
  // (node_tex_coord_position), the Color output premultiplied unless the image's alpha says otherwise.
  ShaderNodeTexEnvironment: (p, decl, { connected, linked, image }) => {
    const ima = image(), vector = connected('Vector') ? 'Vector' : '$P';
    if (!ima) return [['node_tex_environment_empty', [vector], ['@Color']]];
    const equirectangular = p.projection === 'EQUIRECTANGULAR', closest = p.interpolation === 'Closest';
    const sample = closest || p.interpolation === 'Linear' ? 'node_tex_image_linear' : 'node_tex_image_cubic';
    const clear = ['CHANNEL_PACKED', 'NONE', 'PREMUL'].includes(ima.alpha_mode) || ima.colorspace_settings.is_data;
    return [
      [equirectangular ? 'node_tex_environment_equirectangular' : 'node_tex_environment_mirror_ball', [vector], [['#uv', 'vec3']]],
      [sample, ['#uv', { image: ima, extension: p.projection, interpolation: equirectangular && !closest ? 'Environment' : p.interpolation }], ['@Color', ['#alpha', 'float']]],
      linked('Color') && [clear ? 'color_alpha_clear' : 'color_alpha_premultiply', ['@Color'], ['@Color']],
    ];
  },
  // node_shader_tex_sky.cc, node_shader_gpu_tex_sky: Single and Multiple Scattering sample the sky Blender precomputes
  // (GPU_image_sky, one layer); an unlinked vector is Generated.
  ShaderNodeTexSky: (p, decl, { connected }) => {
    const sky = NISHITA.includes(p.sky_type) ? skyTexture(p) : null;
    if (!sky) return [];
    const [type, rotation, ...rows] = sky.params;
    return [['node_tex_sky_nishita', [connected('Vector') ? 'Vector' : '$orco', type, rotation, rows.slice(0, 3), rows.slice(3, 6), rows.slice(6, 9), { sky }, 0], ['@Color']]];
  },
  // node_shader_color_ramp.cc, gpu_shader_valtorgb
  ShaderNodeValToRGB: (p, decl) => {
    const ramp = p.color_ramp, stops = sortedStops(ramp), outs = ['@Color', '@Alpha'];
    if (stops.length === 1) return [['set_rgba', [stops[0].color], ['@Color']]];
    if (stops.length === 2 && ramp.color_mode === 'RGB') {
      const [a, b] = stops, mul = 1 / (b.position - a.position), mulBias = [mul, -mul * a.position];
      if (ramp.interpolation === 'LINEAR') return [['valtorgb_opti_linear', ['Fac', mulBias, a.color, b.color], outs]];
      if (ramp.interpolation === 'CONSTANT') return [['valtorgb_opti_constant', ['Fac', Math.max(a.position, b.position), a.color, b.color], outs]];
      if (ramp.interpolation === 'EASE') return [['valtorgb_opti_ease', ['Fac', mulBias, a.color, b.color], outs]];
    }
    const table = { texture: colorRampTable(ramp) };
    return [[ramp.interpolation === 'CONSTANT' ? 'valtorgb_nearest' : 'valtorgb', ['Fac', table, 0.5], outs]];
  },
  // node_shader_tex_coord.cc, node_shader_gpu_tex_coord
  ShaderNodeTexCoord: (p, decl) => [['bl_tex_coord', ['$orco', '$object_normal', '$uv', '$object', '$camera', '$window', '$reflection'], decl.outputs.map((s) => '@' + s.identifier)]],
  // node_shader_bump.cc, gpu_shader_bump: no height is no bump; an unlinked normal is the shaded point's.
  ShaderNodeBump: (p, decl, { connected }) => {
    const normal = connected('Normal') ? 'Normal' : '$N';
    if (!connected('Height')) return [['bl_vector_copy', [normal], ['@Normal']]];
    return [G_DATA, ['node_bump', ['Strength', 'Distance', 'Filter Width', 'Height', normal, '$height_xy', p.invert ? -1 : 1], ['@Normal']]];
  },
  // node_shader_hair_info.cc, node_shader_gpu_hair_info
  ShaderNodeHairInfo: (p, decl) => [G_DATA, ['node_hair_info', ['$hair_intercept', '$hair_length'], decl.outputs.map((s) => '@' + s.identifier)]],
  // node_shader_emission.cc, node_shader_bsdf_*.cc, node_shader_mix_shader.cc, node_shader_add_shader.cc,
  // node_shader_holdout.cc: closures (STAND_INS bl_closure); an unlinked normal is the shaded point's.
  ShaderNodeEmission: () => [['bl_node_emission', ['Color', 'Strength'], ['@Emission']]],
  // node_shader_background.cc: a world's emission.
  ShaderNodeBackground: () => [['bl_node_emission', ['Color', 'Strength'], ['@Background']]],
  ShaderNodeBsdfPrincipled: (p, decl, { connected }) => [G_DATA, ['bl_node_bsdf_principled', ['Base Color', 'Metallic', 'Roughness', 'IOR', 'Alpha',
    normal(connected), 'Transmission Weight', 'Emission Color', 'Emission Strength', 'Specular IOR Level'], ['@BSDF']]],
  ShaderNodeBsdfDiffuse: (p, decl, { connected }) => [G_DATA, ['bl_node_bsdf_diffuse', ['Color', normal(connected)], ['@BSDF']]],
  ShaderNodeBsdfSheen: (p, decl, { connected }) => [G_DATA, ['bl_node_bsdf_diffuse', ['Color', normal(connected)], ['@BSDF']]],
  ShaderNodeBsdfTranslucent: (p, decl, { connected }) => [G_DATA, ['bl_node_bsdf_diffuse', ['Color', normal(connected)], ['@BSDF']]],
  ShaderNodeSubsurfaceScattering: (p, decl, { connected }) => [G_DATA, ['bl_node_bsdf_diffuse', ['Color', normal(connected)], ['@BSSRDF']]],
  ShaderNodeBsdfHair: () => [G_DATA, ['bl_node_bsdf_diffuse', ['Color', WORLD_NORMAL], ['@BSDF']]],
  ShaderNodeBsdfHairPrincipled: () => [G_DATA, ['bl_node_bsdf_diffuse', ['Color', WORLD_NORMAL], ['@BSDF']]],
  ShaderNodeBsdfGlossy: (p, decl, { connected, lobe }) => [G_DATA, ['bl_node_bsdf_glossy', ['Color', 'Roughness', normal(connected), lobe()], ['@BSDF']]],
  ShaderNodeBsdfAnisotropic: (p, decl, { connected, lobe }) => [G_DATA, ['bl_node_bsdf_glossy', ['Color', 'Roughness', normal(connected), lobe()], ['@BSDF']]],
  ShaderNodeBsdfMetallic: (p, decl, { connected, lobe }) => [G_DATA, ['bl_node_bsdf_glossy', ['Base Color', 'Roughness', normal(connected), lobe()], ['@BSDF']]],
  ShaderNodeBsdfGlass: (p, decl, { connected }) => [G_DATA, ['bl_node_bsdf_glass', ['Color', 'Roughness', 'IOR', normal(connected)], ['@BSDF']]],
  ShaderNodeBsdfRefraction: (p, decl, { connected }) => [G_DATA, ['bl_node_bsdf_glass', ['Color', 'Roughness', 'IOR', normal(connected)], ['@BSDF']]],
  ShaderNodeBsdfTransparent: () => [['bl_node_bsdf_transparent', ['Color'], ['@BSDF']]],
  ShaderNodeHoldout: () => [['bl_node_holdout', [], ['@Holdout']]],
  // node_shader_volume_principled.cc, node_shader_volume_scatter.cc, node_shader_volume_absorption.cc: a mesh has no
  // grids, so a named density or color attribute is its default (1) and a named temperature none (0); the weight is
  // the mix nodes' (bl_node_mix_shader).
  ShaderNodeVolumePrincipled: (p, decl, { value }) => [['node_volume_principled', ['Color', 'Density', 'Anisotropy', 'Absorption Color', 'Emission Strength',
    'Emission Color', 'Blackbody Intensity', 'Blackbody Tint', 'Temperature', 1, [1, 1, 1, 1], [1, 1, 1, 1], value('Temperature Attribute') ? [0, 0, 0, 0] : [1, 1, 1, 1],
    { texture: blackbodyTable() }, 0.5], ['@Volume']]],
  ShaderNodeVolumeScatter: () => [['node_volume_scatter', ['Color', 'Density', 'Anisotropy', 'IOR', 'Backscatter', 'Alpha', 'Diameter', 1], ['@Volume']]],
  ShaderNodeVolumeAbsorption: () => [['node_volume_absorption', ['Color', 'Density', 1], ['@Volume']]],
  ShaderNodeMixShader: (p, decl) => [stack('bl_node_mix_shader', decl)],
  ShaderNodeAddShader: (p, decl) => [stack('bl_node_add_shader', decl)],
  // node_shader_curves.cc, gpu_shader_curve_rgb, gpu_shader_curve_vec, gpu_shader_curve_float: shader nodes do no
  // white balancing; when R, G and B map identity only the combined curve applies.
  ShaderNodeRGBCurve: (p, decl) => {
    const curves = curveMappingGPU(p.mapping), levels = [[0, 0, 0, 1], [1, 1, 1, 1], { texture: curves.table }, 0.5];
    const only = curves.identity.slice(0, 3).every(Boolean);
    return [stack(only ? 'curves_combined_only' : 'curves_combined_rgb', decl, [...levels, ...curveParameters(curves, only ? (v) => v[3] : (v) => v)])];
  },
  ShaderNodeVectorCurve: (p, decl) => {
    const curves = curveMappingGPU(p.mapping);
    return [stack('curves_vector_mixed', decl, [{ texture: curves.table }, 0.5, ...curveParameters(curves, (v) => v.slice(0, 3))])];
  },
  ShaderNodeFloatCurve: (p, decl) => {
    const curves = curveMappingGPU(p.mapping);
    return [stack('curves_float_mixed', decl, [{ texture: curves.table }, 0.5, ...curveParameters(curves, (v) => v[0])])];
  },
  // node_shader_blackbody.cc, node_shader_wavelength.cc
  ShaderNodeBlackbody: (p, decl) => [stack('node_blackbody', decl, [{ texture: blackbodyTable() }, 0.5])],
  ShaderNodeWavelength: (p, decl) => [stack('node_wavelength', decl, [{ texture: wavelengthTable() }, 0.5])],
  // node_shader_vector_math.cc, gpu_shader_vector_math
  ShaderNodeVectorMath: (p, decl) => [stack(functions.vector_math[p.operation], decl)],
  // node_shader_map_range.cc, gpu_shader_map_range
  ShaderNodeMapRange: (p, decl) => {
    const vector = p.data_type === 'FLOAT_VECTOR', name = functions.map_range[p.interpolation_type];
    return [
      stack(vector ? 'vector_' + name : name, decl, [p.clamp ? 1 : 0]),
      p.clamp && !vector && !['SMOOTHSTEP', 'SMOOTHERSTEP'].includes(p.interpolation_type) && ['clamp_range', ['@Result', 'To Min', 'To Max'], ['@Result']],
    ];
  },
  // node_shader_clamp.cc, gpu_shader_clamp
  ShaderNodeClamp: (p, decl) => [stack(p.clamp_type === 'MINMAX' ? 'clamp_minmax' : 'clamp_range', decl)],
  // node_shader_mapping.cc, gpu_shader_mapping
  ShaderNodeMapping: (p, decl) => [stack(functions.mapping[p.vector_type], decl)],
  // node_shader_mix_rgb.cc, gpu_shader_mix_rgb
  ShaderNodeMixRGB: (p, decl) => [
    ['clamp_value', ['Fac', 0, 1], ['Fac']],
    stack(functions.mix_rgb[p.blend_type], decl),
    // Blender passes its three-float limits as clamp_color's four: the color's alpha clamps to 0.
    p.use_clamp && ['clamp_color', ['@Color', [0, 0, 0, 0], [1, 1, 1, 0]], ['@Color']],
  ],
  // node_shader_hueSatVal.cc, node_shader_brightness.cc, node_shader_invert.cc, node_shader_gamma.cc
  ShaderNodeHueSaturation: (p, decl) => [stack('hue_sat', decl)],
  ShaderNodeBrightContrast: (p, decl) => [stack('brightness_contrast', decl)],
  ShaderNodeInvert: (p, decl) => [stack('invert', decl)],
  ShaderNodeGamma: (p, decl) => [stack('node_gamma', decl)],
  // node_shader_sepcomb_xyz.cc, node_shader_sepcomb_color.cc
  ShaderNodeSeparateXYZ: (p, decl) => [stack('separate_xyz', decl)],
  ShaderNodeCombineXYZ: (p, decl) => [stack('combine_xyz', decl)],
  ShaderNodeSeparateColor: (p, decl) => [stack(functions.separate_color[p.mode], decl)],
  ShaderNodeCombineColor: (p, decl) => [stack(functions.combine_color[p.mode], decl)],
  // node_shader_rgb_to_bw.cc, gpu_shader_rgbtobw: the scene linear luminance of Blender's default color management.
  ShaderNodeRGBToBW: (p, decl) => [stack('rgbtobw', decl, [LUMINANCE])],
  // node_shader_normal.cc, gpu_shader_normal: the direction is the output socket's value.
  ShaderNodeNormal: (p, decl) => [stack('normal_new_shading', decl, ['=Normal'])],
  // node_shader_vector_rotate.cc, gpu_shader_vector_rotate
  ShaderNodeVectorRotate: (p, decl) => [stack(functions.vector_rotate[p.rotation_type], decl, [p.invert ? -1 : 1])],
  // node_shader_value.cc, node_shader_rgb.cc: the output socket's value.
  ShaderNodeValue: () => [['set_value', ['=Value'], ['@Value']]],
  ShaderNodeRGB: () => [['set_rgba', ['=Color'], ['@Color']]],
  // node_shader_tex_*.cc, node_shader_gpu_tex_*: an unlinked vector is Generated (node_shader_gpu_default_tex_coord).
  ShaderNodeTexGradient: (p, decl, context) => texture(decl, context, 'node_tex_gradient', [enumValue(decl, p, 'gradient_type')]),
  ShaderNodeTexWave: (p, decl, context) => texture(decl, context, 'node_tex_wave', ['wave_type', 'bands_direction', 'rings_direction', 'wave_profile'].map((key) => enumValue(decl, p, key))),
  ShaderNodeTexVoronoi: (p, decl, context) => texture(decl, context, functions.voronoi[p.feature][DIMENSIONS.indexOf(p.voronoi_dimensions)], [enumValue(decl, p, 'distance'), p.normalize ? 1 : 0]),
  ShaderNodeTexChecker: (p, decl, context) => texture(decl, context, 'node_tex_checker'),
  ShaderNodeTexBrick: (p, decl, context) => texture(decl, context, 'node_tex_brick', [p.offset, p.offset_frequency, p.squash, p.squash_frequency]),
  ShaderNodeTexMagic: (p, decl, context) => texture(decl, context, 'node_tex_magic', [p.turbulence_depth]),
  // node_shader_tex_white_noise.cc, gpu_shader_tex_white_noise: no default coordinates.
  ShaderNodeTexWhiteNoise: (p, decl) => [stack(`node_white_noise_${p.noise_dimensions.toLowerCase()}`, decl)],
  // node_shader_tex_gabor.cc, node_shader_squeeze.cc, node_shader_radial_tiling.cc
  ShaderNodeTexGabor: (p, decl, context) => texture(decl, context, 'node_tex_gabor', [enumValue(decl, p, 'gabor_type')]),
  ShaderNodeSqueeze: (p, decl) => [stack('squeeze', decl)],
  ShaderNodeRadialTiling: (p, decl, { linked }) => [stack('node_radial_tiling', decl, [p.normalize ? 1 : 0, ...outputs(decl).map((id) => (linked(id.slice(1)) ? 1 : 0))])],
  // node_shader_light_falloff.cc: a material's surface is lit by no light of its own, so its strength passes through.
  ShaderNodeLightFalloff: (p, decl) => [stack('node_light_falloff', decl)],
  // node_shader_bevel.cc, node_shader_ambient_occlusion.cc, node_shader_displacement.cc,
  // node_shader_vector_displacement.cc: an unlinked normal is the shaded point's.
  ShaderNodeBevel: (p, decl, { connected }) => [G_DATA, ['node_bevel', ['Radius', connected('Normal') ? 'Normal' : WORLD_NORMAL], ['@Normal']]],
  // port-override: EEVEE searches its hi-Z buffer (ambient_occlusion_eval); the view's depth (render/scene-depth.js)
  // stands in for it.
  ShaderNodeAmbientOcclusion: (p, decl, { connected }) => [G_DATA,
    ['bl_ambient_occlusion', [{ depth: true }, '$viewmat', '$winmat', '$sample_offset', 'Color', 'Distance', connected('Normal') ? 'Normal' : WORLD_NORMAL, p.inside ? 1 : 0, p.samples], outputs(decl)]],
  ShaderNodeDisplacement: (p, decl, { connected }) => [...ENGINE_STEPS,
    [p.space === 'OBJECT' ? 'node_displacement_object' : 'node_displacement_world', ['Height', 'Midlevel', 'Scale', connected('Normal') ? 'Normal' : WORLD_NORMAL], ['@Displacement']]],
  ShaderNodeVectorDisplacement: (p, decl) => [...ENGINE_STEPS, p.space === 'TANGENT' ? stack('node_vector_displacement_tangent', decl, [tangent('')])
    : stack(p.space === 'OBJECT' ? 'node_vector_displacement_object' : 'node_vector_displacement_world', decl)],
  // node_shader_vector_transform.cc, gpu_shader_vect_transform: get_gpufn_name_from_to names the transform by its
  // type and spaces; camera space looks down -z where the view's looks down z.
  ShaderNodeVectorTransform: (p) => {
    const space = { OBJECT: 'object', WORLD: 'world', CAMERA: 'view' }, type = { POINT: 'point', VECTOR: 'direction', NORMAL: 'normal' }[p.vector_type];
    const same = p.convert_from === p.convert_to;
    return [...ENGINE_STEPS,
      !same && p.convert_from === 'CAMERA' && ['invert_z', ['Vector'], ['Vector']],
      [same ? 'set_rgb' : `${type}_transform_${space[p.convert_from]}_to_${space[p.convert_to]}`, ['Vector'], ['@Vector']],
      !same && p.convert_to === 'CAMERA' && ['invert_z', ['@Vector'], ['@Vector']],
      p.vector_type === 'NORMAL' && ['vector_normalize', ['@Vector'], ['@Vector']]];
  },
  // node_shader_geometry.cc, node_shader_gpu_geometry
  ShaderNodeNewGeometry: (p, decl) => [...ENGINE_STEPS, ['node_geometry', ['$orco'], outputs(decl)]],
  // node_shader_object_info.cc, node_shader_gpu_object_info: the material's pass index is not Bylonder's.
  ShaderNodeObjectInfo: (p, decl) => [...ENGINE_STEPS, ['node_object_info', [0], outputs(decl)]],
  // node_shader_camera.cc, node_shader_light_path.cc: every ray is a camera ray, as in EEVEE's main view.
  ShaderNodeCameraData: (p, decl) => [...ENGINE_STEPS, stack('camera', decl)],
  // A world's rays are the view's, or the world probe's (eevee_view.cc CaptureView: diffuse, then glossy).
  ShaderNodeLightPath: (p, decl, { world }) => [G_DATA, world() && ['bl_set_ray_type', ['$ray_type'], []], stack('node_light_path', decl)],
  // node_shader_fresnel.cc, node_shader_layer_weight.cc: an unlinked normal is the shaded point's (world_normals_get).
  ShaderNodeFresnel: (p, decl, { connected }) => [...ENGINE_STEPS, ['node_fresnel', ['IOR', connected('Normal') ? 'Normal' : WORLD_NORMAL], ['@Fac']]],
  ShaderNodeLayerWeight: (p, decl, { connected }) => [...ENGINE_STEPS, ['node_layer_weight', ['Blend', connected('Normal') ? 'Normal' : WORLD_NORMAL], ['@Fresnel', '@Facing']]],
  // node_shader_attribute.cc, node_shader_gpu_attribute: a geometry attribute by name (color and temperature as Blender
  // reads them), else the object's, its instancer's or the view layer's value of that name.
  ShaderNodeAttribute: (p, decl) => {
    const name = p.attribute_name;
    if (p.attribute_type !== 'GEOMETRY') return [['node_attribute', [`$uniform_attribute:${p.attribute_type}:${name}`], outputs(decl)]];
    const post = { color: 'node_attribute_color', temperature: 'node_attribute_temperature' }[name];
    return [post && [post, [attribute(name)], [['#attribute', 'vec4']]], ['node_attribute', [post ? '#attribute' : attribute(name)], outputs(decl)]];
  },
  // node_shader_vertex_color.cc, node_shader_uvmap.cc: an empty name is the default color attribute, the default UV map.
  ShaderNodeVertexColor: (p, decl) => [['node_vertex_color', [attribute(p.layer_name, 'color')], outputs(decl)]],
  ShaderNodeUVMap: (p, decl) => [['node_uvmap', [p.uv_map ? attribute(p.uv_map) : '$uv'], outputs(decl)]],
  // node_shader_tangent.cc, node_shader_gpu_tangent
  ShaderNodeTangent: (p, decl) => (p.direction_type === 'UV_MAP' ? [...ENGINE_STEPS, ['node_tangentmap', [tangent(p.uv_map)], ['@Tangent']]]
    : [...ENGINE_STEPS, [`tangent_orco_${p.axis.toLowerCase()}`, ['$orco'], [['#orco', 'vec3']]], ['node_tangent', ['#orco'], ['@Tangent']]]),
  // node_shader_normal_map.cc, gpu_shader_normal_map
  ShaderNodeNormalMap: (p, decl) => {
    const steps = [...ENGINE_STEPS,
      [p.space.startsWith('BLENDER_') ? 'color_to_blender_normal_new_shading' : 'color_to_normal_new_shading', ['Color'], [['#normal', 'vec3']]],
      p.convention === 'DIRECTX' && ['color_invert_green_channel', ['#normal'], [['#normal', 'vec3']]],
      [p.base === 'DISPLACED' ? 'input_normal_displaced' : 'input_normal_original', [], [['#input', 'vec3']]]];
    if (p.space === 'TANGENT') return [...steps, ['node_normal_map', [tangent(p.uv_map), 'Strength', '#normal', '#input'], ['@Normal']]];
    return [...steps, p.space.endsWith('OBJECT') && ['normal_transform_object_to_world', ['#normal'], [['#normal', 'vec3']]],
      ['node_normal_map_mix', ['Strength', '#normal'], ['@Normal']]];
  },
};

const outputs = (decl) => decl.outputs.map((s) => '@' + s.identifier);
const NISHITA = ['SINGLE_SCATTERING', 'MULTIPLE_SCATTERING'];
// A BSDF's Normal socket, the shaded point's normal when unlinked.
const normal = (connected) => (connected('Normal') ? 'Normal' : WORLD_NORMAL);
// A curve mapping's range minimums, dividers, start and end slopes, each as `pick` takes its curves' values.
const curveParameters = (curves, pick) => [curves.minimums, curves.dividers, curves.startSlopes, curves.endSlopes].map(pick);
// The curve mappings nodes start with (their init functions' BKE_curvemapping_add): curves and range.
const CURVE_MAPPINGS = { ShaderNodeRGBCurve: [4, [0, 1]], ShaderNodeVectorCurve: [3, [-1, 1]], ShaderNodeFloatCurve: [1, [0, 1]] };
// A geometry attribute's value by name ('$attribute:...'), as GPU_attribute(CD_AUTO_FROM_NAME) reads it; `fallback`
// names the default layer an empty name reads (GPU_attribute_default_color).
const attribute = (name, fallback = '') => `$attribute:${name || (fallback && ':' + fallback)}`;
// A UV map's tangent (GPU_attribute(CD_TANGENT)).
const tangent = (uvMap) => `$tangent:${uvMap}`;

// blender-port: node_shader_tex_image.cc node_shader_gpu_tex_image, its projections: Box blends three planar samples by
// the object space normal (normal_transform_world_to_object of the world normal points as the mesh's own normal does);
// Sphere and Tube map the vector first.
function imageProjection({ projection, projection_blend: blend = 0 }, vector, image, cubic) {
  const sample = cubic ? 'node_tex_image_cubic' : 'node_tex_image_linear';
  if (projection === 'BOX') {
    const samples = [['#color1', 'vec4'], ['#color2', 'vec4'], ['#color3', 'vec4']];
    return [
      [cubic ? 'tex_box_sample_cubic' : 'tex_box_sample_linear', [vector, '$object_normal', image], samples],
      ['tex_box_blend', ['$object_normal', ...samples.map(([id]) => id), blend], ['@Color', '@Alpha']],
    ];
  }
  if (projection === 'SPHERE' || projection === 'TUBE') return [
    ['point_texco_remap_square', [vector], [['#square', 'vec3']]],
    [projection === 'SPHERE' ? 'point_map_to_sphere' : 'point_map_to_tube', ['#square'], [['#mapped', 'vec3']]],
    [sample, ['#mapped', image], ['@Color', '@Alpha']],
  ];
  return [[sample, [vector, image], ['@Color', '@Alpha']]];
}

// A texture node's function linked with its vector, Generated when unlinked (node_shader_gpu_default_tex_coord).
function texture(decl, { connected }, name, extra) {
  const [, args, outs] = stack(name, decl, extra);
  return [[name, args.map((a) => (a === 'Vector' && !connected('Vector') ? '$orco' : a)), outs]];
}
// An enum property as the DNA value Blender's GPU code passes.
const enumValue = (decl, p, key) => decl.properties[key].values?.[p[key]] ?? decl.properties[key].items.findIndex(([id]) => id === p[key]);

// Bylonder's GLSL where Blender's is its render engine's (EEVEE's g_data, draw manager resources and closures,
// gpu_shader_codegen_lib.glsl). port-override: the shaded point comes from Babylon's geometry and a closure is its
// radiance, so these stand in.
export const STAND_INS = {
  // blender-port: eevee_surf_common.bsl.hh init_globals, init_globals_curves: every ray is a camera ray (EEVEE's main
  // view); a strand's normal is its cylinder's, which curves.js gives. The derivatives node_bump reads (the film's scale is 1).
  // A material drawing its back faces in a pass of their own (separateCullingPass) reverses which winding faces front
  // there; bl_reversed_faces (ShaderNodeOutputMaterial.bind) tells, so FrontFacing stays Blender's.
  bl_g_data: `#define FrontFacing (gl_FrontFacing != (bl_reversed_faces > 0.5))
#define RAY_TYPE_CAMERA 0
#define RAY_TYPE_SHADOW 1
#define RAY_TYPE_DIFFUSE 2
#define RAY_TYPE_GLOSSY 3
struct GlobalData { vec3 P; vec3 N; vec3 Ni; vec3 Ng; vec3 curve_T; vec3 curve_B; vec3 curve_N; vec2 barycentric_coords; vec3 barycentric_dists;
  float hair_diameter; int hair_strand_id; float ray_depth; float ray_length; int ray_type; bool is_strand; };
GlobalData g_data;
float derivative_scale_get() { return 1.0; }
void bl_g_data(vec3 P, vec3 N, vec3 camera, float is_strand, float hair_radius, vec3 curve_N, float hair_strand_id) {
  bool flip = !FrontFacing && is_strand < 0.5;
  g_data.P = P;
  g_data.Ni = flip ? -N : N;
  g_data.N = normalize(g_data.Ni);
  g_data.Ng = normalize(cross(dFdx(P), dFdy(P)));
  g_data.curve_T = vec3(0.0);
  g_data.curve_B = vec3(0.0);
  g_data.curve_N = curve_N;
  g_data.barycentric_coords = vec2(0.0);
  g_data.barycentric_dists = vec3(0.0);
  g_data.hair_diameter = hair_radius * 2.0;
  g_data.hair_strand_id = int(hair_strand_id);
  g_data.ray_depth = 0.0;
  g_data.ray_length = distance(P, camera);
  // A shadow map draws the surface for shadow rays (Babylon's shadow generator defines SM_FLOAT in its pass).
#ifdef SM_FLOAT
  g_data.ray_type = RAY_TYPE_SHADOW;
#else
  g_data.ray_type = RAY_TYPE_CAMERA;
#endif
  g_data.is_strand = is_strand > 0.5;
}`,
  // The draw manager's object and view resources (draw_resource.hh ObjectInfos, ObjectMatrices; ViewMatrices).
  bl_engine: `#define OBJECT_NEGATIVE_SCALE 16u
struct ObjectMatrices { mat4 model; mat4 model_inverse; };
struct ViewMatrices { mat4 viewmat; mat4 viewinv; mat4 winmat; };
struct ObjectInfos { vec4 ob_color; float index; float random; uint flag; };
ObjectMatrices bl_object_matrices;
ViewMatrices bl_view_matrices;
ObjectInfos bl_object_infos;
void bl_engine(mat4 model, mat4 model_inverse, mat4 viewmat, mat4 viewinv, mat4 winmat, vec4 color, vec3 info) {
  bl_object_matrices = ObjectMatrices(model, model_inverse);
  bl_view_matrices = ViewMatrices(viewmat, viewinv, winmat);
  bl_object_infos = ObjectInfos(color, info.x, info.y, uint(info.z));
}`,
  object_matrices_get: 'ObjectMatrices object_matrices_get() { return bl_object_matrices; }',
  view_matrices_get: 'ViewMatrices view_matrices_get() { return bl_view_matrices; }',
  object_infos_get: 'ObjectInfos object_infos_get() { return bl_object_infos; }',
  // blender-port: eevee_nodetree_lib.bsl.hh coordinate_incoming, draw_view_lib.glsl drw_world_incident_vector
  coordinate_incoming: `vec3 coordinate_incoming(vec3 P) {
  return bl_view_matrices.winmat[3][3] == 0.0 ? normalize(bl_view_matrices.viewinv[3].xyz - P) : bl_view_matrices.viewinv[2].xyz;
}`,
  // A UV map's tangent: the mesh's (Blender's MikkTSpace tangents, object space) in world space, as EEVEE's
  // attr_load_tangent gives it. port-override: where the mesh gives none (another UV map's, a mesh not Blender's), from
  // the screen derivatives of the point and its UV, its sign (w) orienting the bitangent as Blender's does.
  bl_uv_tangent: `vec4 bl_uv_tangent(vec4 extracted, mat4 model_inverse, vec3 P, vec3 N, vec2 uv) {
  if (dot(extracted.xyz, extracted.xyz) > 0.0) return vec4(normalize(extracted.xyz * mat3(model_inverse)), extracted.w);
  vec3 dp1 = dFdx(P), dp2 = dFdy(P);
  vec2 duv1 = dFdx(uv), duv2 = dFdy(uv);
  vec3 dp2perp = cross(dp2, N), dp1perp = cross(N, dp1);
  vec3 T = dp2perp * duv1.x + dp1perp * duv2.x, B = dp2perp * duv1.y + dp1perp * duv2.y;
  T -= N * dot(N, T);
  return dot(T, T) > 0.0 ? vec4(normalize(T), dot(cross(N, T), B) < 0.0 ? -1.0 : 1.0) : vec4(0.0, 0.0, 0.0, 1.0);
}`,
  bl_vector_copy: 'void bl_vector_copy(vec3 v, inout vec3 result) { result = v; }',
  bl_set_ray_type: 'void bl_set_ray_type(float ray_type) { g_data.ray_type = int(ray_type); }',
  // EEVEE's texture LOD bias (the film's, 1 at full resolution).
  texture_lod_bias_get: 'float texture_lod_bias_get() { return 1.0; }',
  bl_tex_coord: `void bl_tex_coord(vec3 orco, vec3 normal_in, vec3 uv_in, vec3 object_in, vec3 camera_in, vec3 window_in, vec3 reflection_in,
  inout vec3 generated, inout vec3 normal, inout vec3 uv, inout vec3 object, inout vec3 camera, inout vec3 window, inout vec3 reflection) {
  generated = orco; normal = normal_in; uv = uv_in; object = object_in; camera = camera_in; window = window_in; reflection = reflection_in;
}`,
  // A closure as EEVEE gathers a material's closures into its bins before lighting them (eevee_nodetree_lib.bsl.hh
  // closure_eval): a base lobe, each kind of reflection's color with its weight (dielectric, metal, transmission), its
  // roughness, IOR and normal summed as they weigh, and two lobes of reflection only (BlLobe, EEVEE's reflection bins),
  // with its emission and its transparency. Mixing and adding closures weighs and sums them; the material's surface
  // lights each lobe once (BlenderSurfaceBlock), as EEVEE merges the closures of one bin.
  bl_closure: `struct BlLobe { vec3 color; float weight; float roughness; vec3 normal; };
struct BlClosure { vec3 dielectric; float dielectric_weight; vec3 metal; float metal_weight; vec3 transmission; float transmission_weight;
  float roughness; float ior; vec3 normal; vec3 emission; float transparency; BlLobe lobe1; BlLobe lobe2;
  vec3 volume_scattering; vec3 volume_absorption; float volume_anisotropy; };
BlLobe bl_lobe_weigh(BlLobe l, float w) { return BlLobe(l.color * w, l.weight * w, l.roughness * w, l.normal * w); }
BlLobe bl_lobe_add(BlLobe a, BlLobe b) { return BlLobe(a.color + b.color, a.weight + b.weight, a.roughness + b.roughness, a.normal + b.normal); }
const BlLobe bl_lobe_empty = BlLobe(vec3(0.0), 0.0, 0.0, vec3(0.0));
BlClosure bl_closure_empty() { return BlClosure(vec3(0.0), 0.0, vec3(0.0), 0.0, vec3(0.0), 0.0, 0.0, 0.0, vec3(0.0), vec3(0.0), 0.0, bl_lobe_empty, bl_lobe_empty, vec3(0.0), vec3(0.0), 0.0); }
BlClosure bl_closure_weigh(BlClosure c, float w) {
  return BlClosure(c.dielectric * w, c.dielectric_weight * w, c.metal * w, c.metal_weight * w, c.transmission * w, c.transmission_weight * w,
    c.roughness * w, c.ior * w, c.normal * w, c.emission * w, c.transparency * w, bl_lobe_weigh(c.lobe1, w), bl_lobe_weigh(c.lobe2, w),
    c.volume_scattering * w, c.volume_absorption * w, c.volume_anisotropy * w);
}
BlClosure bl_closure_add(BlClosure a, BlClosure b) {
  return BlClosure(a.dielectric + b.dielectric, a.dielectric_weight + b.dielectric_weight, a.metal + b.metal, a.metal_weight + b.metal_weight,
    a.transmission + b.transmission, a.transmission_weight + b.transmission_weight, a.roughness + b.roughness, a.ior + b.ior, a.normal + b.normal,
    a.emission + b.emission, a.transparency + b.transparency, bl_lobe_add(a.lobe1, b.lobe1), bl_lobe_add(a.lobe2, b.lobe2),
    a.volume_scattering + b.volume_scattering, a.volume_absorption + b.volume_absorption, a.volume_anisotropy + b.volume_anisotropy);
}
// A reflection of weight 1, its color split among the kinds by their weights.
BlClosure bl_closure_bsdf(vec3 color, float dielectric, float metal, float transmission, float roughness, float ior, vec3 N) {
  color = max(color, vec3(0.0));
  return BlClosure(color * dielectric, dielectric, color * metal, metal, color * transmission, transmission, roughness, ior, normalize(N), vec3(0.0), 0.0,
    bl_lobe_empty, bl_lobe_empty, vec3(0.0), vec3(0.0), 0.0);
}
// A reflection of weight 1 in a lobe: the base's metal (0), or a lobe of its own (1, 2).
BlClosure bl_closure_reflection(vec3 color, float roughness, vec3 N, float lobe) {
  if (lobe < 0.5) return bl_closure_bsdf(color, 0.0, 1.0, 0.0, roughness, 1.5, N);
  BlClosure c = bl_closure_empty();
  BlLobe l = BlLobe(max(color, vec3(0.0)), 1.0, roughness, normalize(N));
  if (lobe < 1.5) c.lobe1 = l; else c.lobe2 = l;
  return c;
}
// The lobes merged into the base's metal, as one bin lights them (EEVEE Parity off: plain Babylon PBR).
BlClosure bl_closure_merge_lobes(BlClosure c) {
  BlLobe l = bl_lobe_add(c.lobe1, c.lobe2);
  c.metal += l.color; c.metal_weight += l.weight; c.roughness += l.roughness; c.ior += 1.5 * l.weight; c.normal += l.normal;
  c.lobe1 = bl_lobe_empty; c.lobe2 = bl_lobe_empty;
  return c;
}
BlLobe bl_closure_lobe(BlClosure c, int lobe) { if (lobe == 1) return c.lobe1; return c.lobe2; }
vec3 bl_lobe_color(BlLobe l) { return l.weight > 0.0 ? l.color / l.weight : vec3(0.0); }
float bl_lobe_roughness(BlLobe l) { return l.weight > 0.0 ? l.roughness / l.weight : 0.5; }
vec3 bl_lobe_normal(BlLobe l) { return dot(l.normal, l.normal) > 0.0 ? normalize(l.normal) : vec3(0.0, 0.0, 1.0); }
float bl_closure_weight(BlClosure c) { return c.dielectric_weight + c.metal_weight + c.transmission_weight; }
// A parameter summed as the reflections weigh, as one reflection's (its fallback where none reflects).
float bl_closure_parameter(BlClosure c, float sum, float fallback) { float w = bl_closure_weight(c); return w > 0.0 ? sum / w : fallback; }
vec3 bl_closure_base_color(BlClosure c) {
  float w = c.dielectric_weight + c.metal_weight;
  return w > 0.0 ? (c.dielectric + c.metal) / w : vec3(0.0);
}
float bl_closure_metallic(BlClosure c) { float w = c.dielectric_weight + c.metal_weight; return w > 0.0 ? c.metal_weight / w : 0.0; }
float bl_closure_transmission(BlClosure c) { return bl_closure_parameter(c, c.transmission_weight, 0.0); }
vec3 bl_closure_transmission_tint(BlClosure c) { return c.transmission_weight > 0.0 ? c.transmission / c.transmission_weight : vec3(1.0); }
vec3 bl_closure_normal(BlClosure c) { return dot(c.normal, c.normal) > 0.0 ? normalize(c.normal) : vec3(0.0, 0.0, 1.0); }
// The light the surface sends toward the view, premultiplied by its coverage, and that coverage.
vec4 bl_closure_radiance(BlClosure c, vec3 lit) {
  return vec4(lit * bl_closure_weight(c) + c.emission, 1.0 - clamp(c.transparency, 0.0, 1.0));
}`,
  // blender-port: node_shader_tree.cc ntree_shader_weight_tree_invert: the mix's factor clamped, its closures weighted.
  bl_node_mix_shader: `void bl_node_mix_shader(float fac, BlClosure shader1, BlClosure shader2, inout BlClosure shader) {
  fac = clamp(fac, 0.0, 1.0);
  shader = bl_closure_add(bl_closure_weigh(shader1, 1.0 - fac), bl_closure_weigh(shader2, fac));
}`,
  bl_node_add_shader: 'void bl_node_add_shader(BlClosure shader1, BlClosure shader2, inout BlClosure shader) { shader = bl_closure_add(shader1, shader2); }',
  // node_bsdf_diffuse and the BSDFs EEVEE shades as diffuse (Sheen, Translucent, Subsurface Scattering, the hair
  // BSDFs: gpu_shader_material_sheen.glsl, gpu_shader_material_hair.glsl): no specular reflection (IOR 1).
  bl_node_bsdf_diffuse: 'void bl_node_bsdf_diffuse(vec4 color, vec3 N, inout BlClosure result) { result = bl_closure_bsdf(color.rgb, 1.0, 0.0, 0.0, 1.0, 1.0, N); }',
  // node_bsdf_glossy, node_bsdf_metallic: a conductor of the color, in its lobe.
  bl_node_bsdf_glossy: 'void bl_node_bsdf_glossy(vec4 color, float roughness, vec3 N, float lobe, inout BlClosure result) { result = bl_closure_reflection(color.rgb, roughness, N, lobe); }',
  // node_bsdf_glass, node_bsdf_refraction: light through the surface, tinted by the color.
  bl_node_bsdf_glass: 'void bl_node_bsdf_glass(vec4 color, float roughness, float ior, vec3 N, inout BlClosure result) { result = bl_closure_bsdf(color.rgb, 0.0, 0.0, 1.0, roughness, ior, N); }',
  // node_bsdf_principled: its base color as metal, transmission and dielectric by their weights, its emission, all
  // weighed by its alpha, the rest transparent. blender-port: gpu_shader_material_principled.glsl node_bsdf_principled:
  // Specular IOR Level scales the specular F0, reflected as the IOR that has it (transmission keeps the IOR).
  bl_node_bsdf_principled: `void bl_node_bsdf_principled(vec4 base_color, float metallic, float roughness, float ior, float alpha, vec3 N, float transmission,
  vec4 emission, float emission_strength, float specular_ior_level, inout BlClosure result) {
  metallic = clamp(metallic, 0.0, 1.0);
  transmission = clamp(transmission, 0.0, 1.0);
  alpha = clamp(alpha, 0.0, 1.0);
  specular_ior_level = max(specular_ior_level, 0.0);
  float eta = ior;
  if (specular_ior_level != 0.5) {
    float f0 = (1.0 - ior) / (1.0 + ior), f = sqrt(clamp(f0 * f0 * 2.0 * specular_ior_level, 0.0, 0.99));
    eta = (-f - 1.0) / (f - 1.0);
    if (ior < 1.0) eta = 1.0 / eta;
  }
  result = bl_closure_bsdf(base_color.rgb, (1.0 - metallic) * (1.0 - transmission), metallic, (1.0 - metallic) * transmission, roughness,
    transmission > 0.0 ? ior : eta, N);
  result.emission = max(emission.rgb, vec3(0.0)) * max(emission_strength, 0.0);
  result = bl_closure_weigh(result, alpha);
  result.transparency = 1.0 - alpha;
}`,
  // blender-port: eevee_nodetree_lib.bsl.hh closure_eval of the volume closures and emission: what a volume shader of
  // Blender's (gpu_shader_material_volume_*.glsl) gathers, its parts weighted (the weight tree is the mix nodes' here).
  closure_eval: `#define Closure BlClosure
#ifndef M_PI
#define M_PI 3.14159265358979323846
#endif
struct ClosureVolumeScatter { float weight; vec3 scattering; float anisotropy; };
struct ClosureVolumeAbsorption { float weight; vec3 absorption; };
struct ClosureEmission { float weight; vec3 emission; };
BlClosure closure_eval(ClosureVolumeScatter s) {
  BlClosure c = bl_closure_empty();
  c.volume_scattering = s.scattering * s.weight;
  c.volume_anisotropy = s.anisotropy * s.weight;
  return c;
}
BlClosure closure_eval(ClosureVolumeAbsorption a) { BlClosure c = bl_closure_empty(); c.volume_absorption = a.absorption * a.weight; return c; }
BlClosure closure_eval(ClosureEmission e) { BlClosure c = bl_closure_empty(); c.emission = e.emission * e.weight; return c; }
BlClosure closure_eval(ClosureVolumeScatter s, ClosureVolumeAbsorption a, ClosureEmission e) {
  return bl_closure_add(bl_closure_add(closure_eval(s), closure_eval(a)), closure_eval(e));
}`,
  // node_emission: max(color, 0) times max(strength, 0).
  bl_node_emission: `void bl_node_emission(vec4 color, float strength, inout BlClosure result) {
  result = bl_closure_empty();
  result.emission = max(color.rgb, vec3(0.0)) * max(strength, 0.0);
}`,
  // node_bsdf_transparent: its transmittance, max(color, 0), as one transparency.
  bl_node_bsdf_transparent: `void bl_node_bsdf_transparent(vec4 color, inout BlClosure result) {
  result = bl_closure_empty();
  result.transparency = dot(max(color.rgb, vec3(0.0)), vec3(1.0 / 3.0));
}`,
  // node_holdout: nothing of the surface or what is behind it.
  bl_node_holdout: 'void bl_node_holdout(inout BlClosure result) { result = bl_closure_empty(); }',
  // blender-port: eevee_nodetree_lib.bsl.hh ambient_occlusion_eval and eevee_fast_gi.bsl.hh fast_gi::eval (AO only),
  // angles_to_bitmask and bitmask_to_occlusion_cosine: two slices around the view vector, each side's samples spread
  // quadratically over the distance, each occluding the sectors between its front and its back (its depth plus the
  // scene's Fast GI near thickness) within the sphere of the distance, the occluded sectors cosine weighted; the noise
  // shifts with the film's sample. port-override: the view's depth (render/scene-depth.js) stands in for the hi-Z buffer.
  bl_ambient_occlusion: `uint bl_angles_to_bitmask(vec2 theta) {
  vec2 ratio = clamp(theta * 0.31830989 + 0.5, 0.0, 1.0);
  uint a = uint(floor(32.0 * ratio.x)), b = uint(ceil(32.0 * (ratio.y - ratio.x)));
  return (((b < 32u) ? 1u << b : 0u) - 1u) << a;
}
// bitCount, which GLSL ES 3.0 lacks.
float bl_bit_count(uint x) {
  x = x - ((x >> 1) & 0x55555555u);
  x = (x & 0x33333333u) + ((x >> 2) & 0x33333333u);
  return float((((x + (x >> 4)) & 0x0F0F0F0Fu) * 0x01010101u) >> 24);
}
float bl_bitmask_to_occlusion_cosine(uint bitmask) {
  const vec4 weights = vec4(0.0095061, 0.0270951, 0.0405571, 0.0478421);
  vec4 counts = vec4(bl_bit_count(bitmask & 0xF000000Fu), bl_bit_count(bitmask & 0x0F0000F0u), bl_bit_count(bitmask & 0x00F00F00u),
    bl_bit_count(bitmask & 0x000FF000u));
  return clamp(1.0 - dot(counts, weights), 0.0, 1.0);
}
void bl_ambient_occlusion(sampler2D depth, mat4 viewmat, mat4 winmat, float offset, vec4 color, float dist, vec3 normal, float inverted,
    float sample_count, out vec4 result_color, out float result_ao) {
  const float PI = 3.14159265, THICKNESS = 0.1, ANGLE_BIAS = 1.0 / 0.95;
  bool reversed = inverted > 0.5, ortho = winmat[3][3] > 0.5;
  vec3 vP = (viewmat * vec4(g_data.P, 1.0)).xyz, vN = normalize(mat3(viewmat) * normal) * (reversed ? -1.0 : 1.0);
  vec3 vV = ortho ? vec3(0.0, 0.0, 1.0) : normalize(-vP);
  vec2 scale = vec2(winmat[0][0], winmat[1][1]), shift = ortho ? -winmat[3].xy : vec2(winmat[2][0], winmat[2][1]);
  vec4 clip = winmat * vec4(vP, 1.0);
  vec2 uv = clip.xy / clip.w * 0.5 + 0.5, radius = 0.5 * dist * scale / (ortho ? 1.0 : -vP.z);
  vec4 ign = vec4(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715)), dot(gl_FragCoord.xy + vec2(5.588, 4.312), vec2(0.06711056, 0.00583715)),
    dot(gl_FragCoord.xy + vec2(13.21, 9.17), vec2(0.06711056, 0.00583715)), dot(gl_FragCoord.xy + vec2(21.73, 2.51), vec2(0.06711056, 0.00583715)));
  vec4 noise = fract(fract(52.9829189 * fract(ign)) + offset * vec4(1.0, 1.618034, 2.236068, 3.141593));
  vec2 size = vec2(textureSize(depth, 0));
  // ScreenThicknessParameters: the scene's near thickness and some pixels' footprint at the sample's depth.
  float pixel_thickness = 4.0 * sqrt(64.0 / 8.0) * 0.5 * (1.0 / (scale.x * size.x) + 1.0 / (scale.y * size.y));
  int samples = int(max(sample_count * 0.5, 1.0));
  float angle = 2.0 * PI * noise.x / 4.0, occlusion = 0.0, weight = 0.0;
  vec2 v_dir = vec2(cos(angle), sin(angle));
  for (int slice = 0; slice < 2; slice++) {
    vec3 vB = normalize(cross(vV, vec3(v_dir, 0.0))), vT = cross(vB, vV);
    vec3 n_proj = vN - vB * dot(vN, vB);
    float n_len = length(n_proj);
    n_proj /= max(n_len, 1e-8);
    float n_angle = sign(dot(n_proj, vT)) * acos(clamp(dot(n_proj, vV), -1.0, 1.0)) + (noise.z - 0.5) * (PI / 32.0) * ANGLE_BIAS;
    uint slice_bitmask = 0u;
    for (int side = 0; side < 2; side++) {
      vec2 direction = (side == 0 ? v_dir : -v_dir) * radius * size, step = normalize(direction) / size;
      float max_time = length(direction), prev_z = -vP.z, prev_time = 0.0;
      vec2 prev_slope = vec2(0.0);
      for (int j = 0; j < 32; j++) {
        if (j >= samples) break;
        // Always cross at least one pixel.
        float time = 1.0 + pow((float(j) + noise.y) / float(samples), 2.0) * max_time + (reversed ? 1.0 : 0.0);
        vec2 at = uv + step * time;
        if (any(lessThan(at, vec2(0.0))) || any(greaterThan(at, vec2(1.0)))) break;
        // Level 0, as EEVEE reads its depth: a sample in a loop that breaks per pixel has no derivatives (FXC, WGSL).
        float z = textureLod(depth, at, 0.0).r;
        // ScreenThicknessEstimator: a sample is a segment from the one before, unless the slope breaks.
        float slope = (z - prev_z) / (time - prev_time), thickness = abs(z - prev_z);
        if (any(greaterThan(abs(prev_slope - slope), abs(prev_slope)))) thickness = 0.0;
        thickness = max(thickness, THICKNESS + (ortho ? 1.0 : z) * pixel_thickness);
        prev_slope = vec2(slope, prev_slope.x);
        prev_z = z;
        prev_time = time;
        if (z > 1e7 && !reversed) continue;
        vec2 ndc = at * 2.0 - 1.0;
        vec3 front = vec3((ndc + shift) * (ortho ? 1.0 : z) / scale, -z) - vP;
        vec3 back = vec3((ndc + shift) * (ortho ? 1.0 : z + thickness) / scale, -z - thickness) - vP;
        vec3 ls_front = front / dist, ls_back = back / dist;
        float max_dist = sqrt(clamp(1.0 - dot(ls_front.xy, ls_front.xy), 0.0, 1.0));
        if (!reversed) {
          ls_front.z = clamp(ls_front.z, -max_dist, max_dist);
          ls_back.z = clamp(ls_back.z, -max_dist, max_dist);
          if (ls_front.z == ls_back.z) continue;
        }
        float lv_front = dot(normalize(ls_front), vV), lv_back = dot(normalize(ls_back), vV);
        if (reversed) {
          lv_front = 1.0;
          if (z > 1e7) lv_back = -1.0;
        }
        vec2 theta = acos(clamp(vec2(lv_front, lv_back), -1.0, 1.0));
        theta.y = max(theta.x, theta.y);
        if (reversed) theta -= PI;
        theta = side == 0 ? theta.xy : -theta.yx;
        slice_bitmask |= bl_angles_to_bitmask((theta - n_angle) * ANGLE_BIAS);
      }
    }
    occlusion += bl_bitmask_to_occlusion_cosine(slice_bitmask) * n_len;
    weight += n_len;
    v_dir = vec2(-v_dir.y, v_dir.x);
  }
  result_ao = clamp(occlusion / max(weight, 1e-8), 0.0, 1.0);
  result_color = result_ao * color;
}
`,
};
// What a node reads of the world's normal (world_normals_get).
const WORLD_NORMAL = { glsl: 'g_data.N' };

// The geometry a node's code reads, as Babylon blocks: an attribute, a system value, or what the mesh's geometry block
// gives (a mesh's position and normal, or a curves vertex's and its curve's values: curves.js CurvesGeometryBlock), by the
// hidden input's name; a geometry attribute of Blender's ('__attribute name') is the vertex buffer the mesh gives for it.
const GEOMETRY = {
  __position: ['geometry', 'position', T.Vector3], __normal: ['geometry', 'normal', T.Vector3], __uv: ['attribute', 'uv', T.Vector2],
  __hair_intercept: ['geometry', 'intercept', T.Float], __hair_length: ['geometry', 'length', T.Float], __hair_radius: ['geometry', 'radius', T.Float],
  __hair_curve_N: ['geometry', 'curveN', T.Vector3], __hair_strand_id: ['geometry', 'strandId', T.Float], __is_strand: ['geometry', 'isStrand', T.Float],
  __world: ['system', System.World, T.Matrix], __view: ['system', System.View, T.Matrix], __viewProjection: ['system', System.ViewProjection, T.Matrix],
  __cameraPosition: ['system', System.CameraPosition, T.Vector3], __tangent: ['attribute', TANGENT_KIND, T.Vector4],
};
const ATTRIBUTE = '__attribute ';
const geometrySpec = (name) => GEOMETRY[name] ?? ['attribute', attributeKind(name.slice(ATTRIBUTE.length)), T.Vector4];
// The values of the shaded point ('$name') in Blender's axes, from the geometry inputs they use.
const POINT = {
  $P: ['__position', '__world'], $N: ['__normal', '__world'], $orco: ['__position'], $object: ['__position'], $object_normal: ['__normal'],
  $uv: ['__uv'], $camera: ['__position', '__world', '__view'], $window: ['__position', '__world', '__viewProjection'],
  $reflection: ['__position', '__normal', '__world', '__cameraPosition'], $camera_position: ['__cameraPosition'],
  $is_strand: ['__is_strand'], $hair_radius: ['__hair_radius'], $hair_curve_N: ['__hair_curve_N'], $hair_strand_id: ['__hair_strand_id'],
  $hair_intercept: ['__hair_intercept'], $hair_length: ['__hair_length'],
};
const pointGeometry = (id) => {
  const [kind, name] = id.split(':');
  if (kind === '$attribute') return [ATTRIBUTE + id.slice(kind.length + 1)];
  if (kind === '$tangent') return [...POINT.$P, ...POINT.$N, ...(name ? [ATTRIBUTE + name] : [...POINT.$uv, '__tangent'])];
  return POINT[id] ?? [];
};
// The geometry inputs a node's steps read.
const geometryOf = (steps) => [...new Set(steps.filter(Boolean).flatMap(([, args]) => args.filter((a) => typeof a === 'string' && a[0] === '$').flatMap(pointGeometry)))];

// A mesh drawn with a material whose nodes read attributes its draw buffers lack asks to be drawn again with them
// (main-view.js), once for what the material reads.
export const attributesWanted = new Observable();
const asked = new WeakMap();
function askForAttributes(material, mesh) {
  const requests = requestedAttributes(material);
  if (!requests.length) return;
  const kinds = requests.map((r) => r.kind), key = kinds.join();
  if (asked.get(mesh) === key || kinds.every((kind) => mesh.isVerticesDataPresent(kind))) return;
  asked.set(mesh, key);
  attributesWanted.notifyObservers(mesh);
}

// The object a mesh draws (ObjectInfos: color, pass index, random; its object and instancer attributes, and the view
// layer's), as Bylonder's Main gives it (setObjectInfo); without one, an object's defaults.
let objectInfo = () => ({ color: [1, 1, 1, 1], index: 0, random: 0, attribute: () => [0, 0, 0, 0] });
export const setObjectInfo = (provide) => { objectInfo = provide; };
// A Babylon matrix in Blender's axes: (x, y, z) is Babylon's (x, z, y) on both sides; a view looks down -z.
const SWAP = [0, 2, 1, 3];
const blenderAxes = (m, { rows = SWAP, flipRow = -1, flipColumn = -1 } = {}) => Matrix.FromArray(Array.from({ length: 16 }, (_, i) => {
  const c = i >> 2, r = i & 3;
  return m.m[SWAP[c] * 4 + rows[r]] * (r === flipRow ? -1 : 1) * (c === flipColumn ? -1 : 1);
}));
const IDENTITY_ROWS = [0, 1, 2, 3];
// What each draw binds, made again only when its source matrix changed (Matrix.updateFlag), not per draw.
const derived = new WeakMap();
const derive = (m, kind, make) => {
  const entries = derived.get(m) ?? derived.set(m, {}).get(m), entry = entries[kind];
  return entry?.flag === m.updateFlag ? entry.value : (entries[kind] = { flag: m.updateFlag, value: make(m) }).value;
};
const VIEW_AXES = { rows: IDENTITY_ROWS, flipRow: 2 };
const model = (mesh) => derive(mesh.getWorldMatrix(), 'model', (m) => blenderAxes(m));
const modelInverse = (mesh) => derive(mesh.getWorldMatrix(), 'modelInverse', (m) => blenderAxes(m).invert());
const viewmat = (scene) => derive(scene.getViewMatrix(), 'view', (m) => blenderAxes(m, VIEW_AXES));
const viewinv = (scene) => derive(scene.getViewMatrix(), 'viewInverse', (m) => blenderAxes(m, VIEW_AXES).invert());
const winmat = (scene) => derive(scene.getProjectionMatrix(), 'win', (m) => Matrix.FromArray(Array.from(m.m, (v, i) => ((i >> 2) === 2 ? -v : v))));
// The rays a scene's world is drawn for (eevee_defines.hh RAY_TYPE_*): its view's, else its probe's while it renders.
export const RAY_TYPE = { CAMERA: 0, DIFFUSE: 2, GLOSSY: 3 };
const rayTypes = new WeakMap();
export const setRayType = (scene, type) => rayTypes.set(scene, type);
// Per drawn mesh values ('$name' read as uniforms): [Babylon type, value from the mesh and scene].
const MESH_VALUES = {
  $model: [T.Matrix, (mesh) => model(mesh)],
  $model_inverse: [T.Matrix, (mesh) => modelInverse(mesh)],
  $viewmat: [T.Matrix, (mesh, scene) => viewmat(scene)],
  $viewinv: [T.Matrix, (mesh, scene) => viewinv(scene)],
  $winmat: [T.Matrix, (mesh, scene) => winmat(scene)],
  $object_color: [T.Vector4, (mesh) => objectInfo(mesh).color],
  // Pass index, random and flags (OBJECT_NEGATIVE_SCALE).
  $object_info: [T.Vector3, (mesh) => [objectInfo(mesh).index, objectInfo(mesh).random, mesh.getWorldMatrix().determinant() < 0 ? 16 : 0]],
  $texspace_location: [T.Vector3, (mesh) => texspace(mesh)[0]],
  $texspace_size: [T.Vector3, (mesh) => texspace(mesh)[1]],
  $ray_type: [T.Float, (mesh) => rayTypes.get(mesh.getScene()) ?? RAY_TYPE.CAMERA],
  // The film's sample: its noise offset (render/dither.js), as EEVEE's sampling shifts its noise per sample.
  $sample_offset: [T.Float, (mesh) => ditherOffset(mesh.getScene())],
};
export const meshValue = (id) => MESH_VALUES[id] ?? (id.startsWith('$uniform_attribute:') && [T.Vector4, (mesh) => {
  const [, type, ...name] = id.split(':');
  return objectInfo(mesh).attribute(type, name.join(':'));
}]);

// A Bylonder helper block of a material, found by name or made (`blender:` and the name: GLSL takes a block's name
// into its variables' names, where two underscores are reserved).
function helper(material, name, make) {
  const full = 'blender:' + name.replace(/^__/, '');
  const found = material.attachedBlocks.find((b) => b.name === full);
  if (found) return found;
  const block = make(full);
  material.attachedBlocks.push(block);
  return block;
}
// An attribute's block is named as the attribute (Babylon reads it by its name), and shared.
function attributeBlock(material, value, type) {
  const found = material.attachedBlocks.find((b) => b.isAttribute && b.name === value);
  if (found) return found;
  const block = new InputBlock(value, undefined, type);
  block.setAsAttribute(value);
  material.attachedBlocks.push(block);
  return block;
}
// Babylon's own vertex chain, as its PBR material has it: the mesh's position and normal through its morph targets, and
// the world matrix through its instances and bones. Babylon's blocks take the attributes they read themselves.
function morphTargets(material) {
  const morph = helper(material, '__morphTargets', (name) => new MorphTargetsBlock(name));
  wire(attributeBlock(material, 'position', T.Vector3).output, morph.position);
  wire(attributeBlock(material, 'normal', T.Vector3).output, morph.normal);
  morph.autoConfigure(material);
  return morph;
}
function finalWorld(material) {
  const world = helper(material, '__worldMatrix', (name) => Object.assign(new InputBlock(name, undefined, T.Matrix), { systemValue: System.World }));
  const instances = helper(material, '__instances', (name) => new InstancesBlock(name));
  wire(world.output, instances.world);
  instances.autoConfigure(material);
  const bones = helper(material, '__bones', (name) => new BonesBlock(name));
  wire(instances.output, bones.world);
  bones.autoConfigure(material);
  return bones;
}
// The material's geometry block, its mesh's morphed position and normal into it, and the normal it shades with.
function curvesGeometry(material) {
  const geometry = helper(material, '__geometry', (name) => new CurvesGeometryBlock(name)), morph = morphTargets(material);
  wire(morph.positionOutput, geometry.getInputByName('meshPosition'));
  wire(morph.normalOutput, geometry.getInputByName('meshNormal'));
  return geometry;
}
function shadingNormal(material) {
  const geometry = curvesGeometry(material), normal = helper(material, '__shadingNormal', (name) => new CurvesNormalBlock(name));
  for (const name of ['normal', 'curveN', 'binormal', 'timeWidth', 'radius']) wire(geometry.getOutputByName(name), normal.getInputByName(name));
  return normal;
}
function geometryBlock(material, name) {
  const [kind, value, type] = geometrySpec(name);
  if (kind === 'attribute' && name.startsWith(ATTRIBUTE)) return Object.assign(attributeBlock(material, value, type), { blenderAttribute: { name: name.slice(ATTRIBUTE.length), kind: value } });
  if (name === '__tangent') return Object.assign(attributeBlock(material, value, type), { blenderAttribute: { tangent: true, kind: value } });
  if (kind === 'attribute') return attributeBlock(material, value, type);
  if (name === '__normal') return shadingNormal(material);
  if (kind === 'geometry') return { output: material.blenderGeometry?.(value) ?? curvesGeometry(material).getOutputByName(value) };
  if (name === '__world') return finalWorld(material);
  return helper(material, name, (full) => Object.assign(new InputBlock(full, undefined, type), { systemValue: value }));
}
// Links `from` into `to` unless it already is.
const wire = (from, to) => { if (to.connectedPoint !== from) { to.connectedPoint?.disconnectFrom(to); from.connectTo(to, true); } };
const transformed = (material, name, w) => helper(material, name, (full) => {
  const block = new TransformBlock(full);
  block.complementW = w;
  return block;
});
// Position times World, the world position Babylon's blocks take.
function worldPosition(material) {
  const block = transformed(material, '__worldPosition', 1);
  wire(geometryBlock(material, '__position').output, block.vector);
  wire(geometryBlock(material, '__world').output, block.transform);
  return block;
}

// Texture space of a mesh as BKE_mesh_texspace_calc makes it, from its geometry before modifiers: location and size.
const texspaces = new WeakMap();
function texspace(mesh) {
  const base = mesh?.metadata?.wbModifierBase ?? mesh;
  if (!base) return [[0, 0, 0], [1, 1, 1]];
  if (!texspaces.has(base)) {
    const positions = base.positions ?? base.getVerticesData?.('position') ?? [];
    const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < positions.length; i += 3) for (let k = 0; k < 3; k++) { min[k] = Math.min(min[k], positions[i + k]); max[k] = Math.max(max[k], positions[i + k]); }
    const axes = (v) => [v[0], v[2], v[1]];
    const location = positions.length ? axes(min.map((v, k) => (v + max[k]) / 2)) : [0, 0, 0];
    const size = positions.length ? axes(min.map((v, k) => (max[k] - v) / 2)).map((s) => (s === 0 ? 1 : s > 0 && s < 1e-5 ? 1e-5 : s)) : [1, 1, 1];
    texspaces.set(base, [location, size]);
  }
  return texspaces.get(base);
}

// Color ramp tables as textures (GPU_color_band), by table.
const rampTextures = new Map();
export function rampTexture(table, scene) {
  const key = table.join();
  if (!rampTextures.get(key)?.getScene?.()?.isDisposed && rampTextures.get(key)?.getScene() === scene) return rampTextures.get(key);
  const texture = new RawTexture(halfFloats(table), table.length / 4, 1, Constants.TEXTUREFORMAT_RGBA, scene, false, false, Texture.BILINEAR_SAMPLINGMODE, Constants.TEXTURETYPE_HALF_FLOAT);
  texture.wrapU = texture.wrapV = Texture.CLAMP_ADDRESSMODE;
  texture.metadata = { table };
  rampTextures.set(key, texture);
  return texture;
}

// A precomputed sky as the texture GPU_image_sky makes of it: one layer, filtered linearly, repeating around and
// extending at the poles.
const skyTextures = new Map();
function skyArrayTexture(sky, scene) {
  const key = `${scene.uid} ${sky.key}`;
  if (!skyTextures.has(key) || skyTextures.get(key).getScene() !== scene) {
    const texture = new RawTexture2DArray(sky.pixels, sky.width, sky.height, 1, Constants.TEXTUREFORMAT_RGBA, scene, false, false, Texture.BILINEAR_SAMPLINGMODE, Constants.TEXTURETYPE_FLOAT);
    Object.assign(texture, { wrapU: Texture.WRAP_ADDRESSMODE, wrapV: Texture.CLAMP_ADDRESSMODE });
    skyTextures.set(key, texture);
  }
  return skyTextures.get(key);
}

// What an Image without pixels yet samples (GPU_texture_create_error's pink, as Blender draws a missing image).
const empties = new WeakMap();
function emptyTexture(scene) {
  if (!empties.has(scene)) empties.set(scene, new RawTexture(new Uint8Array([255, 0, 255, 255]), 1, 1, Constants.TEXTUREFORMAT_RGBA, scene));
  return empties.get(scene);
}

const BLENDER = Symbol('blender');
export const isBlenderShader = (block) => !!block?.[BLENDER];

// A Blender node on a Babylon block class: its sockets the node's declaration (inputs read in the fragment shader),
// its code its steps, its geometry hidden inputs.
const blenderShader = (Base) => class extends Base {
  constructor(name, idname, ...args) {
    super(name, ...args);
    this[BLENDER] = true;
    this.idname = idname;
    this.declaration = declaration('shader', idname);
    Object.assign(this, defaults(this.declaration), { mute: false });
    for (const s of this.declaration.inputs) {
      const type = socketType(s.type)?.babylon;
      if (type === undefined) continue;
      this.registerInput(s.identifier, type, true, Targets.Fragment);
      Object.assign(this.getInputByName(s.identifier), { displayName: s.name, acceptedConnectionPointTypes: [...BABYLON_TYPES] });
    }
    for (const id of OUTPUT_VALUES[idname] ?? []) this.values['=' + id] = structuredClone(socketOf(this.declaration, '=' + id).default);
    for (const s of this.declaration.outputs) {
      const type = socketType(s.type)?.babylon;
      if (type === undefined) continue;
      this.registerOutput(s.identifier, type, Targets.Fragment);
      adaptOutput(Object.assign(this.getOutputByName(s.identifier), { displayName: s.name }), type, s.type);
    }
  }

  getClassName() { return this.idname; }
  // Babylon names an output's variable after the output, which can be one of its defines (UV1, a second UV output's).
  build(state, activeBlocks) {
    if (this._buildId !== state.sharedData.buildId) for (const output of this._outputs) output.associatedVariableName ||= state._getFreeVariableName(`bl_out_${output.name}`);
    return super.build(state, activeBlocks);
  }
  get availability() { return availability(this.declaration, this.properties, this.values); }
  // Whether a socket is the node's own, not one Bylonder links its geometry or Babylon's code through.
  declared(name) { return this.declaration.inputs.some((s) => s.identifier === name) || this.declaration.outputs.some((s) => s.identifier === name); }

  // The geometry its steps read, as hidden inputs read in the fragment shader (Babylon carries an attribute there as a
  // varying), linked to the material's geometry blocks.
  initialize(state) {
    super.initialize(state);
    const material = state.sharedData.nodeMaterial;
    this._world = !!material.blenderWorld;
    for (const name of geometryOf(this._steps())) wire(geometryBlock(material, name).output, this._geometryInput(name));
  }

  _geometryInput(name) {
    if (!this.getInputByName(name)) this.registerInput(name, geometrySpec(name)[2], true, Targets.Fragment);
    return this.getInputByName(name);
  }

  _steps() {
    return SHADER_NODES[this.idname]?.(this.properties, this.declaration, {
      connected: (id) => !!this.getInputByName(id)?.isConnected,
      linked: (id) => !!this.getOutputByName(id)?.hasEndpoints,
      image: () => (this.properties.image ? blendData().images.get(this.properties.image) ?? null : null),
      lobe: () => this.lobe ?? 0,
      world: () => !!this._world,
      value: (id) => this.values[id],
    }) ?? [];
  }

  // The GLSL of each socket's link, made when first used: a linked input converted to the socket's type, a menu as
  // its item, else the input's uniform; an output's once a step writes it; a value of the shaded point ('$name').
  _links(state) {
    if (this._built !== state.sharedData) Object.assign(this, { _built: state.sharedData, _uniforms: [], _textures: [], _meshUniforms: [] });
    const links = new Map();
    const input = (id) => {
      const s = socketOf(this.declaration, id), type = socketType(s.type), point = this.getInputByName(id);
      if (point?.isConnected) return convert(point.associatedVariableName, kindOf(point.connectedPoint.type), type.kind);
      if (s.type === 'MENU') return menuValue(s, this.values[id]);
      // Nothing (Closure(0)), which covers what is behind.
      if (s.type === 'SHADER') return glslValue(0, 'closure');
      const name = state._getFreeVariableName(glslIdentifier(id));
      state._emitUniformFromString(name, type.babylon);
      this._uniforms.push([name, id, type.kind]);
      return name;
    };
    const geometry = (name) => this._geometryInput(name).associatedVariableName;
    const declare = (prefix, type, value) => {
      const name = state._getFreeVariableName(prefix);
      state.compilationString += `${type} ${name} = ${value};\n`;
      return name;
    };
    const meshUniform = (id) => {
      const name = state._getFreeVariableName(glslIdentifier(id.slice(1)));
      state._emitUniformFromString(name, meshValue(id)[0]);
      this._meshUniforms.push([name, id]);
      return name;
    };
    // blender-port: eevee_surf_world.bsl.hh surf_world, eevee_attributes_world_lib.glsl attr_load_orco,
    // eevee_nodetree_lib.bsl.hh coordinate_camera, coordinate_reflect (MAT_GEOM_WORLD): a world's point is the direction
    // it is seen in, which the world's box gives as its position from its centre, the eye; its normal faces the eye.
    const worldPoint = {
      $P: () => declare('bl_P', 'vec3', `normalize(${geometry('__position')}.xzy)`),
      $N: () => declare('bl_N', 'vec3', `-${link('$P')}`),
      $orco: () => link('$P'), $object: () => link('$P'), $object_normal: () => link('$N'), $reflection: () => link('$N'), $uv: () => 'vec3(0.0)',
      $camera: () => declare('bl_camera', 'vec3', `normalize((${geometry('__view')} * vec4(${link('$P')}.xzy, 0.0)).xyz)`),
    };
    const point = (id) => {
      if (this._world && worldPoint[id]) return worldPoint[id]();
      if (meshValue(id)) return meshUniform(id);
      const position = () => geometry('__position'), world = () => geometry('__world');
      const worldPosition = () => `(${world()} * vec4(${position()}, 1.0))`;
      switch (id) {
        case '$P': return declare('bl_P', 'vec3', `${worldPosition()}.xzy`);
        case '$N': return declare('bl_N', 'vec3', `normalize((${world()} * vec4(${geometry('__normal')}, 0.0)).xyz).xzy`);
        case '$object': return declare('bl_object', 'vec3', `${position()}.xzy`);
        case '$object_normal': return declare('bl_object_normal', 'vec3', `normalize(${geometry('__normal')}).xzy`);
        case '$uv': return declare('bl_uv', 'vec3', `vec3(${geometry('__uv')}, 0.0)`);
        case '$camera_position': return `${geometry('__cameraPosition')}.xzy`;
        case '$camera': return declare('bl_camera', 'vec3', `(${geometry('__view')} * ${worldPosition()}).xyz`);
        case '$window': {
          const clip = declare('bl_clip', 'vec4', `${geometry('__viewProjection')} * ${worldPosition()}`);
          return declare('bl_window', 'vec3', `vec3(${clip}.xy / ${clip}.w * 0.5 + 0.5, 0.0)`);
        }
        case '$reflection': {
          const P = link('$P'), N = link('$N'), incident = `normalize(${geometry('__cameraPosition')}.xzy - ${P})`;
          return declare('bl_reflection', 'vec3', `-reflect(${incident}, ${N})`);
        }
        // Generated: the position in the mesh's texture space, from [-1, 1] to [0, 1] as the orco attribute is.
        case '$orco': return declare('bl_orco', 'vec3', `(${position()}.xzy - ${link('$texspace_location')}) / ${link('$texspace_size')} * 0.5 + 0.5`);
        // port-override: Blender evaluates the height again at offset positions (GPU_differentiate_float_function);
        // the height's screen derivatives stand for that, as Blender's GPU_FAST_DERIVATIVE path takes them.
        case '$height_xy': {
          const height = link('Height');
          return declare('bl_height_xy', 'vec2', `vec2(${height}) + ${link('Filter Width')} * vec2(dFdx(${height}), dFdy(${height}))`);
        }
        // A curve's values (none for a mesh), as the geometry block gives them.
        case '$is_strand': case '$hair_radius': case '$hair_curve_N': case '$hair_strand_id': case '$hair_intercept': case '$hair_length': return geometry(POINT[id][0]);
        default: {
          const [kind, name] = id.split(':');
          if (kind === '$attribute') return geometry(ATTRIBUTE + id.slice(kind.length + 1));
          if (kind === '$tangent') {
            state._emitFunction('bl_uv_tangent', STAND_INS.bl_uv_tangent, '');
            const uv = name ? link(attribute(name)) : link('$uv'), extracted = name ? 'vec4(0.0)' : geometry('__tangent');
            return declare('bl_tangent', 'vec4', `bl_uv_tangent(${extracted}, ${link('$model_inverse')}, ${link('$P')}, ${link('$N')}, ${uv}.xy)`);
          }
          throw Error(`${this.name}: no ${id}`);
        }
      }
    };
    const link = (id) => (links.has(id) || id.startsWith('@') ? links.get(id) : links.set(id, id.startsWith('$') ? point(id) : input(id)).get(id));
    return { get: link, set: (id, v) => links.set(id, v) };
  }

  // The node's steps compiled into the fragment shader; its outputs' variables written.
  _compile(state) {
    const links = this._links(state);
    if (this.mute) muteLinks(this.declaration, this.availability.inputs, links);
    else {
      const steps = this._steps();
      // Blender's hashes take 32 bit integers, which a fragment shader's default (mediump) need not be.
      state._emitFunction('bl_precision', 'precision highp int;\n', '');
      if ([...this.declaration.inputs, ...this.declaration.outputs].some((s) => s.type === 'SHADER')) state._emitFunction('bl_closure', STAND_INS.bl_closure, '');
      // Compiled before it is added: the values of the shaded point are declared as the steps first use them.
      const code = compileSteps(this.declaration, steps, links, {
        emit: (key, code) => {
          if (key === 'bl_g_data') state._emitUniformFromString(REVERSED_FACES, T.Float);
          state._emitFunction(key, code, '');
        },
        free: (prefix) => state._getFreeVariableName(prefix),
        sampler: ({ texture: table, image, sky, depth, ...sampling }) => {
          if (depth) {
            const name = state._getFreeVariableName('bl_depth'), scene = state.sharedData.scene;
            state._emit2DSampler(name, '', false, undefined, false, 'highp');
            readsSceneDepth(scene);
            this._textures.push([name, () => sceneDepth(scene)]);
            return name;
          }
          if (sky) {
            const name = state._getFreeVariableName('bl_sky');
            state._emit2DArraySampler(name);
            // Made as it is first bound: a texture array needs WebGL 2.
            const scene = state.sharedData.scene;
            this._textures.push([name, () => skyArrayTexture(sky, scene)]);
            return name;
          }
          const name = state._getFreeVariableName(table ? 'bl_table' : 'bl_image');
          state._emit2DSampler(name, '', false, undefined, false, 'highp');
          const scene = state.sharedData.scene;
          this._textures.push([name, table ? rampTexture(table, scene) : imageTexture(image, scene, { ...this.properties, ...sampling }) ?? emptyTexture(scene)]);
          return name;
        },
        functions: STAND_INS,
        pointKind: (id) => (/^\$(attribute|tangent|uniform_attribute):/.test(id) ? 'vec4' : id === '$uv' ? 'vec3' : undefined),
      });
      state.compilationString += code;
    }
    return links;
  }

  _writeOutputs(state, links) {
    for (const output of this.outputs) {
      if (!output.hasEndpoints || !this.declared(output.name)) continue;
      const kind = kindOfSocket(this.declaration, '@' + output.name), value = links.get('@' + output.name) ?? glslValue(0, kind);
      // A closure is a struct of Blender's (STAND_INS bl_closure), which links only to closures.
      if (kind === 'closure') state.compilationString += `${glslType(kind)} ${output.associatedVariableName} = ${value};\n`;
      else state.compilationString += `${state._declareOutput(output)} = ${convert(value, kind, kindOf(output.type))};\n`;
    }
  }

  _buildBlock(state) {
    super._buildBlock(state);
    if (state.shaderLanguage !== 0) throw Error(`${this.name}: Blender nodes build GLSL only`);
    if (state.target !== Targets.Fragment) return this;
    recordBuild(state, this, () => this._writeOutputs(state, this._compile(state)));
    if (!state.sharedData.bindableBlocks.includes(this)) state.sharedData.forcedBindableBlocks.push(this);
    // Babylon's material is ready when its blocks are: this one when its images are loaded (a world's probe bakes them).
    if (this._textures?.length && !state.sharedData.blockingBlocks.includes(this)) state.sharedData.blockingBlocks.push(this);
    return this;
  }

  isReady() {
    return (this._textures ?? []).every(([, texture]) => typeof texture === 'function' || texture.isReady());
  }

  bind(effect, nodeMaterial, mesh) {
    super.bind?.(effect, nodeMaterial, mesh);
    setUniforms(effect, this._uniforms ?? [], this.values);
    for (const [name, texture] of this._textures ?? []) effect.setTexture(name, typeof texture === 'function' ? texture() : texture);
    if (!mesh) return;
    for (const [name, id] of this._meshUniforms ?? []) {
      const [type, value] = meshValue(id), v = value(mesh, nodeMaterial.getScene());
      if (type === T.Matrix) effect.setMatrix(name, v);
      else if (type === T.Vector3) effect.setFloat3(name, ...v);
      else if (type === T.Float) effect.setFloat(name, v);
      else effect.setFloat4(name, ...v);
    }
  }

  serialize() {
    return { ...super.serialize(), blender: { properties: this.properties, values: this.values, mute: this.mute } };
  }

  _deserialize(serialized, scene, rootUrl) {
    super._deserialize(serialized, scene, rootUrl);
    const { properties, values, mute } = serialized.blender ?? {};
    Object.assign(this.properties, structuredClone(properties ?? {}));
    Object.assign(this.values, values);
    this.mute = !!mute;
  }
};

// What a Blender node's build wrote into the fragment shader, kept for an export that writes the material's Blender
// nodes as one of Babylon's CustomBlocks (io_scene_babylon/node-material-export.js): its code, in build order, the
// functions it emitted, and the variable it read each of its inputs from.
let builds = 0;
function recordBuild(state, block, build) {
  const emit = state._emitFunction, functions = [], start = state.compilationString.length;
  state._emitFunction = (key, code, comments) => { functions.push([key, code]); return emit.call(state, key, code, comments); };
  try { build(); } finally { delete state._emitFunction; }
  block.built = { shared: state.sharedData, order: builds++, code: state.compilationString.slice(start), functions,
    inputs: block.inputs.filter((input) => input.isConnected).map((input) => [input, input.associatedVariableName]) };
}

export class BlenderShaderBlock extends blenderShader(NodeMaterialBlock) {
  constructor(name, idname) {
    super(name, idname, Targets.Neutral);
    if (idname === 'ShaderNodeValToRGB') this.properties.color_ramp ??= defaultColorRamp();
    if (CURVE_MAPPINGS[idname]) this.properties.mapping ??= defaultCurveMapping(...CURVE_MAPPINGS[idname]);
  }
}

// Babylon's reflection block writes its code only when the scene has an environment at build time, while its defines
// follow the scene's: it keeps the environment it was built with, and the material builds again when the scene's
// changes (Material Preview), so code and defines agree.
const ENVIRONMENT = Symbol('environment');
function environmentOf(material) {
  const scene = material.getScene();
  if (!material[ENVIRONMENT]) {
    const observer = scene.onEnvironmentTextureChangedObservable.add(() => {
      if (scene.environmentTexture !== material[ENVIRONMENT].texture) buildMaterial(material);
    });
    material[ENVIRONMENT] = {};
    material.onDisposeObservable.addOnce(() => scene.onEnvironmentTextureChangedObservable.remove(observer));
  }
  material[ENVIRONMENT].texture = scene.environmentTexture;
  return () => material[ENVIRONMENT].texture;
}

// A material's surface closure lit once by Babylon's PBR block, as EEVEE lights the closures a material gathers: the
// block's inputs are the closure's colors and parameters in proportion to their weights, its reflection Babylon's
// environment, and a transmission Babylon's refraction of that environment. Its radiance is what the lit part reflects
// as it weighs, plus the emission, over the coverage the transparency leaves.
const LOBE = {
  baseColor: (c, k) => `bl_lobe_color(bl_closure_lobe(${c}, ${k}))`, metallic: () => '1.0', roughness: (c, k) => `bl_lobe_roughness(bl_closure_lobe(${c}, ${k}))`,
  indexOfRefraction: () => '1.5',
};
const SURFACE = {
  baseColor: (c) => `bl_closure_base_color(${c})`, metallic: (c) => `bl_closure_metallic(${c})`, roughness: (c) => `bl_closure_parameter(${c}, ${c}.roughness, 0.5)`,
  indexOfRefraction: (c) => `bl_closure_parameter(${c}, ${c}.ior, 1.5)`,
};
const REFRACTION = {
  'subsurface.tintColor': (c) => `bl_closure_transmission_tint(${c})`,
  'refraction.intensity': (c) => `bl_closure_transmission(${c})`, 'refraction.volumeIndexOfRefraction': (c) => `bl_closure_parameter(${c}, ${c}.ior, 1.5)`,
};
const AREA_LIGHT_SAMPLERS = ['areaLightsLTC1Sampler', 'areaLightsLTC2Sampler'];
export class BlenderSurfaceBlock extends PBRMetallicRoughnessBlock {
  // lobe: 0 for the base, else the reflection lobe it lights over the radiance of the surface before it (`under`).
  constructor(name, lobe = 0) {
    super(name);
    this.lobe = lobe;
    this.registerInput('closure', T.Color4, false, Targets.Fragment);
    this.registerInput('under', T.Color4, true, Targets.Fragment);
    this.registerOutput('radiance', T.Color4, Targets.Fragment);
    this.metallic.isOptional = this.roughness.isOptional = true;
    // Blender's coverage scales the whole closure; Babylon's would keep reflections opaque.
    this.useRadianceOverAlpha = this.useSpecularOverAlpha = false;
    // EEVEE's diffuse is Lambert's, where Babylon's block defaults to Oren-Nayar.
    this.baseDiffuseModel = Constants.MATERIAL_DIFFUSE_MODEL_LAMBERT;
    this._helpers = {};
  }

  getClassName() { return 'BlenderSurfaceBlock'; }
  // Babylon's PBR block lists each light's samplers but not the area lights' LTC tables (its LightBlock does): unlisted,
  // they stay on texture unit 0, which a point light's cube shadow map also takes, and every draw fails.
  updateUniformsAndSamples(state, nodeMaterial, defines, uniformBuffers) {
    super.updateUniformsAndSamples(state, nodeMaterial, defines, uniformBuffers);
    for (const name of AREA_LIGHT_SAMPLERS) if (!state.samplers.includes(name)) state.samplers.push(name);
  }
  // A reset of the material's defines clears the area light support NodeMaterialDefines starts with, while the lights'
  // own defines come back: their code then calls area light functions its includes left out. So does a light turned into
  // an area light without AREALIGHTUSED (light/area-specular.js BlenderAreaLightsPlugin).
  prepareDefines(defines, nodeMaterial, mesh) {
    super.prepareDefines(defines, nodeMaterial, mesh);
    defines.setValue('AREALIGHTSUPPORTED', true, true);
    defines.setValue('AREALIGHTNOROUGHTNESS', true, true);
    defines.setValue('AREALIGHTUSED', usesAreaLights(mesh, nodeMaterial), true);
  }
  serialize() { return { ...super.serialize(), lobe: this.lobe }; }
  _deserialize(serializationObject, scene, rootUrl) { super._deserialize(serializationObject, scene, rootUrl); this.lobe = serializationObject.lobe ?? 0; }
  get closure() { return this.getInputByName('closure'); }
  get under() { return this.getInputByName('under'); }
  get radiance() { return this.getOutputByName('radiance'); }

  // A PBR input (or a helper block's, 'subsurface.tintColor') given from the closure: connected while it holds a value.
  _point(path) {
    const [owner, name] = path.includes('.') ? [this._helpers[path.split('.')[0]], path.split('.')[1]] : [this, path];
    const point = owner[name];
    if (!Object.hasOwn(point, 'isConnected')) Object.defineProperty(point, 'isConnected', { get: () => !!point._blenderValue || !!point.connectedPoint });
    return point;
  }
  get _values() {
    if (this.lobe) return Object.fromEntries(Object.entries(LOBE).map(([path, value]) => [path, (c) => value(c, this.lobe)]));
    return { ...SURFACE, ...(this._helpers.refraction && REFRACTION) };
  }

  initialize(state) {
    super.initialize(state);
    const material = state.sharedData.nodeMaterial;
    if (!this.lobe && !this.scoped && closureHas(this.closure.connectedPoint?.ownerBlock, transmits)) this._refraction(material);
    for (const path of Object.keys(this._values)) this._point(path)._blenderValue = null;
    const position = geometryBlock(material, '__position'), world = geometryBlock(material, '__world');
    wire(worldPosition(material).output, this.worldPosition);
    // In the fragment stage, where the normal is shaded (a strand's: curves.js CurvesNormalBlock).
    const normal = Object.assign(transformed(material, '__worldNormal', 0), { target: Targets.Fragment });
    wire(geometryBlock(material, '__normal').output, normal.vector);
    wire(world.output, normal.transform);
    wire(normal.output, this.worldNormal);
    wire(geometryBlock(material, '__view').output, this.view);
    // The lobes are lit on their own with EEVEE Parity (eevee-parity.js), else merged into the base, as Babylon's PBR.
    this._merged = !this.lobe && (this.scoped || !eeveeParity(material.getScene()));
    if (this._merged) wire(geometryBlock(material, '__cameraPosition').output, this.cameraPosition);
    else {
      const eye = helper(material, '__viewEye', (name) => new BlenderViewEyeBlock(name));
      wire(worldPosition(material).output, eye.position);
      wire(geometryBlock(material, '__cameraPosition').output, eye.eye);
      wire(eye.output, this.cameraPosition);
    }
    // A reflection block of its own: Babylon's names the uniforms it binds anew for each PBR block that reads it.
    const reflection = helper(material, this.lobe ? `__reflection lobe ${this.lobe}` : this.scoped ? `__reflection ${this.uniqueId}` : '__reflection', (name) => new ReflectionBlock(name));
    reflection._getTexture = environmentOf(material);
    wire(position.output, reflection.position);
    wire(world.output, reflection.world);
    wire(reflection.reflection, this.reflection);
    const shading = Object.assign(helper(material, `__shadingNormal ${this.uniqueId}`, (name) => new BlenderClosureNormalBlock(name)), { lobe: this.lobe, merged: this._merged });
    wire(this.closure.connectedPoint, shading.closure);
    wire(shading.output, this.perturbedNormal);
  }

  // Babylon's sub-surface block refracting the environment, as the reflection reflects it.
  _refraction(material) {
    const subsurface = this._helpers.subsurface = helper(material, '__subsurface', (name) => new SubSurfaceBlock(name));
    const refraction = this._helpers.refraction = helper(material, '__refraction', (name) => new RefractionBlock(name));
    refraction._getTexture = environmentOf(material);
    // Given at this block's build, after theirs.
    refraction.intensity.isOptional = true;
    // blender-port: eevee_deferred_eval.bsl.hh: light through a surface of some thickness is tinted by the color squared,
    // in and out. Babylon tints by the tint to the power of thickness over its distance (1), so a thickness of 2.
    const thickness = helper(material, '__thickness', (name) => Object.assign(new InputBlock(name, Targets.Fragment, T.Float), { value: 2, isConstant: true }));
    wire(thickness.output, subsurface.thickness);
    wire(refraction.refraction, subsurface.refraction);
    wire(subsurface.subsurface, this.subsurface);
  }

  _buildBlock(state) {
    if (state.target !== Targets.Fragment) return this.lobe || this.scoped ? this._scoped(state, () => super._buildBlock(state)) : super._buildBlock(state);
    state._emitFunction('bl_closure', STAND_INS.bl_closure, '');
    let closure = this.closure.associatedVariableName;
    if (this._merged) {
      closure = state._getFreeVariableName('merged');
      state.compilationString += `BlClosure ${closure} = bl_closure_merge_lobes(${this.closure.associatedVariableName});\n`;
    }
    for (const [path, value] of Object.entries(this._values)) Object.assign(this._point(path), { _blenderValue: value(closure), associatedVariableName: value(closure) });
    if (!this.lobe) {
      const build = () => { const start = state.compilationString.length; super._buildBlock(state); this._dielectricReflectance(state, start, closure); };
      let lit = 'finalColor.rgb';
      if (this.scoped) {
        lit = state._getFreeVariableName('closureLit');
        state.compilationString += `vec3 ${lit};\n`;
        this._scoped(state, build, `${lit} = finalColor.rgb;\n`);
      } else build();
      state.compilationString += `${state._declareOutput(this.radiance)} = bl_closure_radiance(${closure}, ${lit});\n`;
      return this._areaSpecular(state);
    }
    const lit = state._getFreeVariableName('lobeLit');
    state.compilationString += `vec3 ${lit};\n`;
    this._scoped(state, () => super._buildBlock(state), `${lit} = finalColor.rgb;\n`);
    state.compilationString += `${state._declareOutput(this.radiance)} = ${this.under.associatedVariableName} + vec4(${lit} * bl_closure_lobe(${closure}, ${this.lobe}).weight, 0.0);\n`;
    return this._areaSpecular(state);
  }

  // The light specular of the lighting Babylon's block emitted, as EEVEE's
  // (blenkernel/light/area-specular.js): the include's text with the formula put right, in its place.
  _areaSpecular(state) {
    const key = 'pbrDirectLightingFunctions', store = ShaderStore.GetIncludesShadersStore(state.shaderLanguage);
    if (state.functions[key]?.includes(`#include<${key}>`)) state.functions[key] = store[key].replace(AREA_SPECULAR.search, AREA_SPECULAR.replace);
    // Its area light function marked for inlining on WebGPU (AREA_PRE_LIGHTING).
    const setup = 'pbrDirectLightingSetupFunctions';
    if (state.sharedData.scene.getEngine().isWebGPU && state.functions[setup]?.includes(`#include<${setup}>`)) state.functions[setup] = store[setup].replace(AREA_PRE_LIGHTING.search, AREA_PRE_LIGHTING.replace);
    // The lights' specular color (LIGHT_SPECULAR), in code emitted inline and in an include of the lights of its own name.
    store[LIGHT_FRAGMENT] ??= store.lightFragment.replace(LIGHT_SPECULAR.search, LIGHT_SPECULAR.replace);
    state.compilationString = state.compilationString.replaceAll('#include<lightFragment>', `#include<${LIGHT_FRAGMENT}>`).replace(LIGHT_SPECULAR.search, LIGHT_SPECULAR.replace);
    return this;
  }

  // blender-port: eevee_nodetree_lib.bsl.hh bsdf_lut: a dielectric reflects F0 from its IOR at normal incidence and F90
  // rising with it (full from IOR 1.33). Babylon's block takes F0 from a constant IOR and F90 from a material-wide
  // factor, so the closure's IOR sets both per pixel: F0 over F90 as the reflectivity, F90 as the specular weight.
  _dielectricReflectance(state, start, closure) {
    const f = state._getFreeVariableName('bl_f'), f90 = state._getFreeVariableName('bl_f90'), factors = this._vMetallicReflectanceFactorsName;
    const code = state.compilationString.slice(start)
      .replace(/(vReflectivityColor\s*=\s*vec4\([^;]*,)\s*[-0-9.e]+\);/, `$1 ${f} * ${f} / max(${f90}, 1e-6));`)
      .replaceAll(factors, `vec4(${factors}.rgb, ${f90})`);
    const ior = `bl_closure_parameter(${closure}, ${closure}.ior, 1.5)`;
    state.compilationString = `${state.compilationString.slice(0, start)}float ${f} = (${ior} - 1.0) / (${ior} + 1.0);\n`
      + `float ${f90} = clamp(2.33 / 0.33 * ${f}, 0.0, 1.0);\n${code}`;
  }

  // Babylon's PBR code declares fixed names: a second one runs in a scope of its own.
  _scoped(state, build, end = '') {
    const start = state.compilationString.length, temps = state.sharedData.temps.length;
    build();
    // What the scope declared is not declared after it.
    state.sharedData.temps.length = temps;
    state.compilationString = `${state.compilationString.slice(0, start)}{\n${state.compilationString.slice(start)}${end}}\n`;
    return this;
  }
}
RegisterClass('BABYLON.BlenderSurfaceBlock', BlenderSurfaceBlock);

// The eye Babylon's lighting reads at the shaded point (draw-view.js viewEye), global as Babylon's camera position is:
// its reflection reads it in a function of its own.
export class BlenderViewEyeBlock extends NodeMaterialBlock {
  constructor(name) {
    super(name, Targets.Fragment);
    this.registerInput('position', T.Vector4);
    this.registerInput('eye', T.Vector3);
    this.registerOutput('output', T.Vector3);
  }
  getClassName() { return 'BlenderViewEyeBlock'; }
  get position() { return this._inputs[0]; }
  get eye() { return this._inputs[1]; }
  get output() { return this._outputs[0]; }
  bind(effect, nodeMaterial) { effect.setVector4(this._forward, viewForward(nodeMaterial.getScene().activeCamera)); }
  _buildBlock(state) {
    super._buildBlock(state);
    this._forward = state._getFreeVariableName(VIEW_FORWARD);
    state._emitUniformFromString(this._forward, T.Vector4);
    state._emitFunction('blViewEye', 'vec3 blViewEye;\n', '');
    state.sharedData.bindableBlocks.push(this);
    state.compilationString += `blViewEye = ${viewEye(`${this.position.associatedVariableName}.xyz`, this.eye.associatedVariableName, this._forward)};\n`;
    this.output.associatedVariableName = 'blViewEye';
    return this;
  }
}
RegisterClass('BABYLON.BlenderViewEyeBlock', BlenderViewEyeBlock);

// A closure's normal, its base's or a lobe's reflections' as they weigh, as Babylon's shading normal (in its axes, w 0).
export class BlenderClosureNormalBlock extends NodeMaterialBlock {
  constructor(name) {
    super(name, Targets.Fragment);
    this.lobe = 0;
    this.merged = false;
    this.registerInput('closure', T.Color4);
    this.registerOutput('output', T.Vector4);
  }
  getClassName() { return 'BlenderClosureNormalBlock'; }
  get closure() { return this._inputs[0]; }
  get output() { return this._outputs[0]; }
  _buildBlock(state) {
    super._buildBlock(state);
    state._emitFunction('bl_closure', STAND_INS.bl_closure, '');
    const closure = this.merged ? `bl_closure_merge_lobes(${this.closure.associatedVariableName})` : this.closure.associatedVariableName;
    const normal = this.lobe ? `bl_lobe_normal(bl_closure_lobe(${closure}, ${this.lobe}))` : `bl_closure_normal(${closure})`;
    state.compilationString += `${state._declareOutput(this.output)} = vec4(${normal}.xzy, 0.0);\n`;
    return this;
  }
}
RegisterClass('BABYLON.BlenderClosureNormalBlock', BlenderClosureNormalBlock);
// Whether a closure's nodes are one that `is` tells: one that reflects light (a BSDF), one that transmits it (a Glass or
// Refraction BSDF, a Principled BSDF's transmission).
// Shader to RGB's closure is lit where it is: its output is a color, not the closure's.
const closureEnds = (block) => block.idname === 'ShaderNodeShaderToRGB';
function closureHas(block, is, seen = new Set()) {
  if (!block || seen.has(block) || closureEnds(block)) return false;
  seen.add(block);
  return is(block) || block.inputs.some((input) => closureHas(input.connectedPoint?.ownerBlock, is, seen));
}
const transparent = (block) => block.idname === 'ShaderNodeBsdfTransparent'
  || (block.idname === 'ShaderNodeBsdfPrincipled' && (block.getInputByName('Alpha').isConnected || block.values.Alpha < 1));
const reflects = (block) => /^ShaderNodeBsdf(?!Transparent)|^ShaderNodeSubsurfaceScattering$/.test(block.idname);
const REFLECTION_ONLY = ['ShaderNodeBsdfGlossy', 'ShaderNodeBsdfAnisotropic', 'ShaderNodeBsdfMetallic'];
// The blocks of a closure's nodes, each once, from the output up.
function closureBlocks(block, seen = new Set()) {
  if (!block || seen.has(block) || closureEnds(block)) return [];
  seen.add(block);
  return [block, ...block.inputs.flatMap((input) => closureBlocks(input.connectedPoint?.ownerBlock, seen))];
}
// blender-port: eevee_nodetree_lib.bsl.hh closure_eval, gpu_material.cc GPU_material_flag_set: EEVEE's bins, a base one
// and two of reflection; the reflection BSDFs take the reflection bins in turn, the base's when nothing else is there,
// and the last bin's beyond. Returns the lobes in use past the base.
function assignLobes(closure) {
  const blocks = closureBlocks(closure), reflections = blocks.filter((b) => REFLECTION_ONLY.includes(b.idname));
  const base = blocks.some((b) => reflects(b) && !REFLECTION_ONLY.includes(b.idname));
  reflections.forEach((block, i) => { block.lobe = Math.min(base ? i + 1 : i, 2); });
  return [...new Set(reflections.map((b) => b.lobe))].filter(Boolean);
}
const transmits = (block) => ['ShaderNodeBsdfGlass', 'ShaderNodeBsdfRefraction'].includes(block.idname) || (block.idname === 'ShaderNodeBsdfPrincipled'
  && (block.getInputByName('Transmission Weight').isConnected || block.values['Transmission Weight'] > 0));

// Shader to RGB (node_shader_shader_to_rgb.cc, EEVEE's closure_to_rgba): the closure lit where the node is, by a
// surface block of its own (Babylon's PBR lighting, in a scope of its own), its radiance the Color and its coverage the
// Alpha.
export class ShaderNodeShaderToRGB extends blenderShader(NodeMaterialBlock) {
  constructor(name) {
    super(name || 'Shader to RGB', 'ShaderNodeShaderToRGB', Targets.Neutral);
    this.registerInput('__lit', T.Color4, true, Targets.Fragment);
  }

  initialize(state) {
    super.initialize(state);
    const closure = this.getInputByName('Shader').connectedPoint, lit = this.getInputByName('__lit');
    if (!closure) return lit.connectedPoint?.disconnectFrom(lit);
    const material = state.sharedData.nodeMaterial;
    const surface = helper(material, `__shaderToRGB ${this.uniqueId}`, (name) => Object.assign(new BlenderSurfaceBlock(name), { scoped: true }));
    wire(closure, surface.closure);
    wire(surface.radiance, lit);
  }

  _compile(state) {
    const links = this._links(state), lit = this.getInputByName('__lit');
    const radiance = lit.isConnected ? lit.associatedVariableName : 'vec4(0.0)';
    links.set('@Color', radiance);
    links.set('@Alpha', `${radiance}.a`);
    return links;
  }
}

// A closure that reflects nothing (emission, transparency) as its radiance, without lighting.
export class BlenderUnlitSurfaceBlock extends NodeMaterialBlock {
  constructor(name) {
    super(name, Targets.Fragment);
    this.registerInput('closure', T.Color4);
    this.registerOutput('radiance', T.Color4);
  }
  getClassName() { return 'BlenderUnlitSurfaceBlock'; }
  get closure() { return this._inputs[0]; }
  get radiance() { return this._outputs[0]; }
  _buildBlock(state) {
    super._buildBlock(state);
    state._emitFunction('bl_closure', STAND_INS.bl_closure, '');
    state.compilationString += `${state._declareOutput(this.radiance)} = bl_closure_radiance(${this.closure.associatedVariableName}, vec3(0.0));\n`;
    return this;
  }
}
RegisterClass('BABYLON.BlenderUnlitSurfaceBlock', BlenderUnlitSurfaceBlock);

// Babylon's image processing of a material's scene linear color, as its display shows it: every block before it (the
// surface's PBR block among them) keeps colors linear, as with image processing by post-process, and this block
// applies the scene's (its exposure and tone mapping, then the encoding to the display's sRGB), unless a post-process
// does. Babylon's own block encodes only when one of its effects is on, and its PBR block encodes within.
export class BlenderDisplayBlock extends ImageProcessingBlock {
  constructor(name) {
    super(name);
    this.convertInputToLinearSpace = false;
    this.registerOutput('displayRgba', T.Color4);
    this.registerOutput('displayRgb', T.Color3);
  }
  getClassName() { return 'BlenderDisplayBlock'; }

  bind(effect, nodeMaterial, mesh) {
    super.bind(effect, nodeMaterial, mesh);
    if (mesh) askForAttributes(nodeMaterial, mesh);
  }

  prepareDefines(defines, nodeMaterial) {
    super.prepareDefines(defines, nodeMaterial);
    const ip = nodeMaterial.imageProcessingConfiguration;
    defines.setValue(this._displayDefine, !!ip?.isEnabled && !ip.applyByPostProcess, true);
    defines.setValue('IMAGEPROCESSINGPOSTPROCESS', true, true);
  }

  _buildBlock(state) {
    super._buildBlock(state);
    this._displayDefine = state._getFreeDefineName('BL_DISPLAY');
    const [rgba, rgb] = [this.getOutputByName('displayRgba'), this.getOutputByName('displayRgb')];
    state.compilationString += `${state._declareOutput(rgba)} = ${this.output.associatedVariableName};\n#ifdef ${this._displayDefine}\n`
      + `${rgba.associatedVariableName} = applyImageProcessing(${rgba.associatedVariableName});\n#endif\n`
      + `${state._declareOutput(rgb)} = ${rgba.associatedVariableName}.rgb;\n`;
    return this;
  }
}
RegisterClass('BABYLON.BlenderDisplayBlock', BlenderDisplayBlock);

const LIGHT_FRAGMENT = 'blenderLightFragment';
const REVERSED_FACES = 'bl_reversed_faces', DITHERED = 'BL_DITHERED', DITHER_OFFSET = 'bl_dither_offset', frontPass = new WeakSet();
// Material Output (node_shader_output_material.cc) as Babylon's fragment output: the Surface closure's radiance through
// Babylon's image processing, as the material's color. A material it is added to gets the vertex output Babylon needs.
export class ShaderNodeOutputMaterial extends blenderShader(FragmentOutputBlock) {
  constructor(name, idname = 'ShaderNodeOutputMaterial') {
    super(name || 'Material Output', idname);
    // The surface's world position, which a Dithered surface's hash reads.
    this.registerInput('blPosition', T.Vector4, true, Targets.Fragment);
  }

  // Babylon draws a separate culling pass's back faces first, their winding reversed, then its front faces.
  bind(effect, nodeMaterial, mesh) {
    super.bind(effect, nodeMaterial, mesh);
    const separate = nodeMaterial.separateCullingPass && !nodeMaterial.backFaceCulling;
    effect.setFloat(REVERSED_FACES, separate ? 1 : 0);
    effect.setFloat(DITHER_OFFSET, ditherOffset(nodeMaterial.getScene()));
    if (!separate || !mesh || frontPass.has(mesh)) return;
    frontPass.add(mesh);
    mesh.onBetweenPassObservable.add((subMesh) => subMesh.effect?.setFloat(REVERSED_FACES, 0));
  }

  attach(material) {
    material.addOutputNode(this);
    const clipPlanes = helper(material, '__clipPlanes', (name) => new ClipPlanesBlock(name));
    wire(worldPosition(material).output, clipPlanes.worldPosition);
    if (!material._vertexOutputNodes.includes(clipPlanes)) material.addOutputNode(clipPlanes);
    if (material._vertexOutputNodes.some((block) => block instanceof VertexOutputBlock)) return;
    const projection = helper(material, '__projection', (name) => new TransformBlock(name));
    wire(worldPosition(material).output, projection.vector);
    wire(geometryBlock(material, '__viewProjection').output, projection.transform);
    const output = helper(material, '__vertexOutput', (name) => new VertexOutputBlock(name));
    wire(projection.output, output.vector);
    material.addOutputNode(output);
  }

  initialize(state) {
    super.initialize(state);
    const material = state.sharedData.nodeMaterial;
    material.alphaMode = Constants.ALPHA_PREMULTIPLIED_PORTERDUFF;
    const closure = this.getInputByName('Surface').connectedPoint;
    // A blended surface's back faces drawn before its front ones, as EEVEE draws its transparency overlap.
    material.separateCullingPass = true;
    const processing = helper(material, `__display ${this.uniqueId}`, (name) => new BlenderDisplayBlock(name));
    if (closure) {
      const lit = closureHas(closure.ownerBlock, reflects), Surface = lit ? BlenderSurfaceBlock : BlenderUnlitSurfaceBlock;
      let surface = helper(material, `__${lit ? 'surface' : 'unlit'} ${this.uniqueId}`, (name) => new Surface(name));
      wire(closure, surface.closure);
      const lobes = lit ? assignLobes(closure.ownerBlock) : [];
      for (const lobe of eeveeParity(material.getScene()) ? lobes : []) {
        const under = surface;
        surface = helper(material, `__surface ${this.uniqueId} lobe ${lobe}`, (name) => new BlenderSurfaceBlock(name, lobe));
        wire(closure, surface.closure);
        wire(under.radiance, surface.under);
      }
      wire(fogged(material, surface.radiance), processing.color);
    } else wire(helper(material, '__black', (name) => Object.assign(new InputBlock(name, undefined, T.Color4), { value: new Color4(0, 0, 0, 1) })).output, processing.color);
    // Its coverage where the closure lets light through (blended), else its color alone (opaque, unless its Blend Mode
    // blends it).
    material.blenderDithered = closureHas(closure?.ownerBlock, transparent);
    const position = this.getInputByName('blPosition');
    if (material.blenderDithered) wire(worldPosition(material).output, position);
    else position.connectedPoint?.disconnectFrom(position);
    // EEVEE draws no surface for a Volume without a Surface (draw/volumes.js draws its volume).
    material.blenderNoSurface = this._noSurface = !closure && !!this.blenderVolume;
    // EEVEE's transparent shadows: a Dithered surface's shadow is hashed per sample as the surface is, so its samples
    // average a shadow as dense as its coverage. Babylon's shadow maps draw it with the material's own shader.
    // Babylon's shadow includes name the world position worldPos; the material's own shader names it as its block did in
    // the last build, whose shader a depth program is made from while the next build runs.
    if (material.blenderDithered && !material.shadowDepthWrapper) {
      let worldPos;
      material.onBuildObservable.add(() => { worldPos = worldPosition(material).output.associatedVariableName; });
      material.shadowDepthWrapper = new SharedShadowDepthWrapper(material, material.getScene(), { get remappedVariables() { return ['worldPos', worldPos]; } });
    }
    const [from, to, other] = material.blenderDithered ? [processing.getOutputByName('displayRgba'), this.rgba, this.rgb]
      : [processing.getOutputByName('displayRgb'), this.rgb, this.rgba];
    other.connectedPoint?.disconnectFrom(other);
    wire(from, to);
  }

  // A Dithered surface (EEVEE's default render method) keeps no depth where it is fully transparent: EEVEE's hashed
  // transparency discards it there. A Blended one writes no depth at all (its material's disableDepthWrite).
  prepareDefines(defines, nodeMaterial, ...rest) {
    super.prepareDefines(defines, nodeMaterial, ...rest);
    defines.setValue(DITHERED, nodeMaterial.transparencyMode == null, true);
  }

  _buildBlock(state) {
    if (!state.sharedData.bindableBlocks.includes(this) && !state.sharedData.forcedBindableBlocks.includes(this)) state.sharedData.forcedBindableBlocks.push(this);
    FragmentOutputBlock.prototype._buildBlock.call(this, state);
    if (this.rgba.isConnected) {
      // Hashed: kept where its coverage passes the sample's noise, its color then the surface's alone.
      state._emitUniformFromString(DITHER_OFFSET, T.Float);
      for (const [name, glsl] of DITHER_FUNCTIONS) state._emitFunction(name, glsl, '');
      const rgba = this.rgba.associatedVariableName;
      state.compilationString += `#ifdef ${DITHERED}
if (${rgba}.a <= bl_dither(${this.getInputByName('blPosition').associatedVariableName}.xyz, ${DITHER_OFFSET})) discard;
gl_FragColor = vec4(gl_FragColor.rgb / ${rgba}.a, 1.0);
#endif
`;
    }
    if (this._noSurface) state.compilationString += 'discard;\n';
    return this;
  }
}

// blender-port: eevee_lightprobe_sphere_bake.bsl.hh, eevee_colorspace_lib.bsl.hh brightness_clamp_max: the world probe
// keeps the world's light up to its Sun Threshold (EEVEE lights the rest as a sun) and the scene's indirect light clamp;
// the view sees the world unclamped. The material's limits (blenderProbeClamp: sun, indirect) are its world's; 0 is none.
export class BlenderWorldProbeClampBlock extends NodeMaterialBlock {
  constructor(name) {
    super(name, Targets.Fragment);
    this.registerInput('radiance', T.Color4);
    this.registerOutput('output', T.Color4);
  }
  getClassName() { return 'BlenderWorldProbeClampBlock'; }
  get radiance() { return this._inputs[0]; }
  get output() { return this._outputs[0]; }
  bind(effect, nodeMaterial, mesh) {
    const limit = (value) => (value > 0 ? value : 1e20), [sun = 0, indirect = 0] = nodeMaterial.blenderProbeClamp ?? [];
    effect.setFloat3(this._limits, mesh ? meshValue('$ray_type')[1](mesh) : RAY_TYPE.CAMERA, limit(sun), limit(indirect));
  }
  _buildBlock(state) {
    super._buildBlock(state);
    this._limits = state._getFreeVariableName('bl_probe_limits');
    state._emitUniformFromString(this._limits, T.Vector3);
    state._emitFunction('bl_brightness_clamp_max', 'vec3 bl_brightness_clamp_max(vec3 color, float limit) { return color * clamp(limit / max(1e-8, max(max(abs(color.r), abs(color.g)), abs(color.b))), 0.0, 1.0); }\n', '');
    const radiance = this.radiance.associatedVariableName, limits = this._limits;
    state.compilationString += `${state._declareOutput(this.output)} = ${limits}.x == ${RAY_TYPE.CAMERA}.0 ? ${radiance} : vec4(bl_brightness_clamp_max(bl_brightness_clamp_max(${radiance}.rgb, ${limits}.y), ${limits}.z), ${radiance}.a);\n`;
    state.sharedData.bindableBlocks.push(this);
    return this;
  }
}
RegisterClass('BABYLON.BlenderWorldProbeClampBlock', BlenderWorldProbeClampBlock);

// A world's box at the far plane: behind all the view draws, whatever its clip end.
export class BlenderFarPlaneBlock extends NodeMaterialBlock {
  constructor(name) {
    super(name, Targets.Vertex);
    this.registerInput('vector', T.Vector4);
    this.registerOutput('output', T.Vector4);
  }
  getClassName() { return 'BlenderFarPlaneBlock'; }
  get vector() { return this._inputs[0]; }
  get output() { return this._outputs[0]; }
  _buildBlock(state) {
    super._buildBlock(state);
    const v = this.vector.associatedVariableName;
    state.compilationString += `${state._declareOutput(this.output)} = vec4(${v}.xy, ${v}.w * 0.99999, ${v}.w);
`;
    return this;
  }
}
RegisterClass('BABYLON.BlenderFarPlaneBlock', BlenderFarPlaneBlock);

// World Output (node_shader_output_world.cc) as Babylon's fragment output: the Surface closure's emission, opaque, as
// EEVEE draws a world (eevee_surf_world.bsl.hh), through Babylon's image processing. Its material draws the world's box
// (world-babylon.js), behind everything.
export class ShaderNodeOutputWorld extends ShaderNodeOutputMaterial {
  constructor(name) {
    super(name || 'World Output', 'ShaderNodeOutputWorld');
  }

  attach(material) {
    material.addOutputNode(this);
    if (material._vertexOutputNodes.some((block) => block instanceof VertexOutputBlock)) return;
    const projection = helper(material, '__projection', (name) => new TransformBlock(name)), far = helper(material, '__farPlane', (name) => new BlenderFarPlaneBlock(name));
    wire(worldPosition(material).output, projection.vector);
    wire(geometryBlock(material, '__viewProjection').output, projection.transform);
    wire(projection.output, far.vector);
    const output = helper(material, '__vertexOutput', (name) => new VertexOutputBlock(name));
    wire(far.output, output.vector);
    material.addOutputNode(output);
  }

  initialize(state) {
    FragmentOutputBlock.prototype.initialize.call(this, state);
    const material = state.sharedData.nodeMaterial, closure = this.getInputByName('Surface').connectedPoint;
    Object.assign(material, { alphaMode: Constants.ALPHA_DISABLE, backFaceCulling: false, disableDepthWrite: true });
    const processing = helper(material, `__display ${this.uniqueId}`, (name) => new BlenderDisplayBlock(name));
    const radiance = closure ? helper(material, `__unlit ${this.uniqueId}`, (name) => new BlenderUnlitSurfaceBlock(name)) : null;
    if (radiance) wire(closure, radiance.closure);
    const probe = helper(material, `__probeClamp ${this.uniqueId}`, (name) => new BlenderWorldProbeClampBlock(name));
    wire(radiance?.radiance ?? helper(material, '__black', (name) => Object.assign(new InputBlock(name, undefined, T.Color4), { value: new Color4(0, 0, 0, 1) })).output, probe.radiance);
    wire(probe.output, processing.color);
    this.rgba.connectedPoint?.disconnectFrom(this.rgba);
    wire(processing.getOutputByName('displayRgb'), this.rgb);
  }
}

// A material's Volume as EEVEE stores it in its froxels (eevee_surf_volume.bsl.hh SurfVolume::write_froxel), drawn by
// draw/volumes.js: the mesh it draws is a slab of the view's froxel slices in its domain's object space, each slice at its
// tile of the froxel atlas (`blFroxelClip`), so the nodes read each froxel's point as they read a surface's. It writes
// the four property textures additively: scattering, extinction, emission, and the phase (anisotropy, weight). A point
// outside the domain's bounds (`blVolumeBounds` of the mesh, in its local space) holds nothing.
export const FROXEL_CLIP = 'blFroxelClip', FROXEL_SLICE = 'blFroxelSlice', FROXEL_CORNER = 'blFroxelCorner';
// Each froxel's point, found per fragment from the slab's fixed geometry (each vertex its slice, `blFroxelSlice`, and
// its corner of the grid in volume uv, `blFroxelCorner`) and the view's state as uniforms (the mesh's `blFroxel`
// metadata: the view's inverse projection, the view to the mesh's space, the depth distribution, the grid's width,
// height, slices and the sample's noise offset, its coordinate scale), so the slab never changes and its material never
// prepares again; moved along its view ray within its slice by the sample's noise, as EEVEE's eval_froxel jitters it.
class BlenderFroxelPositionBlock extends NodeMaterialBlock {
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
const VOLUME_TARGETS = `#extension GL_EXT_draw_buffers : require
layout(location = 0) out highp vec4 glFragData[4];
highp vec4 gl_FragColor;`;
export class ShaderNodeOutputVolume extends ShaderNodeOutputMaterial {
  constructor(name) {
    super(name);
    this.registerInput('blLocal', T.Vector3, true, Targets.Fragment);
  }

  attach(material) {
    material.addOutputNode(this);
    // The nodes read each froxel's jittered point where they read a mesh's position.
    material.blenderGeometry = (value) => {
      if (value !== 'position') return null;
      const froxel = helper(material, '__froxelPosition', (name) => new BlenderFroxelPositionBlock(name));
      wire(attributeBlock(material, FROXEL_CORNER, T.Vector2).output, froxel.getInputByName('corner'));
      wire(attributeBlock(material, FROXEL_SLICE, T.Float).output, froxel.getInputByName('slice'));
      return froxel.getOutputByName('output');
    };
    const output = helper(material, '__vertexOutput', (name) => new VertexOutputBlock(name));
    wire(attributeBlock(material, FROXEL_CLIP, T.Vector4).output, output.vector);
    material.addOutputNode(output);
  }

  initialize(state) {
    FragmentOutputBlock.prototype.initialize.call(this, state);
    Object.assign(state.sharedData.nodeMaterial, { alphaMode: Constants.ALPHA_ONEONE, forceAlphaBlending: true, backFaceCulling: false,
      disableDepthWrite: true, depthFunction: Constants.ALWAYS, separateCullingPass: false });
    wire(geometryBlock(state.sharedData.nodeMaterial, '__position').output, this.getInputByName('blLocal'));
  }

  prepareDefines() {}

  bind(effect, nodeMaterial, mesh) {
    super.bind(effect, nodeMaterial, mesh);
    const [min, max] = mesh?.metadata?.blVolumeBounds ?? [[0, 0, 0], [0, 0, 0]];
    effect.setFloat3('bl_volume_min', ...min);
    effect.setFloat3('bl_volume_max', ...max);
  }

  _buildBlock(state) {
    NodeMaterialBlock.prototype._buildBlock.call(this, state);
    if (!state.sharedData.bindableBlocks.includes(this) && !state.sharedData.forcedBindableBlocks.includes(this)) state.sharedData.forcedBindableBlocks.push(this);
    if (state.target !== Targets.Fragment) return this;
    state._emitExtension('bl_volume_targets', VOLUME_TARGETS);
    state._emitFunction('bl_closure', STAND_INS.bl_closure, '');
    for (const name of ['bl_volume_min', 'bl_volume_max']) state._emitUniformFromString(name, T.Vector3);
    const volume = this.getInputByName('Volume'), local = this.getInputByName('blLocal').associatedVariableName;
    state.compilationString += `if (any(lessThan(${local}, bl_volume_min)) || any(greaterThan(${local}, bl_volume_max))) discard;
BlClosure bl_volume = ${volume.isConnected ? volume.associatedVariableName : 'bl_closure_empty()'};
vec3 bl_scattering = max(bl_volume.volume_scattering, 0.0);
float bl_phase_weight = any(greaterThan(bl_scattering, vec3(0.0))) ? 1.0 : 0.0;
glFragData[0] = vec4(bl_scattering, 0.0);
glFragData[1] = vec4(bl_scattering + max(bl_volume.volume_absorption, 0.0), 0.0);
glFragData[2] = vec4(max(bl_volume.emission, 0.0), 0.0);
glFragData[3] = vec4(bl_volume.volume_anisotropy * bl_phase_weight, bl_phase_weight, 0.0, 0.0);
`;
    return this;
  }
}

// A scene's node materials build again when its EEVEE Parity changes.
eeveeParityChanged.add((scene) => {
  for (const material of scene.materials) if (material.attachedBlocks?.some((block) => block instanceof ShaderNodeOutputMaterial)) buildMaterial(material);
});

// A radiance through the scene's fog, its coverage kept, as Babylon's PBR material fogs its color.
function fogged(material, radiance) {
  const fog = helper(material, '__fog', (name) => new FogBlock(name)), split = helper(material, '__coverage', (name) => new ColorSplitterBlock(name));
  const merge = helper(material, '__fogged', (name) => new ColorMergerBlock(name));
  wire(worldPosition(material).output, fog.worldPosition);
  wire(radiance, fog.input);
  fog.autoConfigure(material);
  wire(radiance, split.rgba);
  wire(fog.output, merge.getInputByName('rgb '));
  wire(split.a, merge.a);
  return merge.rgba;
}

// A Blender output takes the type of the Babylon inputs it links to, when Blender converts to it, as Blender's code
// generation converts at the link: one Color output can feed a Color3 albedo and other Blender nodes' Float inputs.
// Between Blender nodes, the sockets' own types decide (a closure links only to a closure).
function adaptOutput(point, own, socket) {
  // An input that takes its type from its link (AutoDetect) takes this output's own.
  const babylonTargets = () => point.endpoints.filter((e) => !isBlenderShader(e.ownerBlock) && e._type !== own && e._type !== T.AutoDetect);
  Object.defineProperty(point, 'type', { get: () => babylonTargets()[0]?.type ?? own, set: () => {}, configurable: true });
  const check = point.checkCompatibilityState.bind(point);
  point.checkCompatibilityState = (other) => {
    if (isBlenderShader(other.ownerBlock)) {
      const target = other.ownerBlock.declaration.inputs.find((s) => s.identifier === other.name);
      return target && !converts(socketType(socket).kind, socketType(target.type)?.kind) ? 1 : check(other);
    }
    if (other.type === own) return check(other);
    const target = babylonTargets()[0]?.type;
    if (!converts(kindOf(own), kindOf(other.type)) || (target !== undefined && target !== other.type)) return 1;
    const accepted = other.acceptedConnectionPointTypes;
    other.acceptedConnectionPointTypes = [...accepted, point.type];
    try { return check(other); } finally { other.acceptedConnectionPointTypes = accepted; }
  };
}

// The block classes, one per Blender node Bylonder links, registered for Babylon's serialization.
const OWN_CLASSES = { ShaderNodeOutputMaterial, ShaderNodeOutputWorld, ShaderNodeShaderToRGB };
export const shaderNodeClasses = Object.fromEntries([...Object.keys(SHADER_NODES), ...Object.keys(OWN_CLASSES)].map((idname) => {
  const label = declaration('shader', idname).name;
  const Block = OWN_CLASSES[idname] ?? { [idname]: class extends BlenderShaderBlock { constructor(name) { super(name || label, idname); } } }[idname];
  RegisterClass('BABYLON.' + idname, Block);
  return [idname, Block];
}));
export const { ShaderNodeBsdfPrincipled } = shaderNodeClasses;

// Blender's new material (material.new): a Principled BSDF into a Material Output, where Blender places them.
export function blenderDefaultTree(material) {
  material.clear();
  const principled = new ShaderNodeBsdfPrincipled(), output = new ShaderNodeOutputMaterial();
  principled.getOutputByName('BSDF').connectTo(output.getInputByName('Surface'));
  material.attachedBlocks.push(principled);
  output.attach(material);
  material.editorData = { locations: [{ blockId: principled.uniqueId, x: 10, y: -300 }, { blockId: output.uniqueId, x: 300, y: -300 }], frames: [] };
}

// An RNA value as plain data: an array property (a Sky Texture's sun direction) as an array.
const plainValue = (value) => (value && typeof value === 'object' && Symbol.iterator in value ? [...value] : value);
// A node's properties as its block keeps them, from Blender's node (RNA): those its declaration has, its color ramp and its
// curve mapping.
export function nodeProperties(node, tree = 'shader') {
  const decl = declaration(tree, node.bl_idname), ramp = node.color_ramp, mapping = (CURVE_MAPPINGS[node.bl_idname] || tree === 'compositor') && node.mapping?.curves && node.mapping;
  return {
    // An ID pointer (an Image Texture's image) by its name.
    ...Object.fromEntries(Object.entries(decl?.properties ?? {}).map(([key, { type }]) => [key, type === 'POINTER' ? node[key]?.name ?? null : plainValue(node[key])])),
    ...(ramp && { color_ramp: { color_mode: ramp.color_mode, interpolation: ramp.interpolation, hue_interpolation: ramp.hue_interpolation,
      elements: [...ramp.elements].map((e) => ({ position: e.position, color: [...e.color] })) } }),
    ...(mapping && { mapping: plainCurveMapping(mapping) }),
    // A repeat zone's pairing and items.
    ...(node.bl_idname === 'GeometryNodeRepeatInput' && { paired_output: node.paired_output?.name ?? null }),
    ...(node.bl_idname === 'GeometryNodeRepeatOutput' && { repeat_items: [...node.repeat_items].map((item) => ({ name: item.name, socket_type: item.socket_type })) }),
  };
}

// A node's output socket values (a Value node's), as its block keeps them ('=identifier').
export const outputValues = (node) => Object.fromEntries((OUTPUT_VALUES[node.bl_idname] ?? []).map((id) => {
  const value = [...node.outputs].find((s) => s.identifier === id).default_value;
  return ['=' + id, typeof value === 'number' ? value : [...value]];
}));

// A Blender node tree (plain: { nodes: [{ idname, name, properties, values }], links: [[from node, output, to node,
// input]] }, as a read .blend's Main holds it) as a node material of the blocks for Blender's nodes, linked as in the
// tree. Returns the material and the node types it has no block for, which it leaves out. The surface is drawn with
// Material Output; given `volumeOutput`, a block class in its place, the tree's Volume is drawn with it instead
// (draw/volumes.js), from the same tree (`material.blenderTree`).
export function nodeMaterialFromTree(name, scene, tree, volumeOutput = null) {
  const material = new BlenderNodeMaterial(name, scene), blocks = new Map(), missing = new Set(), output = eeveeOutput(tree.nodes);
  material.clear();
  material.blenderTree = tree;
  material.blenderWorld = output?.idname === 'ShaderNodeOutputWorld';
  for (const node of tree.nodes) {
    if (node.idname === 'GeometryNodeRepeatInput') {
      const paired = tree.nodes.find((n) => n.name === node.properties?.paired_output);
      if (!paired) { missing.add(node.idname); continue; }
      const { zone, write } = repeatZoneBlocks(node, paired);
      blocks.set(node.name, zone).set(paired.name, write);
      material.attachedBlocks.push(zone, write);
      continue;
    }
    if (node.idname === 'GeometryNodeRepeatOutput') continue;
    const Block = node === output && volumeOutput ? volumeOutput : shaderNodeClasses[node.idname];
    if (!Block) { if (!['NodeFrame', 'NodeReroute'].includes(node.idname)) missing.add(node.idname); continue; }
    const block = new Block(node.name);
    Object.assign(block.properties, structuredClone(node.properties ?? {}));
    for (const [id, value] of Object.entries(node.values ?? {})) if (value !== null && id in block.values) block.values[id] = value;
    blocks.set(node.name, block);
    if (node === output) block.attach(material);
    else material.attachedBlocks.push(block);
  }
  // The output's Volume is drawn by its own material, its Surface (and displacement) by this one.
  const drawn = (to, input) => to !== output?.name || (input === 'Volume') === !!volumeOutput;
  const links = rerouted(tree);
  material.blenderVolume = links.some(([, , to, input]) => to === output?.name && input === 'Volume');
  if (blocks.get(output?.name)) blocks.get(output.name).blenderVolume = material.blenderVolume;
  for (const [from, output, to, input] of links.filter(([, , to, input]) => drawn(to, input))) {
    const fromBlock = blocks.get(from), source = fromBlock instanceof BlenderRepeatWriteBlock ? fromBlock.zone.result(output) : fromBlock?.getOutputByName(output);
    const target = blocks.get(to)?.getInputByName(input);
    if (!source || !target) continue;
    const fromShader = isShaderSocket(blocks.get(from), output, 'outputs'), toShader = isShaderSocket(blocks.get(to), input, 'inputs');
    if (fromShader === toShader) source.connectTo(target);
    else if (toShader) implicitEmission(material, `${from} ${output} Emission`, source).connectTo(target);
  }
  buildMaterial(material);
  return { material, missing: [...missing] };
}

// A tree's links with its reroutes passed through (node_tree_reroute_link: a reroute links what links into it).
export function rerouted({ nodes, links }) {
  const reroutes = new Set(nodes.filter((n) => n.idname === 'NodeReroute').map((n) => n.name));
  const source = (node, output, seen = new Set()) => {
    if (!reroutes.has(node) || seen.has(node)) return [node, output];
    const into = links.find(([, , to]) => to === node);
    return into ? source(into[0], into[1], seen.add(node)) : [node, output];
  };
  return links.filter(([, , to]) => !reroutes.has(to)).map(([from, output, to, input]) => [...source(from, output), to, input]);
}

// blender-port: nodes/shader/node_shader_tree.cc ntreeShaderOutputNode for SHD_OUTPUT_EEVEE: of the Material (or
// World) Outputs, one for EEVEE before one for all renderers, the active one among equals, else the first.
const OUTPUTS = ['ShaderNodeOutputMaterial', 'ShaderNodeOutputWorld'];
function eeveeOutput(nodes) {
  let output = null;
  const idname = OUTPUTS.find((id) => nodes.some((n) => n.idname === id));
  for (const node of nodes.filter((n) => n.idname === idname)) {
    const { target = 'ALL', is_active_output: active } = node.properties ?? {}, current = output?.properties?.target ?? 'ALL';
    if (target !== 'ALL' && target !== 'EEVEE') continue;
    if (!output || (target === 'EEVEE' && current === 'ALL') || (target === current && active && !output.properties?.is_active_output)) output = node;
  }
  return output;
}
const isShaderSocket = (block, id, side) => block.declaration?.[side].find((s) => s.identifier === id)?.type === 'SHADER';
// blender-port: nodes/shader/node_shader_tree.cc ntree_shader_implicit_closure_cast: data linked to a shader input is
// an Emission of that color; a shader linked to a data input is no link.
function implicitEmission(material, name, source) {
  const emission = new shaderNodeClasses.ShaderNodeEmission(name);
  material.attachedBlocks.push(emission);
  source.connectTo(emission.getInputByName('Color'));
  return emission.getOutputByName('Emission');
}

// Babylon drops a build asked for while one waits for its blocks' code, so the latest asks again once that one ends
// (after its observers: while they run, the build is still in progress).
const QUEUED = Symbol('queued');
export function buildMaterial(material) {
  if (!material._buildIsInProgress) return material.build();
  if (material[QUEUED]) return;
  material[QUEUED] = true;
  const again = () => queueMicrotask(() => { if (material[QUEUED]) { material[QUEUED] = false; buildMaterial(material); } });
  material.onBuildObservable.addOnce(again);
  material.onBuildErrorObservable.addOnce(again);
}
