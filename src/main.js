import { mountNodeEditor } from './graphs/node-editor.js';
import { createNodeContexts } from './graphs/contexts.js';
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
import { nodeId } from "./objects/identity";
import { createMouseCapture } from "./mouse-capture";
import * as BABYLON from "@babylonjs/core";
import "./style.css";
import "./theme.css";
import "./viewport.css";
import { createViewportOverlays, createViewportStatus } from "./viewport-ui.js";
import { createViews } from "./viewport/views.js";
import { createView3D } from "./viewport/view3d.js";
import "@babylonjs/core/Debug/debugLayer";

import { createEditor } from "./editor";
import { createHistory, snapshot } from "./storage";
import { createWorld } from "./runtime/world.js";
import { createRenderHost } from "./render/host.js";
import { outputSize, renderDefaults } from "./scene/render.js";
import { timeDefaults } from "./scene/time.js";
import { createSceneFrames } from "./sequencer/scene-frames.js";
import { strips } from "./sequencer/sequence-editor.js";
import { createSequencerAdapter } from "./sequencer/sequencer-kubeezcut.js";
import { mountSequencerEditor, mountFileBrowser } from "./sequencer/editor.js";
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
// The engine renders into a hidden working canvas; every 3D Viewport is an engine view (src/viewport/views.js).
// User code gets the primary viewport's canvas, for camera.attachControl and input.
const workCanvas = Object.assign(document.createElement("canvas"), { className: "engine-working-canvas" });
workCanvas.setAttribute("aria-hidden", "true");
document.body.append(workCanvas);
const engine = new BABYLON.Engine(workCanvas, true, { stencil: true });
applyRenderSettings(engine);
let saveOverrides = () => {};
let history;
const commit = () => history?.commit();
let views;
let built;
try {
  built = await createWorld({ input, engine, canvas, hooks: {
    commit,
    saveOverrides: () => saveOverrides(),
    onAnimation: (data) => send("animation", data),
    notify,
    // The scene's name belongs to the project's scene list, kept by the workspace.
    renameScene: (name) => send("rename-scene", name),
    // Scene camera changed (Properties > Scene > Camera): views in camera view look through the new camera.
    setCamera(next, previous) {
      for (const view of views?.all || []) view.sceneCameraChanged(next, previous);
    },
  } });
} catch (error) {
  console.error(error);
  send("run-error", { message: String(error.stack || error) });
  throw error;
}
const { world, sdk, animation, scene, objects, baseline, documentState } = built;
const authored = () => built.authoredCamera;
const overlays = createViewportOverlays(scene);
// Views keep rendering while anything moves: playback, modal edits, user render loops and observers, animations,
// particles, video; otherwise they stop until the next input or change.
const observerCount = () => scene.onBeforeRenderObservable.observers.length + scene.onAfterRenderObservable.observers.length;
const userObservers = observerCount();
let ownObservers = 0;
const live = () =>
  animation.playing || !!editor?.modal || userObservers > 0 ||
  observerCount() > userObservers + ownObservers || engine._activeRenderLoops.length > 1 ||
  scene.animatables.length > 0 || scene.particleSystems.some((p) => p.isStarted?.() && p.isAlive?.()) ||
  scene.textures.some((t) => t.video && !t.video.paused);
