import { createPrimitive, createMesh, addModifier, shadeSmooth } from '@workbench/sdk';
import { heightAt } from './terrain.js';

const pbr = (scene, name, albedo, roughness, metallic = 0) => {
  const material = new BABYLON.PBRMaterial(name, scene);
  material.albedoColor = new BABYLON.Color3(...albedo);
  Object.assign(material, { roughness, metallic });
  return material;
};
const glowing = (scene, name, color, intensity) => {
  const material = new BABYLON.PBRMaterial(name, scene);
  Object.assign(material, { albedoColor: BABYLON.Color3.Black(), emissiveColor: new BABYLON.Color3(...color), emissiveIntensity: intensity });
  return material;
};

// A Blender primitive, smooth shaded, placed at a height above `base`.
function part(name, operator, options, scene, material, parent, y, smooth = true) {
  const mesh = createPrimitive(name, operator, options, scene);
  if (smooth) shadeSmooth(mesh);
  mesh.material = material;
  mesh.parent = parent;
  mesh.position.y = y;
  return mesh;
}

// A lighthouse: a tapering white tower with red bands, a gallery whose railing is Blender's Wireframe modifier on an
// open cylinder, a lit lantern and a sweeping beam.
export function createLighthouse(scene, [x, z]) {
  const root = new BABYLON.TransformNode('Lighthouse', scene);
  root.position.set(x, heightAt(x, z) - 0.5, z);
  const white = pbr(scene, 'Whitewash', [0.85, 0.83, 0.78], 0.7), red = pbr(scene, 'Red Paint', [0.5, 0.06, 0.04], 0.5);
  const iron = pbr(scene, 'Black Iron', [0.04, 0.04, 0.045], 0.35, 1);
  const height = 18, base = 2.6, top = 1.7;
  const radius = (y) => base + (top - base) * (y / height);
  const tower = part('Tower', 'mesh.primitive_cone_add', { vertices: 40, radius1: base, radius2: top, depth: height }, scene, white, root, height / 2);
  for (const [from, to] of [[5, 8], [11, 14]]) part('Band', 'mesh.primitive_cone_add', { vertices: 40, radius1: radius(from) + 0.03, radius2: radius(to) + 0.03, depth: to - from, end_fill_type: 'NOTHING' }, scene, red, root, (from + to) / 2);
  const gallery = part('Gallery', 'mesh.primitive_cylinder_add', { vertices: 40, radius: 2.4, depth: 0.35 }, scene, iron, root, height + 0.15, false);
  addModifier(gallery, 'BEVEL', { width: 0.06, segments: 2 });
  const railing = part('Railing', 'mesh.primitive_cylinder_add', { vertices: 40, radius: 2.3, depth: 1.1, end_fill_type: 'NOTHING' }, scene, iron, root, height + 0.85, false);
  addModifier(railing, 'WIREFRAME', { thickness: 0.05 });
  const lamp = glowing(scene, 'Lamp', [1, 0.78, 0.45], 4);
  part('Lantern', 'mesh.primitive_cylinder_add', { vertices: 16, radius: 1.15, depth: 1.8 }, scene, lamp, root, height + 1.25, false);
  part('Lantern Roof', 'mesh.primitive_cone_add', { vertices: 32, radius1: 1.55, radius2: 0.12, depth: 1.3 }, scene, red, root, height + 2.8);
  part('Finial', 'mesh.primitive_ico_sphere_add', { radius: 0.22, subdivisions: 2 }, scene, iron, root, height + 3.55);

  const beam = createBeam(scene, root, height + 1.25);
  return { root, tower, beam, lantern: new BABYLON.Vector3(x, root.position.y + height + 1.25, z) };
}

