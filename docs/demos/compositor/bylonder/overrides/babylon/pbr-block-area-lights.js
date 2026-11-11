// @ts-check
// SPDX-License-Identifier: MIT OR Apache-2.0
// Babylon's PBR node block with all its lights' samplers: Babylon's (PBRMetallicRoughnessBlock.updateUniformsAndSamples) lists each light's samplers but not the area lights' LTC tables, as its LightBlock does, and a light index's own textures (a cluster's, a projection's) only the first time it lists that index (onlyUpdateBuffersList after), so a later material variant's stay on texture unit 0, which a point light's cube shadow map also takes, and every draw of the material fails; goes when Babylon's PBR block lists them. Registered in Babylon's class registry under the block's own name, so a material serialized with it stays plain Babylon's, and parses as this one where this module is loaded.
import { PBRMetallicRoughnessBlock } from '@babylonjs/core/Materials/Node/Blocks/PBR/pbrMetallicRoughnessBlock.js';
import { PrepareUniformsAndSamplersForLight } from '@babylonjs/core/Materials/materialHelper.functions.js';
import { RegisterClass } from '@babylonjs/core/Misc/typeStore.js';

const AREA_LIGHT_SAMPLERS = ['areaLightsLTC1Sampler', 'areaLightsLTC2Sampler'];

export class AreaLitPBRBlock extends PBRMetallicRoughnessBlock {
  /** @param {any} state @param {...any} rest */
  updateUniformsAndSamples(state, ...rest) {
    // @ts-ignore: Babylon's signature names each of the rest.
    super.updateUniformsAndSamples(state, ...rest);
    // What Babylon's full call (not its buffers-only one) gives each lit index.
    const [nodeMaterial, defines] = rest, uniforms = [], samplers = [...AREA_LIGHT_SAMPLERS];
    for (let i = 0; i < nodeMaterial.maxSimultaneousLights && defines[`LIGHT${i}`]; i++) {
      PrepareUniformsAndSamplersForLight(i, uniforms, samplers, defines[`PROJECTEDLIGHTTEXTURE${i}`], [], false, defines[`IESLIGHTTEXTURE${i}`], defines[`CLUSTLIGHT${i}`]);
    }
    for (const name of uniforms) if (!state.uniforms.includes(name)) state.uniforms.push(name);
    for (const name of samplers) if (!state.samplers.includes(name)) state.samplers.push(name);
  }
}
RegisterClass('BABYLON.PBRMetallicRoughnessBlock', AreaLitPBRBlock);
