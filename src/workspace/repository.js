import { hash } from "./opfs.js";
import { validateProject } from "./project-model.js";
import { storedScenes } from "./scenes.js";
import { splitBinary, joinBinary } from "./binary.js";
export function createRepository(io) {
  const read = async (path) => {
    const raw = await io.read(path);
    return raw ? JSON.parse(raw) : null;
  };
  const version = async (id, rev) =>
    read(`projects/${id}/versions/${rev}.json`);
  const readBlob = async (id) => {
    const blob = await io.readBlob(`blobs/${id}`);
    if (!blob) throw Error("Missing file data: " + id);
    return blob;
  };
  // A value's JSON, its binary contents written once by id.
  const store = async (value) => {
    const { json, blobs } = splitBinary(value);
    for (const [id, blob] of blobs)
      if (!(await io.readBlob(`blobs/${id}`))) await io.write(`blobs/${id}`, blob);
    return json;
  };
  const api = {
    async list() {
      let entries;
      try {
        entries = await io.list("projects");
      } catch (e) {
        if (e.name === "NotFoundError") return [];
        throw e;
      }
      const list = [];
      for (const entry of entries)
        if (entry.kind === "directory") {
          const meta = await read(`projects/${entry.name}/HEAD.json`);
          if (meta) list.push(meta);
        }
      return list.sort((a, b) => b.updated - a.updated);
    },
    async load(id, rev) {
      const meta = await read(`projects/${id}/HEAD.json`);
      if (!meta) throw Error("Project not found");
      const snapshot = await version(id, rev || meta.head);
      if (!snapshot) throw Error("Version not found");
      const files = {};
      for (const [path, digest] of Object.entries(snapshot.files)) {
        const file = await read(`objects/${digest}.json`);
        if (!file) throw Error("Missing file data: " + path);
        files[path] = file;
      }
      return joinBinary({ id, head: meta.head, name: meta.name, ...snapshot, files }, readBlob);
    },
    async commit(project, expectedHead, label = "Autosave") {
      validateProject(await joinBinary(project));
      return io.lock(project.id, async () => {
        const headPath = `projects/${project.id}/HEAD.json`;
        const previous = await read(headPath);
        if ((previous?.head || null) !== (expectedHead || null))
          throw Error(
            "CONFLICT: This project changed in another tab. Export your draft, then reload the project.",
          );
        const files = {};
        for (const [path, file] of Object.entries(project.files)) {
          const content = await store(file);
          const digest = await hash(content);
          files[path] = digest;
          if (!(await io.read(`objects/${digest}.json`)))
            await io.write(`objects/${digest}.json`, content);
        }
        const remember = !!project.settings?.remember;
        const scenes = storedScenes(project);
        const state = {
          files,
          folders: project.folders || [],
          animation: project.animation || null,
          settings: project.settings || { remember: false },
          overrides: remember ? project.overrides || {} : {},
          // Other scenes of the project (scenes.js); scene edits are kept only with Remember Scene Edits, as above.
          ...(scenes.scenes && {
            scene: scenes.scene,
            scenes: scenes.scenes.map((s) => (s.overrides && !remember ? { ...s, overrides: {} } : s)),
          }),
        };
        const old = previous ? await version(project.id, previous.head) : null;
        if (
          label === "Autosave" &&
          old &&
          (await store(state)) ===
            JSON.stringify({
              files: old.files,
              folders: old.folders,
              animation: old.animation || null,
              settings: old.settings,
              overrides: old.overrides,
              ...(old.scenes && { scene: old.scene, scenes: old.scenes }),
            }) &&
          previous.name === project.name
        )
          return previous.head;
        const rev = crypto.randomUUID();
        const snapshot = {
          ...state,
          rev,
          parent: previous?.head || null,
          time: Date.now(),
          label,
        };
        await io.write(
          `projects/${project.id}/versions/${rev}.json`,
          await store(snapshot),
        );
        await io.write(
          headPath,
          JSON.stringify({
            id: project.id,
            name: project.name,
            head: rev,
            updated: snapshot.time,
          }),
        );
        return rev;
      });
    },
    async history(id) {
      const head = await read(`projects/${id}/HEAD.json`);
      const result = [];
      let rev = head?.head;
      const seen = new Set();
      while (rev && !seen.has(rev)) {
        seen.add(rev);
        const row = await version(id, rev);
        if (!row) break;
        result.push(row);
        rev = row.parent;
      }
      return result;
    },
    async create(name, files, extras = {}) {
      const project = {
        id: crypto.randomUUID(),
        name,
        files,
        folders: [],
        settings: { remember: false },
        overrides: {},
        ...extras,
      };
      project.head = await api.commit(project, null, "Initial version");
      return project;
    },
  };
  return api;
}
