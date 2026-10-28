import { createPrimitive, createMesh, addModifier } from '@workbench/sdk';

// Light sculptures for a dark hall. Every piece is a simple mesh that Blender's modifiers multiply or transform.

export const neon = (scene, name, color) => {
  const material = new BABYLON.StandardMaterial(name, scene);
  Object.assign(material, { disableLighting: true, emissiveColor: color.clone() });
  material.metadata = { base: color.clone() };
  return material;
};

// A geodesic lattice: an Ico Sphere whose edges Blender's Wireframe modifier turns into struts.
export function geodesic(scene, material) {
  const sphere = createPrimitive('Geodesic', 'mesh.primitive_ico_sphere_add', { radius: 1.25, subdivisions: 2 }, scene);
  addModifier(sphere, 'WIREFRAME', { thickness: 0.035, use_even_offset: true });
  sphere.material = material;
  return sphere;
}

// A ribbon of light winding up around the lattice: one short edge, swept along a helix by Screw.
export function helix(scene, material) {
  const ribbon = createMesh('Helix', { vertices: [[1.75, 0, 0], [1.75, 0, 0.12]], edges: [[0, 1]] }, scene);
  addModifier(ribbon, 'SCREW', { steps: 160, render_steps: 160, angle: Math.PI * 6, screw_offset: 3.4, iterations: 1 });
  addModifier(ribbon, 'SOLIDIFY', { thickness: 0.02, offset: 0 });
  ribbon.material = material;
  return ribbon;
}

// A halo of light spokes around the lattice: one bar, arrayed on a circle and turned to point outward.
export function halo(scene, material) {
  const bar = BABYLON.MeshBuilder.CreateBox('Light Spokes', { width: 0.06, height: 3.2, depth: 0.06 }, scene);
  bar.position.set(0, 1.6, 0);
  addModifier(bar, 'GN_ARRAY', { shape: 'Circle', count: 28, radius: 4.2, centralAxis: 'Y', alignRotation: true });
  bar.material = material;
  return bar;
}

// Two colonnades of light blades receding into the dark: one blade and Blender's Array modifier with a constant
// offset, mirrored across the hall by Mirror.
export function colonnade(scene, material) {
  const blade = createMesh('Colonnade', {
    vertices: [[7, -14, 0], [7.08, -14, 0], [7.08, -13.9, 0], [7, -13.9, 0], [7, -14, 5], [7.08, -14, 5], [7.08, -13.9, 5], [7, -13.9, 5]],
    faces: [[3, 2, 1, 0], [4, 5, 6, 7], [0, 1, 5, 4], [1, 2, 6, 5], [2, 3, 7, 6], [3, 0, 4, 7]],
  }, scene);
  addModifier(blade, 'ARRAY', { count: 15, use_relative_offset: false, use_constant_offset: true, 'constant_offset_displace[0]': 0, 'constant_offset_displace[1]': 2 });
  addModifier(blade, 'MIRROR', { 'use_axis[0]': true });
  blade.material = material;
  return blade;
}

// A black mirror floor with a faint grid, reflecting every light in the hall.
export function mirrorFloor(scene, reflected) {
  const floor = createPrimitive('Floor', 'mesh.primitive_plane_add', { size: 60 }, scene);
  const material = new BABYLON.PBRMaterial('Black Mirror', scene);
  Object.assign(material, { albedoColor: new BABYLON.Color3(0.005, 0.005, 0.008), metallic: 0, roughness: 0.1 });
  const mirror = new BABYLON.MirrorTexture('Floor Reflection', 1024, scene, true);
  mirror.mirrorPlane = new BABYLON.Plane(0, -1, 0, 0);
  mirror.renderList.push(...reflected);
  material.reflectionTexture = mirror;
  material.reflectionColor = new BABYLON.Color3(1.4, 1.4, 1.5);
  material.emissiveTexture = gridTexture(scene);
  material.emissiveTexture.uScale = material.emissiveTexture.vScale = 30;
  material.emissiveColor = new BABYLON.Color3(0.25, 0.3, 0.5);
  floor.material = material;
  return floor;
}

function gridTexture(scene) {
  const size = 128, data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const line = Math.max(Math.exp(-((x - 0.5) ** 2) / 2), Math.exp(-((y - 0.5) ** 2) / 2)) * 255;
    data.set([line, line, line, 255], (y * size + x) * 4);
  }
  return BABYLON.RawTexture.CreateRGBATexture(data, size, size, scene, true);
}

// A chrome sphere at the heart of the lattice.
export function chrome(scene) {
  const sphere = BABYLON.MeshBuilder.CreateSphere('Chrome Heart', { diameter: 1.1, segments: 48 }, scene);
  const material = new BABYLON.PBRMaterial('Chrome', scene);
  Object.assign(material, { albedoColor: new BABYLON.Color3(0.95, 0.95, 0.98), metallic: 1, roughness: 0.04 });
  sphere.material = material;
  return sphere;
}
