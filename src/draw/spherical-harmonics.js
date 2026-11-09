// EEVEE's first-band spherical harmonics of four channels (eevee_spherical_harmonics.bsl.hh SphericalHarmonicL1<float4>),
// for the light probes the page bakes and loads (light-probes.js): 16 floats, the coefficients L0.M0, L1.Mn1, L1.M0 and
// L1.Mp1 in turn, each RGBA (light, and the visibility of distant light in A). Directions are Blender's axes.
export const L0 = 0, MN1 = 4, M0 = 8, MP1 = 12;
const C0 = 0.282094792, C1 = 0.488602512;

export const shNew = () => new Float32Array(16);

// blender-port: eevee_spherical_harmonics.bsl.hh L0_M0_coef .. L1_Mp1_coef: the basis at a unit direction.
export const shBasis = ([x, y, z]) => [C0, -C1 * y, C1 * z, -C1 * x];

// blender-port: eevee_spherical_harmonics.bsl.hh encode_signal_sample: `amplitude` (4 channels) seen along `direction`,
// already scaled by its solid angle.
export function shEncode(sh, direction, amplitude) {
  const basis = shBasis(direction);
  for (let k = 0; k < 4; k++) for (let c = 0; c < 4; c++) sh[k * 4 + c] += basis[k] * amplitude[c];
  return sh;
}

// blender-port: eevee_spherical_harmonics.bsl.hh evaluate_lambert: the Lambertian radiance (cosine lobe over pi) toward N.
export function shEvaluateLambert(sh, N) {
  const basis = shBasis(N);
  return [0, 1, 2, 3].map((c) => Math.max(0, basis[0] * sh[c] + (basis[1] * sh[MN1 + c] + basis[2] * sh[M0 + c] + basis[3] * sh[MP1 + c]) * (2 / 3)));
}

export const shMul = (sh, factor) => sh.map((v) => v * factor);
export const shAdd = (a, b) => a.map((v, i) => v + b[i]);
// a * b + c.
export const shMadd = (a, b, c) => a.map((v, i) => v * b + c[i]);

// blender-port: eevee_spherical_harmonics.bsl.hh triple_product (SH_product_3).
export function shTripleProduct(a, b) {
  const out = shNew();
  for (let c = 0; c < 4; c++) {
    out[c] = C0 * (a[c] * b[c] + a[MN1 + c] * b[MN1 + c] + a[M0 + c] * b[M0 + c] + a[MP1 + c] * b[MP1 + c]);
    for (const k of [MN1, M0, MP1]) out[k + c] = C0 * (a[c] * b[k + c] + b[c] * a[k + c]);
  }
  return out;
}

// blender-port: eevee_spherical_harmonics.bsl.hh rotate: the first band turned by `rotation` (3x3, rows), each channel's
// L1 as the vector (Mp1, Mn1, -M0).
export function shRotate(rotation, sh) {
  const out = Float32Array.from(sh);
  for (let c = 0; c < 4; c++) {
    const v = [sh[MP1 + c], sh[MN1 + c], -sh[M0 + c]];
    const r = rotation.map((row) => row[0] * v[0] + row[1] * v[1] + row[2] * v[2]);
    out[MN1 + c] = r[1];
    out[M0 + c] = -r[2];
    out[MP1 + c] = r[0];
  }
  return out;
}

// blender-port: eevee_spherical_harmonics.bsl.hh dering: the first band scaled down so that no channel's Lambertian
// evaluation goes negative, by the factor of the most directional color channel.
export function shDering(sh) {
  const weight = C1 * (2 / 3) + 0.05;
  const factors = [0, 1, 2].map((c) => Math.max(Math.abs(sh[c]) * C0, 1e-8) / Math.max(1e-8, Math.hypot(sh[MN1 + c], sh[M0 + c], sh[MP1 + c]) * weight));
  const factor = Math.min(...factors);
  if (factor >= 1) return sh;
  const out = Float32Array.from(sh);
  for (const k of [MN1, M0, MP1]) for (let c = 0; c < 4; c++) out[k + c] *= factor;
  return out;
}
