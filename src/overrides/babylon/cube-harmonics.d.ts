/** @typedef {import('@babylonjs/core').BaseTexture} BaseTexture */
/** @typedef {import('@babylonjs/core').SphericalPolynomial} SphericalPolynomial */
/**
 * @param {BaseTexture} texture a cube drawn by a render target (its +Y face is face 3)
 * @returns {Promise<SphericalPolynomial | null>}
 */
export function cubeHarmonics(texture: BaseTexture): Promise<SphericalPolynomial | null>;
export type BaseTexture = import("@babylonjs/core").BaseTexture;
export type SphericalPolynomial = import("@babylonjs/core").SphericalPolynomial;
