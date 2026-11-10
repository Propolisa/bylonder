// @ts-check
// SPDX-License-Identifier: MIT OR Apache-2.0
// Blender's Area light as Babylon's rectangular area light, lit once parsed and casting shadows: Babylon has no shadow
// for its area lights, so this one is a shadow light (Babylon's IShadowLight) whose shadow is a point light's cube from
// its center, as EEVEE's punctual shadow of an area light is. The app's Area Light Shadows extension
// (blenkernel/light/area-light.js), and an exported page's area lights.
import { Matrix, RectAreaLight, Vector3 } from '@babylonjs/core';

/** @typedef {import('@babylonjs/core').Scene} Scene @typedef {import('@babylonjs/core').Camera} Camera */

// The cube's faces in the order Babylon's shadow maps draw them (as its PointLight's).
const CUBE_FACES = [new Vector3(1, 0, 0), new Vector3(-1, 0, 0), new Vector3(0, -1, 0), new Vector3(0, 1, 0), new Vector3(0, 0, 1), new Vector3(0, 0, -1)];

export class AreaLight extends RectAreaLight {
  /** @param {string} name @param {Vector3} position @param {number} width @param {number} height @param {Scene} scene */
  constructor(name, position, width, height, scene) {
    super(name, position, width, height, scene);
    /** @type {Vector3 | null} */
    this.transformedPosition = null;
    /** @type {number | undefined} */
    this.shadowMinZ = undefined;
    /** @type {number | undefined} */
    this.shadowMaxZ = undefined;
  }

  // Babylon scales an area light's intensity by 1 until its intensity mode or radius is set (as a parsed light's are),
  // which then scale it by 0, a light type it has no case for: an area light shines by its intensity alone.
  getScaledIntensity() { return this.intensity; }
  needCube() { return true; }
  needProjectionMatrixCompute() { return false; }
  forceProjectionMatrixCompute() {}
  /** @param {number} faceIndex */
  getShadowDirection(faceIndex) { return CUBE_FACES[faceIndex] ?? CUBE_FACES[0]; }
  getDepthScale() { return 50; }
  /** @param {Camera | null} camera */
  getDepthMinZ(camera) { return this.shadowMinZ ?? camera?.minZ ?? 0; }
  /** @param {Camera | null} camera */
  getDepthMaxZ(camera) { return this.shadowMaxZ ?? camera?.maxZ ?? 10000; }

  // Its world position, with a parent's transform; false when it has none (its position is world).
  computeTransformedInformation() {
    if (!this.parent?.getWorldMatrix) { this.transformedPosition = null; return false; }
    this.transformedPosition ??= Vector3.Zero();
    Vector3.TransformCoordinatesToRef(this.position, this.parent.getWorldMatrix(), this.transformedPosition);
    return true;
  }
  getAbsolutePosition() { return this.computeTransformedInformation() && this.transformedPosition ? this.transformedPosition : this.position; }

  /** A cube face's projection: a quarter turn wide, square, over the shadow's depth range. @param {Matrix} matrix */
  setShadowProjectionMatrix(matrix) {
    const scene = this.getScene(), engine = scene.getEngine(), camera = scene.activeCamera, reverse = engine.useReverseDepthBuffer;
    const minZ = this.getDepthMinZ(camera), maxZ = this.getDepthMaxZ(camera);
    Matrix.PerspectiveFovLHToRef(Math.PI / 2, 1, reverse ? maxZ : minZ, reverse ? minZ : maxZ, matrix, true, engine.isNDCHalfZRange, undefined, reverse);
    return this;
  }
}
