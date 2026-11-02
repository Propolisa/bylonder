// Blender's shader nodes as Babylon node material blocks: one block class per Blender node type, registered under its
// idname, so one NodeMaterial holds Babylon blocks and Blender nodes linked together. A block's sockets are the
// node's declaration; its code is Blender's GLSL, linked as the node's GPU function links it; unlinked inputs are
// uniforms, as Blender's GPU_uniform, so editing a value needs no rebuild.
//
// What Blender's GPU code reads of the point it shades (g_data, attributes, the object's texture space) comes from
// Babylon's geometry: hidden inputs (named `__...`) linked to Babylon blocks named `blender:...`, which Bylonder's
// editor does not draw. A closure (a SHADER socket) is the radiance it sends toward the view and its alpha: Principled
// BSDF is Babylon's PBR block lit by Babylon's lights, Emission adds its radiance, and Material Output writes the
// fragment through Babylon's image processing.
import {
  Color4, Constants, FragmentOutputBlock, ImageProcessingBlock, InputBlock, NodeMaterial, NodeMaterialBlock, NodeMaterialBlockConnectionPointTypes as T,
  NodeMaterialBlockTargets as Targets, NodeMaterialSystemValues as System, PBRMetallicRoughnessBlock, RawTexture, ReflectionBlock, RegisterClass,
  Texture, TransformBlock, VertexOutputBlock,
} from '@babylonjs/core';
import { functions } from './gpu-library.js';
import { BABYLON_TYPES, convert, converts, glslValue, kindOf, socketType } from './sockets.js';
import { availability, declaration, defaults } from './declarations.js';
import { compileSteps, glslIdentifier, kindOfSocket, menuValue, muteLinks, setUniforms, stack } from './node-code.js';
import { colorRampTable, defaultColorRamp, halfFloats, TABLE_SIZE } from '../../blenkernel/colorband.js';
import { CurvesGeometryBlock, CurvesNormalBlock } from '../../draw/curves.js';
import { imageTexture } from '../../imbuf/image-textures.js';
import { blendData } from '../../python/bpy_rna.js';
import '../graph-roots.js';

const DIMENSIONS = ['1D', '2D', '3D', '4D'];
const sortedStops = (ramp) => [...ramp.elements].sort((a, b) => a.position - b.position);

// g_data as EEVEE's surface shaders fill it (eevee_surf_common.bsl.hh init_globals, init_globals_curves).
const G_DATA = ['bl_g_data', ['$P', '$N', '$is_strand', '$hair_radius', '$hair_curve_N', '$hair_strand_id'], []];
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
  ShaderNodeTexNoise: (p, decl, { connected, linked }) => {
    const [name, args, outs] = stack(functions.noise[p.noise_type][DIMENSIONS.indexOf(p.noise_dimensions)], decl, [p.normalize ? 1 : 0, linked('Color') ? 1 : 0]);
    return [[name, args.map((a) => (a === 'Vector' && !connected('Vector') ? '$orco' : a)), outs]];
  },
  // node_shader_tex_image.cc, node_shader_gpu_tex_image: an unlinked vector is the default UV map; the Color output's
  // alpha as the Alpha output's use asks, from what the texture holds: a float buffer premultiplied, a byte buffer
  // straight (imbuf/image-textures.js imagePremultiplied), where Blender's holds a straight float image straight.
  ShaderNodeTexImage: (p, decl, { connected, linked, image }) => {
    const ima = image();
    if (!ima) return [['node_tex_image_empty', [], ['@Color', '@Alpha']]];
    const sample = ['Cubic', 'Smart'].includes(p.interpolation) ? 'node_tex_image_cubic' : 'node_tex_image_linear';
    const premul = ima.alpha_mode === 'PREMUL', alpha = linked('Alpha');
    const steps = ['CHANNEL_PACKED', 'NONE'].includes(ima.alpha_mode) || ima.colorspace_settings.is_data ? ['color_alpha_clear']
      : !ima.is_float ? [alpha ? 'color_alpha_clear' : 'color_alpha_premultiply']
      : alpha ? ['color_alpha_unpremultiply', !premul && 'color_alpha_clear'] : [premul && 'color_alpha_clear'];
    return [
      [sample, [connected('Vector') ? 'Vector' : '$uv', { image: ima }], ['@Color', '@Alpha']],
      ...(linked('Color') ? steps.filter(Boolean).map((name) => [name, ['@Color'], ['@Color']]) : []),
    ];
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
  // node_shader_emission.cc, node_shader_gpu_emission
  ShaderNodeEmission: (p, decl) => [['bl_node_emission', ['Color', 'Strength', 'Weight'], ['@Emission']]],
};