views = createViews({ engine, scene, live });
world.views = views;
world.focusViewport = () => views.input?.canvas.focus();
let creator;
const systems = sdk.systems;
// Offline renders run from a snapshot of the current document, whether or not scene edits are remembered.
// Render jobs and scene strips render from a snapshot of the scene, whether or not scene edits are remembered.
const liveSnapshot = () => ({ ...input, remember: true, overrides: currentOverrides(), animation: animation.serialize() });
const renderHost = createRenderHost({
  world,
  snapshot: liveSnapshot,
  sequencer: { hasStrips: () => strips(world.sequenceEditor.state).length > 0, openCompositor: (range) => sequencerAdapter.openCompositor(range) },
  name: () => world.sceneSettings.state.name || "render",
});
// Development handle for debugging and browser tests; not present in production builds.
if (import.meta.env.DEV) window.__bylonder = { world, renderHost, get editor() { return editor; }, get views() { return views; }, get sequencer() { return sequencerAdapter; } };
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
  if (e.data.type === "render") ({ image: renderHost.renderImage, animation: renderHost.renderAnimation, view: renderHost.viewRender })[e.data.payload]?.();
  if (e.data.type === "snapshot") {
    const requestId = e.data.payload.requestId;
    if (creator?.pending || editor.modal) send("snapshot-result",{requestId,error:"Finish or cancel the active edit before sharing."});
    else send("snapshot-result",{requestId,state:currentOverrides()});
  }
  if (e.data.type === "remember") {
    remember = e.data.payload;
    if (remember) saveOverrides();
  }
  // Another scene became active while this one stays loaded (Keep Scenes Loaded); it waits hidden.
  if (e.data.type === "suspend") animation.pause();
  if (e.data.type === "resume") views.wake();
  if (e.data.type === "scene-name") world.sceneSettings.renamed(e.data.payload);
});
let ui;
let sceneChanged = () => {};
history = createHistory(world.objects, () => {
  storage.save();
  sceneChanged();
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
},beforeCommit:()=>{world.collections.adopt();animation.captureEdits();}});
animation.setCommit(()=>history.commit());
const capture = createMouseCapture(notify);
const editor = createEditor(
  world,
  views,
  history,
  () => { ui?.refresh(); views.wake(); },
  notify,
  capture,
);
const activeView = () => views.input;
// Object actions and menus act on the 3D Viewport under the pointer, as in Blender.
const nav = { frame: (node) => activeView()?.nav.frame(node) };
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
const touch = createViewportTouch(world, editor, creator, views);
// Like Blender, objects hidden or excluded through their collections drop out of the selection.
world.collections.subscribe(() => {
  const keep = editor.selection.nodes.filter((n) => world.collections.status(n).visible);
  if (keep.length !== editor.selection.size) { editor.selection.replace(keep); editor.reconcile(); }
});
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
    views.relayout();
  }
}
const help = document.querySelector("#shortcuts");
document.querySelector("#help").onclick = () => help.showModal();
document.querySelector("#close-help").onclick = () => help.close();
// 3D Viewports: the primary area and any added by splitting it (dock factory 'viewport').
const viewportCtx = {
  world, views, editor, registry: world.objectActions, creator, dock: viewportDock, capture, inspector, help, overlays,
  sceneCamera: authored,
  // Shading or camera view changed somewhere: effects attach to rendered views' cameras and one rendered view
  // (the last one clicked, else the first) shows the compositor.
  shadingChanged() {
    const all = views.all, rendered = all.filter((v) => v.rendered);
    const compositorView = world.compositor.enabled ? (rendered.includes(views.focused) ? views.focused : rendered[0]) || null : null;
    for (const v of all) v.wantsCompositor = v === compositorView;
    world.setViewShading({ renderedCameras: rendered.map((v) => v.camera), compositorCamera: compositorView?.camera });
    const cameraView = !!views.input?.state.cameraView;
    document.body.classList.toggle("scene-mode", cameraView);
    document.querySelector("#scene-mode").textContent = cameraView ? "Scene mode" : "Edit mode";
    views.relayout();
  },
};
const mountView = (options) => {
  const view = createView3D(viewportCtx, options);
  const detachEditor = editor.attach(view), detachTouch = touch.attach(view);
  const dispose = view.dispose;
  view.dispose = () => { detachEditor(); detachTouch(); dispose(); };
  views.add(view);
  viewportCtx.shadingChanged();
  return view;
};
const primary = mountView({ section: document.querySelector("#viewport-section"), canvas, headerId: "viewport", cameraName: "__editorCamera" });
if (authored()) {
  primary.editorCamera.setPosition(authored().position.clone());
  primary.editorCamera.setTarget(authored().getTarget?.() || BABYLON.Vector3.Zero());
}
viewportDock.setFactory("viewport", (host, id) => mountView({ section: host, headerId: id, from: activeView()?.editorCamera || primary.editorCamera }));
views.setInput(primary);
views.onFocus = () => viewportCtx.shadingChanged();
world.compositor.subscribe(() => viewportCtx.shadingChanged());
const status = createViewportStatus({ world, editor, views, send });
// Video Sequencer and File Browser (KubeezCut islands, loaded on first use). The project's video uses the scene's
// output size and frame rate.
const activeSceneId = input.scene?.id;
const sceneRecords = () => input.scenes || [];
const scenePayload = (id) => {
  if (id === activeSceneId) return liveSnapshot();
  const { overrides, animation: action, ...scene } = sceneRecords().find((s) => s.id === id);
  return { ...input, scene, remember: true, overrides, animation: action };
};
const hostScenes = () => sceneRecords().map((record) => {
  const live = record.id === activeSceneId;
  const time = live ? animation.time.state : { ...timeDefaults, ...record.animation?.time };
  const render = live ? world.renderSettings.state.render : { ...renderDefaults.render, ...record.overrides?.render?.render };
  return { id: record.id, name: live ? world.sceneSettings.state.name : record.name, frameStart: time.frameStart, frameEnd: time.frameEnd, ...outputSize(render) };
});
// Scene strips of the active scene re-render when its saved state changes, not on sequencer edits or seeks.
let liveRevision = 0;
const liveKey = () => {
  const { sequenceEditor, ...overrides } = currentOverrides();
  const { time, ...action } = animation.serialize();
  return JSON.stringify([overrides, action, { ...time, frameCurrent: 0 }]);
};
let lastLiveKey = liveKey();
const sceneFrames = createSceneFrames({ payload: scenePayload, revision: (id) => (id === activeSceneId ? liveRevision : 0) });
sceneChanged = () => {
  const key = liveKey();
  if (key === lastLiveKey) return;
  lastLiveKey = key;
  liveRevision++;
  sceneFrames.changed();
};
const sequencerFormat = () => ({ ...outputSize(world.renderSettings.state.render), fps: animation.time.state.fps });
const sequencerAdapter = createSequencerAdapter({
  project: () => ({ id: "bylonder:" + (input.projectId || "default"), name: world.sceneSettings.state.name, ...sequencerFormat() }),
  sequenceEditor: world.sequenceEditor,
  time: animation.time,
  history: { undo: () => undoRedo(false), redo: () => undoRedo(true) },
  frames: sceneFrames,
  scenes: hostScenes,
  notify,
});
world.renderSettings.subscribe(() => sequencerAdapter.setFormat(sequencerFormat()));
animation.time.subscribe((kind) => { if (kind === "settings" || kind === "load") sequencerAdapter.setFormat(sequencerFormat()); });
const sequencerEditor = mountSequencerEditor(document.querySelector("#sequencer-section"), { adapter: sequencerAdapter, header: viewportDock.header("sequencer"), notify });
const fileBrowser = mountFileBrowser(document.querySelector("#files-section"), { adapter: sequencerAdapter, notify });
for (const event of ["pointermove", "pointerdown", "wheel", "keydown"]) window.addEventListener(event, () => views.wake(), { passive: true, capture: true });
for (const source of [documentState, world.particles, world.modifiers, animation]) source.subscribe?.(() => views.wake());
ownObservers = observerCount() - userObservers;
document.querySelector("#inspector").onclick = inspector;
document.querySelector("#scene-mode").onclick = () => activeView()?.toggleCameraView();
document.querySelector("#opposite-view").onclick = () => activeView().nav.opposite();
document.querySelector("#projection").onclick = () => activeView().nav.toggle();
document.querySelector("#frame").onclick = () => nav.frame(editor.selected);
document.querySelector("#group").onclick = () => world.objectActions.invoke("group");
document.querySelector("#ungroup").onclick = () => world.objectActions.invoke("ungroup");
document.querySelector("#panel-toggle").onclick = () => viewportDock.show("properties", viewportDock.profile !== "desktop");
document
  .querySelectorAll("[data-view]")
  .forEach((b) => (b.onclick = () => activeView().nav.view(b.dataset.view)));
