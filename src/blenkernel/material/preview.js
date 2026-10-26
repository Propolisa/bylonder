import { ArcRotateCamera, Color3, Color4, CubeTexture, DirectionalLight, Engine, HemisphericLight, Material, MeshBuilder, Scene, StandardMaterial, Vector3 } from '@babylonjs/core';

const ENVIRONMENT = 'https://assets.babylonjs.com/environments/environmentSpecular.env';

export function createPreview() {
  let engine, scene, sphere, current, timer, last = '', busy = false;
  const init = () => {
    const canvas = Object.assign(document.createElement('canvas'), { width: 220, height: 220 });
    engine = new Engine(canvas, true, { preserveDrawingBuffer: true, antialias: true, alpha: true });
    scene = new Scene(engine);
    scene.clearColor = new Color4(0, 0, 0, 0);
    new ArcRotateCamera('preview', -Math.PI / 2, Math.PI / 2.25, 5.2, new Vector3(0, -0.15, 0), scene);
    new HemisphericLight('fill', new Vector3(0, 1, 0.3), scene).intensity = 0.55;
    const key = new DirectionalLight('key', new Vector3(-0.6, -1, 0.8), scene);
    key.intensity = 0.9;
    try { scene.environmentTexture = CubeTexture.CreateFromPrefilteredData(ENVIRONMENT, scene); } catch {}
    sphere = MeshBuilder.CreateSphere('sphere', { diameter: 2, segments: 48 }, scene);
    const floor = MeshBuilder.CreateGround('floor', { width: 8, height: 8 }, scene);
    floor.position.y = -1.01;
    const checker = new StandardMaterial('floor', scene);
    checker.diffuseColor = new Color3(0.18, 0.18, 0.18);
    floor.material = checker;
  };
  const render = async (material, done) => {
    if (busy) return;
    busy = true;
    try {
      if (!engine) init();
      current?.dispose(false, true);
      current = Material.Parse(material.serialize(), scene, '');
      sphere.material = current;
      await scene.whenReadyAsync();
      scene.render();
      done(engine.getRenderingCanvas().toDataURL());
    } catch (error) {
      console.warn('Material preview: ' + error.message);
    } finally { busy = false; }
  };
  return {
    request(material, done) {
      clearTimeout(timer);
      if (!material) return;
      timer = setTimeout(() => {
        let signature;
        try { signature = material.name + JSON.stringify(material.serialize()); } catch { return; }
        if (signature === last) return;
        last = signature;
        render(material, done);
      }, 250);
    },
    dispose() { clearTimeout(timer); engine?.dispose(); engine = null; },
  };
}
