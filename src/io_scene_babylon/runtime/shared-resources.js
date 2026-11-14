// @ts-check
// SPDX-License-Identifier: MIT OR Apache-2.0
// What the runs of a package share (docs/notes/shared-runs.md). On the page: its data as read, scene.bin's arrays and
// the IR, by the package's version. On one engine: the GPU buffers of its geometries' vertex streams, one per array of
// scene.bin (named by its content), counted by the geometries that use it. Only scene.bin's arrays come here, which
// never change: a shared buffer is never updated, an edit brings arrays of new names. What a run deforms it replaces on
// its own geometry (setVerticesData), and index buffers stay each geometry's own, as Babylon keeps CPU indices
// (picking, sub-mesh bounds) only with an index buffer it made. Babylon itself shares compiled effects and textures
// loaded by URL per engine.
import { Buffer, Geometry, VertexBuffer } from '@babylonjs/core';

/** How many bytes of streams no geometry uses an engine keeps, for a run loaded again or a patch undone. */
export const IDLE_BYTES = 64 * 1024 * 1024;

/** A shared stream's buffer, which throws if drawn once the cache has let go of it (a stale reference). */
class SharedBuffer extends Buffer {
  /** The stream's key once released. */
  released = '';

  getBuffer() {
    if (this.released) throw new Error(`The shared stream ${this.released} is used after it was released`);
    return super.getBuffer();
  }
}

/** One engine's streams by content name and stride. */
class Streams {
  /** @type {Map<string, { buffer: SharedBuffer, users: number, bytes: number }>} */
  entries = new Map();
  /** Unused streams, oldest first. @type {Map<string, { buffer: SharedBuffer, users: number, bytes: number }>} */
  idle = new Map();
  idleBytes = 0;
  uploads = 0;
  failed = 0;

  /** @param {import('@babylonjs/core').AbstractEngine} engine */
  constructor(engine) {
    this.engine = engine;
    // An unused stream is not rebuilt with the context: it is forgotten, and made again when a geometry asks.
    engine.onContextRestoredObservable.add(() => { for (const key of this.idle.keys()) this.entries.delete(key); this.idle.clear(); this.idleBytes = 0; });
  }

  /** @param {string} key @param {ArrayBufferView} data @param {number} size */
  acquire(key, data, size) {
    let stream = this.entries.get(key);
    if (!stream) {
      stream = { buffer: new SharedBuffer(this.engine, /** @type {any} */ (data), false, size, false, false, false, undefined, `Shared_${key}`), users: 0, bytes: data.byteLength };
      this.entries.set(key, stream);
      this.uploads++;
    }
    if (this.idle.delete(key)) this.idleBytes -= stream.bytes;
    stream.users++;
    return stream.buffer;
  }

  /** @param {string} key */
  release(key) {
    const stream = this.entries.get(key);
    if (!stream || --stream.users > 0) return;
    this.idle.set(key, stream);
    this.idleBytes += stream.bytes;
    for (const [oldest, unused] of this.idle) {
      if (this.idleBytes <= IDLE_BYTES) break;
      unused.buffer.dispose();
      unused.buffer.released = oldest;
      this.idle.delete(oldest);
      this.entries.delete(oldest);
      this.idleBytes -= unused.bytes;
    }
  }
}

/** @type {WeakMap<import('@babylonjs/core').AbstractEngine, Streams>} */
const engines = new WeakMap();
/** @param {import('@babylonjs/core').AbstractEngine} engine */
function streamsOf(engine) {
  let streams = engines.get(engine);
  if (!streams) engines.set(engine, (streams = new Streams(engine)));
  return streams;
}

/** The streams an engine holds: in use, unused and kept, how many it has uploaded, and their buffers. @param {import('@babylonjs/core').AbstractEngine} engine */
export function sharedStreams(engine) {
  const { entries, idle, idleBytes, uploads } = streamsOf(engine);
  return { used: entries.size - idle.size, idle: idle.size, idleBytes, uploads, buffers: [...entries.values()].map((stream) => stream.buffer) };
}

/**
 * A run's sharing in one line, for a page or the Game header: the shared streams it draws, the streams it deforms
 * itself, any it draws that the cache let go of, and the engine's failures to share.
 * @param {import('@babylonjs/core').Scene} scene
 */
export function sharedStatus(scene) {
  const shared = new Set();
  let live = 0, poisoned = 0;
  for (const geometry of scene.geometries) for (const vertices of Object.values(geometry.getVertexBuffers() ?? {})) {
    const buffer = vertices.getWrapperBuffer();
    if (buffer instanceof SharedBuffer) { shared.add(buffer); if (buffer.released) poisoned++; } else if (vertices.isUpdatable()) live++;
  }
  return `${shared.size} shared streams, ${live} own live, ${poisoned} poisoned, ${streamsOf(scene.getEngine()).failed} failed`;
}

