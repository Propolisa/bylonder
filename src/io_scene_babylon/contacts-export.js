// An action's foot contacts, found at export from Blender's own evaluation of the armature it animates (its deform feet,
// solved by the rig's constraints), and written in the clip's IR entry, so the page reads them for any rig at no cost.
// The finding is the page's own (runtime/character/contacts.js contactsFromTracks), run on Blender's feet.
import { contactsFromTracks } from './runtime/character/contacts.js';
import { findRoles, playedBy } from './runtime/character/roles.js';

/** The deform bone Blender moves for a role's bone: its DEF- variant where the rig has one. */
const deformed = (name, has) => playedBy(name, has).find((n) => n.startsWith('DEF-')) ?? name;

/** A point of an armature in the world, Y up (Blender's Z), from its object's matrix (rows) and a bone-space point. */
function worldPoint(matrix, [x, y, z]) {
  const at = (row) => matrix[row * 4] * x + matrix[row * 4 + 1] * y + matrix[row * 4 + 2] * z + matrix[row * 4 + 3];
  return [at(0), at(2), at(1)];
}

/**
 * Before a clip's frames are evaluated (`range`, an export sampling over the clip): records its armature's feet at each
 * frame, and gives a function returning the clip's contacts for the IR (frames from the clip's start) once they have been,
 * or null for a clip that animates no armature with legs.
 * @param {{ ids: any[], frame_start: number, action: any }} clip @param {ReturnType<import('./sampling.js').exportSampling>} range
 */
export function sampleContacts(clip, range) {
  const armature = clip.ids.find((id) => id.type === 'ARMATURE');
  const bones = armature ? [...armature.data.bones] : [], has = (name) => bones.some((b) => b.name === name);
  const legs = /** @type {string[][] | undefined} */ (armature && findRoles(bones.map((b) => b.name)).legs);
  if (!legs?.length) return () => null;
  const feet = legs.map((chain) => deformed(/** @type {string} */ (chain.at(-1)), has));
  const balls = feet.map((foot) => ballOf(armature.data.bones.get(foot)));
  const tops = bones.filter((b) => !b.parent).map((b) => b.name);
  const paths = { ankles: feet.map(() => []), balls: feet.map(() => []), root: [] }, roots = tops.map(() => /** @type {number[][]} */ ([]));
  const frames = [];
  range.sample((frame) => {
    if (frame !== Math.round(frame)) return;
    const matrix = [...armature.matrix_world].flat(), head = (name) => worldPoint(matrix, [...armature.pose.bones.get(name).head]);
    frames.push(frame);
    feet.forEach((foot, k) => { paths.ankles[k].push(head(foot)); paths.balls[k].push(head(balls[k])); });
    tops.forEach((name, k) => roots[k].push(head(name)));
  });
  return () => {
    if (frames.length < 2) return null;
    // The body's root: the top-level bone the action moves furthest (a rig's static Properties or widget bones aside).
    const travel = (/** @type {number[][]} */ p) => Math.hypot(p.at(-1)[0] - p[0][0], p.at(-1)[2] - p[0][2]);
    paths.root = roots.reduce((a, b) => (travel(b) > travel(a) ? b : a));
    const rest = (name) => [...armature.data.bones.get(name).head_local];
    const legLength = Math.max(...legs.map((chain) => {
      const a = rest(deformed(chain[0], has)), b = rest(deformed(/** @type {string} */ (chain.at(-1)), has));
      return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
    }));
    const fps = range.range.fps, markers = [...(clip.action.pose_markers ?? [])].map((m) => ({ name: m.name, time: (m.frame - clip.frame_start) / fps }));
    const { down, speed } = contactsFromTracks({ ...paths, fps, legLength, markers });
    return { fps, speed, legs: down.map((flags, k) => ({ foot: feet[k], down: spans(flags, frames[0] - clip.frame_start) })) };
  };
}

/** The ball of a foot: its child whose head is furthest from the foot's (the toes, past a twist or helper bone). */
export function ballOf(foot) {
  const children = [...(foot.children ?? [])], at = [...foot.head_local];
  const far = (b) => Math.hypot(...[...b.head_local].map((v, k) => v - at[k]));
  return children.length ? children.reduce((a, b) => (far(b) > far(a) ? b : a)).name : foot.name;
}

/** The runs of 1 in `flags` as [start, end) frames, offset by `from`. */
function spans(flags, from) {
  const out = [];
  for (let f = 0; f < flags.length; f++) {
    if (!flags[f] || (f > 0 && flags[f - 1])) continue;
    let end = f;
    while (end < flags.length && flags[end]) end++;
    out.push([from + f, from + end]);
  }
  return out;
}
