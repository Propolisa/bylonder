import { texture, normalMap, fbm, noise, mix, clamp01 } from './lib/textures.js';

const color = (r, g, b) => new BABYLON.Color3(r, g, b);

// A PBR material; nested settings (clearCoat, sheen, anisotropy) go into the material's own configurations.
function pbr(scene, name, settings) {
  const material = new BABYLON.PBRMaterial(name, scene);
  for (const [key, value] of Object.entries(settings)) {
    if (value?.constructor === Object) Object.assign(material[key], value);
    else material[key] = value;
  }
  return material;
}

// Nero Marquina: black marble with white and gold veins, polished under a clear coat.
function marble(scene) {
  const veins = (u, v) => {
    const w = fbm(u, v, { scale: 3, octaves: 6, seed: 4 });
    return Math.pow(1 - Math.abs(Math.sin((u * 2 + v + w * 3.2) * Math.PI * 2)), 18);
  };
  const albedo = texture(scene, 'Marble Color', 512, (u, v) => {
    const vein = veins(u, v), gold = clamp01(fbm(u, v, { scale: 6, seed: 9 }) * 3 - 1.4);
    return mix(mix([0.012, 0.012, 0.014], [0.05, 0.048, 0.05], fbm(u, v, { scale: 8, seed: 2 })), mix([0.75, 0.74, 0.7], [0.8, 0.58, 0.25], gold), vein);
  });
  return pbr(scene, 'Black Marble', { albedoTexture: albedo, metallic: 0, roughness: 0.25, clearCoat: { isEnabled: true, intensity: 1, roughness: 0.02 } });
}

// Brushed brass: anisotropic highlights stretched along the brushing.
const brass = (scene) => pbr(scene, 'Brushed Brass', {
  albedoColor: color(0.92, 0.68, 0.33), metallic: 1, roughness: 0.32,
  anisotropy: { isEnabled: true, intensity: 0.8, direction: new BABYLON.Vector2(1, 0) },
});
const gold = (scene) => pbr(scene, 'Polished Gold', { albedoColor: color(1, 0.76, 0.36), metallic: 1, roughness: 0.12 });
const blued = (scene) => pbr(scene, 'Blued Steel', { albedoColor: color(0.16, 0.22, 0.42), metallic: 1, roughness: 0.22, clearCoat: { isEnabled: true, intensity: 0.4, roughness: 0.1 } });
const silver = (scene) => pbr(scene, 'Silver', { albedoColor: color(0.94, 0.94, 0.95), metallic: 1, roughness: 0.1 });

// Polished stones for the planets, each a texture of its own.
const stone = (scene, name, paint, { roughness = 0.12, coat = 1 } = {}) =>
  pbr(scene, name, { albedoTexture: texture(scene, name + ' Color', 256, paint), metallic: 0, roughness, clearCoat: { isEnabled: coat > 0, intensity: coat, roughness: 0.03 } });

const lapis = (scene) => stone(scene, 'Lapis Lazuli', (u, v) => {
  const pyrite = noise(u * 200, v * 100, 200, 3) > 0.9 ? 1 : 0;
  return mix(mix([0.04, 0.08, 0.36], [0.12, 0.2, 0.62], fbm(u, v, { scale: 6, seed: 5 })), [0.85, 0.7, 0.35], pyrite);
});
const malachite = (scene) => stone(scene, 'Malachite', (u, v) => {
  const bands = 0.5 + 0.5 * Math.sin((v * 2 + fbm(u, v, { scale: 4, seed: 8 }) * 2) * Math.PI * 14);
  return mix([0.0, 0.18, 0.1], [0.12, 0.55, 0.36], bands);
});
const jasper = (scene) => stone(scene, 'Red Jasper', (u, v) => mix([0.32, 0.05, 0.03], [0.62, 0.2, 0.08], fbm(u, v, { scale: 5, seed: 12 })), { roughness: 0.25 });
const pearl = (scene) => pbr(scene, 'Pearl', {
  albedoColor: color(0.9, 0.86, 0.82), metallic: 0, roughness: 0.2,
  iridescence: { isEnabled: true, intensity: 1, indexOfRefraction: 1.4, minimumThickness: 300, maximumThickness: 500 },
  sheen: { isEnabled: true, intensity: 0.4, color: color(1, 0.9, 0.95) },
});

// The sun: molten amber light with a granular surface, glowing through the scene's glow layer.
const sun = (scene) => pbr(scene, 'Sun', {
  albedoColor: color(0, 0, 0), metallic: 0, roughness: 1, emissiveIntensity: 3,
  emissiveTexture: texture(scene, 'Sun Surface', 256, (u, v) => mix([1, 0.38, 0.06], [1, 0.82, 0.45], Math.pow(fbm(u, v, { scale: 12, octaves: 4, seed: 6 }), 1.5))),
  emissiveColor: color(1, 1, 1),
});

// The floor: black lacquer that mirrors the brass.
const lacquer = (scene) => pbr(scene, 'Black Lacquer', {
  albedoColor: color(0.01, 0.012, 0.016), metallic: 0, roughness: 0.18,
  bumpTexture: normalMap(scene, 'Lacquer Ripple', 256, (u, v) => fbm(u, v, { scale: 4, octaves: 3, seed: 30 }), 0.4),
});

// Studio lights seen only in reflections.
const softbox = (scene, name, tint, intensity) => pbr(scene, name, { albedoColor: color(0, 0, 0), emissiveColor: color(...tint), emissiveIntensity: intensity, unlit: true });

export function createMaterials(scene) {
  return {
    marble: marble(scene), brass: brass(scene), gold: gold(scene), blued: blued(scene), silver: silver(scene),
    lapis: lapis(scene), malachite: malachite(scene), jasper: jasper(scene), pearl: pearl(scene), sun: sun(scene), lacquer: lacquer(scene),
    warmBox: softbox(scene, 'Warm Softbox', [1, 0.9, 0.78], 3), coolBox: softbox(scene, 'Cool Strip', [0.55, 0.8, 1], 4),
  };
}