/** A geometry whose vertex streams are the engine's shared ones, let go of as it is disposed or its scene is. */
class SharedGeometry extends Geometry {
  /** @type {string[]} */
  #held = [];
  /** @type {Streams} */
  #streams;
  #sceneDisposed;

  /** @param {string} id @param {import('@babylonjs/core').Scene} scene */
  constructor(id, scene) {
    super(id, scene);
    this.#streams = streamsOf(scene.getEngine());
    // A geometry no mesh uses is not disposed with its scene.
    this.#sceneDisposed = scene.onDisposeObservable.addOnce(() => this.#release());
  }

  /** @param {string} kind @param {string} name scene.bin's array @param {ArrayBufferView} data @param {number} size */
  share(kind, name, data, size) {
    const key = `${name}/${size}`, buffer = this.#streams.acquire(key, data, size);
    this.#held.push(key);
    this.setVerticesBuffer(new VertexBuffer(this.getEngine(), buffer, kind, { updatable: false, stride: size, label: `Geometry_${this.id}_${kind}` }));
  }

  dispose() {
    super.dispose();
    this.#release();
  }

  #release() {
    this.getScene().onDisposeObservable.remove(this.#sceneDisposed);
    for (const key of this.#held.splice(0)) this.#streams.release(key);
  }
}

/**
 * A geometry from its vertex buffers by kind (`[size, buffer]`) and its indices, arrays of scene.bin: its vertex
 * streams shared with every scene on the engine that loads the same arrays, its index buffer its own. A failure lets
 * go of what it took and asks for the run to be loaded again (`reload`), never a run half shared.
 * @param {import('@babylonjs/core').Scene} scene @param {{ vertices: Record<string, [number, string]>, indices?: string }} entry
 * @param {string} key @param {import('./buffers.js').Buffers} buffers
 */
export function sharedGeometry(scene, { vertices, indices }, key, buffers) {
  const made = new SharedGeometry(key, scene);
  try {
    for (const [kind, [size, buffer]] of Object.entries(vertices)) made.share(kind, buffer, /** @type {any} */ (buffers[buffer]), size);
  } catch (error) {
    made.dispose();
    streamsOf(scene.getEngine()).failed++;
    throw Object.assign(/** @type {Error} */ (error), { reload: true });
  }
  if (indices !== undefined) made.setIndices(/** @type {any} */ (buffers[indices]));
  return made;
}

/** @typedef {{ ir: any, buffers: import('./buffers.js').Buffers }} PackageData */
/** Each package version's data, while it is read and then while a run holds its IR. @type {Map<string, Promise<PackageData> | WeakRef<any>>} */
const packages = new Map();
/** A package's arrays by its IR. @type {WeakMap<any, import('./buffers.js').Buffers>} */
const arraysOf = new WeakMap();

/** An object and all it holds made read-only; typed arrays cannot be, and are read-only by contract. @param {any} value */
function freeze(value) {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value) || ArrayBuffer.isView(value)) return value;
  for (const item of Object.values(value)) freeze(item);
  return Object.freeze(value);
}

/**
 * A package version's data, read once for every run of it on the page: `read` reads it when no run holds it. The IR
 * is frozen; each run gets its own table of the shared arrays, which its patches change.
 * @param {string} version the package's URL with its version @param {() => Promise<PackageData>} read
 * @returns {Promise<PackageData>}
 */
export async function sharedPackage(version, read) {
  const held = packages.get(version);
  let ir = held instanceof WeakRef ? held.deref() : (await held)?.ir;
  if (!ir) {
    const reading = read().then((data) => { arraysOf.set(freeze(data.ir), data.buffers); return data; });
    packages.set(version, reading);
    try { ir = (await reading).ir; } catch (error) { packages.delete(version); throw error; }
    packages.set(version, new WeakRef(ir));
  }
  return { ir, buffers: { .../** @type {import('./buffers.js').Buffers} */ (arraysOf.get(ir)) } };
}

/** Each package's IR as readIR makes it, by the IR as read. @type {WeakMap<object, any>} */
const validated = new WeakMap();

/**
 * A run's IR: what `read` (readIR) makes of a package's IR, once for every run of it and frozen, in a view of the run's
 * own: its clock (`scene.time`), entities and their order, which its playhead and scheduler change, and the tables a
 * patch replaces whole.
 * @template {{ scene: { time: object }, entities: object, order: string[] }} IR
 * @param {object} raw the IR as read @param {() => IR} read
 * @returns {IR}
 */
export function sharedIR(raw, read) {
  if (!validated.has(raw)) validated.set(raw, freeze(read()));
  /** @type {IR} */
  const ir = validated.get(raw);
  return { ...ir, scene: { ...ir.scene, time: structuredClone(ir.scene.time) }, entities: { ...ir.entities }, order: [...ir.order] };
}
