// @ts-check
// SPDX-License-Identifier: MIT OR Apache-2.0
// A cube texture's spherical harmonics read back without stalling the page: on WebGL 2 its faces are copied into pixel
// buffers and read once a fence says the GPU is done, where Babylon's readback (CubeMapToSphericalPolynomialTools)
// waits for the GPU on the main thread (seconds on a large scene's load); goes when Babylon reads textures back async.
import { Constants, CubeMapToSphericalPolynomialTools } from '@babylonjs/core';

/** @typedef {import('@babylonjs/core').BaseTexture} BaseTexture */
/** @typedef {import('@babylonjs/core').SphericalPolynomial} SphericalPolynomial */

/**
 * @param {BaseTexture} texture a cube drawn by a render target (its +Y face is face 3)
 * @returns {Promise<SphericalPolynomial | null>}
 */
export function cubeHarmonics(texture) {
  const engine = /** @type {any} */ (texture.getScene()?.getEngine()), gl = engine?._gl, internal = texture.getInternalTexture();
  const resource = /** @type {any} */ (internal)?._hardwareTexture?.underlyingResource;
  if (typeof WebGL2RenderingContext === 'undefined' || !(gl instanceof WebGL2RenderingContext) || !internal || !resource) {
    return Promise.resolve(CubeMapToSphericalPolynomialTools.ConvertCubeMapTextureToSphericalPolynomial(texture));
  }
  const size = internal.width, bytes = size * size * 16, framebuffer = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
  const buffers = [0, 1, 2, 3, 4, 5].map((face) => {
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_CUBE_MAP_POSITIVE_X + face, resource, 0);
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, buffer);
    gl.bufferData(gl.PIXEL_PACK_BUFFER, bytes, gl.STREAM_READ);
    gl.readPixels(0, 0, size, size, gl.RGBA, gl.FLOAT, 0);
    return buffer;
  });
  gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
  gl.bindFramebuffer(gl.FRAMEBUFFER, engine._currentFramebuffer);
  gl.deleteFramebuffer(framebuffer);
  const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
  gl.flush();
  return new Promise((resolve) => {
    const read = () => {
      if (gl.clientWaitSync(sync, 0, 0) === gl.TIMEOUT_EXPIRED) return void setTimeout(read, 4);
      gl.deleteSync(sync);
      const [right, left, down, up, front, back] = buffers.map((buffer) => {
        const pixels = new Float32Array(bytes / 4);
        gl.bindBuffer(gl.PIXEL_PACK_BUFFER, buffer);
        gl.getBufferSubData(gl.PIXEL_PACK_BUFFER, 0, pixels);
        gl.deleteBuffer(buffer);
        return pixels;
      });
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
      resolve(CubeMapToSphericalPolynomialTools.ConvertCubeMapToSphericalPolynomial({
        size, right, left, up, down, front, back, format: Constants.TEXTUREFORMAT_RGBA, type: Constants.TEXTURETYPE_FLOAT, gammaSpace: texture.gammaSpace }));
    };
    read();
  });
}
