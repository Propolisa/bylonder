// tags: behaviors
// The game framework core (io_scene_babylon/runtime/game/): behaviours created per object with live props, events and
// handlers named after them, async handlers whose waits end with their behaviour, what game code makes disposed with
// it, state kept across a hot swap and gone on Reset, this run's material copied on its first write, systems that hear
// every instance, and shared geometry read-only in development.
import assert from 'node:assert/strict';
import { NullEngine, Scene, MeshBuilder, PBRMaterial, Color3, TransformNode } from '@babylonjs/core';
import { defineBehavior, defineSystem, defineGame, float, color, action } from '../src/io_scene_babylon/runtime/game/define.js';
import { createWorld } from '../src/io_scene_babylon/runtime/game/world.js';

const engine = new NullEngine();
const scene = new Scene(engine);
const shared = new PBRMaterial('Stone', scene);
shared.albedoColor = new Color3(0.5, 0.5, 0.5);
const rock = MeshBuilder.CreateBox('Rock', {}, scene), other = rock.clone('Rock.001');
rock.material = other.material = shared;
const values = { 'OB:Rock': { patience: 2 }, 'OB:Rock.001': {} };
const host = {
  scene,
  objects: () => [{ key: 'OB:Rock', name: 'Rock', node: rock, behaviors: ['Rock'] }, { key: 'OB:Rock.001', name: 'Rock.001', node: other, behaviors: ['Rock'] }],
  value: (object, behavior, prop) => values[object]?.[prop],
  play: (name, object) => played.push([name, object]),
};
const played = [], log = [];

let version = 1;
const makeRock = () => defineBehavior({
  name: 'Rock',
  props: { patience: float(8, { min: 1, unit: 's' }), stain: color([0.24, 0.14, 0.07]), admire: action('Wobble') },
  events: ['left'],
  create({ entity, props, time, state }) {
    const made = version;
    state.mood ??= 'waiting';
    state.waited ??= 0;
    new TransformNode(`steam of ${entity.name}`, scene);
    const leave = (served) => { state.mood = 'leaving'; this.emit('left', { served }); };
    return {
      async served() {
        state.mood = 'admiring';
        entity.play(props.admire);
        await time.wait(1.5);
        log.push(`spilled v${made} on ${entity.name}`);
        entity.material().set('baseColor', props.stain);
        await time.wait(0.5);
        leave(true);
      },
      update(dt) {
        if (state.mood === 'waiting' && (state.waited += dt) > props.patience) leave(false);
      },
    };
  },
});
const Shift = defineSystem({
  name: 'Shift',
  props: { length: float(30, { unit: 's' }) },
  create({ game, time, props, saved }) {
    let served = saved?.served ?? 0, walkouts = saved?.walkouts ?? 0;
    game.on(Rock, 'left', ({ served: happy }) => (happy ? served++ : walkouts++));
    return {
      update() { if (time.now >= props.length) game.end({ served, walkouts }); },
      save: () => ({ served, walkouts }),
    };
  },
});
let Rock = makeRock();
const game = defineGame({ systems: [Shift.with({ length: 10 })] });
const world = createWorld({ host, behaviors: [Rock], game, seed: 1 });
world.start();
const handle = (key) => world.instances.get(`${key}/Rock`).handlers;
assert.equal(world.instances.size, 2, 'one instance per object the behaviour is on');
assert.equal(handle('OB:Rock').props.patience, 2, 'a prop the object sets');
assert.equal(handle('OB:Rock.001').props.patience, 8, 'a prop it does not: the default');

// Serve the first rock; the second runs out of patience.
world.game.emit(handle('OB:Rock'), 'served', {});
assert.deepEqual(played, [['Wobble', 'OB:Rock']]);
for (let i = 0; i < 10; i++) await world.step(0.25);
assert.deepEqual(log, ['spilled v1 on Rock']);
assert.equal(handle('OB:Rock').state.mood, 'leaving');
assert.equal(handle('OB:Rock.001').state.mood, 'waiting', 'patience 8 s not run out at 2.5 s');
assert.deepEqual(world.game.get(Shift).save(), { served: 1, walkouts: 0 });

