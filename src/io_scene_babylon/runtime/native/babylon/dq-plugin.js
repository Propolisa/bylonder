// @ts-nocheck
// SPDX-License-Identifier: MIT OR Apache-2.0
// From babylon-blender-rig (scripts/native-rig.mjs).
// Preserve Volume skinning (dual quaternions with scale, specs/armature_modifier.md) as a Babylon material plugin.
// The mesh has no Babylon skeleton; the plugin deforms positionUpdated (after morph targets) from a float texture of
// per-joint data (src/deform/binding.js dualQuatData: q, e and the scale matrix S, six texels per joint) and the
// mesh's joint indices and weights (vertex buffers rigJoints0/1, rigWeights0/1, the weights summing to the
// modifier's mask). skinDQ in binding.js is the same math on the CPU.
import { MaterialPluginBase } from '@babylonjs/core/Materials/materialPluginBase.js';
import { RawTexture } from '@babylonjs/core/Materials/Textures/rawTexture.js';
import { Constants } from '@babylonjs/core/Engines/constants.js';
import { ShaderLanguage } from '@babylonjs/core/Materials/shaderLanguage.js';

const TEXELS = 6;

export class RigDualQuatPlugin extends MaterialPluginBase {
  constructor(material) {
    super(material, 'RigDualQuat', 200, { RIGDQ: false });
    this._enable(true);
  }

  getClassName() { return 'RigDualQuatPlugin'; }

  isCompatible(language) { return language === ShaderLanguage.GLSL; }

  prepareDefines(defines, scene, mesh) {
    defines.RIGDQ = !!mesh.metadata?.rigDualQuat;
  }

  getAttributes(attributes, scene, mesh) {
    if (mesh.metadata?.rigDualQuat) attributes.push('rigJoints0', 'rigWeights0', 'rigJoints1', 'rigWeights1');
  }

  getSamplers(samplers) { samplers.push('rigDQ'); }

  getUniforms() {
    return {
      ubo: [{ name: 'rigPre', size: 16, type: 'mat4' }, { name: 'rigPreInv', size: 16, type: 'mat4' }, { name: 'rigDQWidth', size: 1, type: 'float' }],
      vertex: '#ifdef RIGDQ\nuniform mat4 rigPre;\nuniform mat4 rigPreInv;\nuniform float rigDQWidth;\n#endif\n',
    };
  }

  bindForSubMesh(ubo, scene, engine, subMesh) {
    const data = subMesh.getMesh().metadata?.rigDualQuat;
    if (!data) return;
    ubo.updateMatrix('rigPre', data.pre);
    ubo.updateMatrix('rigPreInv', data.preInv);
    ubo.updateFloat('rigDQWidth', data.width);
    ubo.setTexture('rigDQ', data.texture);
  }

  getCustomCode(shaderType) {
    if (shaderType !== 'vertex') return null;
    return {
      CUSTOM_VERTEX_DEFINITIONS: `#ifdef RIGDQ
attribute vec4 rigJoints0; attribute vec4 rigWeights0; attribute vec4 rigJoints1; attribute vec4 rigWeights1;
uniform sampler2D rigDQ;
vec4 rigFetch(float joint, int k) {
  int i = int(joint) * ${TEXELS} + k, w = int(rigDQWidth);
  return texelFetch(rigDQ, ivec2(i - (i / w) * w, i / w), 0);
}
vec4 rigQmul(vec4 a, vec4 b) {
  return vec4(a.w * b.xyz + b.w * a.xyz + cross(a.xyz, b.xyz), a.w * b.w - dot(a.xyz, b.xyz));
}
#endif
`,
      CUSTOM_VERTEX_UPDATE_POSITION: `#ifdef RIGDQ
{
  vec3 p = (rigPre * vec4(positionUpdated, 1.0)).xyz;
  vec4 Q = vec4(0.0), E = vec4(0.0), A = vec4(0.0), first = vec4(0.0);
  float m = 0.0;
  for (int i = 0; i < 8; i++) {
    float w = i < 4 ? rigWeights0[i] : rigWeights1[i - 4];
    if (w == 0.0) continue;
    float j = i < 4 ? rigJoints0[i] : rigJoints1[i - 4];
    vec4 q = rigFetch(j, 0), e = rigFetch(j, 1);
    mat4 S = mat4(rigFetch(j, 2), rigFetch(j, 3), rigFetch(j, 4), rigFetch(j, 5));
    if (m == 0.0) first = q;
    if (dot(q, first) < 0.0) { q = -q; e = -e; }
    A += w * rigQmul(q, vec4((S * vec4(p, 1.0)).xyz, 0.0));
    Q += w * q; E += w * e; m += w;
  }
  if (m > 0.0) {
    float N = dot(Q, Q);
    vec4 Qc = vec4(-Q.xyz, Q.w);
    vec3 d = (rigQmul(A, Qc).xyz + rigQmul(2.0 * E, Qc).xyz) / N;
    positionUpdated = mix(positionUpdated, (rigPreInv * vec4(d, 1.0)).xyz, m);
#ifdef NORMAL
    vec4 r = Q / sqrt(N);
    vec3 n = mat3(rigPre) * normalUpdated;
    n += 2.0 * cross(r.xyz, cross(r.xyz, n) + r.w * n);
    normalUpdated = normalize(mix(normalUpdated, mat3(rigPreInv) * n, m));
#endif
  }
}
#endif
`,
    };
  }
}

// The per-mesh data the plugin binds: a float texture of the joints' dual quaternion data, updated each frame.
export class DualQuatTexture {
  constructor(scene, jointCount) {
    const texels = Math.max(1, jointCount * TEXELS);
    const max = scene.getEngine().getCaps().maxTextureSize || 4096;
    this.width = Math.min(texels, max);
    this.height = Math.ceil(texels / this.width);
    this.buffer = new Float32Array(this.width * this.height * 4);
    this.texture = RawTexture.CreateRGBATexture(this.buffer, this.width, this.height, scene, false, false, Constants.TEXTURE_NEAREST_SAMPLINGMODE, Constants.TEXTURETYPE_FLOAT);
  }

  update(data) {
    this.buffer.set(data);
    this.texture.update(this.buffer);
  }
}