// Bylonder's GLSL where Blender's is its render engine's (EEVEE's g_data and closures, gpu_shader_codegen_lib.glsl).
// port-override: the shaded point comes from Babylon's geometry and a closure is its radiance, so these stand in.
export const STAND_INS = {
  // g_data as Blender's code generation fills it, and the derivatives node_bump reads (the film's scale is 1).
  bl_g_data: `struct GlobalData { vec3 P; vec3 N; bool is_strand; float hair_diameter; vec3 curve_N; int hair_strand_id; };
GlobalData g_data;
#define FrontFacing gl_FrontFacing
float derivative_scale_get() { return 1.0; }
void bl_g_data(vec3 P, vec3 N, float is_strand, float hair_radius, vec3 curve_N, float hair_strand_id) {
  g_data = GlobalData(P, N, is_strand > 0.5, hair_radius * 2.0, curve_N, int(hair_strand_id));
}`,
  bl_vector_copy: 'void bl_vector_copy(vec3 v, inout vec3 result) { result = v; }',
  // EEVEE's texture LOD bias (the film's, 1 at full resolution).
  texture_lod_bias_get: 'float texture_lod_bias_get() { return 1.0; }',
  bl_tex_coord: `void bl_tex_coord(vec3 orco, vec3 normal_in, vec3 uv_in, vec3 object_in, vec3 camera_in, vec3 window_in, vec3 reflection_in,
  inout vec3 generated, inout vec3 normal, inout vec3 uv, inout vec3 object, inout vec3 camera, inout vec3 window, inout vec3 reflection) {
  generated = orco; normal = normal_in; uv = uv_in; object = object_in; camera = camera_in; window = window_in; reflection = reflection_in;
}`,
  // node_emission's closure: its emission, max(color, 0) times max(strength, 0), as radiance.
  bl_node_emission: 'void bl_node_emission(vec4 color, float strength, float weight, inout vec4 result) { result = vec4(max(color.rgb, 0.0) * max(strength, 0.0), 1.0); }',
};

