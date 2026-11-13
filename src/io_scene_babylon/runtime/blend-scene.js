// @ts-check
// SPDX-License-Identifier: MIT OR Apache-2.0
// A scene exported from Bylonder, with its controls: the IR's properties (docs/ir.md), each a Blender RNA path from
// bpy.data (`objects["Cube"].location[0]`) whose value the page sets, and which lands on the Babylon objects it binds to.
import { AbstractMesh, BoundingInfo, Matrix, Observable, Quaternion, Texture, Vector3 } from '@babylonjs/core';
import { createScheduler, EVALUATORS, NATIVE } from './scheduler.js';
import { TABLES } from './scene-tables.js';
import { nodeById } from '../../overrides/babylon/clustered-lights.js';
import { readEntries, readIR, referencesIn } from './ir.js';
import { createPlayhead } from './playhead.js';
import { createClips, isClip } from './clips.js';
import { collectionKey, collectionTree, objectsIn, showing } from './collections.js';
import { useDualQuaternionSkinning } from './dual-quaternion-skinning.js';

// A 32-bit float's step at 1.
const FLOAT_EPSILON = 1.1920928955078125e-7;

/** @typedef {number | boolean | string} Value */
/** A sequencer sound strip as a page plays it (BlendScene.sounds). @typedef {{ url: string, start: number, offset: number, duration: number, channel: number, volume: number, mute: boolean }} Sound */

/**
 * A control as Blender's RNA describes its property: its type, default and UI range, subtype and unit, and whether the
 * export suggests it to authors and UIs.
 * @typedef {object} Control
 * @property {string} path
 * @property {'FLOAT' | 'INT' | 'BOOLEAN' | 'STRING'} type
 * @property {Value} default
 * @property {number} [soft_min]
 * @property {number} [soft_max]
 * @property {string} [subtype]
 * @property {string} [unit]
 * @property {boolean} [suggested]
 * @property {string} [name] Blender's UI name (a socket's name, a custom property's key)
 * @property {Value} [blender_default] the value Blender gives it new, where known
 * @property {number} [hard_min]
 * @property {number} [hard_max]
 * @property {number} [step] RNA's step: a hundredth of the value for a float
 * @property {number} [precision]
 */

/**
 * How an object's location, rotation and scale place its node: Blender's rotation mode; the parent inverse matrix
 * (Babylon's axes) when not the identity; a turn (x, y, z, w) before the object's own, a camera's to look along +Z or an
 * area light's rig's to hold its rectangle in its XY plane; for a light, the local direction the rotation turns into its
 * `direction` (null for a point light, which has none).
 * @typedef {object} Transform
 * @property {string} mode
 * @property {number[]} [parent_inverse]
 * @property {number[]} [offset]
 * @property {number[] | null} [direction]
 */

/**
 * Where a control's value lands: a property of a node (by id) or of the scene, scaled by `factor`; the node's place
 * (`transform`); visibility (`hide`); a focal length as a field of view (`lens`: half the sensor's fitted size); or a
 * node material's InputBlock (`material` and `block`, and the `component` of a vector) or ImageSourceBlock (`image`: the
 * value is the image's URL, relative to the package) or a material's own `property`; the scene's animation at a frame
 * (`frame`); or a compositor pass (`compositor`, the block's name): one of its
 * uniforms (`uniform`, `component`) or a float its plan uploads (`upload`, its offset in the plan's data).
 * @typedef {object} Binding
 * @property {string} [node]
 * @property {string} [material]
 * @property {string} [block]
 * @property {number} [component]
 * @property {boolean} [image]
 * @property {boolean} [world] the world's Background color or strength (world.js)
 * @property {boolean} [frame]
 * @property {string} [compositor]
 * @property {number} [uniform]
 * @property {number} [upload]
 * @property {string} [property]
 * @property {number} [factor]
 * @property {Transform} [transform]
 * @property {'viewport' | 'render'} [hide]
 * @property {number} [lens]
 * @property {string} [morph] a morph target's name in its node's MorphTargetManager, whose influence it sets
 * @property {string} [channel] the key in its node's `metadata.bylonderChannels` the scene's animation sets it through
 * @property {string} [collection] a collection's visibility flag or time offset: the key of the collection it sets
 * @property {boolean} [offset] a collection's time offset (Bylonder's own): frames its objects' animation plays later
 */

/**
 * A collection of the scene (docs/ir.md, Collections): its key and Blender data, its place in the tree, and whether it
 * shows (neither it nor a collection holding it excluded or hidden).
 * @typedef {import('./ir.js').Collection & { key: string, parent: string | null, depth: number, all_objects: string[], visible: boolean }} CollectionInfo
 */

/** @typedef {Control & { bind?: Binding }} Knob */

/** @typedef {{ path: string, value: Value }} Change */

/**
 * Blender's rotation of a mode as a quaternion (w, x, y, z), normalized as Blender uses it: an Euler mode turns about
 * its first axis first.
 * @param {string} mode
 * @param {number[]} values
 */
