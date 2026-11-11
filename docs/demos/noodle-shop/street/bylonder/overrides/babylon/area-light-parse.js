// @ts-check
// SPDX-License-Identifier: MIT OR Apache-2.0
// Override of Babylon's light parser (Light.Parse): a rectangular area light made by a given class, as Babylon's RectAreaLight, once the parser sets its radius, scales its intensity by 0 (a photometric case it lacks) and no parse option names another class; goes when Babylon scales a parsed area light by its intensity.
import { Light } from '@babylonjs/core/Lights/light.js';
import { Node } from '@babylonjs/core/node.js';
import { RectAreaLight } from '@babylonjs/core/Lights/rectAreaLight.js';
import { Vector3 } from '@babylonjs/core/Maths/math.vector.js';

// The constructor Babylon's Light.Parse makes an area light (light type 4) with.
const AREA = 'Light_Type_4';

/**
 * A serialized light parsed as Babylon's loader parses it, an area light as `AreaLight`.
 * @param {any} entry @param {import('@babylonjs/core').Scene} scene @param {typeof RectAreaLight} AreaLight
 */
export function parseLight(entry, scene, AreaLight) {
  if (entry.type !== Light.LIGHTTYPEID_RECT_AREALIGHT) return Light.Parse(entry, scene);
  Node.AddNodeConstructor(AREA, (name, scene) => () => new AreaLight(name, Vector3.Zero(), 1, 1, scene));
  try {
    return Light.Parse(entry, scene);
  } finally {
    Node.AddNodeConstructor(AREA, (name, scene) => () => new RectAreaLight(name, Vector3.Zero(), 1, 1, scene));
  }
}
