// A Principled BSDF drawn as a Babylon PBRMaterial by composing two converters, copied rather than invented:
// - Blender's glTF exporter, Principled inputs to a glTF material (Blender 5.2 io_scene_gltf2, blender/exp/material:
//   pbr_metallic_roughness.py, materials.py and search_node_tree.py gather_alpha_info, and the extensions' emission.py,
//   clearcoat.py, transmission.py, specular.py, sheen.py, ior.py), for constant inputs;
// - Babylon's glTF loader, a glTF material to a PBRMaterial (@babylonjs/loaders glTF/2.0 glTFLoader.ts
//   _createDefaultMaterial, loadMaterialBasePropertiesAsync, _loadMaterialMetallicRoughnessPropertiesAsync and
//   loadMaterialAlphaProperties, the KHR_materials_* loaders, through pbrMaterialLoadingAdapter.ts).
// Each is a table; principledPBR composes them into every PBRMaterial property the loader sets, so a material is drawn
// whole each time: what an absent extension would leave is a new PBRMaterial's value.
import { Color3, PBRMaterial } from '@babylonjs/core';

// io/com/constants.py
const GLTF_IOR = 1.5, BLENDER_COAT_ROUGHNESS = 0.03;
const rgb = (color) => color.slice(0, 3);
const omit = (value, unless) => (JSON.stringify(value) === JSON.stringify(unless) ? undefined : value);

// The exporter's alpha (gather_alpha_info): 1 is opaque, 0 a mask at the default cutoff, anything else blended.
const alphaMode = (alpha) => (alpha === 1 ? 'OPAQUE' : alpha === 0 ? 'MASK' : 'BLEND');
// export_emission_factor with its strength, normalized as materials.py does when a channel is over 1.
function emission(inputs) {
  const factor = rgb(inputs['Emission Color']).map((c) => c * inputs['Emission Strength']);
  const strength = Math.max(...factor);
  return strength > 1 ? { factor: factor.map((c) => c / strength), strength } : { factor };
}
// export_specular: Blender's level is half glTF's factor; over 1, the factor goes into the color.
function specular(inputs) {
  const factor = inputs['Specular IOR Level'] * 2;
  return { factor: factor < 1 ? factor : undefined, color: rgb(inputs['Specular Tint']).map((c) => (factor > 1 ? c * factor : c)) };
}

// [glTF path, (Principled inputs, Material settings) => value, or undefined where the exporter leaves it out]
const EXPORTER = [
  ['pbrMetallicRoughness.baseColorFactor', (i) => omit([...rgb(i['Base Color']).map((c) => Math.min(Math.max(c, 0), 1)), i.Alpha], [1, 1, 1, 1])],
  ['pbrMetallicRoughness.metallicFactor', (i) => omit(i.Metallic, 1)],
  ['pbrMetallicRoughness.roughnessFactor', (i) => omit(i.Roughness, 1)],
  ['emissiveFactor', (i) => omit(emission(i).factor, [0, 0, 0])],
  ['alphaMode', (i) => omit(alphaMode(i.Alpha), 'OPAQUE')],
  ['doubleSided', (i, m) => (m.use_backface_culling ? undefined : true)],
  ['extensions.KHR_materials_emissive_strength.emissiveStrength', (i) => emission(i).strength],
  ['extensions.KHR_materials_clearcoat.clearcoatFactor', (i) => omit(i['Coat Weight'], 0)],
  ['extensions.KHR_materials_clearcoat.clearcoatRoughnessFactor', (i) => (Math.abs(i['Coat Roughness'] - BLENDER_COAT_ROUGHNESS) > 1e-5 ? i['Coat Roughness'] : undefined)],
  ['extensions.KHR_materials_transmission.transmissionFactor', (i) => omit(i['Transmission Weight'], 0)],
  ['extensions.KHR_materials_specular.specularFactor', (i) => specular(i).factor],
  ['extensions.KHR_materials_specular.specularColorFactor', (i) => omit(specular(i).color, [1, 1, 1])],
  ['extensions.KHR_materials_sheen.sheenColorFactor', (i) => (i['Sheen Weight'] ? omit(rgb(i['Sheen Tint']), [0, 0, 0]) : undefined)],
  ['extensions.KHR_materials_sheen.sheenRoughnessFactor', (i) => (i['Sheen Weight'] ? omit(i['Sheen Roughness'], 0) : undefined)],
  // export_ior needs the specular extension, which a Principled BSDF always has (empty ones are dropped at the end).
  ['extensions.KHR_materials_ior.ior', (i) => omit(i.IOR, GLTF_IOR)],
];

// The glTF material Blender's exporter writes for a Principled BSDF's inputs (by identifier) and the Material's
// settings (use_backface_culling).
export function principledGltf(inputs, settings) {
  const material = {};
  for (const [path, value] of EXPORTER.map(([path, gather]) => [path, gather(inputs, settings)])) {
    if (value === undefined) continue;
    const keys = path.split('.'), key = keys.pop();
    keys.reduce((o, k) => (o[k] ??= {}), material)[key] = value;
  }
  return material;
}

