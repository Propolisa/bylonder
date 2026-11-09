// @ts-check
// SPDX-License-Identifier: MIT OR Apache-2.0
// Override of Babylon on WebGPU: a world's light cube in half floats, as Babylon's bind group marks the wrong sampler non-filtering for a 32 bit float texture on a device without float32-filterable (every frame then fails); goes when Babylon lays that out right.
import { Constants } from '@babylonjs/core';

export const WORLD_CUBE_TYPE = Constants.TEXTURETYPE_HALF_FLOAT;
