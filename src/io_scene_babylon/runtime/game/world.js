// @ts-check
// SPDX-License-Identifier: MIT OR Apache-2.0
// A run of a game (docs/notes/game-code.md): the behaviours added to the scene's objects and the game's systems,
// created over the run's Babylon scene, stepped by the run's clock. Everything a behaviour makes while its code runs is
// disposed with it, its waits never resume once it is gone, and its `state` is handed to the next run of a hot swap.
import { Vector3 } from '@babylonjs/core';
import { propValue } from './define.js';
import { enablePhysics, rigidBody } from './physics.js';

/**
 * The scene a run plays, as game/blend-host.js gives it from a package's controller.
 * @typedef {{
 *   scene: import('@babylonjs/core').Scene,
 *   objects: () => HostObject[],
 *   bodies?: () => HostObject[],
 *   value: (object: string, behavior: string, prop: string) => any,
 *   play?: (action: string, object: string) => void,
 *   playSound?: (sound: string, at?: Entity, options?: { rate?: number, volume?: number }) => void, played?: string[],
 *   spawn?: (collection: string) => HostObject[],
 *   blend?: any,
 * }} Host
 * @typedef {{ key: string, name: string, node: import('@babylonjs/core').TransformNode | null, behaviors: string[], rigid?: Record<string, any> | null }} HostObject
 * @typedef {import('./define.js').Behavior} Behavior
 * @typedef {import('./define.js').System} System
 * @typedef {{ scene: import('@babylonjs/core').Scene, engine: import('@babylonjs/core').AbstractEngine }} Babylon
 * @typedef {{ pressed(action: string): boolean, held(action: string): boolean, stick(action: string): { x: number, y: number }, readonly pointer?: { x: number, y: number } | null, step?: () => void }} Input
 * The project's files a run reads (an Ink story, a GUI layout): `url(path)`, and `text(path)` read.
 * @typedef {{ url(path: string): string, text(path: string): Promise<string> }} Assets
 */

/** Babylon's observables of what a scene gains, each tracked to whose code made it. */
const ADDED = ['onNewMeshAddedObservable', 'onNewTransformNodeAddedObservable', 'onNewLightAddedObservable', 'onNewCameraAddedObservable',
  'onNewMaterialAddedObservable', 'onNewMultiMaterialAddedObservable', 'onNewTextureAddedObservable', 'onNewSkeletonAddedObservable',
  'onNewAnimationGroupAddedObservable', 'onNewGeometryAddedObservable', 'onNewParticleSystemAddedObservable', 'onNewFrameGraphAddedObservable'];
/** A material's colours by the names game code uses, for Babylon's PBR and Standard materials. */
const COLORS = { baseColor: ['albedoColor', 'diffuseColor'], emissionColor: ['emissiveColor'] };
/** Where an entity is in the scene now, its world matrix computed afresh (Babylon updates it only when it draws). @param {any} entity @returns {Vector3} */
const placeOf = (entity) => (entity.node ? entity.node.computeWorldMatrix(true).getTranslation() : entity.position);
/**
 * How far a point is from an entity: from the nearest point of the world box around its node and what it holds, else
 * from its place. @param {any} entity @param {Vector3} point
 */
function distanceToBounds(entity, point) {
  const bounds = entity.node?.getHierarchyBoundingVectors?.(true);
  if (!bounds || !Number.isFinite(bounds.min.x)) return Vector3.Distance(placeOf(entity), point);
  return Vector3.Distance(Vector3.Clamp(point, bounds.min, bounds.max), point);
}

/** A direction on the ground, unit length (zero stays zero). @param {Vector3} v */
const flat = (v) => new Vector3(v.x, 0, v.z).normalize();
/**
 * A stick's `{ x, y }` on the ground as `camera` shows it: x toward the screen's right, y toward its top (forward for a
 * camera behind, up the screen for one looking down); as the scene's x and z without a camera.
 * @param {import('@babylonjs/core').Camera | null | undefined} camera @param {number} x @param {number} y
 */
