/** @typedef {import('@babylonjs/core').BaseTexture} BaseTexture */
/** @typedef {import('@babylonjs/core').SphericalPolynomial} SphericalPolynomial */
/**
 * @param {BaseTexture} texture a cube in the usual face order (+X, -X, +Y, -Y, +Z, -Z), as an upright probe draws it
 * @returns {Promise<SphericalPolynomial | null>}
 */
export function cubeHarmonics(texture: BaseTexture): Promise<SphericalPolynomial | null>;
export type BaseTexture = import("@babylonjs/core").BaseTexture;
export type SphericalPolynomial = import("@babylonjs/core").SphericalPolynomial;
