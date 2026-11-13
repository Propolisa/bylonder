// A patch between two exports of a scene (docs/data-flow.md): the entries of their tables that differ, by table and
// key (null where an entry is gone), with the buffers the later one adds, and the versions it goes from and to. A
// package's version is the hash of its tables' sorted [table, key, entry hash] list, so equal tables are equal versions;
// a full export is the patch from the empty package's.
import { contentKey } from './scene-bin.js';

const text = new TextEncoder();
const hashOf = (value) => contentKey(text.encode(JSON.stringify(value)));

/** Each entry's hash, by table and key. */
const entryHashes = (tables) => Object.fromEntries(Object.entries(tables).map(([table, entries]) => [table, Object.fromEntries(Object.entries(entries).map(([key, entry]) => [key, hashOf(entry)]))]));

/** A package's version from its entries' hashes. */
export function tablesVersion(hashes) {
  const list = Object.entries(hashes).flatMap(([table, entries]) => Object.entries(entries).map(([key, hash]) => [table, key, hash]));
  return hashOf(list.sort((a, b) => (a[0] + '\0' + a[1] < b[0] + '\0' + b[1] ? -1 : 1)));
}

/** An export's tables as a patch is made from: `{ tables, hashes, version, buffers }`; with nothing, the empty package. */
export function packageState({ tables = {}, buffers = {} } = {}) {
  const hashes = entryHashes(tables);
  return { tables, hashes, version: tablesVersion(hashes), buffers };
}

/** The patch from `before` to `after` (packageState's): `{ base, version, tables, buffers }`. */
export function tablesPatch(before, after) {
  const tables = {};
  for (const table of new Set([...Object.keys(before.hashes), ...Object.keys(after.hashes)])) {
    const was = before.hashes[table] ?? {}, is = after.hashes[table] ?? {}, changed = {};
    for (const key of Object.keys(is)) if (was[key] !== is[key]) changed[key] = after.tables[table][key];
    for (const key of Object.keys(was)) if (!(key in is)) changed[key] = null;
    if (Object.keys(changed).length) tables[table] = changed;
  }
  const buffers = Object.fromEntries(Object.entries(after.buffers).filter(([key]) => !(key in before.buffers)));
  return { base: before.version, version: after.version, tables, buffers };
}
