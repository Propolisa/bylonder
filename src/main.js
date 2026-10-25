import { createModifierSystem, registerModifier } from './modifiers/stack.js';
import { geometryNodesDefinition } from './graphs/geometry-nodes.js';
import { createCompositor } from './graphs/compositor.js';
import { createParticles } from './graphs/particles.js';
import { mountNodeEditor } from './graphs/node-editor.js';
import { createNodeContexts } from './graphs/contexts.js';
import { createLogic } from './graphs/logic.js';
import { createDocument, channelSlice } from './state/document.js';
registerModifier(geometryNodesDefinition);
import { registerObjects, objectRefs } from './animation/bindings.js';
import { mountTimeline } from './animation/timeline.js';
import { mountRuntimeLayout } from "./layout/runtime.js";
import { createViewportTouch } from "./input/viewport-touch.js";
import { applyRenderSettings } from "./workspace/render-settings.js";
import {
  createObjectActions,
  createObjectContextMenu,
} from "./objects/object-actions";
import { createObjectCommands } from "./objects/commands";
import { createAddMesh } from "./objects/add-mesh";
import { createOutliner } from "./objects/outliner";
import { identify, nodeId, deleted } from "./objects/identity";
import { createMouseCapture } from "./mouse-capture";
import * as BABYLON from "@babylonjs/core";
import { createSDK } from "./runtime-sdk";
import { RUN_CACHE } from "./workspace/module-host";
import "./style.css";
import "./theme.css";
import "./viewport.css";
import { mountViewportUI } from "./viewport-ui.js";
import { createMaterialLibrary } from "./materials/library.js";
import { createSceneSettings } from "./scene/settings.js";
import { createWorlds } from "./scene/world.js";
import "@babylonjs/core/Debug/debugLayer";

import { createNavigation } from "./navigation";
import { createEditor } from "./editor";
import { createHistory, snapshot, apply } from "./storage";
import { createUI } from "./ui";
const viewportDock = mountRuntimeLayout();
const canvas = document.querySelector("#viewport");
let toastTimer;
const notify = (text) => {
  const el = document.querySelector("#toast");
  el.textContent = text;
  el.style.display = "block";
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.style.display = "none"), 2800);
};
const channel = new URLSearchParams(location.search).get("channel");
const send = (type, payload) =>
  parent.postMessage({ channel, type, payload }, location.origin);
