// SPDX-License-Identifier: MIT OR Apache-2.0
// Override of Babylon's EXRCubeTexture readiness on WebGPU: an environment prefiltered on load is ready for materials only once filtered, as Babylon swaps the filtered texture into the one it uploaded first, which a WebGPU bind group made in between would keep; goes when Babylon's bind groups follow the swap.
import { EXRCubeTexture } from '@babylonjs/core';

export class PrefilteredEXRCubeTexture extends EXRCubeTexture {
  #filtered = false;
  constructor(url, scene, size) {
    super(url, scene, size, false, true, false, true);
    this.onLoadObservable.addOnce(() => { this.#filtered = true; });
  }
  isReady() { return this.#filtered && super.isReady(); }
}
