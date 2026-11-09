import { Observable } from '@babylonjs/core';

// What a render waits on while it prepares: { ready, total } of the materials the scene draws, as their shaders compile.
export const onPreparing = new Observable();
const materialsOf = (scene) => new Set(scene.meshes.filter((mesh) => mesh.isEnabled() && mesh.subMeshes?.length).map((mesh) => mesh.material).filter(Boolean));
const reportPreparing = (scene) => {
  const notReady = new Set(scene.meshes.filter((mesh) => mesh.isEnabled() && mesh.subMeshes?.length && !mesh.isReady(true)).map((mesh) => mesh.material));
  const total = materialsOf(scene).size;
  onPreparing.notifyObservers({ ready: total - [...notReady].filter(Boolean).length, total });
};

// A scene ready to render, as Babylon's whenReadyAsync gives it, or an error naming the material whose shader did not
// compile: Babylon's readiness waits for ever on a material it cannot compile.
const effects = (subMesh) => [subMesh.getMaterial()?.getEffect?.(), ...subMesh._drawWrappers.map((wrapper) => wrapper?.effect)];

export async function sceneReady(scene) {
  const engine = scene.getEngine();
  let observer;
  const failed = new Promise((_, reject) => {
    const fail = (effect, error) => {
      const material = scene.materials.find((m) => m.getEffect?.() === effect) ?? scene.meshes.flatMap((mesh) => mesh.subMeshes ?? []).find((s) => effects(s).includes(effect))?.getMesh().material;
      reject(Error(`the shader of material "${material?.name ?? effect.name}" did not compile: ${String(error).trim().split('\n')[0]}`));
    };
    observer = engine.onEffectErrorObservable.add(({ effect, errors }) => fail(effect, errors));
    for (const mesh of scene.meshes) for (const subMesh of mesh.subMeshes ?? []) {
      const effect = effects(subMesh).find((e) => e?._compilationError);
      if (effect) fail(effect, effect._compilationError);
    }
  });
  const polling = setInterval(() => reportPreparing(scene), 250);
  try { await Promise.race([scene.whenReadyAsync(), failed]); } finally { engine.onEffectErrorObservable.remove(observer); clearInterval(polling); }
}