// The run's material: this rock's own copy, the other rock and the authored material untouched.
assert.notEqual(rock.material, shared, 'copied on its first write');
assert.deepEqual(rock.material.albedoColor.asArray().map((v) => +v.toFixed(2)), [0.24, 0.14, 0.07]);
assert.equal(other.material, shared);
assert.deepEqual(shared.albedoColor.asArray(), [0.5, 0.5, 0.5]);
assert.deepEqual(handle('OB:Rock').entity.authored.material().baseColor, [0.5, 0.5, 0.5]);

// Props are live.
values['OB:Rock.001'].patience = 1;
await world.step(0.1);
assert.equal(handle('OB:Rock.001').state.mood, 'leaving', 'a patience edit reaches the waiting rock at once');
assert.deepEqual(world.game.get(Shift).save(), { served: 1, walkouts: 1 });

// Hot swap: an async handler mid-wait never resumes, what create made is disposed, state and save() carry over.
values['OB:Rock.001'].patience = 100;
handle('OB:Rock.001').state.mood = 'waiting';
world.game.emit(handle('OB:Rock.001'), 'served', {});
const steamBefore = scene.transformNodes.filter((n) => n.name.startsWith('steam')).length;
assert.equal(steamBefore, 2);
version = 2;
Rock = makeRock();
world.swap([Rock], game);
assert.equal(scene.transformNodes.filter((n) => n.name.startsWith('steam') && !n.isDisposed()).length, 2, 'the old steam disposed, the new made');
assert.equal(handle('OB:Rock.001').state.mood, 'admiring', 'state survives the swap');
assert.deepEqual(world.game.get(Shift).save(), { served: 1, walkouts: 1 }, 'a system carries its save()');
for (let i = 0; i < 12; i++) await world.step(0.25);
assert.deepEqual(log, ['spilled v1 on Rock'], 'the wait cancelled by the swap never resumed');

// A version whose create throws never replaces the running one: the last good version keeps running, its state as it was.
const moodBefore = handle('OB:Rock.001').state.mood;
const broken = defineBehavior({ name: 'Rock', props: Rock.props, create({ state }) { state.mood = 'broken'; throw new Error('typo in create'); } });
const failedSwap = world.swap([broken], game);
assert.deepEqual(failedSwap.map((e) => e.message), ['typo in create', 'typo in create']);
assert.equal(handle('OB:Rock.001').state.mood, moodBefore, 'the state is as it was');
assert.equal(typeof handle('OB:Rock.001').served, 'function', 'the last good version runs');

// Ended by the system at its length.
for (let i = 0; i < 40; i++) await world.step(0.25);
assert.deepEqual(world.ended, { served: 1, walkouts: 1 });

// Shared geometry is read-only to game code until made unique.
const Deform = defineBehavior({ name: 'Deform', create({ entity }) {
  return { squash() { entity.node.updateVerticesData('position', new Float32Array(72)); }, unique() { entity.node.makeGeometryUnique(); entity.node.updateVerticesData('position', new Float32Array(72)); } };
} });
const a = MeshBuilder.CreateBox('A', {}, scene), b = a.clone('B');
const errors = [];
const deforming = createWorld({ host: { ...host, objects: () => [{ key: 'OB:A', name: 'A', node: a, behaviors: ['Deform'] }] }, behaviors: [Deform], report: (error) => errors.push(error.message) });
deforming.start();
const d = deforming.instances.get('OB:A/Deform').handlers;
deforming.game.emit(d, 'squash');
assert.deepEqual(errors, ['This geometry is shared with 1 other object; call mesh.makeGeometryUnique() first.']);
deforming.game.emit(d, 'unique');
assert.equal(errors.length, 1, 'a unique geometry is the object\'s own to write');
assert.ok(b.geometry !== a.geometry);

// Reset: a new world over a fresh run starts with fresh state.
world.dispose();
const fresh = createWorld({ host, behaviors: [Rock], game });
fresh.start();
assert.equal(fresh.instances.get('OB:Rock/Rock').handlers.state.mood, 'waiting');
console.log('game behaviors: ok');
