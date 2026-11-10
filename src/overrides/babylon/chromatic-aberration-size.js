// @ts-check
// SPDX-License-Identifier: MIT OR Apache-2.0
// Override of Babylon's chromatic aberration (ThinChromaticAberrationPostProcess.bind, patched on its prototype): its pixels measured on the image it draws, as Babylon takes the screen's size once, when the pipeline is made, so a pipeline made before its canvas has a size measures 1 by 1 and moves red and blue off the picture (Lumen's neon all green) and a render at another size than the screen shifts them by other amounts; goes when Babylon measures the image it draws.
import { ThinChromaticAberrationPostProcess } from '@babylonjs/core';

const bind = ThinChromaticAberrationPostProcess.prototype.bind;
/** @this {any} @param {boolean} [noDefaultBindings] */
ThinChromaticAberrationPostProcess.prototype.bind = function (noDefaultBindings) {
  this.screenWidth = this.options.engine.getRenderWidth();
  this.screenHeight = this.options.engine.getRenderHeight();
  bind.call(this, noDefaultBindings);
};
