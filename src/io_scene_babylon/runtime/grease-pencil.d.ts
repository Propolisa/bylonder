/**
 * A drawing's strokes from `first` to `last` curve as GreasedLine points, widths (two per point) and their colors.
 * @param {Drawing} draw
 * @param {number} first
 * @param {number} last
 * @param {number} scale the layer's, by which radii scale
 * @returns {Strokes}
 */
export function strokeArrays(draw: Drawing, first: number, last: number, scale: number): Strokes;
/**
 * A colors texture the size of `count` colors (RGBA floats), laid out as GreasedLine looks them up; `kept` is updated
 * when it has that size.
 * @param {import('@babylonjs/core').Scene} scene
 * @param {Float32Array} colors
 * @param {RawTexture | null} [kept]
 */
export function colorsTexture(scene: import("@babylonjs/core").Scene, colors: Float32Array, kept?: RawTexture | null): RawTexture;
/**
 * GreasedLine widens strokes by the aspect of the view it draws in: each view (and a render) sets it before drawing.
 * @param {import('@babylonjs/core').Scene} scene
 * @param {any} plugin a GreasedLinePluginMaterial
 */
export function followResolution(scene: import("@babylonjs/core").Scene, plugin: any): void;
/**
 * A material for strokes: widths in world units, or in pixels with `sizeAttenuation`.
 * @param {import('@babylonjs/core').Scene} scene
 * @param {string} name
 * @param {boolean} sizeAttenuation
 */
export function greasedLineMaterial(scene: import("@babylonjs/core").Scene, name: string, sizeAttenuation: boolean): import("@babylonjs/core").StandardMaterial;
/**
 * The GreasedLine mesh of strokes, its colors in `texture` (made or updated).
 * @param {import('@babylonjs/core').Scene} scene
 * @param {string} name
 * @param {Strokes} strokes
 * @param {any} plugin the material's GreasedLinePluginMaterial
 * @param {RawTexture | null} [texture]
 */
export function strokesMesh(scene: import("@babylonjs/core").Scene, name: string, { lines, widths, colors }: Strokes, plugin: any, texture?: RawTexture | null): GreasedLineMesh;
/**
 * A material for fills, drawn in their points' colors.
 * @param {import('@babylonjs/core').Scene} scene
 * @param {string} name
 */
export function fillMaterial(scene: import("@babylonjs/core").Scene, name: string): ShaderMaterial & {
    backFaceCulling: boolean;
    disableDepthWrite: boolean;
};
/**
 * A drawing's fills as a mesh (`kept` when given): its points' positions and fill colors, its triangles; null without fills.
 * @param {import('@babylonjs/core').Scene} scene
 * @param {string} name
 * @param {Drawing} draw
 * @param {Mesh | null} [kept]
 */
export function fillMesh(scene: import("@babylonjs/core").Scene, name: string, draw: Drawing, kept?: Mesh | null): Mesh | null;
/**
 * A layer's input as a `grease_pencil:LAYER` entity gives it: its index in the object's layers, blend mode, matrix in its
 * object's space (Babylon's layout), scale, keyed frames and the drawing of each (null: none shown from that key on).
 * @typedef {{ layer: number, blend: number, matrix: number[], scale: number, frames: number[], drawings: (Drawing | null)[] }} Layer
 */
/**
 * The drawing a layer shows at a frame: its last key's at or before it.
 * @param {Pick<Layer, 'frames' | 'drawings'>} layer
 * @param {number} frame
 */
export function drawingAt({ frames, drawings }: Pick<Layer, "frames" | "drawings">, frame: number): Drawing | null;
/**
 * The layer's drawing at the frame, as geometry.
 * @param {Layer & { frame?: number }} inputs
 * @param {{ frame: number }} context
 */
export function run({ frame: _, frames, drawings, ...layer }: Layer & {
    frame?: number;
}, { frame }: {
    frame: number;
}): {
    geometry: {
        grease_pencil: {
            drawing: Drawing | null;
            layer: number;
            blend: number;
            matrix: number[];
            scale: number;
        };
    };
};
/**
 * Draws a layer under its object's node: its drawing shown, the others hidden.
 * @param {import('@babylonjs/core').Scene} scene
 * @param {string} node the object's
 * @param {Omit<Layer, 'frames' | 'drawings'> & { drawing: Drawing | null }} layer
 */
export function drawLayer(scene: import("@babylonjs/core").Scene, node: string, { layer, blend, matrix, scale, drawing }: Omit<Layer, "frames" | "drawings"> & {
    drawing: Drawing | null;
}): void;
export const CURVE_INTS: 5;
export const POINT_FLOATS: 14;
export const CURVE_CYCLIC: 1;
export const CURVE_STROKE: 2;
export const CURVE_FILL: 4;
export const BLEND_MODES: number[];
export function alphaIndex(draw: {
    onion: number;
    layer: number;
}, part: number): number;
export function meanScale(m: ArrayLike<number>): number;
/**
 * A layer's input as a `grease_pencil:LAYER` entity gives it: its index in the object's layers, blend mode, matrix in its
 * object's space (Babylon's layout), scale, keyed frames and the drawing of each (null: none shown from that key on).
 */
export type Layer = {
    layer: number;
    blend: number;
    matrix: number[];
    scale: number;
    frames: number[];
    drawings: (Drawing | null)[];
};
export type Drawing = {
    curves: Int32Array;
    points: Float32Array;
    triangles: Uint32Array;
};
export type Strokes = {
    lines: Float32Array[];
    widths: number[];
    colors: Float32Array;
};
import { RawTexture } from '@babylonjs/core';
import { GreasedLineMesh } from '@babylonjs/core';
import { ShaderMaterial } from '@babylonjs/core';
import { Mesh } from '@babylonjs/core';
