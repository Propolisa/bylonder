import { controls } from '@workbench/sdk';

export const createScene = function () {
  const scene = new BABYLON.Scene(engine);
  scene.clearColor = new BABYLON.Color4(0.55, 0.68, 0.82, 1);
  const camera = new BABYLON.ArcRotateCamera('camera', -0.8, 0.95, 60, BABYLON.Vector3.Zero(), scene);
  camera.attachControl(canvas, true);
  new BABYLON.HemisphericLight('Sky', new BABYLON.Vector3(0, 1, 0), scene).intensity = 0.6;
  const sun = new BABYLON.DirectionalLight('Sun', new BABYLON.Vector3(-1, -2, -1), scene);
  sun.position = new BABYLON.Vector3(40, 80, 40);
  const shadows = new BABYLON.ShadowGenerator(1024, sun);
  shadows.usePercentageCloserFiltering = true;

  const ground = BABYLON.MeshBuilder.CreateGround('Ground', { width: 80, height: 80 }, scene);
  ground.receiveShadows = true;
  const block = BABYLON.MeshBuilder.CreateBox('Buildings', { size: 1 }, scene);
  block.setPivotPoint(new BABYLON.Vector3(0, -0.5, 0));
  block.material = new BABYLON.StandardMaterial('concrete', scene);
  block.material.diffuseColor = new BABYLON.Color3(0.86, 0.86, 0.9);
  block.receiveShadows = true;
  shadows.addShadowCaster(block);

  controls({
    id: 'city', title: 'City',
    schema: {
      size: { default: 14, min: 4, max: 30, step: 1, label: 'Blocks' },
      density: { default: 0.7, min: 0.1, max: 1, step: 0.05, label: 'Density' },
      height: { default: 12, min: 2, max: 40, step: 0.5, label: 'Max height' },
      seed: { default: 7, min: 1, max: 999, step: 1, label: 'Seed' }
    },
    connect(store) {
      return store.effect(['size', 'density', 'height', 'seed'], ({ size, density, height, seed }) => {
        let s = seed;
        const random = () => (s = (s * 16807) % 2147483647) / 2147483647;
        const matrices = [];
        for (let x = 0; x < size; x++) for (let z = 0; z < size; z++) {
          if (random() > density) continue;
          const w = 1.2 + random() * 1.3, h = 1 + Math.pow(random(), 2.5) * height;
          const m = BABYLON.Matrix.Compose(new BABYLON.Vector3(w, h, w), BABYLON.Quaternion.Identity(), new BABYLON.Vector3((x - size / 2) * 3, h / 2, (z - size / 2) * 3));
          matrices.push(...m.asArray());
        }
        block.thinInstanceSetBuffer('matrix', new Float32Array(matrices), 16);
      }, { mode: 'debounce', delay: 80 });
    }
  });
  return scene;
};
