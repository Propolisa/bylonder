import { mountNodeEditor } from './editors/space_node/node-editor.js';
import { syncLightDirections } from "./runtime/object-transform.js";
import { createCompositorBackdrop } from './editors/space_node/compositor-backdrop.js';
import { createNodeContexts } from './editors/space_node/contexts.js';
import { registerObjects, objectRefs } from './blenkernel/animation/bindings.js';
import { mountAnimEditor, registerAnimOperators } from './editors/animation/anim-editor.js';
import { mountRuntimeLayout } from "./editors/screen/runtime.js";
import { createViewportTouch } from "./windowmanager/input/viewport-touch.js";
import { applyRenderSettings } from "./workspace/render-settings.js";
import {
  createObjectActions,
  createObjectContextMenu,
} from "./editors/object/object-actions";
import { createObjectCommands } from "./editors/object/commands";
import { createAddMesh } from "./editors/object/add-mesh";
import { createOutliner } from "./editors/space_outliner/outliner";
import { visible, deleted } from "./editors/object/identity";
import { view_3d as theme } from "./editors/interface/userdef-default-theme.js";
import { createWorkbench } from "./draw/workbench.js";
import { createMouseCapture } from "./windowmanager/mouse-capture";
import { createEventSystem } from "./windowmanager/wm-event-system.js";
import * as BABYLON from "@babylonjs/core";
import "./style.css";
import "./theme.css";
import "./editors/space_view3d/viewport.css";
import { createViewportOverlays, createViewportStatus } from "./editors/space_view3d/viewport-ui.js";
import { createViews } from "./editors/space_view3d/views.js";
import { createView3D } from "./editors/space_view3d/view3d.js";
import "@babylonjs/core/Debug/debugLayer";

