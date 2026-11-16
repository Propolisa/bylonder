import { askText } from "../editors/interface/props-dialog.js";
import { preloadIcons } from "../editors/interface/icon.js";
import { renderSettings, setupRenderSettings } from "./render-settings.js";
import { setupSharing } from "./share-ui.js";
import { mountWorkspaceLayout } from "./layout.js";
import { RUNTIME_LAYOUT_KEY } from "../editors/screen/model.js";
import "./workspace.css";
import { mountTopbar } from "./topbar.js";
import { examples } from "./examples.js";
import { openOPFS } from "./opfs";
import { createRepository } from "./repository";
import { createFolderRepository, rememberFolder, rememberedFolder, folderAccess, canOpenFolders } from "./folder-repository.js";
import { defaultFiles, blendProjectSource } from "./default-project";
import { resetApp } from "./reset.js";
import {
  normalizePath,
  validateFiles,
  textFile,
  binaryFile,
  renamePath,
  removePath,
} from "./project-model";
import { publishRun, removeRun, APP_BASE } from "./module-host";
import { sceneList, activeSceneId, setSceneData, switchScene, addScene, renameScene, removeScene, storedScenes } from "./scenes.js";
import { menuButton } from "../editors/interface/menu.js";
import { iconButton } from "../editors/interface/icon.js";
import { mountTouch, showScale } from "../editors/interface/touch.js";
import { installBack } from "../windowmanager/wm-back.js";
import { zipSync, unzipSync, strToU8, strFromU8 } from "fflate";
import { createApp, h, reactive, ref } from "vue";
import FileTree from "./explorer/FileTree.vue";
import { definitionAt } from "../editors/space_game/game-code.js";
import { babylonImportIssues } from "../io_scene_babylon/game-export.js";
import { gameTypes, projectKnots, TYPES_PATH } from "../editors/space_game/game-types.js";
import "@/editors/interface/components/tailwind.css";
performance.mark("bl:workspace-imported");
await preloadIcons();
// The window shows once the scene's interface has drawn, or failed to (and in any case after a while: index.html).
const reveal = () => document.body.classList.remove("bl-loading");
const $ = (id) => document.getElementById(id);
const dock = mountWorkspaceLayout();
// Touch in the topbar (docs/mobile.md): a pinch scales the UI as over the scene's, whose window keeps the Preferences.
mountTouch(window, { scale: {
  get: () => Number(getComputedStyle(document.documentElement).getPropertyValue("--bl-ui-scale")) || 1,
  preview: (value) => showScale([document, frame?.contentDocument], value),
  commit: (value) => frame?.contentWindow.postMessage({ channel, type: "ui-scale", payload: value }, location.origin),
} });
const topbar = mountTopbar({ dock, examples, openExample: (example) => openExample(example), newProject: () => $("new-project").click(), recentProjects: () => repo.list(), openProject: (id) => { $("project").value = id; $("project").dispatchEvent(new Event("change")); }, openBlend: (file) => openBlend(file), openFolder: canOpenFolders() && (() => chooseFolder()), resetApp: () => resetApp(() => { dirty = false; clearTimeout(saveTimer); document.querySelectorAll("iframe").forEach((f) => f.remove()); }), send: (type, payload) => frame?.contentWindow.postMessage({ channel, type, payload }, location.origin), sceneTopbar: () => frame?.contentWindow?.__bylonder?.topbar });
let repo,
  // The open project's folder on disk (folder-repository.js), or null for one kept in OPFS.
  folder = null,
  project,
  active = "index.js",
  tabs = ["index.js"],
  dirty = false,
  editGeneration = 0,
  saveTimer,
  runTimer,
  typeTimer,
  saveQueue = Promise.resolve(),
  runGeneration = 0,
  frame,
  runData,
  channel,
  busy = false,
  diffVersion;
const models = new Map(),
  viewStates = new Map();
