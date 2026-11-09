/**
 * The camera's display transform, its last post process, with the scene's materials drawing in scene linear.
 * @param {Camera} camera
 * @param {Display} display
 */
export function viewTransform(camera: Camera, { exposure, exponent, lattice }: Display): PostProcess;
export function displayTransformShader(size: number, stops: number): string;
export const DISPLAY_UNIFORMS: string[];
export type Camera = import("@babylonjs/core").Camera;
/**
 * The display settings: exposure as a factor, the gamma's exponent, and the lattice: its size, the stops below the
 * view's white its log input spans, that white (`range`), and its texels (RGBA half floats).
 */
export type Display = {
    exposure: number;
    exponent: number;
    lattice: {
        size: number;
        stops: number;
        range: number;
        texels: Uint16Array;
    } | null;
};
import { PostProcess } from '@babylonjs/core';
