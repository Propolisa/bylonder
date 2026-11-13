// Undo restores animation channels by what changed (editors/undo/storage.js restoreChannels): of a rig's thousands of
// channels, only those whose value differs from the step's are set again, as each set writes Main and evaluates it
// (Snow's undo spent 13 s setting every channel back to the value it already had).
import assert from 'node:assert/strict';
import { restoreChannels } from '../src/editors/undo/storage.js';

let sets = 0;
const channel = (value) => ({ get: () => value, set(next) { sets++; value = next; } });
const channels = new Map(Array.from({ length: 2000 }, (_, i) => [`["OB:Rig","pose.bones[\\"b${i}\\"].prop"]`, channel(i % 3 ? [i, 0, 1] : i)]));
const step = Object.fromEntries([...channels].map(([ref, ch]) => [ref, ch.get()]));

restoreChannels(channels, step);
assert.equal(sets, 0, 'nothing changed: nothing is set');

const [ref] = channels.keys();
channels.get(ref).set(42);
sets = 0;
restoreChannels(channels, step);
assert.equal(sets, 1, `one channel changed: one set (${sets})`);
assert.deepEqual(channels.get(ref).get(), step[ref], 'and it has its value back');

restoreChannels(channels, { '["OB:Gone","x"]': 1 });
restoreChannels(channels, undefined);
console.log('undo restore channels: an undo sets only the channels it changed');
