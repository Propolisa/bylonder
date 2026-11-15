// A café counter and a cup on it.
export function counter(scene) {
  const wood = new BABYLON.PBRMaterial('Wood', scene);
  wood.albedoColor = new BABYLON.Color3(0.32, 0.18, 0.09);
  wood.metallic = 0;
  wood.roughness = 0.6;
  const top = BABYLON.MeshBuilder.CreateBox('Counter', { width: 2.4, height: 1, depth: 0.8 }, scene);
  top.position.y = 0.5;
  top.material = wood;

  const china = new BABYLON.PBRMaterial('China', scene);
  china.albedoColor = new BABYLON.Color3(0.9, 0.88, 0.84);
  china.metallic = 0;
  china.roughness = 0.25;
  const cup = BABYLON.MeshBuilder.CreateCylinder('Cup', { diameter: 0.24, height: 0.2 }, scene);
  cup.position.set(0.4, 1.1, 0);
  cup.material = china;
}
