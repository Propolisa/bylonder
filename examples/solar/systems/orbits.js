import { controls } from '@workbench/sdk';

const palette = ['#c9a27c', '#e3c16f', '#4f8fd9', '#d0573d', '#d9b38c', '#e8d9a8', '#8fd3e8', '#5b6fd9'];

export function createOrbits(scene) {
  let planets = [];
  const store = controls({
    id: 'orbits', title: 'Orbits',
    schema: {
      count: { default: 6, min: 1, max: 8, step: 1, label: 'Planets' },
      spacing: { default: 2.6, min: 1.5, max: 5, step: 0.1, label: 'Spacing' },
      speed: { default: 1, min: 0, max: 5, step: 0.05, label: 'Speed' },
      rings: { default: true, label: 'Show orbits' }
    },
    connect(store) {
      const build = store.effect(['count', 'spacing', 'rings'], ({ count, spacing, rings }) => {
        planets.forEach(p => p.dispose());
        planets = Array.from({ length: count }, (_, i) => planet(scene, i, 4 + i * spacing, rings));
      });
      let time = 0;
      const spin = scene.onBeforeRenderObservable.add(() => {
        time += scene.getEngine().getDeltaTime() / 1000 * store.values.speed;
        planets.forEach((p, i) => p.orbit(time));
      });
      return () => { build(); scene.onBeforeRenderObservable.remove(spin); planets.forEach(p => p.dispose()); };
    }
  });
  return store;
}

function planet(scene, i, radius, rings) {
  const size = 0.4 + ((i * 37) % 5) * 0.18;
  const body = BABYLON.MeshBuilder.CreateSphere('Planet ' + (i + 1), { diameter: size, segments: 24 }, scene);
  const material = new BABYLON.StandardMaterial('planet' + i, scene);
  material.diffuseColor = BABYLON.Color3.FromHexString(palette[i % palette.length]);
  material.specularColor = new BABYLON.Color3(0.1, 0.1, 0.1);
  body.material = material;
  body.metadata = { editable: false };
  const ring = rings ? BABYLON.MeshBuilder.CreateTorus('orbit' + i, { diameter: radius * 2, thickness: 0.02, tessellation: 128 }, scene) : null;
  if (ring) { ring.isPickable = false; ring.metadata = { editable: false }; ring.material = new BABYLON.StandardMaterial('orbitLine' + i, scene); ring.material.emissiveColor = new BABYLON.Color3(0.3, 0.3, 0.4); ring.material.disableLighting = true; }
  const phase = i * 2.1, rate = 1.6 / Math.sqrt(radius);
  return {
    orbit(t) { body.position.set(Math.cos(phase + t * rate) * radius, 0, Math.sin(phase + t * rate) * radius); body.rotation.y = t; },
    dispose() { body.dispose(false, true); ring?.dispose(false, true); }
  };
}
