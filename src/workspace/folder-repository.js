// A project in a folder on disk (File System Access API), the backend beside OPFS's (repository.js): its files as
// plain files, the scene as <name>.blend written by File > Save as desktop Blender writes it, bylonder.json for the
// project's settings and .bylonder/state.json for the rest of the scene's state. Files the app did not read (dot
// folders, node_modules) are never touched. Versions are the folder's own (git).
import { gzipBase64, gunzipBase64 } from "../runtime/project-gzip.js";
import { binaryFile, textFile, validateFiles } from "./project-model.js";

const SETTINGS = "bylonder.json", STATE = ".bylonder/state.json";
const TEXT = /\.(m?[jt]sx?|json|md|ink|txt|css|html|glsl|wgsl|fx|csv|xml|svg|ya?ml)$/i;
// Dot folders, node_modules, and the swap files Chromium writes beside a file being saved.
const skipped = (name) => name.startsWith(".") || name === "node_modules" || name.endsWith(".crswap");
const stamp = (file) => `${file.size}:${file.lastModified}`;
const base64Bytes = (text) => Uint8Array.from(atob(text), (c) => c.charCodeAt(0));
// Keys in a fixed order, so the file diffs well.
const settingsText = ({ name, blend, settings }) => JSON.stringify({ name, blend, settings }, null, 2) + "\n";

async function directory(root, parts, create = false) {
  let dir = root;
  for (const part of parts) dir = await dir.getDirectoryHandle(part, { create });
  return dir;
}
const split = (path) => { const parts = path.split("/"); return { parts, name: parts.pop() }; };

// The folder's files and folders, by path, as handles, the skipped ones left out.
async function walk(dir, prefix = "", out = { files: new Map(), folders: [] }) {
  for await (const [name, handle] of dir.entries()) {
    const path = prefix + name;
    if (skipped(name)) continue;
    if (handle.kind === "directory") {
      out.folders.push(path);
      await walk(handle, path + "/", out);
    } else out.files.set(path, handle);
  }
  return out;
}

