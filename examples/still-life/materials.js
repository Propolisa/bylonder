import { texture, normalMap, fbm, noise, mix, clamp01 } from './lib/textures.js';

// A PBR material; nested settings (clearCoat, sheen, subSurface) go into the material's own configurations.
function pbr(scene, name, settings) {
  const material = new BABYLON.PBRMaterial(name, scene);
  for (const [key, value] of Object.entries(settings)) {
    if (value?.constructor === Object) Object.assign(material[key], value);
    else material[key] = value;
  }
  return material;
}
const color = (r, g, b) => new BABYLON.Color3(r, g, b);
const tiled = (tex, scale) => { tex.uScale = tex.vScale = scale; return tex; };

// Walnut planks: growth rings bent by noise, fine pores, and a satin oil finish.
function walnut(scene) {
  const rings = (u, v) => {
    const warp = fbm(u, v, { scale: 3, seed: 3 }) * 6;
    const ring = (v * 9 + warp + Math.sin(u * Math.PI * 2) * 0.3) % 1;
    return Math.pow(Math.abs(ring * 2 - 1), 3);
  };
  const albedo = texture(scene, 'Walnut Color', 512, (u, v) => {
    const pores = noise(u * 512, v * 24, 512, 9);
    return mix(mix([0.16, 0.085, 0.045], [0.33, 0.19, 0.1], rings(u, v)), [0.09, 0.05, 0.03], pores * 0.35);
  });
  return pbr(scene, 'Walnut', {
    albedoTexture: tiled(albedo, 2), bumpTexture: tiled(normalMap(scene, 'Walnut Normal', 512, (u, v) => rings(u, v) * 0.6 + noise(u * 512, v * 24, 512, 9) * 0.4, 1.5), 2),
    metallic: 0, roughness: 0.42, clearCoat: { isEnabled: true, intensity: 0.35, roughness: 0.25 },
  });
}

// Lime plaster in warm umber, darker toward the corners: the backdrop of a Dutch still life.
function plaster(scene) {
  const albedo = texture(scene, 'Plaster Color', 256, (u, v) => {
    const mottle = fbm(u, v, { scale: 3, seed: 21 });
    return mix([0.18, 0.15, 0.11], [0.38, 0.32, 0.23], mottle);
  });
  return pbr(scene, 'Plaster', { albedoTexture: albedo, bumpTexture: normalMap(scene, 'Plaster Normal', 256, (u, v) => fbm(u, v, { scale: 16, seed: 5 }), 3), metallic: 0, roughness: 0.95 });
}

// Linen: a plain weave of slubby threads, with sheen for the fibres catching the light.
function linen(scene) {
  const weave = (u, v) => {
    const warp = 0.5 + 0.5 * Math.sin(u * Math.PI * 2 * 128), weft = 0.5 + 0.5 * Math.sin(v * Math.PI * 2 * 128);
    const over = Math.sin(u * Math.PI * 128) * Math.sin(v * Math.PI * 128) > 0;
    return (over ? warp : weft) * (0.75 + 0.25 * noise(u * 64, v * 6, 64, 2));
  };
  const albedo = texture(scene, 'Linen Color', 512, (u, v) => mix([0.42, 0.38, 0.31], [0.6, 0.56, 0.47], weave(u, v) * 0.35 + fbm(u, v, { scale: 6, seed: 7 }) * 0.65));
  return pbr(scene, 'Linen', {
    albedoTexture: tiled(albedo, 4), bumpTexture: tiled(normalMap(scene, 'Linen Normal', 512, weave, 0.8), 4), metallic: 0, roughness: 0.85,
    sheen: { isEnabled: true, intensity: 0.6, color: color(1, 0.95, 0.85), roughness: 0.4 },
  });
}

// Celadon glaze over stoneware: speckled body, glassy clear coat with a faint blue tint.
function celadon(scene) {
  const albedo = texture(scene, 'Celadon Color', 512, (u, v) => {
    const speckle = noise(u * 300, v * 300, 300, 4) > 0.86 ? 0.55 : 1;
    return mix([0.42, 0.62, 0.54], [0.66, 0.8, 0.7], fbm(u, v, { scale: 5, seed: 11 })).map((c) => c * speckle);
  });
  return pbr(scene, 'Celadon', { albedoTexture: albedo, metallic: 0, roughness: 0.35, clearCoat: { isEnabled: true, intensity: 1, roughness: 0.03, indexOfRefraction: 1.52, isTintEnabled: true, tintColor: color(0.85, 0.95, 1), tintThickness: 0.4 } });
}

