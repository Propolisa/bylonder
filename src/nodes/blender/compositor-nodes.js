// Blender's compositor nodes as Babylon render graph blocks, inline with Babylon's post-process blocks in one
// NodeRenderGraph. Blender runs a pixel node's GLSL function on each pixel (its compositor's pixel operations); here
// the block is a post process whose fragment shader calls that function on the image input's texel, with unlinked
// inputs as uniforms. A muted node passes its image through, as Babylon's disabled task does.
import { EffectWrapper, FrameGraphPostProcessTask, NodeRenderGraphBlock, NodeRenderGraphBlockConnectionPointTypes as T, RegisterClass } from '@babylonjs/core';
import { availability, declaration, defaults } from './declarations.js';
import { compileSteps, glslIdentifier, kindOfSocket, menuValue, setUniforms, stack } from './node-code.js';
import { convert, glslType, socketType } from './sockets.js';
import '../graph-roots.js';

// Scene linear Rec. 709 to CIE XYZ (D65) and back, the matrices Blender's default color management gives
// IMB_colormanagement_get_scene_linear_to_xyz, as GLSL's column-major mat4.
const REC709_TO_XYZ = [[0.4123908, 0.3575843, 0.1804808], [0.212639, 0.7151687, 0.0721923], [0.0193308, 0.1191948, 0.9505322]];
const XYZ_TO_REC709 = [[3.2409699, -1.5373832, -0.4986108], [-0.9692436, 1.8759675, 0.0415551], [0.0556301, -0.203977, 1.0569715]];
const mat4 = (m) => ({ glsl: `mat4(${[0, 1, 2].map((c) => [0, 1, 2].map((r) => m[r][c]).concat(0)).flat().concat(0, 0, 0, 1).join(', ')})` });

// Each node's steps from its properties (see node-code.js), as its C++ GPU function links them.
export const COMPOSITOR_NODES = {
  // node_composite_color_balance.cc, node_gpu_material
  CompositorNodeColorBalance: (p, decl) => [stack('node_composite_color_balance', decl, [mat4(REC709_TO_XYZ), mat4(XYZ_TO_REC709)])],
};

class BlenderEffect extends EffectWrapper {
  bind(noDefaultBindings) {
    super.bind(noDefaultBindings);
    setUniforms(this.drawWrapper.effect, this.uniformList, this.values);
  }
}

export class BlenderCompositorBlock extends NodeRenderGraphBlock {
  constructor(name, frameGraph, scene, idname) {
    super(name, frameGraph, scene);
    this.idname = idname;
    this.declaration = declaration('compositor', idname);
    Object.assign(this, defaults(this.declaration));
    this.image = this.declaration.inputs.find((s) => s.type === 'RGBA');
    this.result = this.declaration.outputs.find((s) => s.type === 'RGBA');
    this.registerInput(this.image.identifier, T.AutoDetect);
    this.getInputByName(this.image.identifier).addExcludedConnectionPointFromAllowedTypes(T.TextureAllButBackBuffer);
    this._addDependenciesInput();
    this.registerOutput(this.result.identifier, T.BasedOnInput);
    this.getOutputByName(this.result.identifier)._typeConnectionSource = this.getInputByName(this.image.identifier);
    this._frameGraphTask = new FrameGraphPostProcessTask(this.name, frameGraph, this._effect());
  }

  getClassName() { return this.idname; }
  get availability() { return availability(this.declaration, this.properties, this.values); }
  get mute() { return this.disabled; }
  set mute(value) { this.disabled = value; }

  // The fragment shader: the image's texel through the node's steps; the other inputs are uniforms.
  _fragment() {
    const functions = new Map(), uniforms = [];
    let count = 0;
    const links = new Map([[this.image.identifier, 'texture2D(textureSampler, vUV)']]);
    const input = (id) => {
      const s = this.declaration.inputs.find((d) => d.identifier === id), type = socketType(s.type);
      if (s.type === 'MENU') return menuValue(s, this.values[id]);
      const name = glslIdentifier(id);
      uniforms.push([name, id, type.kind]);
      return name;
    };
    const access = {
      get: (id) => (links.has(id) || id.startsWith('@') ? links.get(id) : links.set(id, input(id)).get(id)),
      set: (id, v) => links.set(id, v),
    };
    const body = compileSteps(this.declaration, COMPOSITOR_NODES[this.idname](this.properties, this.declaration), access, {
      emit: (key, code) => functions.set(key, code),
      free: (prefix) => `${prefix}_${count++}`,
    });
    const result = convert(links.get('@' + this.result.identifier), kindOfSocket(this.declaration, '@' + this.result.identifier), 'vec4');
    const code = ['varying vec2 vUV;', 'uniform sampler2D textureSampler;', ...uniforms.map(([n, , kind]) => `uniform ${glslType(kind)} ${n};`),
      ...functions.values(), 'void main(void) {', body + `gl_FragColor = ${result};`, '}'].join('\n');
    return { code, uniforms };
  }

  _effect() {
    const { code, uniforms } = this._fragment();
    const effect = new BlenderEffect({ name: this.name, engine: this._engine, fragmentShader: code, useAsPostProcess: true, uniforms: uniforms.map(([n]) => n) });
    return Object.assign(effect, { code, uniformList: uniforms, values: this.values });
  }

  _buildBlock(state) {
    super._buildBlock(state);
    const task = this._frameGraphTask;
    if (this._fragment().code !== task.postProcess.code) {
      task.postProcess.dispose();
      task.postProcess = this._effect();
      task._postProcessDrawWrapper = task.postProcess.drawWrapper;
    }
    task.postProcess.values = this.values;
    this.getOutputByName(this.result.identifier).value = task.outputTexture;
    task.sourceTexture = this.getInputByName(this.image.identifier).connectedPoint?.value;
  }

  serialize() {
    return { ...super.serialize(), blender: { properties: this.properties, values: this.values, mute: this.mute } };
  }

  _deserialize(serialized) {
    super._deserialize(serialized);
    const { properties, values, mute } = serialized.blender ?? {};
    Object.assign(this.properties, properties);
    Object.assign(this.values, values);
    this.mute = !!mute;
  }
}

// The block classes, one per Blender compositor node Bylonder runs, registered for Babylon's serialization.
export const compositorNodeClasses = Object.fromEntries(Object.keys(COMPOSITOR_NODES).map((idname) => {
  const label = declaration('compositor', idname).name;
  const Block = { [idname]: class extends BlenderCompositorBlock { constructor(name, frameGraph, scene) { super(name || label, frameGraph, scene, idname); } } }[idname];
  RegisterClass('BABYLON.' + idname, Block);
  return [idname, Block];
}));
