/**
 * The reduction and FFT domain of an image of `size`: blocks of `factor` texels, `small` blocks, `domain` texels.
 * @param {number[]} size
 * @typedef {{ factor: number, small: number[], domain: number[] }} Layout
 * @returns {Layout}
 */
export function convolutionLayout([width, height]: number[]): Layout;
/**
 * The kernel's spectrum on the FFT domain, real as the kernel is even, divided by the normalization and by the domain's
 * size (the inverse FFT's scale): each block's kernel, the kernel summed over the texels of a block of `factor`.
 * @param {Layout} layout @param {(x: number, y: number) => number} kernel @param {number} normalization
 */
export function kernelSpectrum({ factor, domain: [w, h] }: Layout, kernel: (x: number, y: number) => number, normalization: number): Float32Array<ArrayBuffer>;
/**
 * A replay step convolving the RGB of `step.source` (an image of `step.size`) with `kernel(x, y, degreesPerTexel)` over
 * `step.normalization`, into a new version of `step.target` with the source's alpha, as Blender's execute_fog_glow
 * writes its glow; the kernel's angle per texel is `step.fieldOfView` over the image's larger side. `task` is the
 * replay task (blocks.js ReplayTask), `read(id)` a recorded texture's current handle. Gives the target's handle.
 * @param {any} task
 * @param {{ source: number, target: number, size: number[], fieldOfView: number, normalization: number }} step
 * @param {(id: number) => number} read
 * @param {(x: number, y: number, degreesPerTexel: number) => number} kernel
 * @returns {number}
 */
export function fftConvolution(task: any, step: {
    source: number;
    target: number;
    size: number[];
    fieldOfView: number;
    normalization: number;
}, read: (id: number) => number, kernel: (x: number, y: number, degreesPerTexel: number) => number): number;
export const MAX_KERNEL: 512;
/**
 * The reduction and FFT domain of an image of `size`: blocks of `factor` texels, `small` blocks, `domain` texels.
 */
export type Layout = {
    factor: number;
    small: number[];
    domain: number[];
};