// Clear glass with refraction, a little green in its thickness as old window glass has.
const glass = (scene, name, tint) => pbr(scene, name, {
  albedoColor: color(0, 0, 0), metallic: 0, roughness: 0.02, indexOfRefraction: 1.5,
  subSurface: { isRefractionEnabled: true, refractionIntensity: 1, tintColor: tint, tintColorAtDistance: 0.25, indexOfRefraction: 1.5 },
  environmentIntensity: 1.2, alpha: 1,
});

// Polished and hammered metals.
const brass = (scene) => pbr(scene, 'Brass', { albedoColor: color(0.95, 0.72, 0.38), metallic: 1, roughness: 0.22, bumpTexture: normalMap(scene, 'Hammered Normal', 256, (u, v) => noise(u * 40, v * 40, 40, 31), 0.6) });
const silver = (scene) => pbr(scene, 'Silver', { albedoColor: color(0.96, 0.95, 0.93), metallic: 1, roughness: 0.08 });

// Lemon peel: waxy, pitted with pores, light scattering under the skin.
function lemon(scene) {
  const pores = (u, v) => 1 - Math.pow(noise(u * 160, v * 80, 160, 13), 2);
  return pbr(scene, 'Lemon Peel', {
    albedoTexture: texture(scene, 'Lemon Color', 256, (u, v) => mix([1, 0.78, 0.04], [1, 0.92, 0.25], fbm(u, v, { scale: 4, seed: 8 }))),
    bumpTexture: normalMap(scene, 'Lemon Normal', 256, pores, 1.2), metallic: 0, roughness: 0.32,
  });
}

// Pear skin: russet freckles over yellow-green.
function pear(scene) {
  const albedo = texture(scene, 'Pear Color', 256, (u, v) => {
    const blush = clamp01(fbm(u, v, { scale: 2, seed: 41 }) * 2 - 0.6);
    const freckle = noise(u * 140, v * 140, 140, 6) > 0.8 ? 0.7 : 1;
    return mix([0.62, 0.62, 0.16], [0.7, 0.3, 0.1], blush).map((c) => c * freckle);
  });
  return pbr(scene, 'Pear Skin', { albedoTexture: albedo, metallic: 0, roughness: 0.55, sheen: { isEnabled: true, intensity: 0.3, roughness: 0.6 } });
}

// Grapes: dusty bloom over dark skin, deep red inside.
const grape = (scene) => pbr(scene, 'Grape', {
  albedoColor: color(0.12, 0.04, 0.12), metallic: 0, roughness: 0.3,
  sheen: { isEnabled: true, intensity: 0.8, color: color(0.55, 0.6, 0.75), roughness: 0.5 },
  subSurface: { isTranslucencyEnabled: true, translucencyIntensity: 0.8, tintColor: color(0.5, 0.05, 0.12) },
});

// Red wine: dark in the body, glowing ruby where light passes through it.
const wine = (scene) => pbr(scene, 'Red Wine', {
  albedoColor: color(0.12, 0.004, 0.012), metallic: 0, roughness: 0.04,
  subSurface: { isTranslucencyEnabled: true, translucencyIntensity: 1, tintColor: color(0.75, 0.04, 0.08) },
});

const stem = (scene) => pbr(scene, 'Stem', { albedoColor: color(0.2, 0.13, 0.06), metallic: 0, roughness: 0.8 });

// The window the light comes through, seen only in reflections.
const window_ = (scene) => pbr(scene, 'Window', { emissiveColor: color(1, 0.9, 0.75), emissiveIntensity: 6, albedoColor: color(0, 0, 0), unlit: true });

export function createMaterials(scene) {
  return {
    walnut: walnut(scene), plaster: plaster(scene), linen: linen(scene), celadon: celadon(scene),
    glass: glass(scene, 'Glass', color(0.86, 0.95, 0.9)), crystal: glass(scene, 'Crystal', color(0.97, 0.98, 1)), wine: wine(scene),
    brass: brass(scene), silver: silver(scene), lemon: lemon(scene), pear: pear(scene), grape: grape(scene), stem: stem(scene), window: window_(scene),
  };
}
