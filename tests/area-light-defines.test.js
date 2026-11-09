// A light that becomes an area light at an index a material drew before brings the area light functions with it
// (AREALIGHTUSED), on PBR and Standard materials: Babylon adds that define only when it rebuilds the defines' keys. An
// area light past the lights a material draws (maxSimultaneousLights), or on an unlit material, is neither defined nor
// bound for it.
import assert from 'node:assert/strict';
import { NullEngine, Scene, PBRMaterial, StandardMaterial, MeshBuilder, PointLight, RectAreaLight, Vector3, FreeCamera, Material } from '@babylonjs/core';
import '../src/overrides/babylon/area-light-used.js';

const scene = () => {
  const made = new Scene(new NullEngine());
  new FreeCamera('camera', new Vector3(0, 0, -5), made);
  return made;
};
const boxes = (where) => [new PBRMaterial('pbr', where), new StandardMaterial('standard', where)].map((material) => Object.assign(MeshBuilder.CreateBox(material.name, {}, where), { material }));
const areaDefines = (mesh) => {
  mesh.getScene().incrementRenderId();
  mesh.material.isReadyForSubMesh(mesh, mesh.subMeshes[0]);
  return mesh.subMeshes[0].materialDefines.toString().split('\n').filter((line) => /AREALIGHT(USED|0)$/.test(line));
};

const turned = scene(), meshes = boxes(turned);
const point = new PointLight('point', Vector3.Zero(), turned);
for (const mesh of meshes) assert.deepEqual(areaDefines(mesh), [], `${mesh.name}: a point light`);
point.dispose();
new RectAreaLight('area', Vector3.Zero(), 1, 1, turned);
for (const mesh of meshes) {
  mesh.material.markAsDirty(Material.LightDirtyFlag);
  assert.deepEqual(areaDefines(mesh), ['#define AREALIGHTUSED', '#define AREALIGHT0'], `${mesh.name}: the area light in its place`);
}

const crowded = scene();
new PointLight('first', Vector3.Zero(), crowded);
new RectAreaLight('second', Vector3.Zero(), 1, 1, crowded);
for (const mesh of boxes(crowded)) {
  mesh.material.maxSimultaneousLights = 1;
  assert.deepEqual(areaDefines(mesh), [], `${mesh.name}: an area light past its light count`);
}
for (const mesh of boxes(crowded)) {
  mesh.material.disableLighting = true;
  assert.deepEqual(areaDefines(mesh), [], `${mesh.name}: unlit (Grease Pencil's strokes)`);
}
console.log('Area light defines: a light turned into an area light brings its functions on PBR and Standard materials, one past their light count or on an unlit material does not');
