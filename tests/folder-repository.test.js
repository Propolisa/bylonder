// tags: storage
// A project in a folder on disk (folder-repository.js), over an in-memory File System Access directory: files as
// plain files, the .blend written by File > Save, bylonder.json stable, and edits made outside the app found.
import assert from "node:assert/strict";
import { gzipBase64 } from "../src/runtime/project-gzip.js";
import { createFolderRepository } from "../src/workspace/folder-repository.js";
import { defaultFiles } from "../src/workspace/default-project.js";
import { binaryFile, textFile } from "../src/workspace/project-model.js";

let clock = 0;
const notFound = () => Object.assign(Error("missing"), { name: "NotFoundError" });
function fileHandle(name) {
  const handle = { kind: "file", name, bytes: new Uint8Array(), modified: 0 };
  handle.getFile = async () => new File([handle.bytes], name, { lastModified: handle.modified });
  handle.createWritable = async () => {
    const chunks = [];
    return {
      write: async (data) => chunks.push(typeof data === "string" ? new TextEncoder().encode(data) : data),
      close: async () => { handle.bytes = new Uint8Array(await new Blob(chunks).arrayBuffer()); handle.modified = ++clock; },
      abort: async () => {},
    };
  };
  return handle;
}
function dirHandle(name) {
  const entries = new Map();
  const get = (kind, make) => async (child, { create } = {}) => {
    if (!entries.has(child)) { if (!create) throw notFound(); entries.set(child, make(child)); }
    return entries.get(child);
  };
  return {
    kind: "directory", name, entries: async function* () { yield* entries; },
    getDirectoryHandle: get("directory", dirHandle), getFileHandle: get("file", fileHandle),
    removeEntry: async (child) => { if (!entries.delete(child)) throw notFound(); },
  };
}
const text = async (dir, path) => {
  const parts = path.split("/"), name = parts.pop();
  for (const part of parts) dir = await dir.getDirectoryHandle(part);
  return (await (await dir.getFileHandle(name)).getFile()).text();
};
async function edit(dir, path, content) {
  const parts = path.split("/"), name = parts.pop();
  for (const part of parts) dir = await dir.getDirectoryHandle(part, { create: true });
  const writer = await (await dir.getFileHandle(name, { create: true })).createWritable();
  await writer.write(content);
  await writer.close();
}

const root = dirHandle("cafe");
const folder = createFolderRepository(root);
assert.ok(await folder.isEmpty());
const files = { ...defaultFiles(), "src/behaviors/rock.js": textFile("export default 1;\n"), "content/icon.png": binaryFile(new Uint8Array([137, 80, 78, 71])) };
let project = await folder.create("Cafe", files);
assert.equal(await text(root, "src/behaviors/rock.js"), "export default 1;\n");
assert.deepEqual(project.files["content/icon.png"], files["content/icon.png"]);
assert.equal(project.settings.remember, true, "a folder's .blend always holds its scene");

// File > Save writes the .blend as Blender's bytes, and bylonder.json with its keys in a fixed order.
const blend = new TextEncoder().encode("BLENDER-v405 scene");
project.overrides = { blend: gzipBase64(blend), objects: [] };
project.files["index.js"] = textFile(project.files["index.js"].content + "// saved\n");
await folder.commit(project);
assert.equal(await text(root, "Cafe.blend"), "BLENDER-v405 scene");
assert.deepEqual(Object.keys(JSON.parse(await text(root, "bylonder.json"))), ["name", "blend", "settings"]);
assert.match(await text(root, "index.js"), /\/\/ saved/);
const settings = await text(root, "bylonder.json");
await folder.commit(project);
assert.equal(await text(root, "bylonder.json"), settings, "saving again rewrites nothing");

// Reopened, the folder gives the same project, its scene from the .blend.
const reopened = await createFolderRepository(root).load();
assert.equal(reopened.name, "Cafe");
assert.equal(reopened.files["src/behaviors/rock.js"].content, "export default 1;\n");
assert.equal(reopened.overrides.blend, project.overrides.blend);
assert.ok(!reopened.files["Cafe.blend"] && !reopened.files["bylonder.json"]);

// Edits made outside the app are found; the app's own writes are not reported back.
assert.deepEqual(await folder.changes(), { files: {}, blend: false });
await edit(root, "src/behaviors/rock.js", "export default 2;\n");
await edit(root, "content/cafe.ink", "=== rock_reaction ===\n");
await edit(root, "Cafe.blend", "BLENDER-v405 other");
let changes = await folder.changes();
assert.equal(changes.files["src/behaviors/rock.js"].content, "export default 2;\n");
assert.equal(changes.files["content/cafe.ink"].content, "=== rock_reaction ===\n");
assert.equal(changes.blend, true);
assert.equal(folder.saved("src/behaviors/rock.js"), "export default 2;\n");

// Moves and deletes reach the folder.
project.files = { ...project.files, "src/behaviors/stone.js": project.files["src/behaviors/rock.js"] };
delete project.files["src/behaviors/rock.js"];
await folder.move("src/behaviors/rock.js", "src/behaviors/stone.js", project.files);
await folder.remove("content/icon.png");
await assert.rejects(text(root, "src/behaviors/rock.js"));
await assert.rejects(text(root, "content/icon.png"));
assert.deepEqual(await folder.changes(), { files: {}, blend: false }, "the app's own moves are not reported back");

// A folder that is not a project says so.
const other = dirHandle("photos");
await edit(other, "a.txt", "x");
await assert.rejects(createFolderRepository(other).load(), /no index.js/);
console.log("folder repository: ok");