const snapshotRequests = new Map();
// Inactive scenes kept loaded (Keep Scenes Loaded); the active scene's viewport is `frame`.
const parked = new Map();
let suppress = false;
// The code editor (Monaco) and its type service, loaded when the code is first needed or once the scene runs: not before
// the scene, which the window shows first.
let monaco, language, editor, diff, intelligencePromise, codeLoading;
const code = () => (codeLoading ??= import("./intelligence").then((intelligence) => {
  ({ monaco, language } = intelligence);
  const { setupIntelligence } = intelligence;
  editor = monaco.editor.create($("editor-container"), {
    theme: "vs-dark",
    automaticLayout: true,
    minimap: { enabled: false },
    fontSize: 13,
    tabSize: 4,
    scrollBeyondLastLine: false,
    wordWrap: "off",
    padding: { top: 8 },
    bracketPairColorization: { enabled: true },
    suggest: { preview: true },
    inlineSuggest: { enabled: true },
  });
  diff = monaco.editor.createDiffEditor($("diff-container"), {
    theme: "vs-dark",
    automaticLayout: true,
    readOnly: true,
    minimap: { enabled: false },
    renderSideBySide: true,
  });
  intelligencePromise = setupIntelligence((status) => {
    $("type-status").textContent = status.split("\n")[0];
    $("types-content").textContent = status;
  }).catch((e) => {
    failure(e);
    $("type-status").textContent = "Type service unavailable";
    return null;
  });
  monaco.editor.onDidChangeMarkers(() => {
    const markers = monaco.editor
      .getModelMarkers({})
      .filter(
        (m) =>
          m.resource.toString().startsWith("file:///workspace/") &&
          !m.resource.path.includes("__"),
      );
    $("problem-count").textContent = markers.length;
    $("problems-content").replaceChildren();
    for (const marker of markers.slice(0, 100)) {
      const b = document.createElement("button");
      b.className = "problem";
      const path = decodeURIComponent(
        marker.resource.path.replace("/workspace/", ""),
      );
      b.textContent =
        path +
        ":" +
        marker.startLineNumber +
        ":" +
        marker.startColumn +
        " " +
        marker.message;
      b.onclick = () => {
        openFile(path);
        editor.setPosition({
          lineNumber: marker.startLineNumber,
          column: marker.startColumn,
        });
        editor.revealLineInCenter(marker.startLineNumber);
      };
      $("problems-content").append(b);
    }
  });
  monaco.editor.registerEditorOpener({
    openCodeEditor(source, resource, selection) {
      const path = decodeURIComponent(resource.path.replace("/workspace/", ""));
      if (project?.files[path]) openFile(path);
      else {
        let model = monaco.editor.getModel(resource);
        if (!model) {
          const lib =
            monaco.languages.typescript.typescriptDefaults.getExtraLibs()[
              resource.toString()
            ];
          if (!lib) return false;
          model = monaco.editor.createModel(
            lib.content,
            language(resource.path),
            resource,
          );
        }
        editor.setModel(model);
        editor.updateOptions({ readOnly: true });
        $("active-file").textContent = resource.path;
      }
      if (selection) {
        const position =
          "startLineNumber" in selection
            ? {
                lineNumber: selection.startLineNumber,
                column: selection.startColumn,
              }
            : selection;
        editor.setPosition(position);
        editor.revealLineInCenter(position.lineNumber);
      }
      return true;
    },
  });
  syncModels();
  if (project) openFile(active);
  scheduleTypes();
}).catch(failure));
let diffModels = [];
function log(text, level = "log") {
  const row = document.createElement("div");
  row.className = "log " + level;
  row.textContent = text;
  $("console-content").append(row);
  while ($("console-content").childNodes.length > 300)
    $("console-content").firstChild.remove();
  $("console-content").scrollTop = $("console-content").scrollHeight;
}
function failure(error) {
  reveal();
  console.error(error);
  log(error.message || String(error), "error");
  $("save-status").textContent = error.message || String(error);
  $("save-status").classList.add("error");
}
const action =
  (fn) =>
  async (...args) => {
    try {
      return await fn(...args);
    } catch (e) {
      failure(e);
    }
  };
