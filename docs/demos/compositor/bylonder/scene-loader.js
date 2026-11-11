// @ts-check
// SPDX-License-Identifier: MIT OR Apache-2.0
// Babylon's SceneLoader reads a package's scene.bylonder as it reads a .glb: imported once, this module lets
// ImportMeshAsync, AppendSceneAsync and LoadAssetContainerAsync take it, loading the package's scene.js beside it into the
// scene (its load({ scene }), asset.js).
import { Observable } from '@babylonjs/core/Misc/observable.js';
import { RegisterSceneLoaderPlugin } from '@babylonjs/core/Loading/sceneLoader.js';

/** The package's scene.js beside its scene.bylonder. @param {unknown} url */
const sceneModule = (url) => import(new URL(String(url).replace(/\.bylonder$/, '.js'), globalThis.document?.baseURI).href);

RegisterSceneLoaderPlugin({
  name: 'bylonder',
  extensions: { '.bylonder': { isBinary: false } },
  // scene.js reads its own files: the loader only passes on the URL.
  loadFile(scene, url, rootUrl, onSuccess) {
    onSuccess(url);
    return { abort() {}, onCompleteObservable: new Observable() };
  },
  async importMeshAsync(names, scene, url) {
    const { entries } = await (await sceneModule(url)).load({ scene });
    return { ...entries, spriteManagers: [] };
  },
  async loadAsync(scene, url) {
    await (await sceneModule(url)).load({ scene });
  },
  async loadAssetContainerAsync(scene, url) {
    return (await sceneModule(url)).loadAssetContainer(scene);
  },
});
