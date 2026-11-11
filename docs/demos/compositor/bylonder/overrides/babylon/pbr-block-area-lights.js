// @ts-check
// SPDX-License-Identifier: MIT OR Apache-2.0
// Babylon's PBR node block with the area lights' samplers: Babylon's (PBRMetallicRoughnessBlock.updateUniformsAndSamples) lists each light's samplers but not the area lights' LTC tables, as its LightBlock does, so they stay on texture unit 0, which a point light's cube shadow map also takes, and every draw of the material fails; goes when Babylon's PBR block lists them.
import { PBRMetallicRoughnessBlock } from '@babylonjs/core/Materials/Node/Blocks/PBR/pbrMetallicRoughnessBlock.js';
import { RegisterClass } from '@babylonjs/core/Misc/typeStore.js';

const AREA_LIGHT_SAMPLERS = ['areaLightsLTC1Sampler', 'areaLightsLTC2Sampler'];
export const AREA_LIT_PBR_BLOCK = 'BylonderAreaLitPBRBlock';

export class AreaLitPBRBlock extends PBRMetallicRoughnessBlock {
  getClassName() { return AREA_LIT_PBR_BLOCK; }
  /** @param {any} state @param {...any} rest */
  updateUniformsAndSamples(state, ...rest) {
    // @ts-ignore: Babylon's signature names each of the rest.
    super.updateUniformsAndSamples(state, ...rest);
    for (const name of AREA_LIGHT_SAMPLERS) if (!state.samplers.includes(name)) state.samplers.push(name);
  }
}
RegisterClass(`BABYLON.${AREA_LIT_PBR_BLOCK}`, AreaLitPBRBlock);
