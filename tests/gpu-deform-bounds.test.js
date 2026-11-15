// A mesh the native rig runtime deforms on WebGPU draws from a position buffer that lives on the GPU alone
// (gpu-deform.js GpuDeformer), from which Babylon reads no positions to bound it. A mesh of two materials, one of them
// transparent, then had a submesh without bounds, and sorting the transparent ones threw on the scene's first frame:
// Snow's teeth and gums, and the load never finished. keepingBounds keeps the mesh's and each submesh's bounds.
import assert from 'node:assert/strict';
import { FreeCamera, Mesh, MultiMaterial, NullEngine, Scene, StandardMaterial, SubMesh, Vector3, VertexBuffer, VertexData } from '@babylonjs/core';
import { keepingBounds } from '../src/io_scene_babylon/runtime/native/babylon/gpu-deform.js';

const engine = new NullEngine();
const twoMaterialBox = (scene, name) => {
  const mesh = new Mesh(name, scene);
  const box = VertexData.CreateBox({ size: 1 });
  box.applyToMesh(mesh);
  mesh.subMeshes = [];
  new SubMesh(0, 0, 24, 0, 18, mesh);
  new SubMesh(1, 0, 24, 18, 18, mesh);
  const multi = new MultiMaterial(`${name} materials`, scene);
  const clear = new StandardMaterial('clear', scene);
  clear.alpha = 0.5;
  multi.subMaterials.push(new StandardMaterial('solid', scene), clear);
  mesh.material = multi;
  return mesh;
};
// A position buffer as the deformer gives one: data on the GPU, none Babylon can read back.
const gpuOnly = (mesh) => () => mesh.setVerticesBuffer(new VertexBuffer(engine, engine.createVertexBuffer(new Float32Array(24 * 4)), VertexBuffer.PositionKind, false, false, 4, false, 0, 3));
const frame = (scene) => { try { scene.render(); return null; } catch (error) { return error; } };

const scene = new Scene(engine);
new FreeCamera('camera', new Vector3(0, 0, -5), scene);
const mesh = twoMaterialBox(scene, 'kept');
keepingBounds(mesh, gpuOnly(mesh));
assert.ok(mesh.subMeshes.length === 2 && mesh.subMeshes.every((sub) => sub.getBoundingInfo()), 'each submesh keeps its bounds');
assert.ok(Number.isFinite(mesh.getBoundingInfo().boundingSphere.radius) && mesh.getBoundingInfo().boundingSphere.radius < 2, 'the mesh keeps its rest bounds, not infinite ones');
assert.equal(frame(scene), null, 'the scene draws its first frame');
console.log('GPU deform bounds: a mesh drawn from a GPU-only position buffer keeps its bounds and its submeshes');
process.exit(0);