function undoRedo(redo) {
  creator.finish();
  editor.finish(false);
  redo ? history.redo() : history.undo();
  editor.reconcile();
}
const key = (e) => {
  // Keys over the Video Sequencer (and its menu commands, which run as synthetic key events) belong to it.
  if (!e.isTrusted || (e.key !== "F12" && document.querySelector(".vse-area:hover"))) return;
  if (
    e.target.closest('input,textarea,select,[contenteditable="true"],.node-editor-host') ||
    help.open ||
    creator.open
  )
    return;
  if (e.code === "Numpad0" && !e.repeat) { e.preventDefault(); activeView()?.toggleCameraView(); return; }
  if (e.key === "F12" && !e.repeat) { e.preventDefault(); (e.ctrlKey || e.metaKey ? renderHost.renderAnimation : renderHost.renderImage)(); return; }
  if (e.key === "F11" && !e.repeat) { e.preventDefault(); renderHost.viewRender(); return; }
  if (e.key === "Escape" && !editor.modal && !creator.pending && renderHost.escape()) { e.preventDefault(); return; }
  if (e.target.closest(".timeline") || e.repeat || !activeView() || activeView().state.cameraView) return;
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
    undoRedo(e.shiftKey);
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
  if (!mod && k === 'i') { e.preventDefault(); e.altKey ? animation.deleteKeys(objectRefs(editor.selection.roots).map(ref=>({ref,frame:Math.round(animation.time.frame)}))) : insertKeys(); return; }
  if (e.code === 'Space') {e.preventDefault();animation.play();return;}
  if (world.objectActions.key(e)) return;
  if (mod && !["1", "3", "7"].includes(k)) return;
  if (["g", "r", "s"].includes(k)) {
    e.preventDefault();
    creator.finish();
    editor.start({ g: "move", r: "rotate", s: "scale" }[k]);
  } else if (k === "escape") editor.setMode("select");
  else if (k === "5") {
    e.preventDefault();
    activeView().nav.toggle();
  } else if (["1", "3", "7"].includes(k)) {
    e.preventDefault();
    activeView().nav.view({ 1: "front", 3: "right", 7: "top" }[k], mod);
  } else if (k === "f" || e.code === "NumpadDecimal") {
    e.preventDefault();
    nav.frame(editor.selected);
  } else if (k === "?") help.showModal();
};
window.addEventListener("keydown", key);
let last = 0;
// Once per animation frame, before views decide whether to render.
const perFrame = engine.onBeginFrameObservable.add(() => {
  animation.tick(performance.now());
  world.modifiers.refresh();
  for (const view of views.all) if (!view.state.cameraView) view.nav.updateBounds();
  status.tick();
  if (performance.now() - last > 500) {
    world.outliner.refresh();
    nodeEditor.refresh();
    saveOverrides();
    last = performance.now();
  }
}, undefined, true);
// Runs once per visible view per frame (engine views); the view manager applies per-view state around it.
const renderScene = () => scene.render();
engine.runRenderLoop(renderScene);

function dispose() {
  storage.save();
  timeline.dispose();
  engine.onBeginFrameObservable.remove(perFrame);
  for (const view of views.all) view.dispose();
  views.dispose();
  overlays.dispose();
  renderHost.dispose();
  sequencerEditor.dispose();
  fileBrowser.dispose();
  sequencerAdapter.dispose();
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
  capture.dispose();
  world.scene.dispose();
  world.engine.dispose();
  window.removeEventListener("keydown", key);
  clearTimeout(toastTimer);
}
send("running", {});
window.addEventListener("pagehide", dispose, { once: true });
if (import.meta.hot) import.meta.hot.dispose(dispose);