function blenderQuaternion(mode, values) {
  if (mode === 'QUATERNION') {
    const length = Math.hypot(...values) || 1;
    return values.map((v) => v / length);
  }
  /** @type {number[]} */
  let q = [1, 0, 0, 0];
  for (const letter of mode) {
    const axis = 'XYZ'.indexOf(letter), half = values[axis] / 2, turn = [Math.cos(half), 0, 0, 0];
    turn[axis + 1] = Math.sin(half);
    const [w, x, y, z] = q, [tw, tx, ty, tz] = turn;
    q = [tw * w - tx * x - ty * y - tz * z, tw * x + tx * w + ty * z - tz * y, tw * y - tx * z + ty * w + tz * x, tw * z + tx * y - ty * x + tz * w];
  }
  return q;
}

/**
 * Blender's rotation of a mode as Babylon's quaternion: Babylon's (x, y, z) is Blender's (x, z, y), its rotations
 * turning the other way.
 * @param {string} mode
 * @param {number[]} values
 */
export function babylonRotation(mode, values) {
  const [w, x, y, z] = blenderQuaternion(mode, values);
  return new Quaternion(-x, -z, -y, w);
}

/**
 * Where an object's location, rotation and scale place its node, as Blender's matrix_world of an object without
 * constraints: the parent's, its parent inverse, then its own; for a light, its direction.
 * @param {Transform} transform
 * @param {(name: string, count: number) => number[]} vector the object's value of a property (`location`, 3)
 */
export function placement({ mode, parent_inverse, offset, direction }, vector) {
  const [x, y, z] = vector('location', 3), [sx, sy, sz] = vector('scale', 3);
  const position = new Vector3(x, z, y), scaling = new Vector3(sx, sz, sy);
  const rotation = babylonRotation(mode, vector(mode === 'QUATERNION' ? 'rotation_quaternion' : 'rotation_euler', mode === 'QUATERNION' ? 4 : 3));
  if (offset || parent_inverse) {
    let matrix = Matrix.Compose(scaling, rotation, position);
    if (offset) matrix = Quaternion.FromArray(offset).toRotationMatrix(new Matrix()).multiply(matrix);
    if (parent_inverse) matrix = matrix.multiply(Matrix.FromArray(parent_inverse));
    matrix.decompose(scaling, rotation, position);
  }
  return { position, rotation, scaling, direction: direction ? Vector3.FromArray(direction).applyRotationQuaternion(rotation) : null };
}

/**
 * A bone's local matrix from its pose's location, rotation and scale, as Blender's pose of a bone without constraints:
 * its rest matrix relative to its parent's (Babylon's Bone.getRestMatrix), after the pose's own.
 * @param {Transform} transform
 * @param {(name: string, count: number) => number[]} vector the pose bone's value of a property (`location`, 3)
 * @param {Matrix} rest
 */
export function posedBone(transform, vector, rest) {
  const { position, rotation, scaling } = placement(transform, vector);
  return Matrix.Compose(scaling, rotation, position).multiply(rest);
}

/**
 * Sets the dotted `path` of `owner` to `value`.
 * @param {any} owner
 * @param {string} path
 * @param {Value} value
 */
function assign(owner, path, value) {
  const keys = path.split('.'), last = /** @type {string} */ (keys.pop());
  keys.reduce((o, key) => o[key], owner)[last] = value;
}

/**
 * Hides a mesh alone, as Blender hides an object and not its children, or another node (a light: its light is off) with
 * its children. @param {any} node @param {boolean} hidden
 */
function hide(node, hidden) {
  if (node instanceof AbstractMesh) node.isVisible = !hidden;
  else node.setEnabled(!hidden);
}

// The tables a patch reaches: the scene's objects (scene-tables.js) and the IR's IDs, collections and properties (its
// references are what the export follows; the page reads none).
const IR_TABLES = new Set(['ids', 'collections', 'properties', 'graphs']);
// The tables whose objects a rig's runtime holds, and the implementations that hold them.
const REMADE = ['skeletons', 'morphTargets', 'nodes', 'geometries'], RIGS = ['pose', 'pose-kernels', 'native-rig'];
// A buffer's key as entries name it (scene-bin.js contentKey).
const BUFFER_KEY = /"((?:f32|u16|u32|i32|u8|i8|i16)\.[0-9a-z]+)"/g;
const PATCHED = new Set([...TABLES, 'animations', 'references', 'entities', 'irScene', 'sampleRates', ...IR_TABLES]);
// What of the scene's time a patch may change in place (the clips' ranges, the markers; what is baked has a table of
// its own): the rest (its range, rate and loop, which the playhead runs on) loads the package again.
const RETIMED = ['clips', 'markers'], CLOCK = ['frame_start', 'frame_end', 'fps', 'fps_base', 'loop'];

/**
 * The exported scene and its controls.
 * @template {Record<string, Value>} [Controls=Record<string, Value>]
 */