function scheduleTypes() {
  clearTimeout(typeTimer);
  typeTimer = setTimeout(async () => {
    const intelligence = await intelligencePromise?.catch(() => null);
    if (intelligence && project)
      try {
        await intelligence.acquire(project);
      } catch (e) {
        $("types-content").textContent = String(e);
      }
  }, 1200);
}
function markDirty(source = true) {
  dirty = true;
  editGeneration++;
  $("save-status").classList.remove("error");
  $("save-status").textContent = "Unsaved changes";
  clearTimeout(saveTimer);
  showUnsaved();
  if (!folder) saveTimer = setTimeout(() => save().catch(failure), 750);
  if (source) scheduleTypes();
  if (source && $("auto-run").checked) {
    clearTimeout(runTimer);
    runTimer = setTimeout(() => run().catch(failure), 1500);
  }
}
// Game code's imports a package cannot ship (Babylon imported whole), marked while typing as the export refuses them.
function markGameImports(path, model) {
  if (!/^src\/.+\.m?js$/.test(path)) return;
  monaco.editor.setModelMarkers(model, "game-imports", babylonImportIssues(model.getValue()).map(({ line, column, endColumn, message }) => ({
    severity: monaco.MarkerSeverity.Error, message, startLineNumber: line, startColumn: column, endLineNumber: line, endColumn })));
}
function syncModels() {
  if (!monaco) return;
  suppress = true;
  for (const [path, model] of models)
    if (!project.files[path] || project.files[path].kind !== "text") {
      model.dispose();
      models.delete(path);
    }
  for (const [path, file] of Object.entries(project.files)) {
    if (file.kind !== "text") continue;
    let model = models.get(path);
    if (!model) {
      model = monaco.editor.createModel(
        file.content,
        language(path),
        monaco.Uri.parse("file:///workspace/" + path),
      );
      markGameImports(path, model);
      model.onDidChangeContent(() => {
        markGameImports(path, model);
        if (suppress || !project.files[path]) return;
        project.files[path].content = model.getValue();
        frame?.contentWindow.postMessage({ channel, type: "text", payload: { name: path, content: project.files[path].content } }, location.origin);
        markDirty();
        if (path.endsWith(".ink")) writeGameTypes();
      });
      models.set(path, model);
    } else if (model.getValue() !== file.content) model.setValue(file.content);
  }
  suppress = false;
}
function openFile(path) {
  if (!project.files[path]) return;
  if (project.files[path].kind === "binary") {
    log(
      path +
        " · binary asset · " +
        Math.round(project.files[path].content.length * 0.75) +
        " bytes",
    );
    return;
  }
  if (!editor) {
    active = path;
    if (!tabs.includes(path)) tabs.push(path);
    $("active-file").textContent = path;
    renderTabs();
    renderTree();
    code();
    return;
  }
  closeDiff();
  if (editor.getModel()) viewStates.set(active, editor.saveViewState());
  active = path;
  if (!tabs.includes(path)) tabs.push(path);
  editor.updateOptions({ readOnly: false });
  editor.setModel(models.get(path));
  if (viewStates.has(path)) editor.restoreViewState(viewStates.get(path));
  $("active-file").textContent = path;
  renderTabs();
  renderTree();
  editor.focus();
}
function renderTabs() {
  $("tabs").replaceChildren();
  for (const path of tabs.filter((p) => project.files[p]?.kind === "text")) {
    const button = document.createElement("button");
    button.className = path === active ? "active" : "";
    button.textContent = path.split("/").pop();
    button.title = path;
    if ((folder ? folder.saved(path) : savedText.get(path)) !== project.files[path].content) button.classList.add("dirty");
    button.onclick = () => openFile(path);
    if (path !== "index.js") {
      const close = document.createElement("span");
      close.className = "tab-close";
      close.textContent = "×";
      close.onclick = (e) => {
        e.stopPropagation();
        tabs = tabs.filter((p) => p !== path);
        if (active === path) openFile(tabs.at(-1) || "index.js");
        else renderTabs();
      };
      button.append(close);
    }
    $("tabs").append(button);
  }
}
// The Explorer (explorer/FileTree.vue), drawn from the project's files.
const explorer = reactive({ title: "", paths: [], folders: [], active: "", dirty: [] });
let explorerTree;
function renderTree() {
  Object.assign(explorer, { title: project.name, paths: Object.keys(project.files), folders: project.folders || [], active, dirty: unsavedPaths() });
  if (explorerTree) return;
  const view = ref();
  createApp({
    render: () => h(FileTree, {
      ref: view, ...explorer,
      onOpen: (path) => { openFile(path); dock.show("code"); },
      onCreate: action((path, isFolder) => (isFolder ? createFolder(path) : createFile(path))),
      onRename: action(moveTo),
      onMove: action(moveTo),
      onRemove: action(remove),
    }),
  }).mount($("file-tree"));
  explorerTree = view;
}
// The files whose text differs from what was last saved: to OPFS, or to the project's folder.
let savedText = new Map();
const unsavedPaths = () => Object.keys(project.files).filter((path) => project.files[path].kind === "text" && (folder ? folder.saved(path) : savedText.get(path)) !== project.files[path].content);
const rememberSaved = (files) => (savedText = new Map(Object.entries(files).map(([path, file]) => [path, file.content])));
// A rename or a move of a file or folder.
async function moveTo(path, to) {
  normalizePath(to);
  if (project.files[to] || project.folders.includes(to)) throw Error(to + " already exists.");
  project.files = renamePath(project.files, path, to);
  await folder?.move(path, to, project.files);
  if (folder && !Object.keys(project.files).some((p) => p.startsWith(to + "/"))) await folder.createFolder(to);
  project.folders = (project.folders || []).map((p) =>
    p === path || p.startsWith(path + "/") ? to + p.slice(path.length) : p,
  );
  tabs = tabs.map((p) =>
    p === path || p.startsWith(path + "/") ? to + p.slice(path.length) : p,
  );
  if (active === path || active.startsWith(path + "/"))
    active = to + active.slice(path.length);
  syncModels();
  openFile(project.files[active] ? active : "index.js");
  markDirty();
  renderTree();
  log("Moved " + path + " to " + to + ". Relative import statements are not rewritten.");
}
async function remove(path, isFolder) {
  if (path === "index.js") throw Error("index.js cannot be deleted.");
  if (!confirm(`Delete ${path}${isFolder ? " and its contents" : ""}? ${folder ? "It is deleted from the folder on disk." : "This change remains recoverable in version history."}`))
    return;
  await folder?.remove(path);
  project.files = removePath(project.files, path);
  project.folders = project.folders.filter(
    (f) => f !== path && !f.startsWith(path + "/"),
  );
  tabs = tabs.filter((p) => project.files[p]);
  syncModels();
  openFile(project.files[active] ? active : "index.js");
  renderTree();
  markDirty();
}
function save(label = "Autosave") {
  clearTimeout(saveTimer);
  if (folder) return label === "Autosave" ? saveQueue : (saveQueue = saveQueue.catch(() => {}).then(saveFolder));
  const work = async () => {
    if (!project || (!dirty && label === "Autosave")) return;
    const captured = structuredClone(project),
      generation = editGeneration;
    captured.head = project.head;
    $("save-status").textContent = "Saving…";
    try {
      const head = await repo.commit(captured, project.head, label);
      project.head = head;
      rememberSaved(captured.files);
      showUnsaved();
      if (generation === editGeneration) dirty = false;
      $("save-status").classList.remove("error");
      $("save-status").textContent = dirty
        ? "Unsaved changes"
        : "Saved locally";
      if (dirty) {
        clearTimeout(saveTimer);
        saveTimer = setTimeout(() => save().catch(failure), 750);
      }
      await updateQuota();
      return head;
    } catch (e) {
      dirty = true;
      throw e;
    }
  };
  saveQueue = saveQueue.catch(() => {}).then(work);
  return saveQueue;
}
// File > Save of a project in a folder: the scene as its .blend, and every changed file.
async function saveFolder() {
  if (frame && $("run-status").textContent === "Running") project.overrides = await sceneSnapshot();
  const generation = editGeneration;
  $("save-status").textContent = "Saving…";
  await folder.commit(project);
  if (generation === editGeneration) dirty = false;
  $("save-status").textContent = dirty ? "Unsaved changes" : "Saved to folder";
  showUnsaved();
}
// Ctrl S in the code editor: its file only.
async function saveActiveFile() {
  await folder.writeFile(active, project.files[active]);
  dirty = unsavedPaths().length > 0;
  $("save-status").textContent = dirty ? "Unsaved changes" : "Saved to folder";
  showUnsaved();
}
function showUnsaved() {
  renderTabs();
  explorer.dirty = unsavedPaths();
}
// Edits made to the folder outside the app, when the page regains focus or the browser reports them: files without
// unsaved edits here take the folder's, and a changed .blend reopens the project.
async function folderChanged() {
  if (!folder || busy) return;
  const unsaved = new Set(Object.keys(project.files).filter((path) => folder.saved(path) !== project.files[path].content));
  const { files, blend } = await folder.changes();
  let changed = false;
  for (const [path, file] of Object.entries(files)) {
    if (unsaved.has(path)) { log(`${path} changed on disk; your unsaved edits here are kept, and Save writes them over it.`, "warn"); continue; }
    if (file) project.files[path] = file;
    else if (path !== "index.js") delete project.files[path];
    changed = true;
  }
  if (blend && !dirty) return load(folder.id);
  if (blend) log("The .blend changed on disk; your unsaved scene edits are kept, and Save writes them over it.", "warn");
  if (!changed) return;
  tabs = tabs.filter((path) => project.files[path]);
  syncModels();
  openFile(project.files[active] ? active : "index.js");
  renderTree();
  scheduleTypes();
  if ($("auto-run").checked) run().catch(failure);
}
window.addEventListener("focus", () => folderChanged().catch(failure));
let observer = null;
function watchFolder() {
  observer?.disconnect();
  observer = null;
  if (!folder || typeof FileSystemObserver !== "function") return;
  let timer;
  observer = new FileSystemObserver(() => { clearTimeout(timer); timer = setTimeout(() => folderChanged().catch(failure), 300); });
  observer.observe(folder.root, { recursive: true }).catch(() => {});
}
// File > Open Folder: a project folder opens; an empty one gets the open project's files, and its .blend with the
// first save once the scene runs.
async function openFolder(handle) {
  const opened = createFolderRepository(handle);
  if (await opened.isEmpty()) await opened.create(project.name, project.files);
  await rememberFolder(handle);
  await save();
  folder = opened;
  await load(opened.id);
}
const chooseFolder = action(async () => {
  const handle = await showDirectoryPicker({ id: "bylonder-project", mode: "readwrite" }).catch((e) => { if (e.name !== "AbortError") throw e; });
  if (handle) await openFolder(handle);
});
// A folder opened on an earlier visit: the browser asks for its permission again on a click.
async function reconnectFolder(id) {
  const handle = await rememberedFolder(id.slice("folder:".length)).catch(() => null);
  if (!handle) return false;
  if ((await folderAccess(handle)) === "granted") return openFolder(handle).then(() => true);
  const button = $("storage-status");
  button.textContent = "Reconnect " + handle.name;
  button.classList.add("reconnect");
  button.onclick = action(async () => {
    if ((await folderAccess(handle, true)) !== "granted") return;
    button.onclick = null;
    button.classList.remove("reconnect");
    await openFolder(handle);
  });
  return false;
}
function showStorage() {
  $("storage-status").textContent = folder ? "Folder: " + folder.label : "Local workspace";
  $("storage-status").title = folder ? `The project's files are in the folder ${folder.label}; File > Save writes them` : "Projects are kept in this browser";
}
async function updateProjects() {
  const projects = [...(await repo.list()), ...(folder ? await folder.list() : [])];
  $("project").replaceChildren(
    ...projects.map((p) => {
      const option = document.createElement("option");
      option.value = p.id;
      option.textContent = p.name;
      return option;
    }),
  );
  if (project) $("project").value = project.id;
  // Blender's window title names the open file.
  document.title = project ? `${project.name} - Bylonder` : "Bylonder";
}
function renderScenes() {
  const select = $("scene");
  select.replaceChildren(...sceneList(project).map((scene) => Object.assign(document.createElement("option"), { value: scene.id, textContent: scene.name })));
  select.value = activeSceneId(project);
  $("scene-delete").disabled = sceneList(project).length < 2;
}
function postToScene(sceneId, type, payload) {
  const entry = sceneId === activeSceneId(project) ? (frame && { frame, channel }) : parked.get(sceneId);
  entry?.frame.contentWindow.postMessage({ channel: entry.channel, type, payload }, location.origin);
}
function renameSceneTo(sceneId, name) {
  renameScene(project, sceneId, name);
  const renamed = sceneList(project).find((scene) => scene.id === sceneId).name;
  if (renamed !== name) postToScene(sceneId, "scene-name", renamed);
  renderScenes();
  markDirty(false);
}
async function activateScene(sceneId) {
  const previous = activeSceneId(project);
  if (sceneId === previous) return;
  switchScene(project, sceneId);
  if (frame && runData && frame.contentWindow.__bylonder?.bylonderPreferences()?.keep_scenes_loaded !== false) {
    frame.hidden = true;
    frame.contentWindow.postMessage({ channel, type: "suspend" }, location.origin);
    parked.set(previous, { frame, channel, runData });
    frame = null;
    runData = null;
  }
  renderScenes();
  markDirty(false);
  const loaded = parked.get(sceneId);
  if (loaded) {
    parked.delete(sceneId);
    if (frame) { frame.remove(); removeRun(runData.base).catch(console.warn); }
    ({ frame, channel, runData } = loaded);
    frame.hidden = false;
    frame.contentWindow.postMessage({ channel, type: "resume" }, location.origin);
    $("run-status").textContent = "Running";
    return;
  }
  await run({ keepParked: true });
}
const newSceneTypes = [
  ["NEW", "New", "Add a new, empty scene with default settings"],
  ["EMPTY", "Copy Settings", "Add a new, empty scene, and copy settings from the current scene"],
  ["FULL_COPY", "Full Copy", "Make a full copy of the current scene"],
];
$("scene-actions").append(
  menuButton("", () => newSceneTypes.map(([type, label, title]) => ({ label, title, run: action(async () => {
    const id = addScene(project, type);
    await activateScene(id);
  }) })), { icon: "duplicate", className: "bl-icon-only", title: "New Scene" }),
  Object.assign(iconButton("x", "Delete Scene", action(async () => {
    const scene = sceneList(project).find((s) => s.id === activeSceneId(project));
    if (!confirm(`Delete scene "${scene.name}"?`)) return;
    const deleted = scene.id;
    const list = sceneList(project), index = list.findIndex((s) => s.id === deleted);
    await activateScene(list[index === 0 ? 1 : index - 1].id);
    const entry = parked.get(deleted);
    if (entry) { entry.frame.remove(); removeRun(entry.runData.base).catch(console.warn); parked.delete(deleted); }
    removeScene(project, deleted);
    renderScenes();
    markDirty(false);
  })), { id: "scene-delete" }),
);
$("scene").onchange = action((e) => activateScene(e.target.value));
$("scene").ondblclick = action(async () => {
  const scene = sceneList(project).find((s) => s.id === activeSceneId(project));
  const name = await askText("Rename Scene", "Name", scene.name);
  if (name) { renameSceneTo(scene.id, name); postToScene(scene.id, "scene-name", sceneList(project).find((s) => s.id === scene.id).name); }
});
async function load(id, autoRun = true) {
  if (folder && dirty && project?.id === folder.id && id !== folder.id && !confirm(`Discard the unsaved changes to ${folder.label}?`)) return;
  await save();
  stop();
  if (folder?.id !== id) folder = null;
  project = await (folder ?? repo).load(id);
  rememberSaved(project.files);
  watchFolder();
  showStorage();
  renderScenes();
  dirty = false;
  editGeneration = 0;
  tabs = ["index.js"];
  viewStates.clear();
  for (const model of models.values()) model.dispose();
  models.clear();
  syncModels();
  openFile("index.js");
  topbar.setWorkspaces(project.settings.workspaces);
  $("remember").checked = !!project.settings.remember;
  $("toggle-remember").textContent = "Remember scene edits: " + (project.settings.remember ? "on" : "off");
  localStorage.setItem("babylon-active-project", id);
  $("save-status").textContent = folder ? "Saved to folder" : "Saved locally";
  await updateProjects();
  scheduleTypes();
  if (autoRun) await run();
}
async function run({ keepParked = false } = {}) {
  if (!project) return;
  if (!keepParked) unloadParked();
  const generation = ++runGeneration;
  clearTimeout(runTimer);
  await save();
  $("run-status").textContent = "Preparing modules…";
  performance.mark("bl:run");
  const next = await publishRun(structuredClone(project)).catch((error) => {
    $("run-status").textContent = "Run failed";
    throw error;
  });
  performance.mark("bl:published");
  if (generation !== runGeneration) {
    await removeRun(next.base);
    return;
  }
  const old = runData;
  frame?.remove();
  runData = next;
  channel = crypto.randomUUID();
  performance.mark("bl:frame");
  frame = document.createElement("iframe");
  frame.title = "Babylon scene";
  frame.allow = "fullscreen; clipboard-write; web-share";
  frame.src = APP_BASE + "viewport.html?channel=" + encodeURIComponent(channel);
  $("frame-host").append(frame);
  $("run-status").textContent = "Running createScene…";
  if (old) removeRun(old.base).catch(console.warn);
}
function unloadParked() {
  for (const entry of parked.values()) {
    entry.frame.remove();
    removeRun(entry.runData.base).catch(console.warn);
  }
  parked.clear();
}
function stop() {
  unloadParked();
  runGeneration++;
  frame?.remove();
  frame = null;
  if (runData) removeRun(runData.base).catch(console.warn);
  runData = null;
  $("frame-host").textContent = "";
  $("run-status").textContent = "Stopped";
}
const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
function parkedMessage(sceneId, { type, payload }) {
  if (type === "snapshot-result") snapshotResult(payload);
  if (type === "console") log(payload.text, payload.level);
  if (type === "run-error") log(payload.message, "error");
  if (type === "animation") { setSceneData(project, sceneId, { animation: payload }); markDirty(false); }
  if (type === "overrides" && project.settings.remember) { setSceneData(project, sceneId, { overrides: payload }); markDirty(false); }
  if (type === "rename-scene") renameSceneTo(sceneId, payload);
}
// The running scene's state now: its .blend and the rest of what Remember Scene Edits keeps.
const sceneSnapshot = () => new Promise((resolve, reject) => {
  const requestId = crypto.randomUUID();
  const timer = setTimeout(() => { snapshotRequests.delete(requestId); reject(Error("Scene did not respond. Finish any active operation and retry.")); }, 5000);
  snapshotRequests.set(requestId, { resolve, reject, timer });
  frame.contentWindow.postMessage({ channel, type: "snapshot", payload: { requestId } }, location.origin);
});
function snapshotResult(payload) {
  const pending = snapshotRequests.get(payload.requestId);
  if (pending) { clearTimeout(pending.timer); snapshotRequests.delete(payload.requestId); payload.error ? pending.reject(Error(payload.error)) : pending.resolve(payload.state); }
}
window.addEventListener("message", (e) => {
  if (e.origin !== location.origin) return;
  for (const [sceneId, entry] of parked)
    if (e.source === entry.frame.contentWindow && e.data?.channel === entry.channel) return parkedMessage(sceneId, e.data);
  if (
    !frame ||
    e.source !== frame.contentWindow ||
    e.data?.channel !== channel
  )
    return;
  const { type, payload } = e.data;
  if (type === "snapshot-result") snapshotResult(payload);
  if (type === "rename-scene") renameSceneTo(activeSceneId(project), payload);
  if (type === "ready")
    frame.contentWindow.postMessage(
      { channel, type: "init", payload: { ...runData, screen: topbar.screen(), workspace: topbar.workspace() } },
      location.origin,
    );
  if (type === "text") textChanged(payload);
  // A library Main links from (blenkernel/libraries.js), kept with the project.
  if (type === "library") { project.files[payload.path] = binaryFile(payload.bytes); renderTree(); markDirty(false); }
  if (type === "preferences" && !payload.keep_scenes_loaded) unloadParked();
  if (type === "running" || type === "run-error") requestAnimationFrame(() => requestAnimationFrame(() => { reveal(); setTimeout(code, 0); }));
  // A folder's project always has its .blend: one opened without it gets it once the scene runs.
  if (type === "running" && folder && !folder.savedBlend) save("Save").catch(failure);
  if (type === "running") { topbar.connect(); $("run-status").textContent = "Running"; frame.contentWindow.postMessage({channel,type:"render-settings",payload:renderSettings()},location.origin); }
  if (type === "run-error") {
    $("run-status").textContent = "Run failed";
    log(payload.message, "error");
  }
  if (type === "console") log(payload.text, payload.level);
  // Game code the Game area did not take (game-code.js): its error on its line, until a version of the file runs.
  if (type === "code-error") gameCodeError(payload);
  if (type === "edit-source") editSource(payload).catch(failure);
  if (type === "names") { blendNamesNow = payload; writeGameTypes(); }
  // A project file the scene wrote (package.json's licence, chosen in File > Export).
  if (type === "project-file") { project.files[payload.path] = textFile(payload.content); syncModels(); renderTree(); markDirty(false); }
  // The scene's state as it reports it: a change only where it differs (a run starting sends what it opened with).
  if (type === "animation" && !same(project.animation, payload)) { project.animation = payload; markDirty(false); }
  if (type === "overrides" && project.settings.remember && !same(project.overrides, payload)) {
    project.overrides = payload;
    markDirty(false);
  }
  if (type === "remember") setRemember(payload, false);
  if (type === "status") topbar.status(payload);
});
// types/blend.d.ts (space_game/game-types.js): the .blend's names, as the scene sends them, and the project's Ink knots;
// written where it changed, for a project with game code.
let blendNamesNow = null;
function writeGameTypes() {
  if (!blendNamesNow || !Object.keys(project.files).some((path) => /^src\/.+\.m?js$/.test(path))) return;
  const content = gameTypes({ ...blendNamesNow, knots: projectKnots(project.files) });
  if (project.files[TYPES_PATH]?.content === content) return;
  project.files[TYPES_PATH] = textFile(content);
  syncModels();
  renderTree();
  markDirty(false);
}
// Edit Source of a behaviour (Object properties > Behaviors): its file in the code editor at its defineBehavior call.
async function editSource({ path, name }) {
  if (!project.files[path]) return;
  await code();
  dock.show("code");
  openFile(path);
  const { line, column } = definitionAt(project.files[path].content, name);
  // The jump shows: `defineBehavior` selected, its line in the centre.
  editor.setSelection({ startLineNumber: line, startColumn: column, endLineNumber: line, endColumn: column + "defineBehavior".length });
  editor.revealLineInCenter(line);
  editor.focus();
}
function gameCodeError({ path, message, line = 1, column = 1 }) {
  const model = models.get(path);
  if (!monaco || !model) return;
  monaco.editor.setModelMarkers(model, "game", message ? [{ severity: monaco.MarkerSeverity.Error, message: `Not swapped into the game: ${message}`,
    startLineNumber: line, startColumn: column, endLineNumber: line, endColumn: model.getLineMaxColumn(line) }] : []);
  if (message) log(`${path}:${line}: ${message}`, "error");
}
// A text the scene's Text Editor changed, created (content) or deleted (null): the project file follows.
function textChanged({ name, content }) {
  if (content === null) {
    if (name === "index.js") return;
    delete project.files[name];
    tabs = tabs.filter((path) => path !== name);
    if (active === name) openFile("index.js");
  } else if (project.files[name]?.content === content) return;
  else project.files[name] = textFile(content);
  syncModels();
  renderTabs();
  renderTree();
  markDirty(false);
}
function setRemember(enabled, notifyFrame = true) {
  project.settings.remember = enabled;
  $("remember").checked = enabled;
  $("toggle-remember").textContent = "Remember scene edits: " + (enabled ? "on" : "off");
  if (!enabled) project.overrides = {};
  if (notifyFrame && frame)
    frame.contentWindow.postMessage(
      { channel, type: "remember", payload: enabled },
      location.origin,
    );
  if (notifyFrame) for (const entry of parked.values()) entry.frame.contentWindow.postMessage({ channel: entry.channel, type: "remember", payload: enabled }, location.origin);
  markDirty(false);
}
async function showHistory() {
  await save();
  $("version-list").replaceChildren();
  if (folder) $("version-list").textContent = "Versions of a project in a folder are kept by the folder's own tools, such as git.";
  for (const version of folder ? [] : await repo.history(project.id)) {
    const row = document.createElement("div");
    row.className = "version";
    const b = document.createElement("button");
    b.textContent =
      version.label + (version.rev === project.head ? " · current" : "");
    b.onclick = action(() => showDiff(version));
    const time = document.createElement("small");
    time.textContent = new Date(version.time).toLocaleString();
    row.append(b, time);
    $("version-list").append(row);
  }
}
async function showDiff(version) {
  await code();
  diffVersion = version;
  const past = await repo.load(project.id, version.rev);
  const old = past.files[active]?.content || "",
    current = project.files[active]?.content || "";
  closeDiff(false);
  diffModels = [
    monaco.editor.createModel(old, language(active)),
    monaco.editor.createModel(current, language(active)),
  ];
  diff.setModel({ original: diffModels[0], modified: diffModels[1] });
  $("editor-container").hidden = true;
  $("diff-container").hidden = false;
  $("diff-actions").hidden = false;
  $("diff-label").textContent = active + " · selected version ↔ working copy";
  diff.layout();
}
function closeDiff(clear = true) {
  if (!diff) return;
  diff.setModel(null);
  diffModels.forEach((m) => m.dispose());
  diffModels = [];
  $("editor-container").hidden = false;
  $("diff-container").hidden = true;
  $("diff-actions").hidden = true;
  if (clear) diffVersion = null;
  editor.layout();
}
async function restore() {
  if (!diffVersion) return;
  if (
    !confirm(
      "Restore the whole project to this snapshot? Current work is saved as history first.",
    )
  )
    return;
  await save();
  const previous = await repo.load(project.id, diffVersion.rev);
  project.files = previous.files;
  project.folders = previous.folders;
  project.settings = previous.settings;
  project.overrides = previous.overrides;
  project.animation = previous.animation || null;
  project.scenes = previous.scenes;
  project.scene = previous.scene;
  unloadParked();
  markDirty();
  await save("Restore " + diffVersion.rev.slice(0, 8));
  syncModels();
  openFile(project.files[active]?.kind === "text" ? active : "index.js");
  $("remember").checked = !!project.settings.remember;
  $("toggle-remember").textContent = "Remember scene edits: " + (project.settings.remember ? "on" : "off");
  await showHistory();
  await run();
}
function download(bytes, name) {
  const url = URL.createObjectURL(
    new Blob([bytes], { type: "application/zip" }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
async function exportZip() {
  const files = {};
  for (const [path, file] of Object.entries(project.files))
    files[path] =
      file.kind === "text"
        ? strToU8(file.content)
        : Uint8Array.from(atob(file.content), (c) => c.charCodeAt(0));
  files[".workbench.json"] = strToU8(
    JSON.stringify(
      {
        name: project.name,
        folders: project.folders,
        settings: project.settings,
        animation: project.animation || null,
        overrides: project.overrides,
        ...storedScenes(project),
      },
      null,
      2,
    ),
  );
  download(zipSync(files), project.name.replace(/[^a-z0-9_-]/gi, "-") + ".zip");
}
function importedFile(path, bytes, mime) {
  if (
    /\.(?:[mc]?[jt]sx?|json|css|html|md|txt|glsl|wgsl|svg|yaml|yml|csv|d\.ts)$/i.test(
      path,
    )
  )
    return textFile(strFromU8(bytes));
  return binaryFile(bytes, mime);
}
async function importZip(file) {
  await save();
  const archive = unzipSync(new Uint8Array(await file.arrayBuffer()));
  const files = {};
  let settings = {};
  for (const [path, bytes] of Object.entries(archive)) {
    if (path.endsWith("/")) continue;
    if (path === ".workbench.json") {
      settings = JSON.parse(strFromU8(bytes));
      continue;
    }
    normalizePath(path);
    files[path] = importedFile(path, bytes);
  }
  validateFiles(files);
  const created = await repo.create(
    settings.name || file.name.replace(/\.zip$/, ""),
    files,
    {
      folders: settings.folders || [],
      settings: settings.settings || { remember: false },
      animation: settings.animation || null,
      overrides: settings.overrides || {},
      ...(settings.scenes && { scenes: settings.scenes, scene: settings.scene }),
    },
  );
  await load(created.id);
}
async function updateQuota() {
  const estimate = await navigator.storage.estimate();
  $("quota").textContent =
    (estimate.usage / 1048576).toFixed(1) +
    " MB / " +
    (estimate.quota / 1073741824).toFixed(1) +
    " GB";
  $("storage-status").textContent = (await navigator.storage.persisted())
    ? "OPFS · durable"
    : "OPFS · browser managed";
}
const openRenderSettings = setupRenderSettings(value => {
  frame?.contentWindow.postMessage({channel,type:"render-settings",payload:value},location.origin);
  for (const entry of parked.values()) entry.frame.contentWindow.postMessage({channel:entry.channel,type:"render-settings",payload:value},location.origin);
});
$("render-settings").onclick = openRenderSettings;
document.addEventListener('dock-reset', () => {
  try { localStorage.removeItem(RUNTIME_LAYOUT_KEY); } catch {}
  frame?.contentWindow.postMessage({channel,type:'reset-layout'},location.origin);
});
document.querySelectorAll('[data-code-action]').forEach(button => button.onclick = () => code().then(() => { editor.focus(); editor.trigger('toolbar',button.dataset.codeAction,null); }));
document.querySelectorAll('#app-more button').forEach(button => button.addEventListener('click', () => { $("app-more").open = false; }));
const sharing = setupSharing({
  async capture(includeOverrides) {
    const projectId = project.id;
    let overrides = project.overrides;
    if (includeOverrides && frame && $("run-status").textContent === "Running") overrides = await sceneSnapshot();
    if(project.id !== projectId) throw Error('Project changed. Reopen Share.');
    await save();
    return {project:structuredClone(project),overrides};
  },
  async importProject(payload) {
    await save();
    const created = await repo.create(payload.name + ' shared', payload.files, {folders:payload.folders,settings:payload.settings,animation:payload.animation,overrides:payload.overrides,...(payload.scenes&&{scenes:payload.scenes,scene:payload.scene})});
    await load(created.id, false);
    dock.show('code');
    log('Shared project imported. Review index.js, then press Run.');
  }
});
$("share-project").onclick = () => sharing.open();
$("project").onchange = action((e) => load(e.target.value));
$("new-project").onclick = action(async () => {
  const name = await askText("New Project", "Name", "Untitled");
  if (!name) return;
  await save();
  const created = await repo.create(name, defaultFiles());
  await load(created.id);
});
// File > Open of a .blend: a new project holding the file, whose code opens it (openBlend in @workbench/sdk), so
// Bylonder's edits are kept over it as over any project.
const openBlend = action(async (file) => {
  await save();
  const path = normalizePath(file.name.replace(/[^\w. -]/g, "_"));
  const files = { "index.js": textFile(blendProjectSource(path)), [path]: importedFile(path, new Uint8Array(await file.arrayBuffer())) };
  const created = await repo.create(file.name.replace(/\.blend$/i, ""), files);
  await load(created.id);
});
const createExample = async (example) => repo.create(example.title, await example.files(), example.workspaces && { settings: { remember: false, workspaces: example.workspaces } });
const openExample = action(async (example) => {
  await save();
  await load((await createExample(example)).id);
});
// A link to index.html#example=<id> (the docs' Open in Bylonder) opens that example as a new project. The hash leaves
// the address at once, keeping the entry's state, so Back never comes to it and opens the example again.
const linkedExample = () => {
  const example = examples.find(({ id }) => location.hash === `#example=${id}`);
  if (example) history.replaceState(history.state, "", location.pathname + location.search);
  return example;
};
window.addEventListener("hashchange", () => {
  const example = linkedExample();
  if (example) openExample(example);
});
$("fork-project").onclick = action(async () => {
  const name = await askText("Fork Project", "Name", project.name + " copy");
  if (!name) return;
  await save();
  const created = await repo.create(name, structuredClone(project.files), {
    folders: project.folders,
    settings: project.settings,
    animation: project.animation || null,
        overrides: project.overrides,
    ...structuredClone(storedScenes(project)),
  });
  await load(created.id);
});
$("rename-project").onclick = action(async () => {
  const name = await askText("Rename Project", "Name", project.name);
  if (!name) return;
  project.name = name;
  markDirty();
  await save("Rename project");
  await updateProjects();
});
async function createFile(path) {
  normalizePath(path);
  if (project.files[path]) throw Error(path + " already exists.");
  project.files[path] = textFile("");
  await folder?.writeFile(path, project.files[path]);
  syncModels();
  openFile(path);
  dock.show("code");
  markDirty();
}
async function createFolder(path) {
  normalizePath(path);
  if (project.files[path]) throw Error("A file exists at " + path);
  await folder?.createFolder(path);
  if (!project.folders.includes(path)) project.folders.push(path);
  renderTree();
  markDirty();
}
$("run").onclick = action(run);
$("stop").onclick = stop;
$("checkpoint").onclick = action(async () => {
  if (folder) return save("Save");
  const label = await askText("Save Checkpoint", "Label", "Checkpoint");
  if (label) await save(label);
});
$("export").onclick = action(exportZip);
$("import").onclick = () => $("import-input").click();
$("import-input").onchange = action(async (e) => {
  if (e.target.files[0]) await importZip(e.target.files[0]);
  e.target.value = "";
});
$("upload").onclick = () => $("upload-input").click();
$("upload-input").onchange = action(async (e) => {
  for (const file of e.target.files) {
    const path = normalizePath(file.webkitRelativePath || file.name);
    if (path === "index.js")
      throw Error("Edit index.js in the editor; uploads cannot overwrite it.");
    if (project.files[path] && !confirm("Overwrite " + path + "?")) continue;
    project.files[path] = importedFile(
      path,
      new Uint8Array(await file.arrayBuffer()),
      file.type,
    );
  }
  syncModels();
  renderTree();
  markDirty();
  e.target.value = "";
});
$("toggle-remember").onclick = () => setRemember(!project.settings.remember);
$("clear-scene-edits").onclick = () => $("clear-overrides").click();
$("remember").onchange = (e) => setRemember(e.target.checked);
$("clear-overrides").onclick = action(async () => {
  project.overrides = {};
  markDirty();
  await run();
});
$("layout").onclick = () => dock.openMenu();
$("request-persist").onclick = action(async () => {
  const granted = await navigator.storage.persist();
  log(
    granted
      ? "Durable storage granted."
      : "Browser declined durable storage. Export ZIP backups.",
    "warn",
  );
  await updateQuota();
});
$("files-tab").onclick = () => {
  $("file-tree").hidden = false;
  $("file-actions").hidden = false;
  $("version-list").hidden = true;
  $("files-tab").classList.add("active");
  $("history-tab").classList.remove("active");
};
$("history-tab").onclick = action(async () => {
  $("file-tree").hidden = true;
  $("file-actions").hidden = true;
  $("version-list").hidden = false;
  $("history-tab").classList.add("active");
  $("files-tab").classList.remove("active");
  await showHistory();
});
$("restore").onclick = action(restore);
$("close-diff").onclick = () => closeDiff();
for (const name of ["console", "problems", "types"])
  $(name + "-tab").onclick = () => {
    for (const id of ["console", "problems", "types"]) {
      $(id + "-content").hidden = id !== name;
      $(id + "-tab").classList.toggle("active", id === name);
    }
  };
$("clear-console").onclick = () => $("console-content").replaceChildren();
window.addEventListener("keydown", (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
    e.preventDefault();
    run().catch(failure);
  }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
    e.preventDefault();
    (!folder ? save() : editor?.hasTextFocus() ? saveActiveFile() : save("Save")).catch(failure);
  }
});
const startExample = linkedExample();
installBack(window, { unsaved: () => dirty });
window.addEventListener("beforeunload", (e) => {
  if (dirty) {
    e.preventDefault();
    e.returnValue = "";
  }
});
document.addEventListener("visibilitychange", () => {
  if (document.hidden && dirty) save().catch(failure);
});
(async () => {
  try {
    // A first visit that loads once more for isolation (public/isolation.js) starts only on that load.
    await self.isolated;
    repo = createRepository(await openOPFS());
    const projects = await repo.list();
    const last = localStorage.getItem("babylon-active-project");
    let id = last;
    if (!projects.some((p) => p.id === id)) id = projects[0]?.id;
    const example = startExample;
    if (example) id = (await createExample(example)).id;
    else if (!id) id = (await repo.create("Untitled", defaultFiles())).id;
    const shared = location.hash.startsWith("#project=");
    if (last?.startsWith("folder:") && !example && !shared) {
      await load(id, false);
      if (!(await reconnectFolder(last))) await run();
    } else await load(id, !shared);
    await sharing.incoming();
    if (!projects.length && !example && !location.hash.startsWith("#project=")) topbar.splash();
  } catch (e) {
    failure(e);
    if (!project) {
      $("fatal").hidden = false;
      $("fatal").textContent =
        "Workspace could not open.\n\n" +
        e.message +
        "\n\nYour existing browser files have not been replaced.";
    }
  }
})();

setInterval(() => { if (dirty && project) save().catch(failure); }, 5000);
