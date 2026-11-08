// EEVEE's world sun (eevee_lightprobe_sphere_bake.bsl.hh sun_extraction): the world's light above its Sun Threshold is
// taken out of the world probe and lit as a sun light, with shadows, from the mean direction of that light. A studio
// light's image is read as Babylon's EXRCubeTexture reads it; its texels are clamped before Babylon lays them on the
// cube, so its reflections and its spherical harmonics are the clamped world's as in EEVEE's probe, and what the clamp
// took is summed into the sun.
import { Color3, EXRCubeTexture, PanoramaToCubeMapTools, ReadExrDataAsync, SphericalHarmonics, SphericalPolynomial, Vector3 } from '@babylonjs/core';

// blender-port: eevee_colorspace_lib.bsl.hh brightness_clamp_max: a texel scaled down to `limit` at its brightest
// channel, in place, what it took into `taken`.
function brightnessClampMax(data, i, limit, taken) {
  const scale = Math.min(1, limit / Math.max(1e-8, Math.abs(data[i]), Math.abs(data[i + 1]), Math.abs(data[i + 2])));
  for (let c = 0; c < 3; c++) { taken[c] = data[i + c] * (1 - scale); data[i + c] *= scale; }
}

// The light above `threshold` of an equirectangular image (RGBA rows), clamped away in place: { color (the sun's
// irradiance), direction (towards it, in the cube's axes as PanoramaToCubeMapTools lays the image out) }, or null.
export function extractSun(data, width, height, threshold) {
  if (!(threshold > 0)) return null;
  const sum = [0, 0, 0], mean = new Vector3(), taken = [0, 0, 0];
  for (let y = 0; y < height; y++) {
    const phi = (Math.PI * (y + 0.5)) / height, solidAngle = Math.sin(phi) * (Math.PI / height) * ((2 * Math.PI) / width);
    for (let x = 0; x < width; x++) {
      brightnessClampMax(data, (y * width + x) * 4, threshold, taken);
      const strength = Math.hypot(...taken) * solidAngle;
      if (!strength) continue;
      for (let c = 0; c < 3; c++) sum[c] += taken[c] * solidAngle;
      // The texel's direction as CalcProjectionSpherical reads it (theta from X towards Z, phi from Y), on the face
      // Babylon uploads it to: X and Z swapped, Y turned over.
      const theta = ((x + 0.5) / width * 2 - 1) * Math.PI;
      mean.addInPlaceFromFloats(Math.sin(phi) * Math.sin(theta) * strength, -Math.cos(phi) * strength, Math.sin(phi) * Math.cos(theta) * strength);
    }
  }
  return sum[0] + sum[1] + sum[2] > 0 ? { color: Color3.FromArray(sum), direction: mean.normalize() } : null;
}

// A studio light's image with its sun taken out (`sun`, once loaded), as EEVEE's lookdev world holds it.
export class StudioLightTexture extends EXRCubeTexture {
  constructor(url, scene, size, threshold) {
    super(url, scene, size, false, true, false, true);
    this.threshold = threshold;
    this.sun = null;
  }

  async _getCubeMapTextureDataAsync(buffer, size, supersample) {
    const { width, height, data } = await ReadExrDataAsync(buffer);
    if (!data) throw new Error('EXR data could not be decoded.');
    this.sun = extractSun(data, width, height, this.threshold);
    return PanoramaToCubeMapTools.ConvertPanoramaToCubemap(data, width, height, size, supersample, false);
  }
}

// A cube's diffuse lighting as EEVEE's world probe keeps it: its spherical harmonics to the first band
// (eevee_lightprobe_sphere_bake.bsl.hh irradiance_sum: SphereProbeHarmonic holds L0 and L1 only).
export function firstBand(polynomial) {
  const harmonics = SphericalHarmonics.FromPolynomial(polynomial);
  for (const key of ['l2_2', 'l2_1', 'l20', 'l21', 'l22']) harmonics[key].setAll(0);
  return SphericalPolynomial.FromHarmonics(harmonics);
}
