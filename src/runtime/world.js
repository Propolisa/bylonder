import * as BABYLON from "@babylonjs/core";
import { asObject } from "./object-transform.js";
import { createModifierSystem, registerModifier } from "../modifiers/stack.js";
import { createWorkerEvaluator } from "../modifiers/evaluator.js";
import { createJobs } from "../windowmanager/wm-jobs.js";
import { geometryNodesDefinition } from "../nodes/geometry-nodes.js";
import { createCompositor } from "../compositor/compositor.js";
import { createParticles } from "../nodes/particles.js";
import { createLogic } from "../nodes/logic.js";
import { createDocument, channelSlice } from "../blenkernel/document.js";
import { createAnnotations } from "../blenkernel/gpencil/annotations.js";
import { registerObjects } from "../blenkernel/animation/bindings.js";
import { identify, hasMesh } from "../editors/object/identity.js";
import { createSDK } from "./sdk.js";
import { sdkModuleSource } from "./sdk-module.js";
import { RUN_CACHE } from "../workspace/module-host.js";
import { createMaterialLibrary } from "../blenkernel/material/library.js";
import { createSceneSettings } from "../blenkernel/scene/settings.js";
import { createTextures } from "../blenkernel/texture/textures.js";
import { createWorlds } from "../blenkernel/scene/world.js";
import { createRenderSettings } from "../blenkernel/scene/render.js";
import { createCollections } from "../blenkernel/scene/collections.js";
import { createSequenceEditor } from "../sequencer/sequence-editor.js";
import { snapshot, apply } from "../editors/undo/storage.js";
registerModifier(geometryNodesDefinition);

