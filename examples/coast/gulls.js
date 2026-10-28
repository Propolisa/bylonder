import { animation, createMesh } from '@workbench/sdk';

// Gulls wheeling over the headland. Their flight follows the scene frame, so every render of a frame shows them at the
// same place.
export function createGulls(scene, center, count = 6) {
  const white = new BABYLON.PBRMaterial('Gull', scene);
  Object.assign(white, { albedoColor: new BABYLON.Color3(0.8, 0.8, 0.82), roughness: 0.8, metallic: 0, backFaceCulling: false });
  // A swept wing in Blender's axes: span along x, chord along y.
  const wingShape = [[0, 0.12, 0], [0.55, 0.02, 0], [0.9, -0.12, 0], [0, -0.14, 0]];
  const gulls = Array.from({ length: count }, (_, i) => {
    const body = BABYLON.MeshBuilder.CreateSphere('Gull ' + (i + 1), { diameter: 0.22, segments: 8 }, scene);
    body.scaling.z = 2.4;
    body.material = white;
    const wings = [1, -1].map((side) => {
      const wing = createMesh('Wing', { vertices: wingShape.map(([x, y, z]) => [x * side, y, z]), faces: [side > 0 ? [0, 1, 2, 3] : [3, 2, 1, 0]] }, scene);
      wing.material = white;
      wing.parent = body;
      wing.scaling.z = 1 / 2.4;
      wing.isPickable = false;
      return { wing, side };
    });
    return { body, wings, radius: 18 + i * 7, height: 26 + (i % 3) * 6, speed: 0.22 + (i % 4) * 0.04, phase: i * 1.7 };
  });
  scene.onBeforeRenderObservable.add(() => {
    const t = animation.time.frame / 24;
    for (const g of gulls) {
      const a = g.phase + t * g.speed;
      g.body.position.set(center.x + Math.cos(a) * g.radius, center.y + g.height + Math.sin(a * 2.3) * 2, center.z + Math.sin(a) * g.radius);
      g.body.rotation.set(0, -a, -0.35);
      const flap = Math.sin(t * 7 + g.phase) * 0.55 * (0.5 + 0.5 * Math.sin(t * 0.7 + g.phase));
      for (const { wing, side } of g.wings) wing.rotation.z = side * flap;
    }
  });
  return gulls.map((g) => g.body);
}