// The geometry a node's code reads, as Babylon blocks: an attribute, a system value, or what the mesh's geometry block
// gives (a mesh's position and normal, or a curves vertex's and its curve's values: curves.js CurvesGeometryBlock), by the
// hidden input's name.
const GEOMETRY = {
  __position: ['geometry', 'position', T.Vector3], __normal: ['geometry', 'normal', T.Vector3], __uv: ['attribute', 'uv', T.Vector2],
  __hair_intercept: ['geometry', 'intercept', T.Float], __hair_length: ['geometry', 'length', T.Float], __hair_radius: ['geometry', 'radius', T.Float],
  __hair_curve_N: ['geometry', 'curveN', T.Vector3], __hair_strand_id: ['geometry', 'strandId', T.Float], __is_strand: ['geometry', 'isStrand', T.Float],
  __world: ['system', System.World, T.Matrix], __view: ['system', System.View, T.Matrix], __viewProjection: ['system', System.ViewProjection, T.Matrix],
  __cameraPosition: ['system', System.CameraPosition, T.Vector3],
};
// The values of the shaded point ('$name') in Blender's axes, from the geometry inputs they use.
const POINT = {
  $P: ['__position', '__world'], $N: ['__normal', '__world'], $orco: ['__position'], $object: ['__position'], $object_normal: ['__normal'],
  $uv: ['__uv'], $camera: ['__position', '__world', '__view'], $window: ['__position', '__world', '__viewProjection'],
  $reflection: ['__position', '__normal', '__world', '__cameraPosition'], $height_xy: [],
  $is_strand: ['__is_strand'], $hair_radius: ['__hair_radius'], $hair_curve_N: ['__hair_curve_N'], $hair_strand_id: ['__hair_strand_id'],
  $hair_intercept: ['__hair_intercept'], $hair_length: ['__hair_length'],
};
const G_DATA_POINTS = ['$P', '$N', '$is_strand', '$hair_radius', '$hair_curve_N', '$hair_strand_id'];
const NEEDS = {
  ShaderNodeTexNoise: ['$orco'], ShaderNodeTexImage: ['$uv'], ShaderNodeBump: G_DATA_POINTS, ShaderNodeHairInfo: [...G_DATA_POINTS, '$hair_intercept', '$hair_length'],
  ShaderNodeTexCoord: ['$orco', '$object_normal', '$uv', '$object', '$camera', '$window', '$reflection'],
};
const geometryOf = (idname) => [...new Set((NEEDS[idname] ?? []).flatMap((value) => POINT[value]))];

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
// The material's geometry block, its mesh's position and normal into it, and the normal it shades with.
function curvesGeometry(material) {
  const geometry = helper(material, '__geometry', (name) => new CurvesGeometryBlock(name));
  wire(attributeBlock(material, 'position', T.Vector3).output, geometry.getInputByName('meshPosition'));
  wire(attributeBlock(material, 'normal', T.Vector3).output, geometry.getInputByName('meshNormal'));
  return geometry;
}
function shadingNormal(material) {
  const geometry = curvesGeometry(material), normal = helper(material, '__shadingNormal', (name) => new CurvesNormalBlock(name));
  for (const name of ['normal', 'curveN', 'binormal', 'timeWidth', 'radius']) wire(geometry.getOutputByName(name), normal.getInputByName(name));
  return normal;
}
function geometryBlock(material, name) {
  const [kind, value, type] = GEOMETRY[name];
  if (kind === 'attribute') return attributeBlock(material, value, type);
  if (name === '__normal') return shadingNormal(material);
  if (kind === 'geometry') return { output: curvesGeometry(material).getOutputByName(value) };
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
    const positions = base.positions ?? mesh.getVerticesData?.('position') ?? [];
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
function rampTexture(table, scene) {
  const key = table.join();
  if (!rampTextures.get(key)?.getScene?.()?.isDisposed && rampTextures.get(key)?.getScene() === scene) return rampTextures.get(key);
  const texture = new RawTexture(halfFloats(table), TABLE_SIZE, 1, Constants.TEXTUREFORMAT_RGBA, scene, false, false, Texture.BILINEAR_SAMPLINGMODE, Constants.TEXTURETYPE_HALF_FLOAT);
  texture.wrapU = texture.wrapV = Texture.CLAMP_ADDRESSMODE;
  rampTextures.set(key, texture);
  return texture;
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
    for (const s of this.declaration.outputs) {
      const type = socketType(s.type)?.babylon;
      if (type === undefined) continue;
      this.registerOutput(s.identifier, type, Targets.Fragment);
      adaptOutput(Object.assign(this.getOutputByName(s.identifier), { displayName: s.name }), type, s.type);
    }
    // Read in the fragment shader: Babylon carries an attribute there as a varying.
    for (const name of geometryOf(idname)) this.registerInput(name, GEOMETRY[name][2], true, Targets.Fragment);
  }

  getClassName() { return this.idname; }
  get availability() { return availability(this.declaration, this.properties, this.values); }
  // Whether a socket is the node's own, not one Bylonder links its geometry or Babylon's code through.
  declared(name) { return this.declaration.inputs.some((s) => s.identifier === name) || this.declaration.outputs.some((s) => s.identifier === name); }

  initialize(state) {
    super.initialize(state);
    const material = state.sharedData.nodeMaterial;
    for (const name of geometryOf(this.idname)) wire(geometryBlock(material, name).output, this.getInputByName(name));
  }

  // The GLSL of each socket's link, made when first used: a linked input converted to the socket's type, a menu as
  // its item, else the input's uniform; an output's once a step writes it; a value of the shaded point ('$name').
  _links(state) {
    if (this._built !== state.sharedData) Object.assign(this, { _built: state.sharedData, _uniforms: [], _textures: [], _texspace: null });
    const links = new Map();
    const input = (id) => {
      const s = this.declaration.inputs.find((d) => d.identifier === id), type = socketType(s.type), point = this.getInputByName(id);
      if (point?.isConnected) return convert(point.associatedVariableName, kindOf(point.connectedPoint.type), type.kind);
      if (s.type === 'MENU') return menuValue(s, this.values[id]);
      const name = state._getFreeVariableName(glslIdentifier(id));
      state._emitUniformFromString(name, type.babylon);
      this._uniforms.push([name, id, type.kind]);
      return name;
    };
    const geometry = (name) => this.getInputByName(name).associatedVariableName;
    const declare = (prefix, type, value) => {
      const name = state._getFreeVariableName(prefix);
      state.compilationString += `${type} ${name} = ${value};\n`;
      return name;
    };
    const point = (id) => {
      const position = () => geometry('__position'), world = () => geometry('__world');
      const worldPosition = () => `(${world()} * vec4(${position()}, 1.0))`;
      switch (id) {
        case '$P': return declare('bl_P', 'vec3', `${worldPosition()}.xzy`);
        case '$N': return declare('bl_N', 'vec3', `normalize((${world()} * vec4(${geometry('__normal')}, 0.0)).xyz).xzy`);
        case '$object': return declare('bl_object', 'vec3', `${position()}.xzy`);
        case '$object_normal': return declare('bl_object_normal', 'vec3', `normalize(${geometry('__normal')}).xzy`);
        case '$uv': return declare('bl_uv', 'vec3', `vec3(${geometry('__uv')}, 0.0)`);
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
        case '$orco': {
          this._texspace ??= ['bl_texspace_location', 'bl_texspace_size'].map((prefix) => {
            const name = state._getFreeVariableName(prefix);
            state._emitUniformFromString(name, T.Vector3);
            return name;
          });
          const [location, size] = this._texspace;
          return declare('bl_orco', 'vec3', `(${position()}.xzy - ${location}) / ${size} * 0.5 + 0.5`);
        }
        // port-override: Blender evaluates the height again at offset positions (GPU_differentiate_float_function);
        // the height's screen derivatives stand for that, as Blender's GPU_FAST_DERIVATIVE path takes them.
        case '$height_xy': {
          const height = link('Height');
          return declare('bl_height_xy', 'vec2', `vec2(${height}) + ${link('Filter Width')} * vec2(dFdx(${height}), dFdy(${height}))`);
        }
        // A curve's values (none for a mesh), as the geometry block gives them.
        case '$is_strand': case '$hair_radius': case '$hair_curve_N': case '$hair_strand_id': case '$hair_intercept': case '$hair_length': return geometry(POINT[id][0]);
        default: throw Error(`${this.name}: no ${id}`);
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
      const steps = SHADER_NODES[this.idname](this.properties, this.declaration, {
        connected: (id) => !!this.getInputByName(id)?.isConnected,
        linked: (id) => !!this.getOutputByName(id)?.hasEndpoints,
        image: () => (this.properties.image ? blendData().images.get(this.properties.image) ?? null : null),
      });
      // Blender's hashes take 32 bit integers, which a fragment shader's default (mediump) need not be.
      state._emitFunction('bl_precision', 'precision highp int;\n', '');
      // Compiled before it is added: the values of the shaded point are declared as the steps first use them.
      const code = compileSteps(this.declaration, steps, links, {
        emit: (key, code) => state._emitFunction(key, code, ''),
        free: (prefix) => state._getFreeVariableName(prefix),
        sampler: ({ texture: table, image }) => {
          const name = state._getFreeVariableName(table ? 'bl_table' : 'bl_image');
          state._emit2DSampler(name, '', false, undefined, false, 'highp');
          const scene = state.sharedData.scene;
          this._textures.push([name, table ? rampTexture(table, scene) : imageTexture(image, scene, this.properties) ?? emptyTexture(scene)]);
          return name;
        },
        functions: STAND_INS,
      });
      state.compilationString += code;
    }
    return links;
  }

  _writeOutputs(state, links) {
    for (const output of this.outputs) {
      if (!output.hasEndpoints || !this.declared(output.name)) continue;
      const kind = kindOfSocket(this.declaration, '@' + output.name);
      state.compilationString += `${state._declareOutput(output)} = ${convert(links.get('@' + output.name) ?? glslValue(0, kind), kind, kindOf(output.type))};\n`;
    }
  }

  _buildBlock(state) {
    super._buildBlock(state);
    if (state.shaderLanguage !== 0) throw Error(`${this.name}: Blender nodes build GLSL only`);
    if (state.target !== Targets.Fragment) return this;
    this._writeOutputs(state, this._compile(state));
    if (!state.sharedData.bindableBlocks.includes(this)) state.sharedData.forcedBindableBlocks.push(this);
    return this;
  }

  bind(effect, nodeMaterial, mesh) {
    super.bind?.(effect, nodeMaterial, mesh);
    setUniforms(effect, this._uniforms ?? [], this.values);
    for (const [name, texture] of this._textures ?? []) effect.setTexture(name, texture);
    if (this._texspace) {
      const [location, size] = texspace(mesh);
      effect.setFloat3(this._texspace[0], ...location);
      effect.setFloat3(this._texspace[1], ...size);
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

export class BlenderShaderBlock extends blenderShader(NodeMaterialBlock) {
  constructor(name, idname) {
    super(name, idname, Targets.Neutral);
    if (idname === 'ShaderNodeValToRGB') this.properties.color_ramp ??= defaultColorRamp();
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

// The BSDFs Bylonder shades with Babylon's PBR block, which lights them with Babylon's lights and environment: what
// each socket gives a PBR input ([PBR input, socket, conversion], or a constant's GLSL), and its alpha, normal and
// emission sockets. EEVEE shades the hair BSDFs as a diffuse closure of their color (gpu_shader_material_hair.glsl),
// here a surface without specular reflection (IOR 1), lit along the strand's cylinder normal.
const rgb = (v) => `${v}.rgb`, same = (v) => v;
const DIFFUSE = (roughness) => [['baseColor', 'Color', rgb], ['metallic', '0.0'], roughness, ['indexOfRefraction', '1.0']];
const BSDFS = {
  ShaderNodeBsdfPrincipled: {
    inputs: [['baseColor', 'Base Color', rgb], ['metallic', 'Metallic', same], ['roughness', 'Roughness', same], ['indexOfRefraction', 'IOR', same]],
    alpha: 'Alpha', normal: 'Normal', emission: ['Emission Color', 'Emission Strength'],
  },
  ShaderNodeBsdfDiffuse: { inputs: DIFFUSE(['roughness', 'Roughness', same]), normal: 'Normal' },
  ShaderNodeBsdfHair: { inputs: DIFFUSE(['roughness', '1.0']) },
  ShaderNodeBsdfHairPrincipled: { inputs: DIFFUSE(['roughness', '1.0']) },
};

// A BSDF (node_shader_bsdf_*.cc) as Babylon's PBR block: its inputs from the BSDF's sockets, its emission added to
// what it reflects.
class BlenderBsdf extends blenderShader(PBRMetallicRoughnessBlock) {
  constructor(name, idname) {
    super(name || declaration('shader', idname).name, idname);
    this.metallic.isOptional = this.roughness.isOptional = true;
    // The PBR inputs given from sockets: connected while they hold a socket's value.
    for (const point of this._pbrInputs) Object.defineProperty(point, 'isConnected', { get: () => !!point._blenderValue || !!point.connectedPoint });
  }

  get _bsdf() { return BSDFS[this.idname]; }
  get _pbrInputs() { return [this.baseColor, this.metallic, this.roughness, this.indexOfRefraction, this.opacity]; }

  initialize(state) {
    super.initialize(state);
    const material = state.sharedData.nodeMaterial;
    for (const point of this._pbrInputs) point._blenderValue = null;
    const position = geometryBlock(material, '__position'), world = geometryBlock(material, '__world');
    wire(worldPosition(material).output, this.worldPosition);
    // In the fragment stage, where the normal is shaded (a strand's: curves.js CurvesNormalBlock).
    const normal = Object.assign(transformed(material, '__worldNormal', 0), { target: Targets.Fragment });
    wire(geometryBlock(material, '__normal').output, normal.vector);
    wire(world.output, normal.transform);
    wire(normal.output, this.worldNormal);
    wire(geometryBlock(material, '__view').output, this.view);
    wire(geometryBlock(material, '__cameraPosition').output, this.cameraPosition);
    const reflection = helper(material, '__reflection', (name) => new ReflectionBlock(name));
    reflection._getTexture = environmentOf(material);
    wire(position.output, reflection.position);
    wire(world.output, reflection.world);
    wire(reflection.reflection, this.reflection);
    // The Normal socket's source as Babylon's world normal.
    const source = this._bsdf.normal && this.getInputByName(this._bsdf.normal).connectedPoint;
    if (!source) this.perturbedNormal.connectedPoint?.disconnectFrom(this.perturbedNormal);
    else {
      const axes = helper(material, `__normal ${this.uniqueId}`, (name) => new BlenderAxesBlock(name));
      wire(source, axes.vector);
      wire(axes.output, this.perturbedNormal);
    }
  }

  _buildBlock(state) {
    if (state.target !== Targets.Fragment) return PBRMetallicRoughnessBlock.prototype._buildBlock.call(this, state);
    const links = this._links(state), { inputs, alpha, emission } = this._bsdf;
    const value = (point, glsl) => { point._blenderValue = glsl; point.associatedVariableName = glsl; };
    for (const [pbr, socket, as] of inputs) value(this[pbr], as ? as(links.get(socket)) : socket);
    if (alpha && (this.getInputByName(alpha).isConnected || this.values[alpha] !== 1)) value(this.opacity, links.get(alpha));
    PBRMetallicRoughnessBlock.prototype._buildBlock.call(this, state);
    const emitted = emission ? ` + ${links.get(emission[0])}.rgb * ${links.get(emission[1])}` : '';
    links.set('@BSDF', `vec4(finalColor.rgb${emitted}, alpha)`);
    this._writeOutputs(state, links);
    return this;
  }
}
const bsdfClass = (idname) => ({ [idname]: class extends BlenderBsdf { constructor(name) { super(name, idname); } } })[idname];
export const ShaderNodeBsdfPrincipled = bsdfClass('ShaderNodeBsdfPrincipled');

// A Blender world vector (Bump's normal) as Babylon's: (x, z, y), w 0.
export class BlenderAxesBlock extends NodeMaterialBlock {
  constructor(name) {
    super(name, Targets.Fragment);
    this.registerInput('vector', T.Vector3);
    this.registerOutput('output', T.Vector4);
  }
  getClassName() { return 'BlenderAxesBlock'; }
  get vector() { return this._inputs[0]; }
  get output() { return this._outputs[0]; }
  _buildBlock(state) {
    super._buildBlock(state);
    state.compilationString += `${state._declareOutput(this.output)} = vec4(${this.vector.associatedVariableName}.xzy, 0.0);\n`;
    return this;
  }
}
RegisterClass('BABYLON.BlenderAxesBlock', BlenderAxesBlock);

// Material Output (node_shader_output_material.cc) as Babylon's fragment output: the Surface closure's radiance through
// Babylon's image processing, as the material's color. A material it is added to gets the vertex output Babylon needs.
export class ShaderNodeOutputMaterial extends blenderShader(FragmentOutputBlock) {
  constructor(name) {
    super(name || 'Material Output', 'ShaderNodeOutputMaterial');
  }

  attach(material) {
    material.addOutputNode(this);
    if (material._vertexOutputNodes.length) return;
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
    const processing = helper(material, `__imageProcessing ${this.uniqueId}`, (name) => Object.assign(new ImageProcessingBlock(name), { convertInputToLinearSpace: false }));
    const surface = this.getInputByName('Surface').connectedPoint;
    if (surface) wire(surface, processing.color);
    else wire(helper(material, '__black', (name) => Object.assign(new InputBlock(name, undefined, T.Color4), { value: new Color4(0, 0, 0, 1) })).output, processing.color);
    wire(processing.output, this.rgba);
  }

  _buildBlock(state) {
    return FragmentOutputBlock.prototype._buildBlock.call(this, state);
  }
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
const OWN_CLASSES = { ...Object.fromEntries(Object.keys(BSDFS).map((idname) => [idname, idname === 'ShaderNodeBsdfPrincipled' ? ShaderNodeBsdfPrincipled : bsdfClass(idname)])), ShaderNodeOutputMaterial };
export const shaderNodeClasses = Object.fromEntries([...Object.keys(SHADER_NODES), ...Object.keys(OWN_CLASSES)].map((idname) => {
  const label = declaration('shader', idname).name;
  const Block = OWN_CLASSES[idname] ?? { [idname]: class extends BlenderShaderBlock { constructor(name) { super(name || label, idname); } } }[idname];
  RegisterClass('BABYLON.' + idname, Block);
  return [idname, Block];
}));

// Blender's new material (material.new): a Principled BSDF into a Material Output, where Blender places them.
export function blenderDefaultTree(material) {
  material.clear();
  const principled = new ShaderNodeBsdfPrincipled(), output = new ShaderNodeOutputMaterial();
  principled.getOutputByName('BSDF').connectTo(output.getInputByName('Surface'));
  material.attachedBlocks.push(principled);
  output.attach(material);
  material.editorData = { locations: [{ blockId: principled.uniqueId, x: 10, y: -300 }, { blockId: output.uniqueId, x: 300, y: -300 }], frames: [] };
}

// A node's properties as its block keeps them, from Blender's node (RNA): those its declaration has, and its color ramp.
export function nodeProperties(node) {
  const decl = declaration('shader', node.bl_idname), ramp = node.color_ramp;
  return {
    // An ID pointer (an Image Texture's image) by its name.
    ...Object.fromEntries(Object.entries(decl?.properties ?? {}).map(([key, { type }]) => [key, type === 'POINTER' ? node[key]?.name ?? null : node[key]])),
    ...(ramp && { color_ramp: { color_mode: ramp.color_mode, interpolation: ramp.interpolation, hue_interpolation: ramp.hue_interpolation,
      elements: [...ramp.elements].map((e) => ({ position: e.position, color: [...e.color] })) } }),
  };
}

// A Blender node tree (plain: { nodes: [{ idname, name, properties, values }], links: [[from node, output, to node,
// input]] }, as a read .blend's Main holds it) as a node material of the blocks for Blender's nodes, linked as in the
// tree. Returns the material and the node types it has no block for, which it leaves out.
export function nodeMaterialFromTree(name, scene, tree) {
  const material = new NodeMaterial(name, scene), blocks = new Map(), missing = new Set();
  material.clear();
  for (const node of tree.nodes) {
    const Block = shaderNodeClasses[node.idname];
    if (!Block) { if (!['NodeFrame', 'NodeReroute'].includes(node.idname)) missing.add(node.idname); continue; }
    const block = new Block(node.name);
    Object.assign(block.properties, structuredClone(node.properties ?? {}));
    for (const [id, value] of Object.entries(node.values ?? {})) if (value !== null && id in block.values) block.values[id] = value;
    blocks.set(node.name, block);
    if (block instanceof ShaderNodeOutputMaterial) block.attach(material);
    else material.attachedBlocks.push(block);
  }
  for (const [from, output, to, input] of tree.links) {
    const source = blocks.get(from)?.getOutputByName(output), target = blocks.get(to)?.getInputByName(input);
    if (source && target) source.connectTo(target);
  }
  buildMaterial(material);
  return { material, missing: [...missing] };
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
