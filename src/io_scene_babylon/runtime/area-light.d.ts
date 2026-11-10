export class AreaLight extends RectAreaLight {
    /** @param {string} name @param {Vector3} position @param {number} width @param {number} height @param {Scene} scene */
    constructor(name: string, position: Vector3, width: number, height: number, scene: Scene);
    /** @type {Vector3 | null} */
    transformedPosition: Vector3 | null;
    /** @type {number | undefined} */
    shadowMinZ: number | undefined;
    /** @type {number | undefined} */
    shadowMaxZ: number | undefined;
    needCube(): boolean;
    needProjectionMatrixCompute(): boolean;
    forceProjectionMatrixCompute(): void;
    /** @param {number} faceIndex */
    getShadowDirection(faceIndex: number): Vector3;
    getDepthScale(): number;
    /** @param {Camera | null} camera */
    getDepthMinZ(camera: Camera | null): number;
    /** @param {Camera | null} camera */
    getDepthMaxZ(camera: Camera | null): number;
    computeTransformedInformation(): boolean;
    /** A cube face's projection: a quarter turn wide, square, over the shadow's depth range. @param {Matrix} matrix */
    setShadowProjectionMatrix(matrix: Matrix): this;
}
export type Scene = import("@babylonjs/core").Scene;
export type Camera = import("@babylonjs/core").Camera;
import { RectAreaLight } from '@babylonjs/core';
import { Vector3 } from '@babylonjs/core';
import { Matrix } from '@babylonjs/core';