import { createEditor } from "./editors/object/editor";
import { createHistory, snapshot } from "./editors/undo/storage";
import { createWorld } from "./runtime/world.js";
import { createRenderHost } from "./editors/render/host.js";
import { outputSize, renderDefaults } from "./blenkernel/scene/render.js";
import { timeDefaults } from "./blenkernel/scene/time.js";
import { createSceneFrames } from "./sequencer/scene-frames.js";
import { strips } from "./sequencer/sequence-editor.js";
import { hash } from "./workspace/opfs.js";
import { createSequencerAdapter } from "./sequencer/sequencer-kubeezcut.js";
import { mountSequencerEditor, mountFileBrowser } from "./editors/space_sequencer/editor.js";
import { createUI } from "./editors/interface/ui";
import { createKeymap } from "./windowmanager/input/keymap.js";
import { createEditMode } from "./editors/object/object-edit.js";
import { createEditModes } from "./editors/object/edit-modes.js";
import { createEditCurve, registerCurveAddOperators } from "./editors/curve/editcurve.js";
import { createCurveObjects } from "./editors/curve/curve-objects.js";
import { registerObjectOperators } from "./editors/object/object-operators.js";
import { registerAddOperators } from "./editors/object/add-operators.js";
import { openMenu } from "./editors/interface/menu.js";
import { createBlenderObjects } from "./editors/object/object-blender.js";
import { registerOperators, runOperator, appendMenu, kw, inArea, contextArea } from "./windowmanager/wm-operators.js";
import { keymapHandler } from "./windowmanager/keyconfig.js";
import { createToolSystem } from "./windowmanager/wm-toolsystem.js";
import { startGestureLasso } from "./windowmanager/wm-gesture-lasso.js";
import { startGestureCircle } from "./windowmanager/wm-gesture-circle.js";
import { lassoRegion, circleRegion } from "./editors/space_view3d/view3d-select.js";
import { createRNA } from "./makesrna/rna-bylonder.js";
import { createContext } from "./blenkernel/context.js";
import { createJobs } from "./windowmanager/wm-jobs.js";
import { createRunningJobs } from "./editors/interface/running-jobs.js";
const viewportDock = mountRuntimeLayout();
const canvas = document.querySelector("#viewport");
let toastTimer;
const notify = (text) => {
  const el = document.querySelector("#toast");
  el.textContent = text;
  el.style.display = text ? "block" : "none";
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
// The engine renders into a hidden working canvas; every 3D Viewport is an engine view (src/editors/space_view3d/views.js).
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
// The 3D Viewports among the engine views (the compositor backdrop is the other kind).
const viewports = () => views?.all.filter((view) => view.nav) || [];
// The Properties editor and the 3D Views' regions drawn from Blender's scripts show the data anew.
function refreshUI() {
  ui?.refresh();
  for (const view of viewports()) view.regions?.draw();
}
// Modifier evaluations off the main thread, shown with Cancel once they take long, asking before enormous ones.
const jobs = createJobs({ ask: true });
const runningJobs = createRunningJobs(document.body.appendChild(document.createElement("div")), jobs);
let built;
try {
  built = await createWorld({ input, engine, canvas, hooks: {
    commit,
    jobs,
    saveOverrides: () => saveOverrides(),
    onAnimation: (data) => send("animation", data),
    notify,
    // The scene's name belongs to the project's scene list, kept by the workspace.
    renameScene: (name) => send("rename-scene", name),
    // Scene camera changed (Properties > Scene > Camera): views in camera view look through the new camera.
    setCamera(next, previous) {
      for (const view of viewports()) view.sceneCameraChanged(next, previous);
    },
  } });
} catch (error) {
  console.error(error);
  send("run-error", { message: String(error.stack || error) });
  throw error;
}
const { world, sdk, animation, scene, objects, baseline, documentState } = built;
const authored = () => built.authoredCamera;
// Theme wire color of an object (Resources::object_wire_theme_id): the active or selected color, else its type's.
const wireColor = (node, type = "wire") => !editor?.selection.has(node) ? theme[type] : editor.selection.nodes.at(-1) === node ? theme.object_active : theme.object_selected;
const overlays = createViewportOverlays(scene, {
  objects: () => world.objects,
  color: wireColor,
  sceneCamera: authored,
  visible: (node) => (world.objects.includes(node) ? visible(node) && (world.collections?.status(node).visible ?? true) : node.isEnabled()),
  aspect: () => { const { width, height } = outputSize(world.renderSettings.state.render); return width / height; },
}, { objects: () => world.objects, color: (node) => (editor?.selection.has(node) && !deleted(node) ? wireColor(node) : null) });
world.pickExtra = (x, y, camera, accept) => overlays.extras.pick(x, y, camera, accept);
world.workbench = createWorkbench(scene, { wireColor: (mesh) => wireColor(mesh.metadata?.drawOwner ?? mesh) });
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
syncLightDirections(scene);
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
// Handle for debugging and the browser tests, which run against the production build.
window.__bylonder ={ world, renderHost, runOperator, get editor() { return editor; }, get views() { return views; }, get sequencer() { return sequencerAdapter; }, get history() { return history; }, get sceneFrames() { return sceneFrames; } };
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
  if (e.data.type === "view-layer") {
    const cols = world.collections, { op, id } = e.data.payload;
    ({ set: () => cols.setViewLayer(id), add: () => cols.createViewLayer(), remove: () => cols.removeViewLayer(cols.layer().id) })[op]?.();
  }
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
  refreshUI();
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
world.wm = createEventSystem({ layers: () => keyLayers(), viewAt: (e) => viewAt(e), accepts: (e) => acceptsKey(e) });
const editor = createEditor(
  world,
  views,
  history,
  () => { refreshUI(); views.wake(); },
  notify,
  capture,
);
const activeView = () => views.input;
// Object actions and menus act on the 3D Viewport under the pointer, as in Blender.
const nav = { frame: (node) => activeView()?.nav.frame(node) };
const commands = createObjectCommands(world, editor, history, () =>
  refreshUI(),
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
world.curves = createCurveObjects(world);
const editModeOptions = { world, editor, views, history, notify, changed: () => { refreshUI(); views.wake(); } };
const editCurve = createEditCurve({ ...editModeOptions, curves: world.curves });
world.editMode = createEditModes(createEditMode(editModeOptions), editCurve);
registerCurveAddOperators({ editor, history, commands, curves: world.curves, editCurve });
// Edit Mode commits a pending Add, as changing mode does in Blender: its panel no longer adjusts the object.
world.onModeChange = () => {
  if (world.editMode?.active) creator.finish();
  applyTool();
  viewports().forEach((view) => view.sync());
};
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
const blenderRNA = createRNA({ world, selection: editor.selection, update: () => { refreshUI(); views.wake(); }, undoPush: commit });
// bpy.context for a 3D Viewport (blenkernel/context.js) and one of its regions, for what is drawn from Blender's scripts.
world.blenderContext = (view, region) => createContext(blenderRNA, { space: view, region });
// The mode the tool system and Blender's keymaps go by (context.mode).
const contextMode = () => (world.editMode.active ? "EDIT_MESH" : "OBJECT");
// Blender's tool system: the active tool's gizmo shows in Object Mode, and the views redraw their toolbars.
const TOOL_GIZMOS = { "builtin.move": "move", "builtin.rotate": "rotate", "builtin.scale": "scale", "builtin.transform": "transform" };
const applyTool = () => {
  if (!editor.modal && !world.editMode.active) editor.setMode(TOOL_GIZMOS[world.toolsystem.active("OBJECT").idname] ?? "select");
};
// The 3D View operators act on: the context area's (wm-operators.js), else the one under the pointer.
const contextView = () => contextArea()?.space ?? activeView();
world.toolsystem = createToolSystem({
  context: () => world.blenderContext(contextView()),
  changed: () => { applyTool(); viewports().forEach((view) => view.sync()); },
});
const blenderObjects = createBlenderObjects({ rna: blenderRNA, transaction: commands.transaction, notify, ids: animation.ids, keying: (run) => animation.keying(run) });
registerObjectOperators(world.objectActions, blenderObjects);
registerAddOperators(creator);
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
ui = createUI(world, editor, storage, history, systems, sdk.properties, input.files || [], blenderRNA);
const nodeSection = document.querySelector("#nodes-section");
let shadingReady = false;
const backdrop = createCompositorBackdrop({
  world,
  overlays,
  camera: () => authored(),
  output: () => outputSize(world.renderSettings.state.render),
  shadingChanged: () => shadingReady && viewportCtx.shadingChanged(),
});
views.add(backdrop.view);
const nodeEditor = mountNodeEditor({ world, host: nodeSection, header: viewportDock.header("nodes"), contexts: createNodeContexts({ world, editor }), backdrop });
nodeSection.addEventListener("node-tree", (e) => nodeEditor.setType(e.detail));
world.openNodeEditor = (type) => { nodeEditor.setType(type); viewportDock.show("nodes"); };
for (const source of [documentState, world.particles, world.modifiers]) source.subscribe(() => nodeEditor.refresh());
world.modifiers.subscribe(() => world.editMode.modifiersChanged());
viewportDock.setFactory('properties',(host,id)=>ui.create(host,id));
const insertKeys = () => {registerObjects(animation, objects);animation.insert(objectRefs(editor.selection.roots));};
// The Timeline, Dope Sheet and Graph Editor: Blender's animation editors, each area its own space (editors/animation).
registerAnimOperators(animation);
const ANIM_EDITORS = { timeline: ['DOPESHEET_EDITOR', 'TIMELINE'], dopesheet: ['DOPESHEET_EDITOR', 'DOPESHEET'], graph: ['GRAPH_EDITOR', 'FCURVES'] };
const mountAnim = (type, host, id) => mountAnimEditor(host, { header: viewportDock.header(id), space: ANIM_EDITORS[type][0], uiType: ANIM_EDITORS[type][1], animation, rna: blenderRNA, objects: blenderObjects, commit });
const animEditors = Object.keys(ANIM_EDITORS).map((type) => mountAnim(type, document.querySelector(`#${type}-section`), type));
for (const type of Object.keys(ANIM_EDITORS)) viewportDock.setFactory(type, (host, id) => mountAnim(type, host, id));
const unsubscribeAnimation = animation.subscribe(() => { if (!editor.modal) {editor.selection.sync();refreshUI();} });
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
  world, views, editor, registry: world.objectActions, rna: blenderRNA, creator, dock: viewportDock, capture, inspector, help, overlays,
  sceneCamera: authored,
  // Shading or camera view changed somewhere: effects attach to rendered views' cameras and one rendered view
  // (the last one clicked, else the first) shows the compositor.
  shadingChanged() {
    const all = views.all, rendered = all.filter((v) => v.rendered && v.active !== false);
    const preferred = backdrop.shown ? backdrop.view : views.focused;
    const compositorView = world.compositor.enabled ? (rendered.includes(preferred) ? preferred : rendered[0]) || null : null;
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
shadingReady = true;
const primary = mountView({ section: document.querySelector("#viewport-section"), canvas, headerId: "viewport", cameraName: "__editorCamera" });
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
// A scene's revision hashes everything its frames depend on (code, builder, scene edits, animation; not the
// current frame or the sequencer edit), so cached and baked scene frames stay valid until the scene changes.
const revisions = new Map();
const sceneState = ({ builder, overrides, animation: action }) => {
  const { sequenceEditor, ...rest } = overrides || {};
  return [input.code, builder, rest, action && { ...action, time: { ...action.time, frameCurrent: 0 } }];
};
const sceneFrames = createSceneFrames({ payload: scenePayload, revision: (id) => revisions.get(id) ?? "" });
const updateRevision = async (id, state) => {
  const next = await hash(JSON.stringify(state));
  if (revisions.get(id) === next) return;
  revisions.set(id, next);
  sceneFrames.changed();
};
for (const record of sceneRecords()) if (record.id !== activeSceneId) updateRevision(record.id, sceneState(record));
sceneChanged = () => updateRevision(activeSceneId, sceneState({ builder: input.scene?.builder, overrides: currentOverrides(), animation: animation.serialize() }));
sceneChanged();
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
  world.curves.refresh();
  editor.reconcile();
  world.editMode.reload();
}
// Keys the window manager takes: not those typed into fields, meant for the Video Sequencer (its menu commands
// run as synthetic key events) or for an open dialog or menu.
const acceptsKey = (e) => e.isTrusted && !e.repeat && (e.key === "F12" || !document.querySelector(".vse-area:hover")) &&
  !e.target.closest('input,textarea,select,[contenteditable="true"],.node-editor-host,.anim-editor') && !help.open && !creator.open && !world.contextMenu.isOpen;
const viewAt = (e) => (e ? views.all.find((v) => v.canvas === e.target) ?? null : activeView());
const inView = (event) => !!event.view;
const selectRegion = (view, region, mode) => (world.editMode.active ? world.editMode : editor).selectRegion(view, region, mode);
// The Add panel's own keys while a new object waits for its settings.
const creatorKeys = createKeymap([
  { keys: "ESC", poll: () => creator.pending, run: () => creator.finish(false) },
  { keys: "RET", poll: () => creator.pending, run: () => creator.finish() },
]);
// The 3D View's and screen's operators Bylonder runs, on the view under the pointer.
const AXIS_VIEWS = { FRONT: ["front", false], BACK: ["front", true], RIGHT: ["right", false], LEFT: ["right", true], TOP: ["top", false], BOTTOM: ["top", true] };
registerOperators({
  "anim.keyframe_insert": { run: () => insertKeys() },
  "anim.keyframe_delete_v3d": { run: () => animation.deleteKeys(objectRefs(editor.selection.roots).map((ref) => ({ ref, frame: Math.round(animation.time.frame) }))) },
  "view3d.rotate": { poll: (props, event) => inView(event), run: (props, event) => event.view.nav.rotate(event) },
  "view3d.move": { poll: (props, event) => inView(event), run: (props, event) => event.view.nav.move(event) },
  "view3d.zoom": { supports: ({ delta }) => !!delta, poll: () => !!activeView(), run: ({ delta }, event) => (event?.view ?? activeView()).nav.wheelZoom(delta) },
  "ed.undo": { run: () => undoRedo(false) },
  "ed.redo": { run: () => undoRedo(true) },
  "screen.redo_last": { run: () => creator.reopen() },
  "screen.animation_play": { run: () => animation.play() },
  "render.render": { run: ({ animation: all }) => (all ? renderHost.renderAnimation : renderHost.renderImage)() },
  "render.view_show": { run: () => renderHost.viewRender() },
  "view3d.view_camera": { run: () => activeView()?.toggleCameraView() },
  "view3d.view_persportho": { run: () => activeView()?.nav.toggle() },
  "view3d.view_axis": { supports: ({ type, align_active }) => !!AXIS_VIEWS[type] && !align_active, run: ({ type }) => activeView()?.nav.view(...AXIS_VIEWS[type]) },
  "view3d.view_selected": { supports: ({ use_all_regions }) => !use_all_regions, poll: () => editor.selection.size > 0, run: () => nav.frame(editor.selected) },
  "screen.screen_full_area": { supports: ({ use_hide_panels }) => !use_hide_panels, run: () => viewportDock.maximize(activeView().id) },
  "screen.area_split": { run: ({ direction }) => viewportDock.split(activeView().id, direction === "HORIZONTAL") },
  "screen.area_close": { run: () => viewportDock.close(activeView().id) },
  // Picks and boxes in the mode's own way; tools' keymaps run them with the tool's settings.
  "view3d.select": { poll: (props, event) => inView(event), run: (props, event) => (world.editMode.active ? world.editMode : editor).selectOperator(event, props) },
  "view3d.select_box": { run: (props, event) => (world.editMode.active ? world.editMode : editor).selectBox({ ...event, view: event?.view ?? activeView() }, props) },
  "view3d.select_lasso": {
    poll: (props, event) => inView(event),
    run: ({ mode = "SET" }, event) => { startGestureLasso(world.wm, { begin: event, select: (path) => selectRegion(event.view, lassoRegion(path), mode) }); },
  },
  "view3d.select_circle": {
    poll: (props, event) => !!(event?.view ?? activeView()),
    run: ({ mode = "SET", radius = 25, wait_for_input = true }, event) => {
      startGestureCircle(world.wm, { at: event, radius, waitForInput: wait_for_input, mode, select: (center, r, m) => selectRegion(event.view ?? activeView(), circleRegion(center, r), m) });
    },
  },
  // A transform from a key starts at the mouse, from a tool's drag at its press; release_confirm ends it on release.
  ...Object.fromEntries([["transform.translate", "move"], ["transform.rotate", "rotate"], ["transform.resize", "scale"]].map(([idname, type]) => [idname, {
    poll: () => editor.selection.size > 0,
    run: (props, event) => {
      creator.finish();
      editor.start(type, { point: event?.press, view: event?.view ?? undefined, releaseConfirm: !!props.release_confirm });
    },
  }])),
  // Blender's is Python setting the data path with exec; a path to a property Bylonder does not bind passes through.
  "wm.context_toggle": {
    run: ({ data_path }) => {
      const path = data_path.split("."), key = path.pop();
      const owner = path.reduce((data, name) => data?.[name], world.blenderContext(contextView()));
      if (typeof owner?.[key] !== "boolean" || !Object.getOwnPropertyDescriptor(Object(owner), key)?.set) return "PASS_THROUGH";
      owner[key] = !owner[key];
    },
  },
  "wm.toolbar": { poll: () => !!contextView(), run: () => contextView().toolbar.popup(editor.pointer) },
  "bylonder.inspector": { keys: () => "Shift Ctrl I", run: inspector },
  "bylonder.shortcuts": { keys: () => "?", run: () => help.showModal() },
});
appendMenu("VIEW3D_MT_view", ({ layout }) => {
  layout.separator();
  layout.operator("bylonder.inspector", kw({ text: "Babylon Inspector" }));
  layout.operator("bylonder.shortcuts", kw({ text: "Keyboard Shortcuts" }));
});
// Bylonder's own keys, below Blender's keymaps.
const bylonderKeys = createKeymap([
  { keys: "ESC", poll: () => !editor.modal, run: () => renderHost.escape() },
  { keys: "Shift /", run: () => help.showModal() },
  { keys: "Shift Ctrl I", run: () => inspector() },
]);
// Blender's keymaps a 3D View runs: the active tool's and its fallback's, the mode's (Object Mode, Mesh, Curve or Font), then the
// 3D View's and the window's. Tool keymaps run with the tool's settings.
const view3dKeys = keymapHandler(
  (event) => [...world.toolsystem.keymaps(contextMode(), editor.gizmoState(event)), "Object Mode", "Mesh", "Curve", "Font", "Object Non-modal", "3D View", "3D View Generic", "Frames", "Screen", "Window"],
  (name) => ({ "Object Mode": !world.editMode.active, Mesh: world.editMode.kind === "MESH", Curve: world.editMode.kind === "CURVE",
    Font: world.editMode.kind === "FONT" })[name] ?? true,
  (name, idname) => world.toolsystem.keymapProperties(contextMode(), name, idname));
// The 3D View under the pointer as the context area, with its menus for wm.call_menu and its view (space) for tools.
const view3dArea = {
  get space() { return activeView(); },
  menu: (name) => activeView()?.menu(name) && (() => openMenu(activeView().menu(name), editor.pointer, activeView().menuTitle(name))),
};
const blenderKeys = (event) => inArea(view3dArea, () => view3dKeys(event));
// The handler stack below modal handlers: the Add panel, the mode's own keymaps, then Blender's and Bylonder's.
// Through the scene camera only Blender's keymaps work.
// The gizmo map's handler comes first: a press on the tool's gizmo is the gizmo's (Babylon's gizmos drag themselves).
const gizmoKeys = (event) => event.type === "leftmouse" && event.value === "PRESS" && !!editor.gizmoState(event).highlight;
const keyLayers = () => {
  const view = activeView();
  if (!view || view.state.cameraView) return [blenderKeys, bylonderKeys];
  return [creatorKeys, gizmoKeys, world.editMode.keymap, ...(world.editMode.active ? [] : [editor.keymap]), blenderKeys, ...(world.editMode.active ? [] : [world.objectActions.key]), bylonderKeys];
};

let last = 0;
// Once per animation frame, before views decide whether to render.
const perFrame = engine.onBeginFrameObservable.add(() => {
  animation.tick(performance.now());
  world.modifiers.refresh();
  for (const view of viewports()) if (!view.state.cameraView) view.nav.updateBounds();
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
  animEditors.forEach((animEditor) => animEditor.dispose());
  engine.onBeginFrameObservable.remove(perFrame);
  for (const view of viewports()) view.dispose();
  views.dispose();
  overlays.dispose();
  renderHost.dispose();
  sequencerEditor.dispose();
  fileBrowser.dispose();
  sequencerAdapter.dispose();
  unsubscribeAnimation();
  world.modifiers.dispose();
  jobs.dispose();
  runningJobs.dispose();
  sdk.dispose();
  creator.dispose();
  world.editMode.dispose();
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
  world.wm.dispose();
  world.scene.dispose();
  world.engine.dispose();
  clearTimeout(toastTimer);
}
send("running", {});
window.addEventListener("pagehide", dispose, { once: true });
if (import.meta.hot) import.meta.hot.dispose(dispose);
