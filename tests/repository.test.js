import assert from "node:assert/strict";
import { createRepository } from "../src/workspace/repository.js";
import { defaultFiles } from "../src/workspace/default-project.js";
import {
  removePath,
  renamePath,
  normalizePath,
} from "../src/workspace/project-model.js";
const disk = new Map();
let failHead = false;
const io = {
  read: async (p) => disk.get(p) || null,
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
console.log(
  "Repository: immutable snapshots, deduplication, conflict rejection, interrupted commit recovery, restore, protected entry and overrides passed",
);
