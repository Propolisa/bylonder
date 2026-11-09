// SPDX-License-Identifier: MIT OR Apache-2.0
// Override of Babylon's DefaultRenderingPipeline (its _buildPipeline): built without its image processing post process, which the display transform replaces, as its own switch turns the scene's image processing off for every material and a PBR material then encodes its color to display itself; goes when Babylon's switch leaves materials in scene linear.
import { DefaultRenderingPipeline } from '@babylonjs/core';

export class SceneLinearPipeline extends DefaultRenderingPipeline {
  _buildPipeline() {
    this._imageProcessingEnabled = false;
    super._buildPipeline();
  }
}