// Two cones of light from the lantern: additive, fading along their length and toward their edges.
function createBeam(scene, parent, y) {
  const pivot = new BABYLON.TransformNode('Beam', scene);
  pivot.parent = parent;
  pivot.position.y = y;
  const material = new BABYLON.StandardMaterial('Beam Light', scene);
  Object.assign(material, { disableLighting: true, emissiveColor: new BABYLON.Color3(1, 0.85, 0.6), alpha: 0.22, alphaMode: BABYLON.Engine.ALPHA_ADD, backFaceCulling: false });
  material.opacityFresnelParameters = Object.assign(new BABYLON.FresnelParameters(), { leftColor: BABYLON.Color3.Black(), rightColor: BABYLON.Color3.White(), power: 2, bias: 0 });
  for (const side of [1, -1]) {
    const cone = BABYLON.MeshBuilder.CreateCylinder('Beam Cone', { height: 90, diameterTop: 0.6, diameterBottom: 16, tessellation: 32, cap: BABYLON.Mesh.NO_CAP }, scene);
    cone.material = material;
    cone.parent = pivot;
    cone.rotation.z = side * Math.PI / 2;
    cone.position.x = -side * 45.6;
    cone.isPickable = false;
    cone.applyFog = true;
  }
  return pivot;
}

// A cottage: whitewashed walls under a slate gable roof, its windows lit for the evening.
function cottageMeshes(scene) {
  const w = 3, d = 5, h = 2.6, ridge = 4.4, eave = 0.3;
  const walls = createMesh('Cottages', {
    vertices: [[-w, -d, 0], [w, -d, 0], [w, d, 0], [-w, d, 0], [-w, -d, h], [w, -d, h], [w, d, h], [-w, d, h], [0, -d, ridge], [0, d, ridge]].map(([a, b, c]) => [a / 2, b / 2, c]),
    faces: [[0, 1, 5, 4], [1, 2, 6, 5], [2, 3, 7, 6], [3, 0, 4, 7], [4, 5, 8], [6, 7, 9]],
  }, scene);
  addModifier(walls, 'BEVEL', { width: 0.05, segments: 2, limit_method: 'ANGLE' });
  const r = w / 2 + eave, e = d / 2 + eave, t = 0.12;
  const roof = createMesh('Roofs', {
    vertices: [[-r, -e, h - 0.25], [0, -e, ridge + t], [r, -e, h - 0.25], [-r, e, h - 0.25], [0, e, ridge + t], [r, e, h - 0.25]],
    faces: [[0, 3, 4, 1], [1, 4, 5, 2]],
  }, scene);
  addModifier(roof, 'SOLIDIFY', { thickness: 0.18, offset: 1 });
  addModifier(roof, 'BEVEL', { width: 0.03, segments: 2 });
  const windows = BABYLON.MeshBuilder.CreatePlane('Windows', { width: 0.7, height: 0.9 }, scene);
  return { walls, roof, windows };
}

// A fishing village along the bay: one cottage, placed many times as instances of its beveled meshes.
export function createVillage(scene, spots) {
  const { walls, roof, windows } = cottageMeshes(scene);
  walls.material = pbr(scene, 'Lime Wash', [0.72, 0.68, 0.6], 0.85);
  roof.material = pbr(scene, 'Slate', [0.08, 0.085, 0.1], 0.45);
  windows.material = glowing(scene, 'Lit Window', [1, 0.62, 0.28], 3);
  const panes = [];
  spots.forEach(([x, z, turn], i) => {
    const at = new BABYLON.Vector3(x, heightAt(x, z) - 0.3, z);
    const cottage = new BABYLON.TransformNode('Cottage ' + (i + 1), scene);
    cottage.position = at;
    cottage.rotation.y = turn;
    for (const mesh of [walls, roof]) {
      const copy = i ? mesh.createInstance(mesh.name + ' ' + (i + 1)) : mesh;
      copy.parent = cottage;
    }
    const rotation = BABYLON.Quaternion.RotationAxis(BABYLON.Axis.Y, turn);
    for (const side of [-1, 1]) {
      const offset = new BABYLON.Vector3(side * 0.9, 1.3, -2.52).applyRotationQuaternion(rotation);
      panes.push(BABYLON.Matrix.Compose(BABYLON.Vector3.One(), rotation, at.add(offset)));
    }
  });
  windows.thinInstanceAdd(panes);
  return [walls, roof, windows];
}
