/**
 * A 3x3 matrix's rotation and scale, A = R S with S symmetric (the polar decomposition, by Higham's iteration).
 * @param {number[]} a column-major 3x3
 */
export function polar(a: number[]): {
    r: number[];
    s: number[];
};
/**
 * Skin matrices (Babylon's, 16 floats each: a column-major matrix acting on column vectors) packed for the shader:
 * per bone the real and dual parts of its unit dual quaternion, then its scale's six entries (s00 s01 s02 s11 s12 s22).
 * @param {ArrayLike<number>} matrices @param {Float32Array} [out]
 */
export function packDualQuaternions(matrices: ArrayLike<number>, out?: Float32Array): Float32Array<ArrayBufferLike>;
/**
 * A point skinned by packed dual quaternions, as the shader skins it: the CPU reference of the same math.
 * @param {Float32Array} packed @param {[number, number][]} influences bone index and weight, strongest first
 * @param {number[]} p
 */
export function skinPoint(packed: Float32Array, influences: [number, number][], p: number[]): number[];
/**
 * Turns dual quaternion skinning on or off for a skinned mesh: its materials blend the bones' dual quaternions (a PBR
 * or Standard material by the plugin; a NodeMaterial's BonesBlock is swapped for DualQuaternionBonesBlock, which
 * draws its other meshes as BonesBlock does, so files keep Babylon's own block).
 * @param {import('@babylonjs/core').AbstractMesh} mesh @param {boolean} on
 */
export function useDualQuaternionSkinning(mesh: import("@babylonjs/core").AbstractMesh, on: boolean): void;
/** A PBR or Standard material's dual quaternion skinning. */
export class DualQuaternionSkinningPlugin extends MaterialPluginBase {
    /** @param {import('@babylonjs/core').Material} material */
    constructor(material: import("@babylonjs/core").Material);
    /** @param {any} defines @param {any} scene @param {import('@babylonjs/core').AbstractMesh} mesh */
    prepareDefines(defines: any, scene: any, mesh: import("@babylonjs/core").AbstractMesh): void;
    /** @param {any} uniformBuffer @param {any} scene @param {any} engine @param {import('@babylonjs/core').SubMesh} subMesh */
    bindForSubMesh(uniformBuffer: any, scene: any, engine: any, subMesh: import("@babylonjs/core").SubMesh): void;
    isCompatible(): boolean;
    /** @param {string} shaderType @param {number} [language] 1: WGSL */
    getCustomCode(shaderType: string, language?: number): {
        [x: string]: string;
        CUSTOM_VERTEX_DEFINITIONS: string;
        '!finalWorld=finalWorld\\*influence;': string;
    } | null;
}
/** A node material's bones, blended as dual quaternions on the meshes that use them, else as Babylon's BonesBlock. */
export class DualQuaternionBonesBlock extends BonesBlock {
    /** Babylon's, and the extra four influences' attributes, which a mesh of up to 8 influences reads. @param {any} material @param {any} [filter] */
    autoConfigure(material: any, filter?: any): void;
    /** @param {any} defines @param {any} nodeMaterial @param {import('@babylonjs/core').AbstractMesh} mesh */
    prepareDefines(defines: any, nodeMaterial: any, mesh: import("@babylonjs/core").AbstractMesh): void;
    /** @param {import('@babylonjs/core').Effect} effect @param {any} nodeMaterial @param {import('@babylonjs/core').Mesh} mesh */
    bind(effect: import("@babylonjs/core").Effect, nodeMaterial: any, mesh: import("@babylonjs/core").Mesh): void;
    /** @param {any} state */
    _buildBlock(state: any): this;
}
import { MaterialPluginBase } from '@babylonjs/core';
import { BonesBlock } from '@babylonjs/core';
