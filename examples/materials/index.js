export const createScene = function () {
  const scene = new BABYLON.Scene(engine);
  const camera = new BABYLON.ArcRotateCamera('camera', -Math.PI / 2, 1.15, 11, new BABYLON.Vector3(0, 0.8, 0), scene);
  camera.attachControl(canvas, true);
  scene.environmentTexture = BABYLON.CubeTexture.CreateFromPrefilteredData('https://assets.babylonjs.com/environments/environmentSpecular.env', scene);
  new BABYLON.HemisphericLight('Sky', new BABYLON.Vector3(0.2, 1, 0.3), scene).intensity = 0.4;

  const gold = new BABYLON.PBRMaterial('Gold', scene);
  gold.albedoColor = new BABYLON.Color3(1, 0.77, 0.34);
  gold.metallic = 1;
  gold.roughness = 0.25;

  const clay = new BABYLON.StandardMaterial('Clay', scene);
  clay.diffuseColor = new BABYLON.Color3(0.75, 0.38, 0.28);
  clay.specularColor = new BABYLON.Color3(0.05, 0.05, 0.05);

  const glow = new BABYLON.NodeMaterial('Glow', scene);
  glow.setToDefault();
  glow.build();
  const tint = glow.getInputBlocks().find(b => b.isUniform && b.value?.r !== undefined);
  if (tint) { tint.name = 'Tint'; tint.value = new BABYLON.Color4(0.2, 0.8, 1, 1); }

  const place = (mesh, x, material) => { mesh.position.set(x, 1, 0); mesh.material = material; return mesh; };
  place(BABYLON.MeshBuilder.CreateSphere('Gold Sphere', { diameter: 1.6, segments: 48 }, scene), -3, gold);
  place(BABYLON.MeshBuilder.CreateTorusKnot('Gold Knot', { radius: 0.55, tube: 0.18, radialSegments: 128 }, scene), 3, gold);
  place(BABYLON.MeshBuilder.CreateBox('Clay Cube', { size: 1.3 }, scene), -1, clay);
  place(BABYLON.MeshBuilder.CreateCylinder('Glow Pillar', { height: 1.6, diameter: 1.1 }, scene), 1, glow);
  const ground = BABYLON.MeshBuilder.CreateGround('Ground', { width: 12, height: 6 }, scene);
  ground.material = new BABYLON.PBRMaterial('Floor', scene);
  ground.material.albedoColor = new BABYLON.Color3(0.2, 0.2, 0.22);
  ground.material.roughness = 0.9;
  ground.material.metallic = 0;
  return scene;
};
