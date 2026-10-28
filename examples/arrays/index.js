import { addModifier } from '@workbench/sdk';

export const createScene = function () {
  const scene = new BABYLON.Scene(engine);
  const camera = new BABYLON.ArcRotateCamera('camera', -2.2, 1.05, 26, new BABYLON.Vector3(0, 3, 0), scene);
  camera.attachControl(canvas, true);
  new BABYLON.HemisphericLight('Sky', new BABYLON.Vector3(0.3, 1, 0.2), scene).intensity = 0.75;
  const sun = new BABYLON.DirectionalLight('Sun', new BABYLON.Vector3(-0.5, -1, 0.4), scene);
  sun.intensity = 0.8;

  const stone = new BABYLON.StandardMaterial('stone', scene);
  stone.diffuseColor = new BABYLON.Color3(0.82, 0.78, 0.7);

  const step = BABYLON.MeshBuilder.CreateBox('Stair Step', { width: 2.4, height: 0.2, depth: 0.8 }, scene);
  step.material = stone;
  step.position.set(1.4, 0.1, 0);
  addModifier(step, 'GN_ARRAY', { shape: 'Transform', count: 24, 'translation.x': 0, 'translation.y': 0.25, 'translation.z': 0, 'rotation.y': Math.PI / 10 });

  const column = BABYLON.MeshBuilder.CreateCylinder('Column', { height: 5, diameter: 0.5, tessellation: 24 }, scene);
  column.material = stone;
  column.position.set(0, 2.5, 0);
  addModifier(column, 'GN_ARRAY', { shape: 'Circle', count: 12, radius: 8, centralAxis: 'Y', alignRotation: false });

  const tile = BABYLON.MeshBuilder.CreateBox('Floor Tile', { width: 0.95, height: 0.1, depth: 0.95 }, scene);
  tile.material = new BABYLON.StandardMaterial('tile', scene);
  tile.material.diffuseColor = new BABYLON.Color3(0.35, 0.37, 0.42);
  tile.position.set(-9.5, -0.05, -9.5);
  addModifier(tile, 'GN_ARRAY', { shape: 'Line', count: 20 });
  addModifier(tile, 'GN_ARRAY', { shape: 'Line', count: 20, 'offset.x': 0, 'offset.z': 1 });
  return scene;
};
