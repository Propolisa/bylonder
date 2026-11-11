// @ts-check
// SPDX-License-Identifier: MIT OR Apache-2.0
// A scene exported from Bylonder, with its controls: the IR's properties (docs/ir.md), each a Blender RNA path from
// bpy.data (`objects["Cube"].location[0]`) whose value the page sets, and which lands on the Babylon objects it binds to.
import { Matrix, Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector.js';
import { Observable } from '@babylonjs/core/Misc/observable.js';
import { Texture } from '@babylonjs/core/Materials/Textures/texture.js';
import { createScheduler, EVALUATORS, NATIVE } from './scheduler.js';
import { readIR, referencesIn } from './ir.js';
import { createPlayhead } from './playhead.js';
import { collectionKey, collectionTree, objectsIn, showing } from './collections.js';

/** @typedef {number | boolean | string} Value */

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
 * @property {string} [channel] the key in its node's `metadata.bylonderChannels` the scene's animation sets it through
 * @property {string} [collection] a collection's visibility flag: the key of the collection it hides
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

/** Hides a mesh alone, as Blender hides an object and not its children, or another node with its children. @param {any} node @param {boolean} hidden */
function hide(node, hidden) {
  if ('isVisible' in node) node.isVisible = !hidden;
  else node.setEnabled(!hidden);
}

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
   *   buffers?: ArrayBufferView[], entries?: import('./asset.js').Entries, dispose?: () => void }} [options]
   * the package's URL, which relative image URLs resolve against, the world of one color its background controls set
   * (world.js), the compositor its pass controls set (bylonder-blocks.js), scene.bin's buffers, which its entities
   * read; loaded into a scene of the page's own, what was added there and what removes it (asset.js)
   */
  constructor(scene, ir, { root = '', world, compositor, buffers = [], entries, dispose = () => scene.dispose() } = {}) {
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
    const frameControl = knobs.find((knob) => knob.bind?.frame)?.path;
    // The frame control shows the playhead's whole frame, as Blender's frame_current does.
    if (frameControl) this.playhead.onChanged.add(({ frame }) => {
      if (Math.floor(frame) === this.#values.get(frameControl)) return;
      this.#values.set(frameControl, Math.floor(frame));
      this.onChanged.notifyObservers({ path: frameControl, value: Math.floor(frame) });
    });
    this.#scheduler = Object.keys(this.ir.entities).length ? createScheduler(this.ir, { scene, root, ir: this.ir, buffers, controls: {
      get: (path) => this.#values.get(path),
      write: (path, value) => this.#write(path, value),
      frame: () => this.playhead.frame,
    } }) : null;
    this.#channels(knobs);
    for (const { path, bind } of knobs) if (bind?.collection) {
      const flag = path.endsWith('.exclude') ? 'exclude' : path.endsWith('.hide_render') ? 'hide_render' : path.includes('.layer_collection') ? 'layer_hide_viewport' : 'hide_viewport';
      this.#flags.set(`${bind.collection} ${flag}`, path);
    }
    this.#hiddenAtExport = new Set([...showing(this.ir, (key, flag) => this.#flag(key, flag))].filter(([, shown]) => !shown).map(([object]) => object));
    if (this.#animated()) this.playhead.play();
  }

  /** Whether the scene moves with its frame: a range of frames, and an animation or what reads the frame. */
  #animated() {
    const { frame_start, frame_end } = this.ir.scene.time;
    return frame_end > frame_start && (this.scene.animationGroups.length > 0
      || Object.values(this.ir.entities).some((e) => [...referencesIn(e.inputs)].some(([ref]) => 'property' in ref && ref.property.endsWith('.frame_current'))));
  }

  /** The objects their collections hid at export. */
  /** @type {Set<string>} */
  #hiddenAtExport;

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
    return node === undefined ? null : this.scene.getNodeById(node);
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
      const hidden = !(shown.get(object) ?? true) || this.#hidden(path);
      // An object its collections hid at export is a disabled node (an instance source's, an excluded collection's).
      if (this.#hiddenAtExport.has(object)) node.setEnabled(!hidden);
      hide(node, hidden);
    }
  }

  /** Whether an object's own Hide in Viewport or Disable in Renders hides it. @param {string | null | undefined} path its RNA path */
  #hidden(path) {
    return ['viewport', 'render'].some((kind) => this.#values.get(`${path}.hide_${kind}`) === true);
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
      const holder = bind?.channel !== undefined && /** @type {any} */ (this.scene.getNodeById(bind.node ?? ''))?.metadata?.bylonderChannels;
      if (!holder) continue;
      Object.defineProperty(holder, /** @type {string} */ (bind?.channel), {
        get: () => this.#values.get(path),
        set: (value) => {
          const typed = typeof initial === 'boolean' ? !!value : value;
          if (typed !== this.#values.get(path)) this.set(path, typed);
        },
      });
    }
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

  /**
   * Places a node by the part of its object's transform a control at `path` sets (location, rotation or scale): the
   * rest of the node stays as it is, which Babylon's animation may be playing. A bone is posed by all three.
   * @param {any} node
   * @param {string} path
   * @param {Transform} transform
   */
  #place(node, path, transform) {
    const base = path.slice(0, path.lastIndexOf('.')), part = path.slice(base.length + 1).replace(/\[\d+\]$/, '');
    const vector = (/** @type {string} */ name, /** @type {number} */ count) => Array.from({ length: count }, (_, i) => /** @type {number} */ (this.#values.get(`${base}.${name}[${i}]`) ?? 1));
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
    const node = /** @type {any} */ (bind.node === undefined ? this.scene : this.scene.getNodeById(bind.node));
    if (!node) return;
    if (bind.transform) {
      this.#place(node, path, bind.transform);
    } else if (bind.hide) {
      const object = Object.keys(this.ir.ids).find((k) => this.ir.ids[k].node === bind.node);
      if (object) this.#showObjects([object]);
      else hide(node, this.#hidden(path.slice(0, path.lastIndexOf('.'))));
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
