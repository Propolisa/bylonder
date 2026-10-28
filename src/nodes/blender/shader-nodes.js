// Blender's shader nodes as Babylon node material blocks: one block class per Blender node type, registered under its
// idname, so one NodeMaterial holds Babylon blocks and Blender nodes linked together. A block's sockets are the
// node's declaration; its code is Blender's GLSL, linked as the node's GPU function links it; unlinked inputs are
// uniforms, as Blender's GPU_uniform, so editing a value needs no rebuild.
import { NodeMaterialBlock, NodeMaterialBlockTargets, RegisterClass } from '@babylonjs/core';
import { functions } from './gpu-library.js';
import { BABYLON_TYPES, convert, converts, glslValue, kindOf, socketType } from './sockets.js';
import { availability, declaration, defaults } from './declarations.js';
import { compileSteps, glslIdentifier, kindOfSocket, menuValue, muteLinks, setUniforms, stack } from './node-code.js';
import '../graph-roots.js';

// Each node's steps from its properties (see node-code.js), as its C++ GPU function links them.
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
};

export class BlenderShaderBlock extends NodeMaterialBlock {
  constructor(name, idname) {
    super(name, NodeMaterialBlockTargets.Neutral);
    this.idname = idname;
    this.declaration = declaration('shader', idname);
    Object.assign(this, defaults(this.declaration), { mute: false });
    for (const s of this.declaration.inputs) {
      const type = socketType(s.type)?.babylon;
      if (type === undefined) continue;
      this.registerInput(s.identifier, type, true);
      Object.assign(this.getInputByName(s.identifier), { displayName: s.name, acceptedConnectionPointTypes: [...BABYLON_TYPES] });
    }
    for (const s of this.declaration.outputs) {
      const type = socketType(s.type)?.babylon;
      if (type === undefined) continue;
      this.registerOutput(s.identifier, type);
      adaptOutput(Object.assign(this.getOutputByName(s.identifier), { displayName: s.name }), type);
    }
  }

  getClassName() { return this.idname; }
  get availability() { return availability(this.declaration, this.properties, this.values); }

  // The GLSL of each socket's link, made when first used: a linked input converted to the socket's type, a menu as
  // its item, else the input's uniform; an output's once a step writes it.
  _links(state) {
    if (this._built !== state.sharedData) Object.assign(this, { _built: state.sharedData, _uniforms: [] });
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
    return {
      get: (id) => (links.has(id) || id.startsWith('@') ? links.get(id) : links.set(id, input(id)).get(id)),
      set: (id, v) => links.set(id, v),
    };
  }

  _buildBlock(state) {
    super._buildBlock(state);
    if (state.shaderLanguage !== 0) throw Error(`${this.name}: Blender nodes build GLSL only`);
    const links = this._links(state);
    if (this.mute) muteLinks(this.declaration, this.availability.inputs, links);
    else {
      const steps = SHADER_NODES[this.idname](this.properties, this.declaration);
      state.compilationString += compileSteps(this.declaration, steps, links, {
        emit: (key, code) => state._emitFunction(key, code, ''),
        free: (prefix) => state._getFreeVariableName(prefix),
      });
    }
    for (const output of this.outputs) {
      if (!output.hasEndpoints) continue;
      const kind = kindOfSocket(this.declaration, '@' + output.name);
      state.compilationString += `${state._declareOutput(output)} = ${convert(links.get('@' + output.name) ?? glslValue(0, kind), kind, kindOf(output.type))};\n`;
    }
    state.sharedData.forcedBindableBlocks.push(this);
    return this;
  }

  bind(effect) { setUniforms(effect, this._uniforms ?? [], this.values); }

  serialize() {
    return { ...super.serialize(), blender: { properties: this.properties, values: this.values, mute: this.mute } };
  }

  _deserialize(serialized, scene, rootUrl) {
    super._deserialize(serialized, scene, rootUrl);
    const { properties, values, mute } = serialized.blender ?? {};
    Object.assign(this.properties, properties);
    Object.assign(this.values, values);
    this.mute = !!mute;
  }
}

// A Blender output takes the type of the Babylon inputs it links to, when Blender converts to it, as Blender's code
// generation converts at the link: one Color output can feed a Color3 albedo and other Blender nodes' Float inputs.
function adaptOutput(point, own) {
  const babylonTargets = () => point.endpoints.filter((e) => !(e.ownerBlock instanceof BlenderShaderBlock) && e.type !== own);
  Object.defineProperty(point, 'type', { get: () => babylonTargets()[0]?.type ?? own, set: () => {}, configurable: true });
  const check = point.checkCompatibilityState.bind(point);
  point.checkCompatibilityState = (other) => {
    if (other.ownerBlock instanceof BlenderShaderBlock || other.type === own) return check(other);
    const target = babylonTargets()[0]?.type;
    if (!converts(kindOf(own), kindOf(other.type)) || (target !== undefined && target !== other.type)) return 1;
    const accepted = other.acceptedConnectionPointTypes;
    other.acceptedConnectionPointTypes = [...accepted, point.type];
    try { return check(other); } finally { other.acceptedConnectionPointTypes = accepted; }
  };
}

// The block classes, one per Blender node Bylonder links, registered for Babylon's serialization.
export const shaderNodeClasses = Object.fromEntries(Object.keys(SHADER_NODES).map((idname) => {
  const label = declaration('shader', idname).name;
  const Block = { [idname]: class extends BlenderShaderBlock { constructor(name) { super(name || label, idname); } } }[idname];
  RegisterClass('BABYLON.' + idname, Block);
  return [idname, Block];
}));