for (const level of ["log", "warn", "error"]) {
  const original = console[level];
  console[level] = (...args) => {
    original(...args);
    send("console", {
      level,
      text: args
        .map((a) => {
          try {
            return typeof a === "string" ? a : JSON.stringify(a);
          } catch {
            return String(a);
          }
        })
        .join(" "),
    });
  };
}
BABYLON.Logger.OnNewCacheEntry = (entry) => {
  const text = entry.replace(/<br>/g, "\n").replace(/<[^>]+>/g, "").trim();
  if (text) send("console", { level: /color:\s*red/i.test(entry) ? "error" : /color:\s*(orange|yellow)/i.test(entry) ? "warn" : "log", text });
};
window.addEventListener("error", (e) =>
  send("console", {
    level: "error",
    text: e.message + " " + e.filename + ":" + e.lineno,
  }),
);
window.addEventListener("unhandledrejection", (e) =>
  send("console", {
    level: "error",
    text: String(e.reason?.stack || e.reason),
  }),
);
const input = await new Promise((resolve) => {
  window.addEventListener("message", function init(e) {
    if (
      e.source === parent &&
      e.origin === location.origin &&
      e.data.channel === channel &&
      e.data.type === "init"
    ) {
      window.removeEventListener("message", init);
      resolve(e.data.payload);
    }
  });
  send("ready", {});
});
const engine = new BABYLON.Engine(canvas, true, { stencil: true });
applyRenderSettings(engine);
let saveOverrides = () => {};
const sdk = createSDK(input.base, input.overrides, () => saveOverrides(), data => send("animation", data));
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
  new Response(
    "export const BABYLON=globalThis.BABYLON,engine=globalThis.engine,canvas=globalThis.canvas,workbench=globalThis.workbench;export const controls=workbench.controls.bind(workbench),editable=workbench.editable.bind(workbench),asset=workbench.asset.bind(workbench),onDispose=workbench.onDispose.bind(workbench),meshTools=workbench.meshTools.bind(workbench),createText=workbench.createText,updateText=workbench.updateText,textSchema=workbench.textSchema,animate=workbench.animate.bind(workbench),animation=workbench.animation,addModifier=workbench.addModifier,curve=workbench.curve,registerModifier=workbench.registerModifier,registerPropertiesContext=workbench.registerPropertiesContext,registerPropertiesPanel=workbench.registerPropertiesPanel;",
    { headers: { "Content-Type": "text/javascript" } },
  ),
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
let scene;
try {
  const module = await import(/* @vite-ignore */ root + "index.js");
  if (typeof module.createScene !== "function")
    throw Error("index.js must export createScene()");
  scene = await module.createScene({ BABYLON, engine, canvas, workbench: sdk });
  if (!(scene instanceof BABYLON.Scene))
    throw Error(
      "createScene() must return a Babylon Scene from the supplied engine.",
    );
} catch (error) {
  console.error(error);
  send("run-error", { message: String(error.stack || error) });
  throw error;
}
let authoredCamera = scene.activeCamera;
let editMode = true;
authoredCamera?.detachControl();
const camera = new BABYLON.ArcRotateCamera(
  "__editorCamera",
  -Math.PI / 2,
  Math.PI / 3,
  12,
  new BABYLON.Vector3(0, 1, 0),
  scene,
);
if (authoredCamera) {
  camera.setPosition(authoredCamera.position.clone());
  camera.setTarget(authoredCamera.getTarget?.() || BABYLON.Vector3.Zero());
}
camera.minZ = 0.01;
camera.lowerRadiusLimit = 0.1;
camera.upperRadiusLimit = 10000;
camera.inertia = 0;
scene.activeCamera = camera;
const objects = [
  ...scene.meshes.filter(
    (m) => m.getTotalVertices() > 0 && m.metadata?.editable !== false,
  ),
  ...scene.transformNodes.filter(
    (n) => !n.name.startsWith("__") && n.metadata?.editable !== false,
  ),
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
const world = { engine, scene, camera, objects, animation, notify };
let creator;
const baseline = snapshot(objects);
if (input.remember && input.overrides?.transforms)
  apply(objects, input.overrides.transforms, { partial: true });
const systems = sdk.systems;
let remember = input.remember,
  lastOverride = "";
const currentOverrides = () => {
  const transforms = snapshot(objects)
    .filter((row) => !(row.deleted && row.creation))
    .filter(
      (row) =>
        JSON.stringify(row) !==
        JSON.stringify(baseline.find((b) => b.id === row.id)),
    );
  return { transforms, stores: sdk.values(), ...documentState.capture({ save: true }) };
};
saveOverrides = () => {
  if (!remember || creator?.pending || animation.evaluating || animation.playing) return;
  const state = currentOverrides();
  const serialized = JSON.stringify(state);
  if (serialized !== lastOverride) {
    lastOverride = serialized;
    send("overrides", state);
  }
};
const storage = {
  get enabled() {
    return remember;
  },
  save: saveOverrides,
  set(value) {
    remember = value;
    send("remember", value);
    if (value) saveOverrides();
  },
  clear() {
    remember = false;
    send("remember", false);
  },
};
window.addEventListener("message", (e) => {
  if (
    e.source !== parent ||
    e.origin !== location.origin ||
    e.data.channel !== channel
  )
    return;
  if (e.data.type === "reset-layout") viewportDock.reset();
  if (e.data.type === "invoke") world.objectActions.invoke(e.data.payload);
  if (e.data.type === "help") help.showModal();
  if (e.data.type === "render-settings") applyRenderSettings(engine, e.data.payload);
  if (e.data.type === "snapshot") {
    const requestId = e.data.payload.requestId;
    if (creator?.pending || editor.modal) send("snapshot-result",{requestId,error:"Finish or cancel the active edit before sharing."});
    else send("snapshot-result",{requestId,state:currentOverrides()});
  }
  if (e.data.type === "remember") {
    remember = e.data.payload;
    if (remember) saveOverrides();
  }
});
registerObjects(animation, objects);
let history;
const commit = () => history?.commit();
const documentState = createDocument();
world.materials = documentState.register("materials", createMaterialLibrary(world, { commit, asset: (path) => sdk.asset(path), files: input.files || [] }));
world.sceneSettings = documentState.register("scene", createSceneSettings(world, { commit, cameras: {
  list: () => scene.cameras.filter((c) => c !== camera),
  get: () => authoredCamera,
  set(next) {
    if (next === authoredCamera) return;
    if (!editMode) { authoredCamera?.detachControl(); scene.activeCamera = next; next.attachControl(canvas, true); }
    authoredCamera = next;
    world.compositor?.syncCamera();
  },
} }));
world.worlds = documentState.register("worlds", createWorlds(world, { commit, asset: (path) => sdk.asset(path) }));
world.compositor = documentState.register("compositor", createCompositor(world, { commit, notify }));
world.logic = documentState.register("logic", createLogic(world, { commit, notify }));
documentState.register("channels", channelSlice(animation, (channel) => /^(store|modifier|world):/.test(channel.id) || channel.id === "scene"));
world.particles = createParticles(world, { commit, notify });
world.particles.refresh();
if (input.remember) documentState.apply(input.overrides);
if (input.remember) for (const [ref, value] of Object.entries(input.overrides?.channels || {})) animation.channels.get(ref)?.set(value);
world.modifiers=createModifierSystem(world,{commit:()=>history?.commit(),notify});
world.modifiers.refresh();
if (input.animation) animation.load(input.animation);
let ui;
history = createHistory(world.objects, () => {
  storage.save();
  world.particles.refresh();
  registerObjects(animation, objects);
  world.modifiers.refresh();
  animation.changed();
  ui?.refresh();
}, {capture:()=>({animation:animation.serialize(),stores:sdk.values(),document:documentState.capture(),properties:Object.fromEntries([...animation.channels].filter(([,ch])=>!ch.transform&&ch.available()).map(([ref,ch])=>[ref,ch.get()]))}),restore:data=>{
  registerObjects(animation, objects);
  for(const system of systems)for(const [key,value] of Object.entries(data?.stores?.[system.id]||{}))system.store.set(key,value);
  documentState.apply(data?.document);
  for(const [ref,value] of Object.entries(data?.properties||{}))animation.channels.get(ref)?.set(value);
  world.modifiers.refresh();
  animation.load(data?.animation,{apply:false});
},beforeCommit:()=>animation.captureEdits()});
animation.setCommit(()=>history.commit());
const capture = createMouseCapture(canvas, notify);
const editor = createEditor(
  world,
  canvas,
  history,
  () => ui?.refresh(),
  notify,
  capture,
);
const nav = createNavigation(world, canvas, capture);
const toggleCameraView = () => {
  creator.finish();
  editor.finish(false);
  capture.release();
  editMode = !editMode;
  if (editMode) {
    authoredCamera?.detachControl();
    scene.activeCamera = camera;
    camera.attachControl(canvas, true);
  } else {
    camera.detachControl();
    if (authoredCamera) {
      scene.activeCamera = authoredCamera;
      authoredCamera.attachControl(canvas, true);
    }
  }
  document.body.classList.toggle("scene-mode", !editMode);
  document.querySelector("#scene-mode").textContent = editMode
    ? "Edit mode"
    : "Scene mode";
  viewportUI?.sync();
  world.compositor.syncCamera();
};
document.querySelector("#scene-mode").onclick = toggleCameraView;
let viewportUI;
const commands = createObjectCommands(world, editor, history, () =>
  ui?.refresh(),
);
creator = createAddMesh(
  world,
  editor,
  history,
  commands,
  sdk.meshToolConfig,
  notify,
);
commands.setBefore(() => creator.finish());
world.beforeSelection = () => creator.finish();
world.objectActions = createObjectActions({
  world,
  editor,
  commands,
  creator,
  history, nav,
  inspect: () => inspector(),
});
world.contextMenu = createObjectContextMenu(world, editor, world.objectActions);
world.dock = viewportDock;
world.outliner = createOutliner(world, editor, commands);
const touch = createViewportTouch(world, editor, nav, canvas, creator);
const beginSelection = editor.selection.begin;
editor.selection.begin = () => { animation.pause(); beginSelection(); };
ui = createUI(world, editor, storage, history, systems, sdk.properties, input.files || []);
const nodeSection = document.querySelector("#nodes-section");
const nodeEditor = mountNodeEditor({ world, host: nodeSection, header: viewportDock.header("nodes"), contexts: createNodeContexts({ world, editor }) });
nodeSection.addEventListener("node-tree", (e) => nodeEditor.setType(e.detail));
world.openNodeEditor = (type) => { nodeEditor.setType(type); viewportDock.show("nodes"); };
for (const source of [documentState, world.particles, world.modifiers]) source.subscribe(() => nodeEditor.refresh());
viewportDock.setFactory('properties',(host,id)=>ui.create(host,id));
const insertKeys = () => {registerObjects(animation, objects);animation.insert(objectRefs(editor.selection.roots));};
const timelineOptions = id => ({insert:insertKeys,undo:()=>{history.undo();editor.reconcile();},redo:()=>{history.redo();editor.reconcile();},header:viewportDock.header(id),names:ref=>world.objects.find(n=>'object:'+nodeId(n)===ref)?.name});
const timeline = mountTimeline(document.querySelector('#timeline-section'), animation, timelineOptions('timeline'));
viewportDock.setFactory('timeline',(host,id)=>mountTimeline(host,animation,timelineOptions(id)));
const unsubscribeAnimation = animation.subscribe(() => { if (!editor.modal) {editor.selection.sync();ui?.refresh();} });
document.querySelector("#add-mesh").onclick = () => creator.show();
document.querySelector("#delete-objects").onclick = () => commands.remove();
document.querySelector("#duplicate-objects").onclick = () =>
  commands.duplicate();
let inspectorBusy = false;
async function inspector() {
  if (inspectorBusy) return;
  editor.finish(false);
  inspectorBusy = true;
  try {
    if (world.scene.debugLayer.isVisible()) world.scene.debugLayer.hide();
    else {
      notify("Loading Babylon Inspector…");
      await import("@babylonjs/inspector");
      await world.scene.debugLayer.show({ embedMode: true });
    }
  } catch (e) {
    console.error(e);
    notify("Inspector could not load. Please retry.");
  } finally {
    inspectorBusy = false;
    world.engine.resize();
  }
}
const help = document.querySelector("#shortcuts");
document.querySelector("#help").onclick = () => help.showModal();
document.querySelector("#close-help").onclick = () => help.close();
viewportUI = mountViewportUI({ world, editor, nav, creator, registry: world.objectActions, dock: viewportDock, send, inspector, help, toggleCameraView, isCameraView: () => !editMode });
document.querySelector("#inspector").onclick = inspector;
document.querySelector("#opposite-view").onclick = () => nav.opposite();
document.querySelector("#projection").onclick = () => nav.toggle();
document.querySelector("#frame").onclick = () => nav.frame(editor.selected);
document.querySelector("#group").onclick = () => world.objectActions.invoke("group");
document.querySelector("#ungroup").onclick = () => world.objectActions.invoke("ungroup");
document.querySelector("#panel-toggle").onclick = () => viewportDock.show("properties", viewportDock.profile !== "desktop");
document
  .querySelectorAll("[data-view]")
  .forEach((b) => (b.onclick = () => nav.view(b.dataset.view)));
document.querySelectorAll("[data-tool]").forEach(
  (b) =>
    (b.onclick = () => {
      creator.finish();
      editor.finish(false);
      editor.setMode(b.dataset.tool);
    }),
);
const key = (e) => {
  if (
    e.target.closest('input,textarea,select,[contenteditable="true"],.node-editor-host') ||
    help.open ||
    creator.open
  )
    return;
  if (e.code === "Numpad0" && !e.repeat) { e.preventDefault(); toggleCameraView(); return; }
  if (e.target.closest(".timeline") || e.repeat || !editMode) return;
  const k = e.key.toLowerCase(),
    mod = e.ctrlKey || e.metaKey;
  if (mod && e.shiftKey && k === "i") {
    e.preventDefault();
    inspector();
    return;
  }
  if (editor.modal) {
    if (k === "escape" || k === "enter") {
      e.preventDefault();
      editor.finish(k === "enter");
      return;
    }
    if (!mod && ["x", "y", "z"].includes(k)) {
      editor.axis(k);
      return;
    }
    if (!(mod && k === "z")) return;
  }
  if (mod && k === "z") {
    e.preventDefault();
    creator.finish();
    editor.finish(false);
    e.shiftKey ? history.redo() : history.undo();
    editor.reconcile();
    return;
  }
  if (world.contextMenu.isOpen) return;
  if (k === "f9") {
    e.preventDefault();
    creator.reopen();
    return;
  }
  if (k === "escape" && creator.pending) {
    e.preventDefault();
    creator.finish(false);
    return;
  }
  if (k === "enter" && creator.pending) {
    e.preventDefault();
    creator.finish();
    return;
  }
  if (!mod && k === 'i') { e.preventDefault(); e.altKey ? animation.deleteKeys(objectRefs(editor.selection.roots).map(ref=>({ref,frame:Math.round(animation.action.frame)}))) : insertKeys(); return; }
  if (e.code === 'Space') {e.preventDefault();animation.play();return;}
  if (world.objectActions.key(e)) return;
  if (mod && k === "g") {
    e.preventDefault();
    e.altKey ? editor.ungroup() : editor.group();
    return;
  }
  if (mod && !["1", "3", "7"].includes(k)) return;
  if (["g", "r", "s"].includes(k)) {
    e.preventDefault();
    creator.finish();
    editor.start({ g: "move", r: "rotate", s: "scale" }[k]);
  } else if (k === "escape") editor.setMode("select");
  else if (k === "5") {
    e.preventDefault();
    nav.toggle();
  } else if (["1", "3", "7"].includes(k)) {
    e.preventDefault();
    nav.view({ 1: "front", 3: "right", 7: "top" }[k], mod);
  } else if (k === "f" || e.code === "NumpadDecimal") {
    e.preventDefault();
    nav.frame(editor.selected);
  } else if (k === "?") help.showModal();
};
window.addEventListener("keydown", key);
const resize = () => {
  if (!canvas.clientWidth || !canvas.clientHeight) return;
  world.engine.resize();
  nav.sync();
};
window.addEventListener("resize", resize);
const resizeObserver = new ResizeObserver(resize);
resizeObserver.observe(canvas);
let last = 0;
world.engine.runRenderLoop(() => {
  animation.tick(performance.now());
  world.modifiers.refresh();
  if (editMode) nav.updateBounds();
  if (canvas.clientWidth && canvas.clientHeight) world.scene.render();
  viewportUI.tick();
  if (performance.now() - last > 500) {
    document.querySelector("#fps").textContent =
      Math.round(world.engine.getFps()) + " FPS";
    document.querySelector("#status").textContent = editor.modal
      ? "Transforming " + editor.selection.size + " selected"
      : editor.selection.size + " selected";
    world.outliner.refresh();
    nodeEditor.refresh();
    saveOverrides();
    last = performance.now();
  }
});

function dispose() {
  storage.save();
  timeline.dispose();
  viewportUI.dispose();
  unsubscribeAnimation();
  world.modifiers.dispose();
  sdk.dispose();
  creator.dispose();
  world.outliner.dispose();
  world.contextMenu.dispose();
  nodeEditor.dispose();
  documentState.dispose();
  world.particles.dispose();
  ui.dispose();
  touch.dispose();
  viewportDock.dispose();
  editor.dispose();
  nav.dispose();
  capture.dispose();
  world.scene.dispose();
  world.engine.dispose();
  window.removeEventListener("keydown", key);
  window.removeEventListener("resize", resize);
  resizeObserver.disconnect();
  clearTimeout(toastTimer);
}
send("running", {});
window.addEventListener("pagehide", dispose, { once: true });
if (import.meta.hot) import.meta.hot.dispose(dispose);