export function createFolderRepository(root) {
  const id = "folder:" + root.name;
  // What the folder held when last read or written: path to stamp, and to content for dirty checks.
  const stamps = new Map(), saved = new Map();
  let blendName = null, savedBlend = null, savedSettings = null, savedState = null;

  const readText = async (path) => {
    try {
      const { parts, name } = split(path);
      return await (await (await (await directory(root, parts)).getFileHandle(name)).getFile()).text();
    } catch (e) {
      if (e.name === "NotFoundError") return null;
      throw e;
    }
  };
  async function write(path, data) {
    const { parts, name } = split(path);
    const handle = await (await directory(root, parts, true)).getFileHandle(name, { create: true });
    const writer = await handle.createWritable();
    try {
      await writer.write(data);
      await writer.close();
    } catch (e) {
      await writer.abort().catch(() => {});
      throw e;
    }
    stamps.set(path, stamp(await handle.getFile()));
  }
  async function remove(path) {
    const { parts, name } = split(path);
    await (await directory(root, parts)).removeEntry(name, { recursive: true }).catch((e) => { if (e.name !== "NotFoundError") throw e; });
    for (const key of [...stamps.keys()]) if (key === path || key.startsWith(path + "/")) { stamps.delete(key); saved.delete(key); }
  }
  async function readFile(path, handle) {
    const file = await handle.getFile();
    stamps.set(path, stamp(file));
    return TEXT.test(path) ? textFile(await file.text()) : binaryFile(new Uint8Array(await file.arrayBuffer()), file.type || undefined);
  }

  const api = {
    kind: "folder",
    id,
    label: root.name,
    root,
    async list() {
      return [{ id, name: root.name, head: id, updated: Date.now() }];
    },
    async load() {
      const config = JSON.parse((await readText(SETTINGS)) ?? "{}");
      const state = JSON.parse((await readText(STATE)) ?? "{}");
      const { files: handles, folders } = await walk(root);
      blendName = config.blend ?? [...handles.keys()].find((p) => !p.includes("/") && p.endsWith(".blend")) ?? (config.name ?? root.name) + ".blend";
      const files = {};
      for (const [path, handle] of handles) {
        if (path === blendName || path === SETTINGS) continue;
        files[path] = await readFile(path, handle);
        saved.set(path, files[path].content);
      }
      if (!files["index.js"]) throw Error(`${root.name} has no index.js: open a project folder, or an empty folder to start one.`);
      validateFiles(files);
      const blend = handles.get(blendName);
      savedBlend = blend ? gzipBase64(new Uint8Array(await (await blend.getFile()).arrayBuffer())) : null;
      if (blend) stamps.set(blendName, stamp(await blend.getFile()));
      savedSettings = settingsText({ name: config.name ?? root.name, blend: blendName, settings: config.settings });
      savedState = JSON.stringify(state);
      const { overrides = {}, ...rest } = state;
      return {
        id,
        head: id,
        name: config.name ?? root.name,
        files,
        folders: folders.filter((f) => !Object.keys(files).some((p) => p.startsWith(f + "/"))),
        animation: null,
        scenes: undefined,
        ...rest,
        settings: { ...config.settings, remember: true },
        overrides: savedBlend ? { ...overrides, blend: savedBlend } : overrides,
      };
    },
    // An empty folder becomes a project of these files; the .blend comes with the first File > Save.
    async create(name, files) {
      for (const [path, file] of Object.entries(files)) await api.writeFile(path, file);
      await write(SETTINGS, settingsText({ name, blend: name + ".blend", settings: { remember: true } }));
      return api.load();
    },
    async isEmpty() {
      for await (const [name] of root.entries()) if (!skipped(name)) return false;
      return true;
    },
    // The content the folder holds for a path, for an editor's dirty marker.
    saved: (path) => saved.get(path),
    get savedBlend() { return savedBlend; },
    async writeFile(path, file) {
      await write(path, file.kind === "text" ? file.content : base64Bytes(file.content));
      saved.set(path, file.content);
    },
    remove,
    async createFolder(path) {
      const { parts, name } = split(path);
      await directory(root, [...parts, name], true);
    },
    async move(from, to, files) {
      for (const [path, file] of Object.entries(files))
        if (path === to || path.startsWith(to + "/")) await api.writeFile(path, file);
      await remove(from);
    },
    // File > Save: every changed file, the scene's .blend, bylonder.json and the scene's other state.
    async commit(project) {
      for (const [path, file] of Object.entries(project.files)) if (saved.get(path) !== file.content) await api.writeFile(path, file);
      const { blend, ...overrides } = project.overrides ?? {};
      if (blend && blend !== savedBlend) {
        await write(blendName, gunzipBase64(blend));
        savedBlend = blend;
      }
      const settings = settingsText({ name: project.name, blend: blendName, settings: project.settings });
      if (settings !== savedSettings) await write(SETTINGS, (savedSettings = settings));
      const state = JSON.stringify({ overrides, animation: project.animation ?? null, ...(project.scenes && { scene: project.scene, scenes: project.scenes }) });
      if (state !== savedState) await write(STATE, (savedState = state));
      return id;
    },
    async history() {
      return [];
    },
    // What changed in the folder since it was last read or written: files by path (null when deleted), and whether
    // the .blend did.
    async changes() {
      const { files: handles } = await walk(root);
      const files = {};
      let blend = false;
      for (const [path, handle] of handles) {
        if (path === SETTINGS) continue;
        // A file can go between the listing and the read, as a save replaces it.
        const file = await handle.getFile().catch((e) => { if (e.name !== "NotFoundError") throw e; });
        if (!file) continue;
        if (stamps.get(path) === stamp(file)) continue;
        if (path === blendName) { blend = true; stamps.set(path, stamp(file)); continue; }
        files[path] = await readFile(path, handle);
        if (saved.get(path) === files[path].content) delete files[path];
        else saved.set(path, files[path].content);
      }
      for (const path of saved.keys()) if (!handles.has(path)) { files[path] = null; saved.delete(path); stamps.delete(path); }
      return { files, blend };
    },
  };
  return api;
}

// The folder last opened, kept across visits (a handle can be stored in IndexedDB, not in localStorage).
const DB = "bylonder-folders";
function store(mode, fn) {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open(DB, 1);
    open.onupgradeneeded = () => open.result.createObjectStore("handles");
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const request = fn(open.result.transaction("handles", mode).objectStore("handles"));
      request.onsuccess = () => { resolve(request.result); open.result.close(); };
      request.onerror = () => reject(request.error);
    };
  });
}
export const rememberFolder = (handle) => store("readwrite", (s) => s.put(handle, handle.name));
export const rememberedFolder = (name) => store("readonly", (s) => s.get(name));
export const folderAccess = (handle, request = false) => handle[request ? "requestPermission" : "queryPermission"]({ mode: "readwrite" });
export const canOpenFolders = () => typeof globalThis.showDirectoryPicker === "function";
