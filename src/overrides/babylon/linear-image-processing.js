// @ts-check
// SPDX-License-Identifier: MIT OR Apache-2.0
// Override of Babylon's image processing post process (ThinImageProcessingPostProcess._updateParameters, patched on its prototype): while the scene's image processing applies by post process (a rendered view in scene linear, whose display transform displays it), a pipeline's image processing passes scene linear on unchanged, as Babylon's applies exposure, tone mapping and grading and encodes to display, which the display transform then displays a second time; goes when Babylon's post process can leave scene linear as it is.
import { ThinImageProcessingPostProcess } from '@babylonjs/core';

const update = ThinImageProcessingPostProcess.prototype._updateParameters;
/** @this {any} */
ThinImageProcessingPostProcess.prototype._updateParameters = function () {
  const config = this.imageProcessingConfiguration;
  if (!config.applyByPostProcess) return update.call(this);
  // Defines as for a material while the post process applies them: none, and no conversion from linear.
  const fromLinearSpace = this._fromLinearSpace;
  const prepare = Object.getPrototypeOf(config).prepareDefines;
  config.prepareDefines = (/** @type {any} */ defines) => prepare.call(config, defines, false);
  this._fromLinearSpace = false;
  try {
    update.call(this);
  } finally {
    delete config.prepareDefines;
    this._fromLinearSpace = fromLinearSpace;
  }
};