export class BlendScene {
  /** Told of each control's new value. @type {Observable<Change>} */
  onChanged = new Observable();
  /** @type {Map<string, Knob>} */
  #knobs;
  /** @type {Map<string, Value>} */
  #values;
  /** The scene's tables and what they made (scene-tables.js), which a patch changes. @type {ReturnType<typeof import('./scene-tables.js').sceneTables> | undefined} */
  #tables;
  /** Loads the package again in place of this scene. @type {(old: BlendScene<any>) => Promise<BlendScene<any>>} */
  #reload;

  /** @type {string} */
  #root;

  /** @type {{ set(color: number[]): void } | undefined} */
  #world;

  /** @type {() => void} */
  #disposeContent;


  /**
   * @param {import('@babylonjs/core').Scene} scene
   * @param {any} ir the scene's IR (scene.ir.json), read with readIR
   * @param {{ root?: string, world?: { set(color: number[]): void }, compositor?: import('@babylonjs/core').NodeRenderGraph,
   *   buffers?: import('./buffers.js').Buffers, entries?: import('./asset.js').Entries, dispose?: () => void,
   *   tables?: ReturnType<typeof import('./scene-tables.js').sceneTables>, reload?: (old: BlendScene<any>) => Promise<BlendScene<any>> }} [options]
   * the package's URL, which relative image URLs resolve against, the world of one color its background controls set
   * (world.js), the compositor its pass controls set (bylonder-blocks.js), scene.bin's buffers, which its entities
   * read; loaded into a scene of the page's own, what was added there and what removes it (asset.js); the scene's tables,
   * which `patch` changes, and what loads the package again in its place
   */
  constructor(scene, ir, { root = '', world, compositor, buffers = {}, entries, dispose = () => scene.dispose(), tables, reload } = {}) {
    this.#tables = tables;
    this.#reload = reload ?? (() => Promise.reject(new Error('This scene cannot load its package again')));
    /** Babylon's scene: loaded into a scene of the page's own, a view of it that holds what was loaded alone. */
    this.scene = scene;
    /** Loaded into a scene of the page's own: what was added there, as ImportMeshAsync gives a .glb's (meshes[0] the root). */
    this.entries = entries;
    this.#disposeContent = dispose;
    this.#root = root;
    this.#world = world;
    /** The compositor, a NodeRenderGraph of the blocks library's passes, when the scene composites. */
    this.compositor = compositor;
    /** scene.bin's arrays, which the IR's `{ buffer }` inputs name. */
    this.buffers = buffers;
    /** The scene's IR, as this runtime reads it. */
    this.ir = readIR(ir, { implementations: [...Object.keys(EVALUATORS), ...NATIVE] });
    const knobs = Object.entries(this.ir.properties).map(([path, { id, ...property }]) => /** @type {Knob} */ ({ path, ...property }));
    this.#knobs = new Map(knobs.map((knob) => [knob.path, knob]));
    this.#values = new Map(knobs.map((knob) => [knob.path, knob.default]));
    /** The scene's one clock: its frame, which the animation and what reads the frame follow. */
    this.playhead = createPlayhead(scene, this.ir.scene.time);
    const { fps, fps_base, frame_start, sounds } = this.ir.scene.time, seconds = (/** @type {number} */ frames) => (frames * fps_base) / fps;
    /**
     * The scene's sequencer sound strips by name, as a page plays them: the sound's URL, when the strip starts (seconds
     * after the scene's first frame), where in the decoded sound it starts (its start offset after the file's encoder
     * delay) and how long it plays, in seconds; its channel, volume and whether it is muted. @type {Record<string, Sound>}
     */
    this.sounds = Object.fromEntries(sounds.map((s) => [s.name, { url: new URL(s.file, root || globalThis.location?.href).href, start: seconds(s.frame_final_start - frame_start),
      offset: s.delay + seconds(s.frame_offset_start), duration: seconds(s.frame_final_end - s.frame_final_start), channel: s.channel, volume: s.volume, mute: s.mute }]));
    // Meshes the export skins with dual quaternions (Preserve Volume, armature.js).
    for (const mesh of scene.meshes) if (mesh.metadata?.bylonderDualQuaternions) useDualQuaternionSkinning(mesh, true);
    // A skinned mesh's bounds over its clips' poses (armature.js clipBounds), so it is culled where it can be.
    for (const mesh of scene.meshes) {
      const bounds = mesh.metadata?.bylonderBounds;
      if (bounds) mesh.setBoundingInfo(new BoundingInfo(Vector3.FromArray(bounds[0]), Vector3.FromArray(bounds[1])));
    }
    this.#clips = createClips(scene, this.ir.scene.time, this.playhead, (path, value) => this.set(path, value));
    /** Told of each marker passed: the scene's as the playhead plays past it, an action's as its clip does. */
    this.onMarker = this.#clips.onMarker;
    const frameControl = knobs.find((knob) => knob.bind?.frame)?.path;
    // The frame control shows the playhead's whole frame, as Blender's frame_current does.
    if (frameControl) this.playhead.onChanged.add(({ frame }) => {
      if (Math.floor(frame) === this.#values.get(frameControl)) return;
      this.#values.set(frameControl, Math.floor(frame));
      this.onChanged.notifyObservers({ path: frameControl, value: Math.floor(frame) });
    });
    this.#scheduler = Object.keys(this.ir.entities).length ? createScheduler(this.ir, { scene, root, ir: this.ir, buffers, controls: {
      get: (path) => this.#values.get(path),
      // A property a started clip keys is the clip's: the timeline's curves do not write it meanwhile.
      write: (path, value) => { if (!this.#clips?.holds(path)) this.#write(path, value); },
      set: (path, value) => { this.#write(path, value); this.#scheduler?.changed(path); },
      frame: (/** @type {string | undefined} */ id) => this.playhead.frameAt(id ? this.#idOffset(id) : 0),
    } }) : null;
    this.#channels(knobs);
    this.#indexKnobs();
    this.playhead.offsetOf = (/** @type {any} */ target) => this.#targetOffsets.get(target) ?? 0;
    this.#retime();
    this.#hiddenAtExport = new Set([...showing(this.ir, (key, flag) => this.#flag(key, flag))].filter(([, shown]) => !shown).map(([object]) => object));
    // The app's viewport draws what Disable in Renders hides; the page shows what Blender renders.
    this.#showObjects([...this.#hiddenAtExport, ...Object.keys(this.ir.ids).filter((key) => this.ir.ids[key].data?.hide_render === true)]);
    if (this.#animated()) this.playhead.play();
  }

  /** Whether the scene moves with its frame: a range of frames, and an animation or what reads the frame. */
  #animated() {
    const { frame_start, frame_end } = this.ir.scene.time;
    return frame_end > frame_start && (this.scene.animationGroups.some((group) => !isClip(group))
      || Object.values(this.ir.entities).some((e) => [...referencesIn(e.inputs)].some(([ref]) => 'property' in ref && ref.property.endsWith('.frame_current'))));
  }

  /** @type {ReturnType<typeof createClips>} */
  #clips;

  /**
   * The clips (docs/ir.md, Clips): an animation group per Blender action exported with Animations set to Clips or Both,
   * named by the action, each with Babylon's group.
   */
  clips() {
    return this.#clips.list();
  }

  /**
   * Plays a clip from its start on Babylon's clock, as a .glb's animation group plays.
   * @param {string} name
   * @param {import('./clips.js').PlayOptions} [options]
   */
  play(name, options) {
    return this.#clips.play(name, options);
  }

  /** Stops a clip. @param {string} name */
  stop(name) {
    this.#clips.stop(name);
  }

  /** Sets a clip's weight, its share where clips blend. @param {string} name @param {number} weight */
  setWeight(name, weight) {
    this.#clips.setWeight(name, weight);
  }

  /**
   * Fades from one clip to another over `seconds`; resolves when done.
   * @param {string} from
   * @param {string} to
   * @param {number} seconds
   * @param {import('./clips.js').PlayOptions} [options] how `to` plays
   */
  crossFade(from, to, seconds, options) {
    return this.#clips.crossFade(from, to, seconds, options);
  }

  /** The objects their collections hid at export. */
  /** @type {Set<string>} */
  #hiddenAtExport;

  /** The path of each collection's time offset, by key. @type {Map<string, string>} */
  #offsetPaths = new Map();
  /** Each object's time offset by key, and each animated Babylon target's. @type {Map<string, number>} */
  #objectOffsets = new Map();
  /** @type {Map<any, number>} */
  #targetOffsets = new Map();

  /**
   * The frames an object (by key or name) plays its animation later: its collections' time offsets added up from the
   * scene collection down. An object in several collections takes the first of them in the outliner's order, depth
   * first.
   * @param {string} object
   */
  timeOffsetOf(object) {
    return this.#objectOffsets.get(this.ir.ids[object] ? object : `OB:${object}`) ?? 0;
  }

  /** An ID's time offset: an object's, or that of the first object using it (its mesh, shape keys, armature). @param {string} id */
  #idOffset(id) {
    if (this.#objectOffsets.has(id)) return /** @type {number} */ (this.#objectOffsets.get(id));
    const user = this.ir.references.find((r) => r.to === id && this.#objectOffsets.has(r.from));
    return user ? /** @type {number} */ (this.#objectOffsets.get(user.from)) : 0;
  }

  /** Each object's and animated target's time offset, as the collections' controls set them. */
  #retime() {
    const sums = new Map();
    this.#objectOffsets.clear();
    for (const { key, parent } of collectionTree(this.ir)) {
      const path = this.#offsetPaths.get(key), sum = (parent === null ? 0 : sums.get(parent)) + (path ? Number(this.#values.get(path)) : 0);
      sums.set(key, sum);
      for (const object of this.ir.collections[key].objects) if (!this.#objectOffsets.has(object)) this.#objectOffsets.set(object, sum);
    }
    // A node's animation, and its skeleton's bones and morph targets, follow its object.
    this.#targetOffsets.clear();
    for (const [object, offset] of this.#objectOffsets) {
      const node = /** @type {any} */ (this.nodeOf(object));
      if (!offset || !node) continue;
      const manager = node.morphTargetManager;
      for (const target of [node, ...(node.skeleton?.bones ?? []), ...Array.from({ length: manager?.numTargets ?? 0 }, (_, i) => manager.getTarget(i))]) this.#targetOffsets.set(target, offset);
    }
  }

  /** The path of each collection's visibility flag, by `<key> <flag>`. @type {Map<string, string>} */
  #flags = new Map();

  /**
   * A collection's flag: its control's value, else its Blender data's in the view layer drawn.
   * @param {string} key
   * @param {import('./collections.js').Flag} flag
   */
  #flag(key, flag) {
    const path = this.#flags.get(`${key} ${flag}`);
    if (path) return this.#values.get(path) === true;
    const collection = this.ir.collections[key], layer = collection?.view_layers[this.ir.scene.view_layer ?? ''];
    return flag === 'exclude' ? !!layer?.exclude : flag === 'layer_hide_viewport' ? !!layer?.hide_viewport : !!collection?.[flag];
  }

  /** The scene's collections from its scene collection down, in the outliner's order, with their flags as set. @returns {CollectionInfo[]} */
  collections() {
    const shown = this.#shownCollections();
    const layer = this.ir.scene.view_layer ?? '';
    return collectionTree(this.ir).map(({ key, parent, depth }) => {
      const collection = structuredClone(this.ir.collections[key]), flags = collection.view_layers[layer];
      if (flags) Object.assign(flags, { exclude: this.#flag(key, 'exclude'), hide_viewport: this.#flag(key, 'layer_hide_viewport') });
      return { ...collection, hide_viewport: this.#flag(key, 'hide_viewport'), hide_render: this.#flag(key, 'hide_render'), key, parent, depth,
        all_objects: objectsIn(this.ir, key), visible: shown.has(key) };
    });
  }

  /** The collections that show: the scene collection and those under it neither excluded nor hidden. */
  #shownCollections() {
    const shown = new Set();
    for (const { key, parent } of collectionTree(this.ir)) {
      const hidden = ['exclude', 'layer_hide_viewport', 'hide_viewport', 'hide_render'].some((flag) => this.#flag(key, /** @type {any} */ (flag)));
      if (parent === null || (shown.has(parent) && !hidden)) shown.add(key);
    }
    return shown;
  }

  /**
   * The objects a collection holds (by key or name), with those of its child collections unless `recursive` is false;
   * ID keys (`OB:Cube`).
   * @param {string} collection
   * @param {{ recursive?: boolean }} [options]
   */
  objectsIn(collection, { recursive = true } = {}) {
    return objectsIn(this.ir, collectionKey(this.ir, collection), recursive);
  }

  /** The collections an object (by key or name) is linked to. @param {string} object */
  collectionsOf(object) {
    const key = this.ir.ids[object] ? object : `OB:${object}`;
    return Object.keys(this.ir.collections).filter((k) => this.ir.collections[k].objects.includes(key));
  }

  /** The Babylon node an object (by key) draws as, if any. @param {string} object */
  nodeOf(object) {
    const node = this.ir.ids[object]?.node;
    return node === undefined ? null : nodeById(this.scene, node);
  }

  /**
   * Shows or hides a collection (by key or name) in the view layer drawn, as the outliner's eye does: what it holds
   * shows only where it and the collections holding it show. With `children`, its child collections too, as Shift does.
   * @param {string} collection
   * @param {boolean} [visible]
   * @param {{ children?: boolean }} [options]
   */
  showCollection(collection, visible = true, { children = false } = {}) {
    const key = collectionKey(this.ir, collection);
    for (const k of children ? collectionTree(this.ir, key).map((c) => c.key) : [key]) {
      const path = this.#flags.get(`${k} layer_hide_viewport`);
      if (path) this.set(path, /** @type {any} */ (!visible));
      else if (k === key && this.ir.scene.collection !== key) throw new Error(`${collection} has no Hide in Viewport control`);
    }
  }

  /** Whether a collection (by key or name) shows. @param {string} collection */
  isCollectionVisible(collection) {
    return this.#shownCollections().has(collectionKey(this.ir, collection));
  }

  /**
   * Shows each object as its own Hide in Viewport and Disable in Renders and its collections give.
   * @param {string[]} objects their keys
   */
  #showObjects(objects) {
    const shown = showing(this.ir, (key, flag) => this.#flag(key, flag));
    for (const object of objects) {
      const node = /** @type {any} */ (this.nodeOf(object)), path = this.ir.ids[object]?.path;
      if (!node) continue;
      const hidden = !(shown.get(object) ?? true) || this.#hidden(path, object);
      // An object its collections hid at export is a disabled node (an instance source's, an excluded collection's).
      if (this.#hiddenAtExport.has(object)) node.setEnabled(!hidden);
      hide(node, hidden);
    }
  }

  /**
   * Whether an object's own Hide in Viewport or Disable in Renders hides it: its controls', else its Disable in Renders
   * as exported (a mesh a rig keeps for another look, which Blender's render leaves out).
   * @param {string | null | undefined} path its RNA path @param {string} [object] its key
   */
  #hidden(path, object) {
    const control = (/** @type {string} */ kind) => this.#values.get(`${path}.hide_${kind}`);
    return control('viewport') === true || (control('render') ?? (object && this.ir.ids[object]?.data?.hide_render)) === true;
  }

  /** @type {ReturnType<typeof createScheduler> | null} */
  #scheduler;

  /**
   * A control's value.
   * @template {keyof Controls & string} P
   * @param {P} path
   * @returns {Controls[P]}
   */
  get(path) {
    if (!this.#values.has(path)) throw new Error(`No control ${path}`);
    return /** @type {Controls[P]} */ (this.#values.get(path));
  }

  /**
   * Sets a control and what it binds to, and runs the entities that read it (its drivers, modifiers).
   * @template {keyof Controls & string} P
   * @param {P} path
   * @param {Controls[P]} value
   */
  set(path, value) {
    const knob = this.#knobs.get(path);
    if (!knob) throw new Error(`No control ${path}`);
    if (typeof value !== typeof knob.default) throw new TypeError(`${path} takes a ${typeof knob.default}, not ${typeof value}`);
    this.#write(path, value);
    this.#scheduler?.changed(path);
  }

  /**
   * Controls the scene's animation sets: each a property of its node's `metadata.bylonderChannels`, which Babylon's
   * animation holds and sets every frame, and which sets the control when its value changes.
   * @param {Knob[]} knobs
   */
  #channels(knobs) {
    for (const { path, default: initial, bind } of knobs) {
      const holder = bind?.channel !== undefined && /** @type {any} */ (nodeById(this.scene, bind.node ?? ''))?.metadata?.bylonderChannels;
      if (!holder || Object.getOwnPropertyDescriptor(holder, /** @type {string} */ (bind?.channel))?.get) continue;
      Object.defineProperty(holder, /** @type {string} */ (bind?.channel), {
        get: () => this.#values.get(path),
        set: (value) => {
          const typed = typeof initial === 'boolean' ? !!value : value;
          if (typed !== this.#values.get(path)) this.set(path, typed);
        },
      });
    }
  }

  /**
   * Applies a patch of the package, made by exporting the same scene again after an edit, undo or redo
   * (docs/data-flow.md): the entries it changes are made and swapped in at once, and the controls keep the page's values,
   * those it has not set taking the patch's defaults. A patch from another version than the one shown, or of what a patch
   * does not reach yet (computed entities, graphs, the scene's settings), loads the package again, reported. One that
   * names what the scene would not hold is not applied, reported, and the scene stays as it was. Gives the scene that
   * shows the result: this one, or the one loaded again.
   * @param {import('./scene-tables.js').Patch} patch
   * @returns {Promise<BlendScene<Controls>>}
   */
  async patch(patch) {
    const unreached = Object.keys(patch.tables).filter((table) => !PATCHED.has(table));
    const stale = !this.#tables ? 'it was not loaded from tables' : patch.base !== this.#tables.version ? `the patch is from version ${patch.base}, the page shows ${this.#tables.version}`
      : unreached.length ? `the patch changes ${unreached.join(', ')}, which a patch does not reach yet`
      : patch.tables.entities && !this.#scheduler ? 'the patch adds what the page computes to a scene that computed nothing'
      : patch.tables.irScene && !this.#sameClock(patch.tables.irScene) ? "the patch changes the scene's time or its root" : null;
    if (stale || !this.#tables) {
      console.warn(`Bylonder: the package is loaded again: ${stale}`);
      return this.#reload(this);
    }
    const notApplied = (/** @type {unknown} */ error) => {
      console.warn(`Bylonder: a patch is not applied, the scene stays as it was: ${/** @type {Error} */ (error).message}`);
      return this;
    };
    const reload = (/** @type {unknown} */ error) => {
      console.warn(`Bylonder: the package is loaded again, as a patch failed once applied: ${/** @type {Error} */ (error).message}`);
      return this.#reload(this);
    };
    /** @type {Record<string, Record<string, any>>} */
    let entries;
    try {
      entries = readEntries(patch.tables);
    } catch (error) {
      return notApplied(error);
    }
    const playing = this.#clips.playing(), tables = this.#tables.tables, ir = /** @type {Record<string, any>} */ (this.ir);
    const replaced = JSON.stringify(Object.entries(patch.tables).map(([table, part]) => Object.keys(part).map((key) => (tables[table] ?? ir[table])?.[key])));
    try {
      this.#tables.apply(patch);
    } catch (error) {
      return /** @type {any} */ (error).reload ? reload(error) : notApplied(error);
    }
    try {
      for (const [table, part] of Object.entries(entries)) if (IR_TABLES.has(table)) {
        const into = /** @type {Record<string, any>} */ (this.ir)[table];
        for (const [key, entry] of Object.entries(part)) entry === null ? delete into[key] : (into[key] = entry);
      }
      for (const [path, property] of Object.entries(entries.properties ?? {})) {
        const knob = this.#knobs.get(path), unset = !knob || this.#values.get(path) === knob.default;
        if (!property) { this.#knobs.delete(path); this.#values.delete(path); continue; }
        const { id, ...fields } = property;
        this.#knobs.set(path, /** @type {Knob} */ ({ path, ...fields }));
        if (unset) this.#values.set(path, property.default);
      }
      for (const scene of Object.values(patch.tables.irScene ?? {})) Object.assign(this.ir.scene.time, Object.fromEntries(RETIMED.map((name) => [name, scene.time[name]])));
      const rates = this.ir.scene.time.sample_rates;
      for (const [name, rate] of Object.entries(patch.tables.sampleRates ?? {})) rate === null ? delete rates[name] : (rates[name] = rate);
      this.#indexKnobs();
      this.#channels([...this.#knobs.values()]);
      if (patch.tables.animationGroups || patch.tables.animations) this.#clips.refresh(playing);
      // What a rig runs on holds its skeleton, meshes and morph targets: made again, it attaches to the new ones.
      const remade = REMADE.some((table) => patch.tables[table]);
      if (entries.entities || entries.graphs || remade) this.#scheduler?.replace(entries.entities ?? {}, Object.keys(entries.graphs ?? {}), (name) => remade && RIGS.includes(name));
      this.#retime();
      // What a binding writes is the control's, on the objects the patch made too.
      for (const [path, knob] of this.#knobs) if (knob.bind) this.#write(path, /** @type {Value} */ (this.#values.get(path)));
    } catch (error) {
      return reload(error);
    }
    this.#dropUnusedBuffers(replaced);
    return this;
  }

  /** Whether a patch's scene part keeps the scene's root, view layer and clock. @param {Record<string, any>} part */
  #sameClock(part) {
    const clock = (/** @type {any} */ scene) => JSON.stringify([scene.id, scene.collection, scene.view_layer, ...CLOCK.map((name) => scene.time?.[name])]);
    return Object.values(part).every((scene) => scene && clock(scene) === clock(this.ir.scene));
  }

  /** The collections' time offsets and visibility flags, by the controls that set them. */
  #indexKnobs() {
    this.#offsetPaths.clear();
    this.#flags.clear();
    for (const { path, bind } of this.#knobs.values()) {
      if (bind?.offset) this.#offsetPaths.set(/** @type {string} */ (bind.collection), path);
      else if (bind?.collection) {
        const flag = path.endsWith('.exclude') ? 'exclude' : path.endsWith('.hide_render') ? 'hide_render' : path.includes('.layer_collection') ? 'layer_hide_viewport' : 'hide_viewport';
        this.#flags.set(`${bind.collection} ${flag}`, path);
      }
    }
  }

  /** Lets go of the buffers `replaced` (the entries a patch replaced) named that no table entry or IR value names now. @param {string} replaced */
  #dropUnusedBuffers(replaced) {
    const keys = (/** @type {string} */ text) => [...text.matchAll(BUFFER_KEY)].map((m) => m[1]);
    const candidates = new Set(keys(replaced));
    if (!candidates.size) return;
    for (const key of keys(JSON.stringify(this.#tables?.tables) + JSON.stringify(this.ir))) candidates.delete(key);
    for (const key of candidates) delete this.buffers[key];
  }

  /** Resolves once what the last changes set going has run (an evaluator's first load). */
  settled() {
    return this.#scheduler?.settled() ?? Promise.resolve();
  }

  /**
   * A control's value, applied to what it binds to and told.
   * @param {string} path
   * @param {Value} value
   */
  #write(path, value) {
    const knob = /** @type {Knob} */ (this.#knobs.get(path));
    // A number given a switch (a driver's value) is on only from 1 down by a float's precision, as Blender's drivers
    // set one; any other is clamped to its hard range, as Blender's RNA sets a property.
    if (typeof value === 'number' && knob.type === 'BOOLEAN') value = value > 1 - FLOAT_EPSILON;
    else if (typeof value === 'number') value = Math.min(knob.hard_max ?? Infinity, Math.max(knob.hard_min ?? -Infinity, value));
    this.#values.set(path, value);
    if (knob.bind) this.#apply(knob.bind, path, value);
    this.onChanged.notifyObservers({ path, value });
  }

  /** The controls, as Blender's RNA describes them. @returns {Control[]} */
  controls() {
    return [...this.#knobs.values()].map(({ bind, ...control }) => control);
  }

  /** Disposes of the scene. */
  dispose() {
    this.#scheduler?.dispose();
    this.#clips.dispose();
    this.playhead.dispose();
    this.onChanged.clear();
    this.#disposeContent();
  }

  /**
   * A texture of the image at `url`, sampled as the one it replaces.
   * @param {import('@babylonjs/core').Texture} old
   * @param {string} url
   */
  #image(old, url) {
    const texture = new Texture(new URL(url, this.#root || globalThis.location?.href).href, this.scene, { noMipmap: old.noMipmap, invertY: old.invertY, samplingMode: old.samplingMode });
    Object.assign(texture, { wrapU: old.wrapU, wrapV: old.wrapV });
    old.dispose();
    return texture;
  }

  /** The paths of a vector's components (`…location[0]`), made once: a bone is placed every frame. @type {Map<string, string[]>} */
  #vectors = new Map();
  /** @param {string} base @param {string} name @param {number} count */
  #paths(base, name, count) {
    const key = `${base}.${name}`;
    if (!this.#vectors.has(key)) this.#vectors.set(key, Array.from({ length: count }, (_, i) => `${key}[${i}]`));
    return /** @type {string[]} */ (this.#vectors.get(key));
  }

  /**
   * Places a node by the part of its object's transform a control at `path` sets (location, rotation or scale): the
   * rest of the node stays as it is, which Babylon's animation may be playing. A bone is posed by all three.
   * @param {any} node
   * @param {string} path
   * @param {Transform} transform
   */
  #place(node, path, transform) {
    const base = path.slice(0, path.lastIndexOf('.')), part = path.slice(base.length + 1).replace(/\[\d+\]$/, '');
    const vector = (/** @type {string} */ name, /** @type {number} */ count) => this.#paths(base, name, count).map((key) => /** @type {number} */ (this.#values.get(key) ?? 1));
    if (node.getRestMatrix) {
      node._matrix = posedBone(transform, vector, node.getRestMatrix());
      return;
    }
    const placed = placement(transform, vector);
    if (part === 'location') node.position?.copyFrom(placed.position);
    else if (transform.direction !== undefined) {
      if (part !== 'scale' && placed.direction) node.direction = placed.direction;
    } else if (part === 'scale') node.scaling?.copyFrom(placed.scaling);
    else node.rotationQuaternion = placed.rotation;
  }

  /**
   * @param {Binding} bind
   * @param {string} path
   * @param {Value} value
   */
  #apply(bind, path, value) {
    if (bind.world) {
      // The Background node's Color (input 0) times its Strength (input 1).
      const inputs = path.slice(0, path.lastIndexOf('.inputs[') + '.inputs'.length);
      const strength = /** @type {number} */ (this.#values.get(`${inputs}[1].default_value`) ?? 1);
      this.#world?.set([0, 1, 2].map((i) => /** @type {number} */ (this.#values.get(`${inputs}[0].default_value[${i}]`)) * strength));
      return;
    }
    if (bind.offset) {
      // The animation and what reads the frame show the frames the new offsets give.
      this.#retime();
      this.playhead.refresh();
      this.#scheduler?.retimed();
      return;
    }
    if (bind.collection) {
      this.#showObjects(objectsIn(this.ir, bind.collection));
      return;
    }
    if (bind.compositor !== undefined) {
      const pass = /** @type {any} */ (this.compositor?.attachedBlocks.find((b) => b.name === bind.compositor));
      if (bind.upload !== undefined) pass?.setUpload(bind.upload, value);
      else pass?.setUniform(bind.uniform, value, bind.component);
      return;
    }
    if (bind.frame) {
      this.playhead.seek(/** @type {number} */ (value));
      return;
    }
    if (bind.material !== undefined && bind.property) {
      const material = this.scene.getMaterialById(bind.material);
      if (material) assign(material, bind.property, /** @type {number} */ (value) * (bind.factor ?? 1));
      return;
    }
    if (bind.material !== undefined) {
      const material = /** @type {any} */ (this.scene.getMaterialById(bind.material)), block = material?.getBlockByName(bind.block);
      if (block && bind.image) block.texture = this.#image(block.texture, /** @type {string} */ (value));
      else if (block && bind.component === undefined) block.value = value;
      else if (block) block.value['xyzw'[bind.component ?? 0]] = value;
      return;
    }
    const node = /** @type {any} */ (bind.node === undefined ? this.scene : nodeById(this.scene, bind.node));
    if (!node) return;
    if (bind.transform) {
      // A clip playing takes the bones and objects it animates: the timeline's own curves do not move them meanwhile.
      if (!this.playhead.claimed(node)) this.#place(node, path, bind.transform);
    } else if (bind.hide) {
      const object = Object.keys(this.ir.ids).find((k) => this.ir.ids[k].node === bind.node);
      if (object) this.#showObjects([object]);
      else hide(node, this.#hidden(path.slice(0, path.lastIndexOf('.'))));
    } else if (bind.morph !== undefined) {
      const target = node.morphTargetManager?.getTargetByName(bind.morph);
      if (target) target.influence = value;
    } else if (bind.lens !== undefined) {
      node.fov = 2 * Math.atan(bind.lens / /** @type {number} */ (value));
    } else if (bind.property) {
      assign(node, bind.property, typeof value === 'number' ? value * (bind.factor ?? 1) : value);
    }
  }
}

/**
 * A scene exported from Bylonder, loaded: `url` is its scene.js.
 * @param {import('@babylonjs/core').AbstractEngine} engine
 * @param {string | URL} url
 * @returns {Promise<BlendScene>}
 */
export async function loadBlendScene(engine, url) {
  const { load } = await import(new URL(url, globalThis.location?.href).href);
  return load(engine);
}
