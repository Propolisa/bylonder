import { nextTick } from "vue";
import { preloadIcons } from "./editors/interface/icon.js";
import { mountNodeEditor } from './editors/space_node/node-editor.js';
import { crossingLosses } from "./blenkernel/light/light-home.js";
import { report } from "./windowmanager/wm-reports.js";
import { syncLightDirections } from "./runtime/object-transform.js";
import { createCompositorBackdrop } from './editors/space_node/compositor-backdrop.js';
import { createNodeContexts } from './editors/space_node/contexts.js';
import { registerObjects } from './blenkernel/animation/bindings.js';
import { mountAnimEditor, registerAnimOperators } from './editors/animation/anim-editor.js';
import { mountRuntimeLayout } from "./editors/screen/runtime.js";
import { createViewportTouch } from "./windowmanager/input/viewport-touch.js";
import { applyRenderSettings } from "./workspace/render-settings.js";
import { createObjectActions } from "./editors/object/object-actions";
import { createObjectCommands } from "./editors/object/commands";
import { createAddMesh } from "./editors/object/add-mesh";
import { createHud } from "./editors/interface/hud.js";
import { createOutliner } from "./editors/space_outliner/space-outliner.js";
import { visible, deleted } from "./editors/object/identity";
import { view_3d as theme } from "./editors/interface/userdef-default-theme.js";
import { createWorkbench } from "./draw/workbench.js";
import { windowCapture } from "./windowmanager/mouse-capture";
import { createEventSystem } from "./windowmanager/wm-event-system.js";
import { createView3DWindow } from "./editors/space_view3d/view3d-window.js";
import { RGN_TYPE_TOOLS } from "./windowmanager/wm-window.js";
import * as BABYLON from "@babylonjs/core";
import "./style.css";
import "./theme.css";
import "./editors/space_view3d/viewport.css";
import { createViewportOverlays, createViewportStatus } from "./editors/space_view3d/viewport-ui.js";
import { createViews } from "./editors/space_view3d/views.js";
import { createView3D } from "./editors/space_view3d/view3d.js";
import "@babylonjs/core/Debug/debugLayer";

