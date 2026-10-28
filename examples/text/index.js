import { createText, updateText, controls } from '@workbench/sdk';

export const createScene = async function () {
  const scene = new BABYLON.Scene(engine);
  const camera = new BABYLON.ArcRotateCamera('camera', -Math.PI / 2, 1.35, 12, new BABYLON.Vector3(0, 1, 0), scene);
  camera.attachControl(canvas, true);
  new BABYLON.HemisphericLight('light', new BABYLON.Vector3(0.2, 1, -0.6), scene).intensity = 0.9;

  const text = await createText('Title', { text: 'Bylonder', family: 'Roboto', weight: 900, size: 1.6, depth: 0.4, align: 'center' }, scene);
  text.position.y = 0.6;
  const material = new BABYLON.PBRMetallicRoughnessMaterial('gold', scene);
  material.baseColor = new BABYLON.Color3(1, 0.75, 0.3);
  material.metallic = 0.9;
  material.roughness = 0.25;
  text.material = material;
  scene.createDefaultEnvironment({ createGround: false, createSkybox: false });

  controls({
    id: 'title', title: 'Title',
    schema: {
      label: { default: 'Bylonder', label: 'Text' },
      family: { default: 'Roboto', label: 'Google font' },
      weight: { default: 900, min: 100, max: 900, step: 100, label: 'Weight' }
    },
    connect(store) {
      return store.effect(['label', 'family', 'weight'], async ({ label, family, weight }) => {
        try { await updateText(text, { text: label, family, weight }); } catch (error) { console.warn(error.message); }
      }, { mode: 'debounce', delay: 300 });
    }
  });
  return scene;
};