// Builds the scene world from a run payload: runs the project's createScene, identifies editable objects
// and registers every document slice. Shared by the interactive viewport and the offline render context,
// so both see the same scene for the same document state. Hosts own cameras, UI, history and persistence.
//   input: run payload (base, importmap, files, animation, remember, overrides, scene: { id, name, builder })
//   hooks: commit() for undo steps, saveOverrides() for scene edits, onAnimation(data), notify(text),
//          setCamera(next) when the scene camera changes (the host decides what camera view means),
//          renameScene(name) when the scene is renamed in Properties, jobs (wm-jobs.js) that evaluate modifiers
//          off the main thread
export async function createWorld({ input, engine, canvas, hooks = {} }) {
  const { commit = () => {}, saveOverrides = () => {}, onAnimation = () => {}, notify = console.warn, setCamera = () => {}, renameScene = () => {}, jobs = createJobs() } = hooks;
  const sdk = createSDK(input.base, input.overrides, () => saveOverrides(), onAnimation);
  const animation = sdk.animation;
  Object.assign(globalThis, { BABYLON: { ...BABYLON }, engine, canvas, workbench: sdk });
  const root = location.origin + input.base;
  const cache = await caches.open(RUN_CACHE);
  await cache.put(
    root + "__wb_babylon.js",
    new Response(
      Object.keys(BABYLON)
        .filter((k) => /^[A-Za-z_$][\w$]*$/.test(k))
        .map((k) => "export const " + k + "=globalThis.BABYLON." + k + ";")
        .join("\n"),
      { headers: { "Content-Type": "text/javascript" } },
    ),
  );
  await cache.put(
    root + "__wb_sdk.js",
    new Response(sdkModuleSource, { headers: { "Content-Type": "text/javascript" } }),
  );
  const userMap = JSON.parse(input.importmap);
  const imports = {};
  for (const [key, value] of Object.entries(userMap.imports || {}))
    imports[key] = new URL(value, root).href;
  Object.assign(imports, {
    "@babylonjs/core": root + "__wb_babylon.js",
    babylonjs: root + "__wb_babylon.js",
    "@workbench/sdk": root + "__wb_sdk.js",
  });
  const scopes = {};
  for (const [scope, map] of Object.entries(userMap.scopes || {})) {
    scopes[new URL(scope, root).href] = {};
    for (const [key, value] of Object.entries(map))
      scopes[new URL(scope, root).href][key] = new URL(value, root).href;
  }
  const importmap = document.createElement("script");
  importmap.type = "importmap";
  importmap.textContent = JSON.stringify({ imports, scopes });
  document.head.append(importmap);
  // The scene builder: an index.js export (createScene unless the scene names another), or none for an empty
  // scene, which starts without objects and does not load the project code.
  const builder = input.scene ? input.scene.builder : "createScene";
  let scene;
  if (builder) {
    const module = await import(/* @vite-ignore */ root + "index.js");
    if (typeof module[builder] !== "function")
      throw Error(`index.js must export ${builder}()`);
    scene = await module[builder]({ BABYLON, engine, canvas, workbench: sdk });
    if (!(scene instanceof BABYLON.Scene))
      throw Error(`${builder}() must return a Babylon Scene from the supplied engine.`);
  } else scene = new BABYLON.Scene(engine);
  let authoredCamera = scene.activeCamera;
  authoredCamera?.detachControl();
  const authored = (n) => !n.name.startsWith("__") && n.metadata?.editable !== false;
  // Skyboxes (infinite-distance meshes) belong to the World, which shows them in rendered views only (world-babylon.js).
  const objects = [
    ...scene.meshes.filter((m) => hasMesh(m) && !m.infiniteDistance && m.metadata?.editable !== false),
    ...scene.transformNodes.filter(authored),
    ...[...scene.lights, ...scene.cameras].filter(authored).map(asObject),
  ];
  const names = new Set();
  for (const node of objects) {
    const base = node.name || "Object";
    let i = 2;
    while (names.has(node.name)) node.name = base + "." + i++;
    names.add(node.name);
    identify(node);
  }
  objects.scene = scene;
  const world = { engine, scene, objects, animation, notify };
  const baseline = snapshot(objects);
  if (input.remember && input.overrides?.transforms)
    apply(objects, input.overrides.transforms, { partial: true });
  registerObjects(animation, objects);
  const documentState = createDocument();
  world.materials = documentState.register("materials", createMaterialLibrary(world, { commit, asset: (path) => sdk.asset(path), files: input.files || [] }));
  world.textures = documentState.register("textures", createTextures(world, { commit }));
  world.sceneSettings = documentState.register("scene", createSceneSettings(world, { commit, name: input.scene?.name, rename: renameScene, cameras: {
    list: () => scene.cameras.filter((c) => !c.name.startsWith("__")),
    get: () => authoredCamera,
    set(next) {
      if (next === authoredCamera) return;
      const previous = authoredCamera;
      authoredCamera = next;
      setCamera(next, previous);
    },
  } }));
  world.worlds = documentState.register("worlds", createWorlds(world, { commit, asset: (path) => sdk.asset(path) }));
  world.renderSettings = documentState.register("render", createRenderSettings(world, { commit, authored: sdk.authoredRender }));
  world.collections = documentState.register("collections", createCollections(world, { commit }));
  world.sequenceEditor = documentState.register("sequenceEditor", createSequenceEditor({ commit }));
  world.annotations = documentState.register("annotations", createAnnotations({ frame: () => Math.round(animation.time.frame) }));
  // Views in Rendered shading or camera view show the world background and volume, render-engine effects and
  // (in one view at a time) the compositor. setViewShading runs when view shading or cameras change: it attaches
  // effects to the rendered cameras and binds the compositor camera. beforeViewRender runs per view, per frame,
  // and only flips switches.
  world.setViewShading = ({ renderedCameras = [], compositorCamera = null }) => {
    world.renderSettings.setRenderedCameras(renderedCameras);
    world.compositor?.bindCamera(compositorCamera);
  };
  world.beforeViewRender = ({ rendered, compositor }) => {
    world.worlds.setViewportActive(rendered);
    world.compositor?.setViewportActive(compositor);
  };
  world.compositor = documentState.register("compositor", createCompositor(world, { commit, notify }));
  world.logic = documentState.register("logic", createLogic(world, { commit, notify }));
  documentState.register("channels", channelSlice(animation, (channel) => /^(store|modifier|world):/.test(channel.id) || channel.id === "scene"));
  world.particles = createParticles(world, { commit, notify });
  world.particles.refresh();
  if (input.remember) documentState.apply(input.overrides);
  if (input.remember) for (const [ref, value] of Object.entries(input.overrides?.channels || {})) animation.channels.get(ref)?.set(value);
  world.modifiers = createModifierSystem(world, { commit, notify, jobs, evaluate: createWorkerEvaluator() });
  world.modifiers.refresh();
  if (input.animation) animation.load(input.animation);
  return {
    world, sdk, animation, scene, objects, baseline, documentState,
    get authoredCamera() { return authoredCamera; },
  };
}
