import assert from "node:assert/strict";
import { createRepository } from "../src/workspace/repository.js";
import { defaultFiles } from "../src/workspace/default-project.js";
import {
  removePath,
  renamePath,
  normalizePath,
  binaryFile,
} from "../src/workspace/project-model.js";
import { toBase64, bytesOf, textBinary, joinBinary } from "../src/workspace/binary.js";
import { encodeProject, decodeProject } from "../src/workspace/share-codec.js";
import { hash } from "../src/workspace/opfs.js";
const disk = new Map();
let failHead = false;
const io = {
  read: async (p) => disk.get(p) || null,
  readBlob: async (p) => disk.get(p) || null,
  write: async (p, text) => {
    if (failHead && p.endsWith("HEAD.json")) throw Error("quota");
    disk.set(p, text);
  },
  list: async () => [],
  lock: async (_, fn) => fn(),
};
const repo = createRepository(io);
const project = await repo.create("Test", defaultFiles());
const first = project.head;
assert.equal(
  (await repo.load(project.id)).files["index.js"].content,
  project.files["index.js"].content,
);
assert.throws(() => removePath(project.files, "index.js"));
assert.throws(() => renamePath(project.files, "index.js", "other.js"));
assert.throws(() => normalizePath("../escape.js"));
const beforeObjects = [...disk.keys()].filter((k) =>
  k.startsWith("objects/"),
).length;
project.files["index.js"].content += "\n// change";
project.head = await repo.commit(project, first);
assert.notEqual(project.head, first);
assert.equal(
  [...disk.keys()].filter((k) => k.startsWith("objects/")).length,
  beforeObjects + 1,
);
assert.equal(await repo.commit(project, project.head), project.head);
await assert.rejects(repo.commit(project, first), /CONFLICT/);
const second = project.head;
project.files["index.js"].content += "\n// interrupted";
failHead = true;
await assert.rejects(repo.commit(project, second), /quota/);
failHead = false;
assert.equal((await repo.load(project.id)).head, second);
assert.equal((await repo.history(project.id)).length, 2);
const old = await repo.load(project.id, first);
project.files = old.files;
project.head = await repo.commit(project, second, "Restore");
assert.equal((await repo.history(project.id)).length, 3);
assert.equal(
  (await repo.load(project.id)).files["index.js"].content,
  old.files["index.js"].content,
);
project.settings.remember = true;
project.overrides = { stores: { scene: { height: 2 } } };
project.head = await repo.commit(project, project.head);
assert.equal((await repo.load(project.id)).overrides.stores.scene.height, 2);
project.animation = {version:1,name:"Action",start:1,end:20,fps:24,frame:1,loop:true,autoKey:false,tracks:[]};
project.settings.remember = false;
project.head = await repo.commit(project, project.head);
assert.deepEqual((await repo.load(project.id)).overrides, {});
assert.deepEqual((await repo.load(project.id)).animation, project.animation);

// Binary files are stored as bytes once, apart from the JSON, and come back as Blobs.
const bytes = Uint8Array.from({ length: 300000 }, (_, i) => i % 251);
project.files["scene.blend"] = binaryFile(bytes);
project.head = await repo.commit(project, project.head);
project.head = await repo.commit(project, project.head, "Again");
const stored = (await repo.load(project.id)).files["scene.blend"];
assert.deepEqual(await bytesOf(stored), bytes);
assert.equal([...disk.keys()].filter((k) => k.startsWith("blobs/")).length, 1);
assert(![...disk.values()].some((v) => typeof v === "string" && v.length > 100000), "no stored text holds the bytes");

// A project saved before kept its binary files as base64 in their JSON: they open as bytes and are stored as bytes.
const legacyFile = JSON.stringify({ kind: "binary", content: toBase64(bytes) }), digest = await hash(legacyFile);
disk.set(`objects/${digest}.json`, legacyFile);
const snapshot = JSON.parse(disk.get(`projects/${project.id}/versions/${project.head}.json`));
snapshot.files["scene.blend"] = digest;
disk.set(`projects/${project.id}/versions/${project.head}.json`, JSON.stringify(snapshot));
const legacy = await repo.load(project.id);
assert(legacy.files["scene.blend"].content instanceof Blob);
assert.deepEqual(await bytesOf(legacy.files["scene.blend"]), bytes);
legacy.head = await repo.commit(legacy, legacy.head, "Migrated");
assert.deepEqual(await bytesOf((await repo.load(project.id)).files["scene.blend"]), bytes);
assert.equal([...disk.keys()].filter((k) => k.startsWith("blobs/")).length, 2);

// A share link, which is text, carries binary files as base64; they open as bytes.
const small = { ...legacy, files: { ...legacy.files, "scene.blend": binaryFile(bytes.subarray(0, 1000)) } };
const shared = await joinBinary(decodeProject(encodeProject(await textBinary(small))));
assert.deepEqual(await bytesOf(shared.files["scene.blend"]), bytes.subarray(0, 1000));
console.log(
  "Repository: immutable snapshots, deduplication, conflict rejection, interrupted commit recovery, restore, protected entry, overrides, binary files as bytes, base64 files of older projects and share links passed",
);