import { createEditor } from "./editors/object/editor";
import { createHistory } from "./editors/undo/storage";
import { projectState } from "./runtime/project-state.js";
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
import { createMeshEditMode } from "./editors/mesh/editmesh-mode.js";
import { createEditModes } from "./editors/object/edit-modes.js";
import { createEditCurve, registerCurveAddOperators } from "./editors/curve/editcurve.js";
import { createCurveObjects } from "./editors/curve/curve-objects.js";
import { registerObjectOperators, openModulePopup, runBlenderOperator } from "./editors/object/object-operators.js";
import { createArmatureModes } from "./editors/armature/armature-modes.js";
import { registerAddOperators } from "./editors/object/add-operators.js";
import { openMenu } from "./editors/interface/menu.js";
import { createMainSync } from "./blenkernel/main-sync.js";
import { registerOperators, runOperator, pollOperator, appendMenu, kw, inArea, contextArea, operatorIds, spaceOperatorIds } from "./windowmanager/wm-operators.js";
import { registered, registerPythonOperators } from "./python/bpy_interface.js";
import { keymapHandler, blenderKeys } from "./windowmanager/keyconfig.js";
import { createToolSystem } from "./windowmanager/wm-toolsystem.js";
import { createView3DTools } from "./editors/space_view3d/view3d-tools.js";
import { tagRedraw } from "./draw/overlay-tool.js";
import { startGestureLasso } from "./windowmanager/wm-gesture-lasso.js";
import { startGestureCircle } from "./windowmanager/wm-gesture-circle.js";
import { lassoRegion, circleRegion } from "./editors/space_view3d/view3d-select.js";
import { createRNA } from "./makesrna/rna-bylonder.js";
import { createContext } from "./blenkernel/context.js";
import { exportScene } from "./io_scene_babylon/export.js";
import { saveBlend } from "./windowmanager/wm-files.js";
import { createTextFiles } from "./blenkernel/text-files.js";
import { setContextPointer } from "./python/bpy_rna.js";
import { blenderMain } from "./bmesh/bmesh-wasm.js";
import { createTopbarArea } from "./editors/space_topbar/topbar-area.js";
import * as blenderAreas from "./windowmanager/wm-areas.js";
import { mountTextEditor } from "./editors/space_text/text-editor.js";
import { mountConsole } from "./editors/space_console/console.js";
import { registerConsoleOperators } from "./editors/space_console/console-ops.js";
import { mountInfo } from "./editors/space_info/info.js";
// Boot phases, as performance marks (the workspace marks its own).
performance.mark("bl:viewport-imported");
await preloadIcons();
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
performance.mark("bl:viewport-input");
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
// The workspace's screen, which the topbar's tabs choose.
viewportDock.setScreen(input.screen);
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
let built;
try {
  performance.mark("bl:world");
  built = await createWorld({ input, engine, canvas, hooks: {
    commit,
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
const { world, sdk, animation, scene, objects, documentState } = built;
const authored = () => built.authoredCamera;
// Theme wire color of an object (Resources::object_wire_theme_id): the active or selected color, else its type's.
const wireColor = (node, type = "wire") => !editor?.selection.has(node) ? theme[type] : editor.selection.nodes.at(-1) === node ? theme.object_active : theme.object_selected;
const overlays = createViewportOverlays(scene, {
  extras: {
    objects: () => world.objects,
    color: wireColor,
    sceneCamera: authored,
    visible: (node) => (world.objects.includes(node) ? visible(node) && (world.collections?.status(node).visible ?? true) : node.isEnabled()),
    aspect: () => { const { width, height } = outputSize(world.renderSettings.state.render); return width / height; },
  },
  origins: { objects: () => world.objects, color: (node) => (editor?.selection.has(node) && !deleted(node) ? wireColor(node) : null) },
  outlines: { outlined: () => editor?.selection.outlined() ?? [], isActive: (node) => editor.selection.nodes.at(-1) === node, isTransform: () => !!world.wm?.modal },
  view3dCursor: () => world.sceneSettings.state.cursor,
});
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
let topbarArea = null;
// Resolves once what the last input started is done (Blender's code and the views it changed, modifier evaluations,
// a drawn frame), so a test acts next without polling or waiting. Nothing runs unless something awaits it.
const settled = async () => {
  await world.modifiers.settled();
  await nextTick();
  await new Promise((done) => requestAnimationFrame(() => done()));
  await world.modifiers.settled();
};
window.__bylonder ={ world, renderHost, runOperator, settled,
  // The Top Bar's menus, laid out here for the app page's topbar.
  get topbar() { return (topbarArea ??= createTopbarArea(blenderMain(), world.mainSync)); },
  // What this window runs of Blender (the Blender Coverage view): its operators, those for a space type by type, and Blender's registered classes.
  coverage: () => ({ operators: operatorIds(), spaceOperators: spaceOperatorIds(), classes: Object.keys(registered) }), get editor() { return editor; }, get rna() { return blenderRNA; }, get views() { return views; }, get sequencer() { return sequencerAdapter; }, get history() { return history; }, get sceneFrames() { return sceneFrames; } };
let remember = input.remember,
  lastOverride = "";
const currentOverrides = () => ({ ...projectState(world), stores: sdk.values(), ...documentState.capture({ save: true }) });
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
  if (e.data.type === "invoke") runOperator(e.data.payload);
  if (e.data.type === "view-layer") {
    const cols = world.collections, { op, id } = e.data.payload;
    ({ set: () => cols.setViewLayer(id), add: () => cols.createViewLayer(), remove: () => cols.removeViewLayer(cols.layer().id) })[op]?.();
  }
  if (e.data.type === "render-settings") applyRenderSettings(engine, e.data.payload);
  if (e.data.type === "export") {
    crossingLosses(world.objects, "BABYLON").forEach((loss) => report("WARNING", loss));
    exportScene(world, e.data.payload).catch((error) => notify("Export failed: " + error.message));
  }
  if (e.data.type === "save-blend") {
    crossingLosses(world.objects, "BLENDER").forEach((loss) => report("WARNING", loss));
    try { notify(`Saved .blend (${Math.ceil(saveBlend(world) / 1024)} KiB)`); } catch (error) { console.error(error); notify("Save failed: " + error.message); }
  }
  if (e.data.type === "render") ({ image: renderHost.renderImage, animation: renderHost.renderAnimation, view: renderHost.viewRender })[e.data.payload]?.();
  if (e.data.type === "snapshot") {
    const requestId = e.data.payload.requestId;
    if (creator?.pending || world.wm.modal) send("snapshot-result",{requestId,error:"Finish or cancel the active edit before sharing."});
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
  // The workspace's screen (Scripting or Layout), and a project text file changed in the Code workspace.
  if (e.data.type === "screen") setScreen(e.data.payload);
  if (e.data.type === "text") world.texts.load(e.data.payload.name, e.data.payload.content);
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
},beforeCommit:()=>{world.collections.adopt();animation.captureEdits();},main:()=>world.mainSync});
animation.setCommit(()=>history.commit());
const capture = windowCapture(notify);
// Blender's window takes the 3D Views' input in Object Mode and mesh Edit Mode (made once Main is, below).
let view3dWindow = null;
// The editors that are Blender's own (editors/screen/blender-area.js) take theirs.
const blenderWindow = {
  takes: (native, view) => blenderAreas.takes(native) || !!view3dWindow?.takes(native, view),
  send: (kind, data, strings, view, native) => (blenderAreas.takes(native) ? blenderAreas.send(native, kind, data, strings) : view3dWindow.send(kind, data, strings, view)),
  pressHandled: () => blenderAreas.blenderWindow().pressHandled(),
};
world.wm = createEventSystem({ layers: () => keyLayers(), viewAt: (e) => viewAt(e), accepts: (e) => acceptsKey(e), hover: (e) => tools.hover(e), blender: blenderWindow });
const editor = createEditor(
  world,
  views,
  history,
  () => { refreshUI(); views.wake(); },
  capture,
);
const activeView = () => views.input;
// Object actions and menus act on the 3D Viewport under the pointer, as in Blender.
const nav = { frame: (node) => activeView()?.nav.frame(node) };
const commands = createObjectCommands(world, editor, history, () =>
  refreshUI(),
);
// The HUD region's Adjust Last Operation panel, for Add and Edit Mode operators.
world.hud = createHud(document.querySelector("#redo-panel"));
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
const editModeOptions = { world, editor, views, history, notify, changed: () => { refreshUI(); tagRedraw(); views.wake(); } };
const editCurve = createEditCurve({ ...editModeOptions, curves: world.curves });
world.editMode = createEditModes(createMeshEditMode({ world, selection: editor.selection, host: () => objectOperatorHost }), editCurve);
registerCurveAddOperators({ editor, history, commands, curves: world.curves, editCurve });
// Edit Mode commits a pending Add, as changing mode does in Blender: its panel no longer adjusts the object.
world.onModeChange = () => {
  if (world.editMode?.active) creator.finish();
  applyTool();
  viewports().forEach((view) => view.sync());
};
world.beforeSelection = () => creator.finish();
world.objectActions = createObjectActions({ world, editor, commands, creator });
// bpy.data.texts: the project's text files, as Main's Texts.
setContextPointer(blenderMain().C);
world.texts = createTextFiles({ files: input.texts, save: (name, content) => send("text", { name, content }) });
const blenderRNA = createRNA({ world, selection: editor.selection, update: () => { refreshUI(); views.wake(); }, undoPush: commit, notify });
// bpy.context for a 3D Viewport (blenkernel/context.js) and one of its regions, for what is drawn from Blender's scripts.
world.blenderContext = (view, region) => createContext(blenderRNA, { space: view, region });
// The mode the tool system and Blender's keymaps go by (context.mode).
const contextMode = () => ({ MESH: "EDIT_MESH", CURVE: "EDIT_CURVE", FONT: "EDIT_TEXT" }[world.editMode.kind] ?? world.armatureModes?.contextMode ?? "OBJECT");
// Blender's tool system: the active tool's gizmo shows in Object Mode, and the views redraw their toolbars.
const TOOL_GIZMOS = { "builtin.move": "move", "builtin.rotate": "rotate", "builtin.scale": "scale", "builtin.transform": "transform" };
const applyTool = () => {
  if (!world.wm?.modal && !world.editMode.active) editor.setMode(TOOL_GIZMOS[world.toolsystem.active("OBJECT").idname] ?? "select");
};
// The 3D View operators act on: the context area's (wm-operators.js), else the one under the pointer.
const contextView = () => contextArea()?.space ?? activeView();
world.toolsystem = createToolSystem({
  // The workspace's tools in Main, read in the context of the 3D View the window manager acts on (a view's toolbar in its
  // own area's toolbar region).
  inContext: (fn, view) => (view ? world.view3dArea(view).inContext(RGN_TYPE_TOOLS, fn) : world.view3dArea(contextView(), false).inContext(0, fn)),
  mode: contextMode,
  changed: () => { applyTool(); tagRedraw(); viewports().forEach((view) => view.sync()); },
});
// The tools' operators and the active tool's gizmos in the 3D View under the pointer.
const tools = createView3DTools({
  world, editor, views, area: { get space() { return activeView(); }, menu: () => null }, mode: contextMode, commit, notify,
  toolSettings: () => blenderRNA.pointer("ToolSettings", world),
  addPreset: (idname, placement) => creator.add(creator.catalog.find((preset) => preset.operator === idname), placement),
});
// Blender's Main, which owns the scene and its undo, drawn by Babylon (blenkernel/main-sync.js, main-view.js). Slices hooks
// do not see (collections, materials, worlds, modifiers) mark it changed.
world.mainSync = createMainSync({ rna: blenderRNA, ids: animation.ids });
// A frame change evaluates Main with Blender's animation system and draws it (main-sync.js frameChanged).
animation.evaluateMain = (frame) => world.mainSync.frameChanged(frame);
for (const slice of [world.collections, world.materials, world.worlds, world.textures, world.modifiers]) slice?.subscribe(() => world.mainSync.changed());
world.mainSync.debug = new URLSearchParams(location.search).has("sync-check");
history.start();
// What Object Mode's operators run in: the scene's Main, undo steps, the window manager and the 3D View under the pointer.
const objectOperatorHost = { transaction: commands.transaction, notify, keying: (run) => animation.keying(run), commit, wm: () => world.wm,
  pointer: () => editor.pointer, view: () => activeView() };
registerObjectOperators(world.objectActions, { sync: world.mainSync, ...objectOperatorHost });
registerPythonOperators((idname, props, event) => runBlenderOperator(world.mainSync, idname, props, { ...objectOperatorHost, event }), () => world.mainSync.flush());
view3dWindow = createView3DWindow({ sync: world.mainSync, views: viewports, takes: () => !editCurve.active, host: objectOperatorHost,
  menu: (name, at) => world.callMenu(name, at), before: () => creator.finish() });
world.view3dArea = (view, layout) => view3dWindow.area(view, layout);
// An armature's Edit and Pose Modes, Blender's in Main.
world.armatureModes = createArmatureModes({ sync: world.mainSync, selection: editor.selection, views, options: objectOperatorHost });
registerAddOperators(creator);
world.dock = viewportDock;
world.outliner = createOutliner({ world, editor, commands, sync: world.mainSync, rna: blenderRNA, region: document.querySelector("#outliner"), header: world.dock?.header("objects") });
const touch = createViewportTouch(world, editor, creator, views);
// Like Blender, objects hidden or excluded through their collections drop out of the selection.
world.collections.subscribe(() => {
  const keep = editor.selection.nodes.filter((n) => world.collections.status(n).visible);
  if (keep.length !== editor.selection.size) { editor.selection.replace(keep); editor.reconcile(); }
});
const beginSelection = editor.selection.begin;
editor.selection.begin = () => { animation.pause(); beginSelection(); };
ui = createUI(world, editor, storage, history, systems, sdk.properties, input.files || [], blenderRNA);
// Blender's add operators leave the object they add selected and active alone, so a scene opens that way (startup.blend's cube).
const added = world.objects.findLast((n) => n.metadata?.wbCreation?.operator);
if (added) { editor.selection.replace([added]); editor.reconcile(); }
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
// The Timeline, Dope Sheet and Graph Editor: Blender's animation editors, each area its own space (editors/animation).
registerAnimOperators(animation);
const ANIM_EDITORS = { timeline: ['DOPESHEET_EDITOR', 'TIMELINE'], dopesheet: ['DOPESHEET_EDITOR', 'DOPESHEET'], graph: ['GRAPH_EDITOR', 'FCURVES'], drivers: ['GRAPH_EDITOR', 'DRIVERS'] };
const mountAnim = (type, host, id) => mountAnimEditor(host, { header: viewportDock.header(id), space: ANIM_EDITORS[type][0], uiType: ANIM_EDITORS[type][1], animation, rna: blenderRNA, sync: world.mainSync, commit });
const animEditors = Object.keys(ANIM_EDITORS).map((type) => mountAnim(type, document.querySelector(`#${type}-section`), type));
for (const type of Object.keys(ANIM_EDITORS)) viewportDock.setFactory(type, (host, id) => mountAnim(type, host, id));
const unsubscribeAnimation = animation.subscribe(() => { if (!world.wm?.modal) {editor.selection.sync();refreshUI();} });
// The Scripting workspace's editors: Text Editor, Python Console and Info.
registerConsoleOperators();
const scriptingEditors = [
  // A script or console line runs after the Add panel's object is done, as a new operator ends Blender's redo.
  mountTextEditor(document.querySelector("#text-section"), { header: viewportDock.header("text"), files: world.texts, context: () => createContext(blenderRNA, { area: "TEXT_EDITOR" }), beforeRun: () => creator.finish(), afterRun: () => world.mainSync.view() }),
  mountConsole(document.querySelector("#console-section"), { header: viewportDock.header("console"), rna: blenderRNA, beforeRun: () => creator.finish() }),
  mountInfo(document.querySelector("#info-section"), { header: viewportDock.header("info") }),
];
let inspectorBusy = false;
async function inspector() {
  if (inspectorBusy) return;
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
// 3D Viewports: the primary area and any added by splitting it (dock factory 'viewport').
const viewportCtx = {
  world, views, editor, rna: blenderRNA, creator, dock: viewportDock, capture, overlays,
  sceneCamera: authored,
  // Shading or camera view changed somewhere: effects attach to rendered views' cameras and one rendered view
  // (the last one clicked, else the first) shows the compositor.
  shadingChanged() {
    const all = views.all, rendered = all.filter((v) => v.rendered && v.active !== false);
    const preferred = backdrop.shown ? backdrop.view : views.focused;
    const compositorView = world.compositor.enabled ? (rendered.includes(preferred) ? preferred : rendered[0]) || null : null;
    for (const v of all) v.wantsCompositor = v === compositorView;
    world.setViewShading({ renderedCameras: rendered.map((v) => v.camera), compositorCamera: compositorView?.camera, preview: all.some((v) => v.preview && v.active !== false) });
    const cameraView = !!views.input?.state.cameraView;
    document.body.classList.toggle("scene-mode", cameraView);
    views.relayout();
  },
};
const mountView = (options) => {
  const view = createView3D(viewportCtx, options);
  const detachTouch = touch.attach(view);
  const dispose = view.dispose;
  view.dispose = () => { detachTouch(); dispose(); };
  views.add(view);
  viewportCtx.shadingChanged();
  return view;
};
shadingReady = true;
const primary = mountView({ section: document.querySelector("#viewport-section"), canvas, headerId: "viewport", cameraName: "__editorCamera" });
// Each screen's 3D Viewport keeps its own shading, as each of Blender's screens has its own: Shading's starts in
// Material Preview.
const screenShading = { shading: "material" };
function setScreen(name) {
  const previous = viewportDock.screen ?? "layout";
  viewportDock.setScreen(name);
  screenShading[previous] = primary.state.shading;
  primary.setShading(screenShading[name] ?? "solid");
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
world.modifiers.onDrawn(() => views.wake());
ownObservers = observerCount() - userObservers;
function undoRedo(redo) {
  creator.finish();
  redo ? history.redo() : history.undo();
  editor.reconcile();
  world.editMode.reload();
}
// Keys the window manager takes: not those typed into fields, meant for the Video Sequencer (its menu commands
// run as synthetic key events) or for an open dialog or menu.
const acceptsKey = (e) => e.isTrusted && !e.repeat && (e.key === "F12" || !document.querySelector(".vse-area:hover")) &&
  !e.target.closest('input,textarea,select,[contenteditable="true"],.node-editor-host,.anim-editor,.bl-outliner,.wm-area');
const viewAt = (e) => (e ? views.all.find((v) => v.canvas === e.target) ?? null : activeView());
const inView = (event) => !!event?.view;
// Mesh Edit Mode's gestures are Blender's (editmesh-mode.js); the other modes select in the page.
const meshGesture = (idname, props, event) => world.editMode.kind === "MESH" && (world.editMode.selectGesture(idname, props, event), true);
const selectRegion = (view, region, mode) => (world.editMode.active ? world.editMode : editor).selectRegion(view, region, mode);
// The 3D View's and screen's operators Bylonder runs, on the view under the pointer.
const AXIS_VIEWS = { FRONT: ["front", false], BACK: ["front", true], RIGHT: ["right", false], LEFT: ["right", true], TOP: ["top", false], BOTTOM: ["top", true] };
registerOperators({
  // Blender's keying of the selected objects (keyframing.cc, with the scene's keying set), on Main.
  ...Object.fromEntries(["anim.keyframe_insert", "anim.keyframe_delete_v3d"].map((idname) => [idname, {
    blender: true,
    run: (props, event) => runBlenderOperator(world.mainSync, idname, props, { ...objectOperatorHost, event }),
  }])),
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
  "view3d.toggle_xray": { poll: () => !!activeView(), run: () => { const view = activeView(); view.state.xray = !view.state.xray; view.sync(); } },
  "view3d.view_persportho": { run: () => activeView()?.nav.toggle() },
  "view3d.view_axis": { supports: ({ type, align_active }) => !!AXIS_VIEWS[type] && !align_active, run: ({ type }) => activeView()?.nav.view(...AXIS_VIEWS[type]) },
  "view3d.view_selected": { supports: ({ use_all_regions }) => !use_all_regions, poll: () => editor.selection.size > 0, run: () => nav.frame(editor.selected) },
  "screen.screen_full_area": { supports: ({ use_hide_panels }) => !use_hide_panels, run: () => viewportDock.maximize(screenArea()) },
  "screen.area_split": { run: ({ direction }) => viewportDock.split(screenArea(), direction === "HORIZONTAL") },
  "screen.area_close": { run: () => viewportDock.close(screenArea()) },
  // Picks and boxes in the mode's own way; tools' keymaps run them with the tool's settings.
  "view3d.select": { poll: (props, event) => inView(event), run: (props, event) => (world.editMode.active ? world.editMode : world.armatureModes.mode() ? world.armatureModes : editor).selectOperator(event, props) },
  "view3d.select_box": { run: (props, event) => (world.editMode.active ? world.editMode : editor).selectBox({ ...event, view: event?.view ?? activeView() }, props) },
  "view3d.select_lasso": {
    poll: (props, event) => inView(event),
    run: ({ mode = "SET" }, event) => { if (!meshGesture("view3d.select_lasso", { mode }, event)) startGestureLasso(world.wm, { begin: event, select: (path) => selectRegion(event.view, lassoRegion(path), mode) }); },
  },
  "view3d.select_circle": {
    poll: (props, event) => !!(event?.view ?? activeView()),
    run: ({ mode = "SET", radius = 25, wait_for_input = true }, event) => {
      if (meshGesture("view3d.select_circle", { mode, radius, wait_for_input }, event)) return;
      startGestureCircle(world.wm, { at: event, radius, waitForInput: wait_for_input, mode, select: (center, r, m) => selectRegion(event.view ?? activeView(), circleRegion(center, r), m) });
    },
  },
  // A transform starts at the mouse (initTransInfo), the 3D cursor's at a drag's press; release_confirm ends it on
  // release, cursor_transform moves the 3D cursor.
  ...Object.fromEntries([["transform.translate", "move"], ["transform.rotate", "rotate"], ["transform.resize", "scale"]].map(([idname, type]) => [idname, {
    blender: true,
    poll: (props) => editor.selection.size > 0 || !!props.cursor_transform,
    run: (props, event) => {
      creator.finish();
      if (world.editMode.active && !props.cursor_transform) return world.editMode.module(idname, props, event);
      return runBlenderOperator(world.mainSync, idname, props, { ...objectOperatorHost, event });
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
});
appendMenu("VIEW3D_MT_view", ({ layout }) => {
  layout.separator();
  layout.operator("bylonder.inspector", kw({ text: "Babylon Inspector" }));
});
// The area the screen operators act on: the one whose header menu runs them, else the one under the pointer.
let headerArea = null;
const screenArea = () => headerArea ?? viewportDock.hovered ?? activeView().id;
// A header's context menu (screen.region_context_menu, ED_screens_header_tools_menu_create), its screen operators
// acting on that area. Bylonder's areas always show their header and menus, at the top.
viewportDock.onHeaderMenu((id, event) => {
  const view = views.all.find((v) => v.id === id && v.nav);
  const inHeader = (run) => () => { headerArea = id; try { run(); } finally { headerArea = null; } };
  const operator = (label, idname, props = {}, icon) => ({ label, icon, blender: idname, keys: blenderKeys(["Screen", "Window"], idname, props, true),
    enabled: () => pollOperator(idname, props), run: inHeader(() => runOperator(idname, props)) });
  const toggle = (name) => () => { view.state[name] = !view.state[name]; view.sync(); };
  openMenu([
    { label: "Show Header", checked: () => true, enabled: () => false },
    ...(view ? [{ label: "Show Tool Settings", checked: () => view.state.show_region_tool_header, run: toggle("show_region_tool_header") }] : []),
    { label: "Show Menus", checked: () => true, enabled: () => false },
    "-",
    operator("Flip to Bottom", "screen.region_flip"),
    "-",
    operator("Horizontal Split", "screen.area_split", { direction: "HORIZONTAL" }, "split_horizontal"),
    operator("Vertical Split", "screen.area_split", { direction: "VERTICAL" }, "split_vertical"),
    "-",
    operator(viewportDock.maximized === id ? "Back to Previous" : "Maximize Area", "screen.screen_full_area"),
    operator("Focus Mode", "screen.screen_full_area", { use_hide_panels: true }),
    operator("Duplicate Area into New Window", "screen.area_dupli"),
    "-",
    operator("Close Area", "screen.area_close", {}, "x"),
  ], event, "Header");
});
// Bylonder's own keys, below Blender's keymaps.
const bylonderKeys = createKeymap([
  { keys: "ESC", poll: () => !world.wm.modal, run: () => renderHost.escape() },
  { keys: "Shift Ctrl I", run: () => inspector() },
]);
// Blender's keymaps a 3D View runs: the active tool's and its fallback's, the mode's (Object Mode, Mesh, Curve, Font, Armature or Pose), then the
// 3D View's and the window's. Tool keymaps run with the tool's settings.
const view3dKeys = keymapHandler(
  (event) => [...world.toolsystem.keymaps(contextMode(), gizmoState(event)), "Object Mode", "Mesh", "Curve", "Font", ...world.armatureModes.keymaps, "Object Non-modal", "3D View", "3D View Generic", "Frames", "Screen", "Window"],
  (name) => (({ "Object Mode": !world.editMode.active, Mesh: world.editMode.kind === "MESH", Curve: world.editMode.kind === "CURVE",
    Font: world.editMode.kind === "FONT" })[name] ?? true) && world.armatureModes.keymapActive(name),
  (name, idname) => world.toolsystem.keymapProperties(contextMode(), name, idname));
// The 3D View under the pointer as the context area, with its menus for wm.call_menu and its view (space) for tools.
const view3dArea = {
  get space() { return activeView(); },
  // Blender's Python menus, else those its C defines (drawn by the module).
  menu: (name) => {
    const menu = activeView()?.menu(name);
    if (menu) return (event) => openMenu(menu.items(), event ?? editor.pointer, menu.title);
    world.mainSync.flush();
    const popup = world.mainSync.blender.menu(name);
    return popup && ((event) => openModulePopup(world.mainSync, popup, event ?? editor.pointer));
  },
};
const blenderKeymaps = (event) => inArea(view3dArea, () => view3dKeys(event));
// A menu of the 3D View opened as wm.call_menu opens it (the touch controls' long press), at a point of the page.
world.callMenu = (name, at) => inArea(view3dArea, () => view3dArea.menu(name)?.(at));
// The handler stack below modal handlers: the gizmo map, the mode's own keymaps, then Blender's and Bylonder's.
// Through the scene camera only Blender's keymaps work.
// The gizmo map's handler comes first: a press on the tool's gizmo is the gizmo's (Babylon's transform gizmos drag
// themselves; the tools' gizmos run their keymaps).
const gizmoState = (event) => (world.editMode.active || !TOOL_GIZMOS[world.toolsystem.active("OBJECT").idname] ? tools.gizmoState(event) : editor.gizmoState(event));
const gizmoKeys = (event) => (event.type === "leftmouse" && event.value === "PRESS" && !!editor.gizmoState(event).highlight) || tools.keymap(event);
const keyLayers = () => {
  const view = activeView();
  if (!view || view.state.cameraView) return [blenderAreas.areaKeys, blenderKeymaps, bylonderKeys];
  return [blenderAreas.areaKeys, gizmoKeys, world.editMode.keymap, blenderKeymaps, bylonderKeys];
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
  world.texts.flush();
  scriptingEditors.forEach((area) => area.dispose());
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
  sdk.dispose();
  creator.dispose();
  world.hud.dispose();
  tools.dispose();
  world.editMode.dispose();
  world.outliner.dispose();
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
performance.mark("bl:viewport-running");
send("running", {});
window.addEventListener("pagehide", dispose, { once: true });
if (import.meta.hot) import.meta.hot.dispose(dispose);