export function onGround(camera, x, y) {
  if (!camera) return new Vector3(x, 0, y);
  const right = flat(camera.getDirection(Vector3.Right())), up = flat(camera.getDirection(Vector3.Up()).add(camera.getDirection(Vector3.Forward())));
  return right.scale(x).addInPlace(up.scale(y));
}

/** A seeded random in [0, 1) (mulberry32), so a run with the same seed picks the same. @param {number} seed */
function random(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * The run's clock for a behaviour or system.
 * @typedef {{ readonly now: number, wait(seconds: number): Promise<void>, every(seconds: number): boolean, pick<T>(list: T | T[]): T, random(): number }} Time
 * An object of the run as game code reaches it.
 * @typedef {{
 *   key: string, name: string, node: any, readonly position: Vector3, readonly rotation: Vector3, readonly scaling: Vector3,
 *   hide(): void, show(): void, readonly visible: boolean, material(): MaterialHandle, play(action: string): void,
 *   authored: { readonly position: Vector3, material(): { get(name: string): any, readonly baseColor: any } },
 * }} Entity
 * @typedef {{ set(name: string, value: any): void, get(name: string): any, readonly baseColor: any }} MaterialHandle
 * The run, as behaviours and systems reach it.
 * @typedef {{
 *   get(system: System): any, all(behavior: Behavior): any[], near(from: Entity, radius: number, behavior: Behavior, filter?: (handle: any) => boolean): any,
 *   on(behavior: Behavior, event: string, fn: (data: any, from: any) => void): void, emit(target: any, event: string, data?: any): void,
 *   play(sound: string, options?: { at?: Entity, rate?: number, volume?: number }): void, end(result?: any): void,
 *   spawn(collection: string, options?: { at?: Entity, attachTo?: any, jitter?: number }): Entity | null,
 *   camera: { follow(entity: Entity, options?: { pitch?: number, distance?: number, height?: number }): void, controls: boolean, onGround(stick: { x: number, y: number }): Vector3 },
 * }} Game
 */

/**
 * A run of `behaviors` (by name) and the game's systems over `host`.
 * `havok`: Havok's wasm instance, for a game with `physics: 'havok'` (game/physics.js).
 * @param {{ host: Host, behaviors: Behavior[], game?: import('./define.js').GameDefinition, seed?: number, engine?: import('@babylonjs/core').AbstractEngine,
 *   kept?: { states?: Map<string, any>, saved?: Map<string, any> }, input?: Input, assets?: Assets, havok?: any, dev?: boolean, report?: (error: unknown, where: string) => void }} options
 */
export function createWorld({ host, behaviors, game: composition = {}, seed = 1, engine, kept = {}, input = idleInput(), assets = noAssets, havok, dev = true, report = (error, where) => console.error(`${where}:`, error) }) {
  const scene = host.scene, rng = random(seed), babylon = { scene, engine: engine ?? scene.getEngine() };
  // The scene camera's own controls (a page's orbit with the mouse) are off while a game plays: the mouse and keys are
  // the game's. A game turns them on with `game.camera.controls = true`.
  let controls = false;
  const setControls = (/** @type {boolean} */ on) => {
    const camera = scene.activeCamera, canvas = scene.getEngine().getRenderingCanvas?.();
    if (on && canvas) camera?.attachControl(canvas, true);
    else camera?.detachControl();
  };
  setControls(false);
  let now = 0, ended = /** @type {any} */ (undefined), definitions = new Map(behaviors.map((b) => [b.name, b]));
  /** Whose code runs now: what Babylon makes meanwhile is theirs. @type {Owner | null} */
  let owner = null;
  /** @typedef {{ made: Set<{ dispose(): void }>, listeners: Set<() => void>, disposed: boolean, label: string }} Owner */
  /** @type {{ at: number, owner: Owner, resume: () => void }[]} */
  let waits = [];
  /** What the `create`s run since the last start threw. @type {unknown[]} */
  let failures = [];
  const authoredNodes = new Set(scene.getNodes());
  const entities = new Map();
  /** The objects spawned in this run (game.spawn), which the scene does not hold. */
  const spawned = new Set();
  /** @type {Map<string, Instance>} */
  const instances = new Map();
  /** @type {Map<string, { definition: System, owner: Owner, handlers: any }>} */
  const systems = new Map();
  /** @type {Map<string, Set<(data: any, from: any) => void>>} */
  const listeners = new Map();
  /** @typedef {{ key: string, definition: Behavior, entity: any, state: any, owner: Owner, handlers: any }} Instance */

  // A physics body made by game code goes with its owner, as what Babylon makes does.
  const physics = havok ? enablePhysics(scene, havok, (body) => { if (owner && !owner.disposed) owner.made.add(body); }) : null;
  /** The Havok bodies of objects with a rigid body in Blender, the run's own. @param {HostObject[]} objects */
  const bodiesOf = (objects) => { if (physics) for (const o of objects) if (o.rigid && o.node) rigidBody(o.node, o.rigid); };
  bodiesOf(host.bodies?.() ?? []);
  const tracking = ADDED.map((name) => /** @type {any} */ (scene)[name]?.add((/** @type {any} */ made) => { if (owner && !owner.disposed) owner.made.add(made); })).filter(Boolean);
  /** @param {string} label @returns {Owner} */
  const newOwner = (label) => ({ made: new Set(), listeners: new Set(), disposed: false, label });
  /** Runs game code as `who`, reporting what it throws or rejects. @template T @param {Owner} who @param {string} where @param {() => T} fn @returns {T | undefined} */
  function run(who, where, fn) {
    if (who.disposed) return undefined;
    const previous = owner;
    owner = who;
    try {
      const result = fn();
      if (result instanceof Promise) result.catch((error) => report(error, `${who.label} ${where}`));
      return result;
    } catch (error) {
      report(error, `${who.label} ${where}`);
      if (where === 'create') failures.push(error);
      return undefined;
    } finally {
      owner = previous;
    }
  }
  /** @param {Owner} who */
  function release(who) {
    who.disposed = true;
    for (const off of who.listeners) off();
    for (const made of [...who.made].reverse()) { try { made.dispose(); } catch {} }
    who.made.clear();
  }

  /** The run's clock for one owner: its waits end with it. @param {Owner} who @returns {Time} */
  function timeFor(who) {
    const next = new Map();
    return {
      /** Seconds since the run started. */
      get now() { return now; },
      /** Resolves `seconds` later on the run's clock; never, once its behaviour is gone (Reset, hot swap, deleted). @param {number} seconds @returns {Promise<void>} */
      wait: (seconds) => new Promise((resume) => { waits.push({ at: now + Math.max(0, seconds), owner: who, resume }); }),
      /** True once every `seconds`, first after `seconds`. @param {number} seconds */
      every(seconds) {
        const due = next.get(seconds) ?? seconds;
        if (now + 1e-9 < due) { next.set(seconds, due); return false; }
        next.set(seconds, due + seconds);
        return true;
      },
      /** One of `list` (or the value itself), by the run's seeded random. @template T @param {T | T[]} list @returns {T} */
      pick: (/** @type {any} */ list) => (Array.isArray(list) ? list[Math.floor(rng() * list.length)] : list),
      /** A number in [0, 1) from the run's seeded random. */
      random: () => rng(),
    };
  }

  /** An object of the run as game code reaches it: this run's transform, visibility and material. @param {HostObject} object @returns {Entity} */
  function entityOf(object) {
    if (entities.get(object.key)?.node === object.node) return entities.get(object.key);
    const node = object.node, materials = new Map();
    const meshOf = () => /** @type {any} */ (node)?.material !== undefined ? /** @type {any} */ (node) : null;
    /** This entity's own material: the run's copy, made on its first write. @param {boolean} write */
    const material = (write) => {
      const mesh = meshOf(), current = mesh?.material;
      if (!current) throw new Error(`${object.name} has no material`);
      if (!write || materials.has(current)) return current;
      const previous = owner;
      owner = null;
      try {
        const copy = current.clone(`${current.name} (${object.name})`);
        materials.set(copy, current);
        mesh.material = copy;
        return copy;
      } finally {
        owner = previous;
      }
    };
    /** @param {any} m @param {string} name */
    const field = (m, name) => (COLORS[/** @type {keyof typeof COLORS} */ (name)] ?? [name]).find((f) => f in m) ?? name;
    /** @param {any} m @param {string} name */
    const read = (m, name) => { const v = m[field(m, name)]; return v?.asArray ? v.asArray() : v; };
    const entity = {
      key: object.key,
      name: object.name,
      /** The Babylon node that draws the object: all of Babylon's API, this run's. */
      node,
      /** This run's position (Babylon's). */
      get position() { return node?.position ?? Vector3.Zero(); },
      get rotation() { return node?.rotation ?? Vector3.Zero(); },
      get scaling() { return node?.scaling ?? Vector3.One(); },
      /** Hides the object, and takes its rigid body out of the simulation. */
      hide() { node?.setEnabled(false); node?.physicsBody?.dispose(); },
      show() { node?.setEnabled(true); },
      get visible() { return !!node?.isEnabled(); },
      /** This object's material in this run: `set` copies it on its first write, so other objects and the .blend keep theirs. */
      material: () => ({
        /** @param {string} name @param {any} value */
        set(name, value) {
          const m = material(true), f = field(m, name), target = m[f];
          if (target?.copyFromFloats && Array.isArray(value)) target.copyFromFloats(value[0], value[1], value[2]);
          else m[f] = value;
        },
        /** @param {string} name */
        get: (name) => read(material(false), name),
        get baseColor() { return read(material(false), 'baseColor'); },
      }),
      /** Plays one of the .blend's actions on this object. @param {string} action */
      play(action) { host.play?.(action, object.key); },
      /** The object as the run started from it, as authored: what Reset returns to. */
      authored: {
        position: node?.position?.clone() ?? Vector3.Zero(),
        material: () => {
          const m = materials.get(meshOf()?.material) ?? meshOf()?.material;
          return { get: (/** @type {string} */ name) => read(m, name), get baseColor() { return read(m, 'baseColor'); } };
        },
      },
    };
    if (dev) guardShared(node, () => owner !== null);
    entities.set(object.key, entity);
    return entity;
  }

  /** Props read live from the .blend's values: an edit in Blender shows at the next read. @param {HostObject} object @param {Behavior} definition */
  const propsOf = (object, definition) => new Proxy({}, {
    get: (_, name) => (typeof name === 'string' && definition.props?.[name] ? propValue(definition.props[name], host.value(object.key, definition.name, name)) : undefined),
    ownKeys: () => Object.keys(definition.props ?? {}),
    getOwnPropertyDescriptor: (_, name) => (typeof name === 'string' && definition.props?.[name] ? { enumerable: true, configurable: true, value: undefined } : undefined),
  });
  /** @param {Owner} who @returns {Game} */
  const gameFor = (who) => ({
    /** A system of the run. @param {System} system */
    get: (system) => systems.get(system.name)?.handlers,
    /** Every instance of a behaviour. @param {Behavior} behavior */
    all: (behavior) => [...instances.values()].filter((i) => i.definition.name === behavior.name).map((i) => i.handlers),
    /**
     * The instance of `behavior` nearest to `entity` within `radius` metres of its bounds (the nearest point of the box
     * around it and what it holds, as an engine measures an interaction range), passing `filter`, if any.
     * @param {Entity} from @param {number} radius @param {Behavior} behavior @param {(handle: any) => boolean} [filter]
     */
    near(from, radius, behavior, filter = () => true) {
      const at = placeOf(from);
      let best = null, bestDistance = radius;
      for (const i of instances.values()) {
        if (i.definition.name !== behavior.name || i.entity === from || !filter(i.handlers)) continue;
        const d = distanceToBounds(i.entity, at);
        if (d <= bestDistance) [best, bestDistance] = [i.handlers, d];
      }
      return best;
    },
    /** Hears `event` from every instance of `behavior` while the listener's owner lives. @param {Behavior} behavior @param {string} event @param {(data: any, from: any) => void} fn */
    on(behavior, event, fn) {
      const key = `${behavior.name}:${event}`;
      if (!listeners.has(key)) listeners.set(key, new Set());
      const bound = (/** @type {any} */ data, /** @type {any} */ from) => run(who, `on ${key}`, () => fn(data, from));
      listeners.get(key)?.add(bound);
      who.listeners.add(() => listeners.get(key)?.delete(bound));
    },
    /** Sends `event` to one instance: its handler of that name receives `data`. @param {any} target @param {string} event @param {any} [data] */
    emit(target, event, data) {
      const instance = [...instances.values()].find((i) => i.handlers === target);
      if (instance && typeof instance.handlers[event] === 'function') run(instance.owner, event, () => instance.handlers[event](data));
    },
    /** Plays a sound, at an entity's place where given, at a rate (1 as recorded, 2 an octave up) and a volume. @param {string} sound @param {{ at?: Entity, rate?: number, volume?: number }} [options] */
    play: (sound, options) => host.playSound?.(sound, options?.at, options),
    /** The game's camera: `follow(entity, { pitch, distance, height })` follows a Character from above and behind. */
    camera: {
      follow: (entity, options) => /** @type {any} */ (entity).character?.follow?.(options),
      /** Whether the scene camera's own controls (orbit, zoom) take the mouse; off while a game plays unless it sets them. */
      get controls() { return controls; },
      set controls(on) { setControls((controls = !!on)); },
      /** A stick's `{ x, y }` as a direction on the ground, as the camera shows it: x right, y up the screen. */
      onGround: (stick) => onGround(scene.activeCamera, stick.x, stick.y),
    },
    /** Ends the run with a result (`world.ended`). @param {any} result */
    end(result) { if (ended === undefined) ended = result ?? null; },
    /**
     * A copy of a collection (a prefab) for this run, with its behaviours fresh: placed at an entity (spread by `jitter`
     * metres), or parented to a node or bone. It belongs to the run, not to the code that made it: gone on Reset.
     * @param {string} collection @param {{ at?: Entity, attachTo?: any, jitter?: number }} [options]
     */
    spawn(collection, { at, attachTo, jitter = 0 } = {}) {
      const previous = owner;
      owner = null;
      try {
        const made = host.spawn?.(collection) ?? [];
        for (const object of made) spawned.add(object.key);
        const root = made.find((o) => !made.some((p) => p.node === o.node?.parent))?.node;
        if (!root) return null;
        if (attachTo) root.parent = attachTo.node ?? attachTo;
        else if (at) root.setAbsolutePosition(placeOf(at));
        if (jitter) root.position.addInPlaceFromFloats((rng() - 0.5) * 2 * jitter, 0, (rng() - 0.5) * 2 * jitter);
        bodiesOf(made);
        for (const object of made) for (const name of object.behaviors) { const d = definitions.get(name); if (d && !instances.has(`${object.key}/${name}`)) createInstance(object, d); }
        return entityOf(made.find((o) => o.node === root) ?? made[0]);
      } finally {
        owner = previous;
      }
    },
  });

  /** @param {HostObject} object @param {Behavior} definition */
  function createInstance(object, definition) {
    const key = `${object.key}/${definition.name}`, who = newOwner(`${definition.name} on ${object.name}`);
    const entity = entityOf(object), state = kept.states?.get(key) ?? {};
    const instance = /** @type {Instance} */ ({ key, definition, entity, state, owner: who, handlers: {} });
    const self = { emit: (/** @type {string} */ event, /** @type {any} */ data) => listeners.get(`${definition.name}:${event}`)?.forEach((fn) => fn(data, instance.handlers)) };
    const context = { entity, props: propsOf(object, definition), state, game: gameFor(who), time: timeFor(who), input, assets, babylon, blend: host.blend };
    const handlers = run(who, 'create', () => definition.create.call(self, context)) ?? {};
    for (const [name, value] of Object.entries({ entity, state, props: context.props, behavior: definition.name }))
      Object.defineProperty(handlers, name, { value, enumerable: false, configurable: true });
    instance.handlers = handlers;
    instances.set(key, instance);
  }
  /** @param {Instance} instance */
  function disposeInstance(instance) {
    run(instance.owner, 'dispose', () => instance.handlers.dispose?.());
    release(instance.owner);
    instances.delete(instance.key);
    for (const child of instance.entity.node?.getDescendants?.(false) ?? []) if (!authoredNodes.has(child) && !child.isDisposed()) child.dispose();
  }

  /** @param {{ owner: Owner, handlers: any }} system */
  function disposeSystem(system) {
    run(system.owner, 'dispose', () => system.handlers.dispose?.());
    release(system.owner);
  }
  /** @param {System} definition */
  function createSystem(definition) {
    const who = newOwner(definition.name);
    const props = new Proxy({}, { get: (_, name) => (typeof name === 'string' && definition.props?.[name] ? definition.values?.[name] ?? definition.props[name].default : undefined) });
    const handlers = run(who, 'create', () => definition.create({ props, game: gameFor(who), time: timeFor(who), input, assets, babylon, blend: host.blend, saved: kept.saved?.get(definition.name) })) ?? {};
    systems.set(definition.name, { definition, owner: who, handlers });
  }

  function start() {
    for (const system of composition.systems ?? []) createSystem(system);
    for (const object of host.objects()) for (const name of object.behaviors) {
      const definition = definitions.get(name);
      if (definition) createInstance(object, definition);
    }
  }

  /** Waits due by now resume in time order, each as its owner's code. */
  async function resumeWaits() {
    for (;;) {
      waits.sort((a, b) => a.at - b.at);
      const due = waits[0];
      if (!due || due.at > now + 1e-9) return;
      waits.shift();
      if (due.owner.disposed) continue;
      const previous = owner;
      owner = due.owner;
      due.resume();
      // The resumed code runs on the microtasks after resume(), still as its owner.
      for (let i = 0; i < 4; i++) await null;
      owner = previous;
    }
  }

  const ordered = () => [...instances.values()].sort((a, b) => (a.definition.phase === 'late' ? 1 : 0) - (b.definition.phase === 'late' ? 1 : 0));
  return {
    game: gameFor(newOwner('game')),
    timeFor,
    entityOf,
    /** The run's result once a system ended it, else undefined. */
    get ended() { return ended; },
    get now() { return now; },
    /** The behaviours' instances, by `objectKey/Behavior`. */
    instances,
    start,
    /** Advances the run by `dt` seconds: waits due resume, physics steps, then each behaviour's and system's `update`. @param {number} dt */
    async step(dt) {
      if (ended !== undefined) return;
      now += dt;
      input.step?.();
      await resumeWaits();
      physics?.step(dt);
      for (const i of ordered()) if (instances.has(i.key) && typeof i.handlers.update === 'function') run(i.owner, 'update', () => i.handlers.update(dt));
      for (const s of systems.values()) if (typeof s.handlers.update === 'function') run(s.owner, 'update', () => s.handlers.update(dt));
    },
    /** What a hot swap carries to the next run: each instance's state and each system's save(). */
    keep: () => ({ states: new Map([...instances].map(([key, i]) => [key, i.state])), saved: new Map([...systems].map(([name, s]) => [name, s.handlers.save?.()])) }),
    /**
     * Swaps in new definitions: every instance and system made again from them, with the same state. Where a `create`
     * throws, the run goes back to the definitions it had, its state as it was, and the errors are returned.
     * @param {Behavior[]} next @param {import('./define.js').GameDefinition} [nextGame] @returns {unknown[]}
     */
    swap(next, nextGame = composition) {
      const carried = this.keep(), previous = /** @type {const} */ ([definitions, composition]);
      /** @param {Map<string, Behavior>} defs @param {import('./define.js').GameDefinition} game @param {boolean} copies */
      const attempt = (defs, game, copies) => {
        for (const i of [...instances.values()]) disposeInstance(i);
        for (const s of systems.values()) disposeSystem(s);
        systems.clear();
        waits = [];
        // A trial gets copies of the states, so one that fails leaves them as they were.
        kept = copies ? { ...carried, states: new Map([...carried.states].map(([key, state]) => [key, { ...state }])) } : carried;
        [definitions, composition, failures] = [defs, game, []];
        start();
        return failures;
      };
      const failed = attempt(new Map(next.map((b) => [b.name, b])), nextGame, true);
      if (failed.length) attempt(...previous, false);
      return failed;
    },
    /** Adds the behaviours of an object that appeared (spawned, duplicated while playing), with fresh state. @param {HostObject} object */
    added(object) { for (const name of object.behaviors) { const d = definitions.get(name); if (d && !instances.has(`${object.key}/${name}`)) createInstance(object, d); } },
    /** Disposes the behaviours of an object that went. @param {string} key */
    removed(key) { for (const i of [...instances.values()]) if (i.entity.key === key) disposeInstance(i); },
    /**
     * Follows the scene after an edit reached the run: behaviours of objects that appeared (Shift D: props copied, state
     * fresh) are created, those of objects or behaviours that went are disposed.
     */
    sync() {
      const objects = host.objects(), present = new Set(objects.flatMap((o) => o.behaviors.map((b) => `${o.key}/${b}`)));
      for (const i of [...instances.values()]) if (!present.has(i.key) && !spawned.has(i.entity.key)) disposeInstance(i);
      for (const object of objects) this.added(object);
    },
    dispose() {
      for (const i of [...instances.values()]) disposeInstance(i);
      for (const s of systems.values()) disposeSystem(s);
      systems.clear();
      waits = [];
      tracking.forEach((observer, i) => /** @type {any} */ (scene)[ADDED.filter((n) => /** @type {any} */ (scene)[n])[i]]?.remove(observer));
      physics?.dispose();
    },
  };
}

/** A run without project files. @type {Assets} */
const noAssets = { url: (path) => path, text: async (path) => { throw new Error(`No project file ${path} in this run`); } };

/** Input that presses nothing, for a run without a player. @returns {Input} */
export const idleInput = () => ({ pressed: () => false, held: () => false, stick: () => ({ x: 0, y: 0 }), pointer: null });

/**
 * Development's read-only rule on what an object shares: game code writing a geometry other objects draw throws, naming
 * the copy to make first. @param {any} node @param {() => boolean} inGameCode
 */
function guardShared(node, inGameCode) {
  if (!node?.getClassName || !('geometry' in node)) return;
  for (const method of ['setVerticesData', 'updateVerticesData', 'setIndices']) {
    const own = node[method];
    if (typeof own !== 'function') continue;
    node[method] = function (/** @type {any[]} */ ...args) {
      const others = (this.geometry?.meshes?.length ?? 1) - 1;
      if (others > 0 && inGameCode()) throw new Error(`This geometry is shared with ${others} other object${others === 1 ? '' : 's'}; call mesh.makeGeometryUnique() first.`);
      return own.apply(this, args);
    };
  }
}
