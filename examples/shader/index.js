import vertex from './shaders/wave.vert.glsl?raw';
import fragment from './shaders/wave.frag.glsl?raw';
import { controls } from '@workbench/sdk';

export const createScene = function () {
  const scene = new BABYLON.Scene(engine);
  scene.clearColor = new BABYLON.Color4(0.03, 0.05, 0.08, 1);
  const camera = new BABYLON.ArcRotateCamera('camera', -Math.PI / 2, 1.0, 14, BABYLON.Vector3.Zero(), scene);
  camera.attachControl(canvas, true);

  const surface = BABYLON.MeshBuilder.CreateGround('Water', { width: 12, height: 12, subdivisions: 160 }, scene);
  const material = new BABYLON.ShaderMaterial('wave', scene, { vertexSource: vertex, fragmentSource: fragment }, {
    attributes: ['position', 'uv'], uniforms: ['worldViewProjection', 'time', 'amplitude', 'frequency', 'deep', 'shallow']
  });
  surface.material = material;

  const store = controls({
    id: 'waves', title: 'Waves',
    schema: {
      amplitude: { default: 0.35, min: 0, max: 1.5, step: 0.01, label: 'Amplitude' },
      frequency: { default: 1.4, min: 0.2, max: 5, step: 0.05, label: 'Frequency' },
      speed: { default: 1, min: 0, max: 4, step: 0.05, label: 'Speed' }
    },
    connect(store) {
      return store.effect(['amplitude', 'frequency'], ({ amplitude, frequency }) => {
        material.setFloat('amplitude', amplitude);
        material.setFloat('frequency', frequency);
      }, { mode: 'immediate' });
    }
  });
  material.setColor3('deep', new BABYLON.Color3(0.02, 0.15, 0.3));
  material.setColor3('shallow', new BABYLON.Color3(0.3, 0.85, 0.9));
  let time = 0;
  scene.onBeforeRenderObservable.add(() => {
    time += engine.getDeltaTime() / 1000 * store.values.speed;
    material.setFloat('time', time);
  });
  return scene;
};