const TRANSPARENCY = { OPAQUE: PBRMaterial.MATERIAL_OPAQUE, MASK: PBRMaterial.MATERIAL_ALPHATEST, BLEND: PBRMaterial.MATERIAL_ALPHABLEND };
// An extension's properties when the material has it, else null.
const ext = (g, name) => g.extensions?.[name] ?? null;
const transmits = (g) => (ext(g, 'KHR_materials_transmission')?.transmissionFactor ?? 0) > 0;
// [PBRMaterial path, glTF material => value]; a color as an array.
const LOADER = [
  ['albedoColor', (g) => rgb(g.pbrMetallicRoughness?.baseColorFactor ?? [1, 1, 1])],
  ['alpha', (g) => ((g.alphaMode ?? 'OPAQUE') === 'OPAQUE' ? 1 : g.pbrMetallicRoughness?.baseColorFactor?.[3] ?? 1)],
  ['metallic', (g) => g.pbrMetallicRoughness?.metallicFactor ?? 1],
  ['roughness', (g) => g.pbrMetallicRoughness?.roughnessFactor ?? 1],
  ['emissiveColor', (g) => g.emissiveFactor ?? [0, 0, 0]],
  ['emissiveIntensity', (g) => ext(g, 'KHR_materials_emissive_strength')?.emissiveStrength ?? 1],
  ['backFaceCulling', (g) => !g.doubleSided],
  ['twoSidedLighting', (g) => !!g.doubleSided],
  ['transparencyMode', (g) => TRANSPARENCY[g.alphaMode ?? 'OPAQUE']],
  ['alphaCutOff', (g) => (g.alphaMode === 'MASK' ? g.alphaCutoff ?? 0.5 : 0.4)],
  ['indexOfRefraction', (g) => ext(g, 'KHR_materials_ior')?.ior ?? GLTF_IOR],
  ['metallicF0Factor', (g) => ext(g, 'KHR_materials_specular')?.specularFactor ?? 1],
  ['metallicReflectanceColor', (g) => ext(g, 'KHR_materials_specular')?.specularColorFactor ?? [1, 1, 1]],
  ['clearCoat.isEnabled', (g) => !!ext(g, 'KHR_materials_clearcoat')],
  ['clearCoat.useRoughnessFromMainTexture', (g) => !ext(g, 'KHR_materials_clearcoat')],
  ['clearCoat.remapF0OnInterfaceChange', (g) => !ext(g, 'KHR_materials_clearcoat')],
  ['clearCoat.intensity', (g) => (ext(g, 'KHR_materials_clearcoat') ? ext(g, 'KHR_materials_clearcoat').clearcoatFactor ?? 0 : 1)],
  ['clearCoat.roughness', (g) => ext(g, 'KHR_materials_clearcoat')?.clearcoatRoughnessFactor ?? 0],
  ['sheen.isEnabled', (g) => !!ext(g, 'KHR_materials_sheen')],
  ['sheen.useRoughnessFromMainTexture', (g) => !ext(g, 'KHR_materials_sheen')],
  ['sheen.albedoScaling', (g) => !!ext(g, 'KHR_materials_sheen')],
  ['sheen.intensity', () => 1],
  ['sheen.color', (g) => (ext(g, 'KHR_materials_sheen') ? ext(g, 'KHR_materials_sheen').sheenColorFactor ?? [0, 0, 0] : [1, 1, 1])],
  ['sheen.roughness', (g) => (ext(g, 'KHR_materials_sheen') ? ext(g, 'KHR_materials_sheen').sheenRoughnessFactor ?? 0 : null)],
  // configureTransmission and the transmission weight; the loader's TransmissionHelper (an opaque scene render target
  // for refraction) is left out.
  ['subSurface.isRefractionEnabled', (g) => transmits(g)],
  ['subSurface.refractionIntensity', (g) => (transmits(g) ? ext(g, 'KHR_materials_transmission').transmissionFactor : 1)],
  ['subSurface.volumeIndexOfRefraction', (g) => (transmits(g) ? 1 : -1)],
  ['subSurface.useAlbedoToTintRefraction', (g) => transmits(g)],
  ['subSurface.minimumThickness', () => 0],
  ['subSurface.maximumThickness', (g) => (transmits(g) ? 0 : 1)],
];
// What a path holds as set: -1 is the volume IOR's "the material's own", which its getter reads as that IOR.
const STORED = { 'subSurface.volumeIndexOfRefraction': 'subSurface._volumeIndexOfRefraction' };

// The PBRMaterial properties Babylon's loader sets for a glTF material, as [path, value] pairs.
export const gltfPBR = (gltf) => LOADER.map(([path, load]) => [path, load(gltf)]);
// Both composed: a Principled BSDF's inputs and its Material's settings as PBRMaterial properties.
export const principledPBR = (inputs, settings) => gltfPBR(principledGltf(inputs, settings));

const owner = (material, path) => { const keys = path.split('.'), key = keys.pop(); return [keys.reduce((o, k) => o[k], material), key]; };
const read = (material, path) => { const [o, key] = owner(material, STORED[path] ?? path); const value = o[key]; return value?.asArray ? value.asArray() : value; };
const same = (a, b) => (Array.isArray(a) ? a.every((v, i) => Math.abs(v - b?.[i]) < 1e-5) : typeof a === 'number' && typeof b === 'number' ? Math.abs(a - b) < 1e-5 : a === b);

// Sets the properties that differ, a color as a new Color3.
export function applyPBR(material, values) {
  for (const [path, value] of values) {
    if (same(value, read(material, path))) continue;
    const [o, key] = owner(material, path);
    o[key] = Array.isArray(value) ? Color3.FromArray(value) : value;
  }
}
// The properties that differ, as messages.
export const differencesPBR = (material, values) => values.filter(([path, value]) => !same(value, read(material, path)))
  .map(([path, value]) => `${path}: Babylon ${JSON.stringify(read(material, path))}, Main's ${JSON.stringify(value)}`);
