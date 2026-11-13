// @ts-check
// SPDX-License-Identifier: MIT OR Apache-2.0
// A character's bone roles (docs/character-animation.md, Character): single bones and limb chains by their names in the
// common rig families, CloudRig (Snow), Rigify and Blender's metarig (and its DEF- bones, as Quaternius' rigs have),
// and Mixamo, with or without its "mixamorig:" prefix; last, an older CloudRig's FK controls, where it has no result
// bones. Given roles win; a rig of another family names its own.

/** Candidate names per single-bone role, the first the rig has wins. */
const SINGLE = {
  hips: ['Hips', 'TORSO-Spine', 'DEF-hips', 'DEF-spine', 'torso', 'spine', 'mixamorig:Hips'],
  spine: ['Spine', 'DEF-spine.001', 'spine.001', 'mixamorig:Spine', 'FK-Spine'],
  chest: ['Chest', 'RibCage', 'DEF-spine.003', 'DEF-spine.002', 'spine.003', 'spine.002', 'mixamorig:Spine2', 'Spine2', 'mixamorig:Spine1', 'FK-Chest', 'FK-RibCage'],
  neck: ['Neck', 'DEF-neck', 'DEF-spine.004', 'spine.004', 'mixamorig:Neck', 'FK-Neck'],
  head: ['Head', 'DEF-head', 'DEF-spine.006', 'spine.006', 'mixamorig:Head', 'FK-Head'],
  jaw: ['Jaw', 'DEF-jaw', 'jaw', 'mixamorig:Jaw'],
};
/** Per side, candidate chains for arms and legs, root to end, and the eyes and lids. */
const SIDED = (/** @type {'L' | 'R'} */ s) => {
  const side = s === 'L' ? 'Left' : 'Right';
  return {
    [`arm.${s}`]: [[`UpperArm.${s}`, `Forearm.${s}`, `Wrist.${s}`], [`DEF-upper_arm.${s}`, `DEF-forearm.${s}`, `DEF-hand.${s}`],
      [`upper_arm.${s}`, `forearm.${s}`, `hand.${s}`], [`${side}Arm`, `${side}ForeArm`, `${side}Hand`].map((n) => `mixamorig:${n}`),
      [`${side}Arm`, `${side}ForeArm`, `${side}Hand`], [`FK-UpperArm.${s}`, `FK-Forearm.${s}`, `FK-Wrist.${s}`]],
    [`leg.${s}`]: [[`Thigh.${s}`, `Knee.${s}`, `Foot.${s}`], [`DEF-thigh.${s}`, `DEF-shin.${s}`, `DEF-foot.${s}`],
      [`thigh.${s}`, `shin.${s}`, `foot.${s}`], [`${side}UpLeg`, `${side}Leg`, `${side}Foot`].map((n) => `mixamorig:${n}`),
      [`${side}UpLeg`, `${side}Leg`, `${side}Foot`], [`FK-Thigh.${s}`, `FK-Knee.${s}`, `FK-Foot.${s}`]],
    [`eye.${s}`]: [[`Eye.${s}`], [`DEF-eye.${s}`], [`eye.${s}`], [`mixamorig:${side}Eye`], [`${side}Eye`]],
    // The lid controls, upper and lower: a blink moves the upper toward the lower.
    [`lid.${s}`]: [[`MSTR-Eyelid_Upper.${s}`, `MSTR-Eyelid_Lower.${s}`], [`lid.T.${s}.002`, `lid.B.${s}.002`]],
  };
};

/**
 * The rig's roles: single bones by name, `arm.L`, `arm.R`, `leg.L`, `leg.R` as chains (root to end) with their ends
 * `hand.*` and `foot.*`, `arms` and `legs` listing them, and `lid.L`, `lid.R` as [upper, lower] lid controls; `given`
 * roles (from the character's options) win.
 * @param {string[]} names the rig's bones @param {Record<string, string | string[] | string[][]>} [given]
 * @param {ArrayLike<number> | null} [parents] each bone's parent index (-1 for none), to find the hips above the legs
 * @returns {Record<string, string | string[] | string[][]>}
 */
export function findRoles(names, given = {}, parents = null) {
  const has = new Set(names);
  /** @type {Record<string, string | string[] | string[][]>} */
  const roles = {};
  for (const [role, candidates] of Object.entries(SINGLE)) {
    const found = candidates.find((name) => has.has(name));
    if (found) roles[role] = found;
  }
  for (const side of /** @type {const} */ (['L', 'R'])) {
    for (const [role, chains] of Object.entries(SIDED(side))) {
      const chain = chains.find((c) => c.every((name) => has.has(name)));
      if (!chain) continue;
      roles[role] = chain.length === 1 ? chain[0] : chain;
    }
  }
  // The hips: the lowest bone both legs hang from (their common ancestor), where the rig's parents are known.
  const left = roles['leg.L'], right = roles['leg.R'];
  if (parents && Array.isArray(left) && Array.isArray(right)) {
    const index = new Map(names.map((n, i) => [n, i]));
    const above = (/** @type {string} */ name) => { const chain = []; for (let i = parents[index.get(name) ?? -1] ?? -1; i >= 0; i = parents[i]) chain.push(i); return chain; };
    const fromRight = new Set(above(/** @type {string} */ (right[0])));
    const common = above(/** @type {string} */ (left[0])).find((i) => fromRight.has(i));
    if (common !== undefined) roles.hips = names[common];
  }
  Object.assign(roles, given);
  for (const [limb, end] of [['arm', 'hand'], ['leg', 'foot']]) {
    const chains = ['L', 'R'].map((s) => roles[`${limb}.${s}`]).filter((c) => Array.isArray(c));
    for (const s of ['L', 'R']) { const c = roles[`${limb}.${s}`]; if (Array.isArray(c)) roles[`${end}.${s}`] = /** @type {string} */ (c.at(-1)); }
    if (chains.length && !roles[`${limb}s`]) roles[`${limb}s`] = /** @type {string[][]} */ (chains);
  }
  return roles;
}

/**
 * The bones a role's bone stands for in a layer's mask: itself and the controls a rig plays it by (CloudRig's FK- and
 * IK- bones, Rigify's ORG- and DEF- ones).
 * @param {string} name @param {(name: string) => boolean} has
 */
export function playedBy(name, has) {
  const base = name.replace(/^(DEF|ORG|FK|IK|MCH)-/, '');
  return [name, ...['FK-', 'IK-', 'ORG-', 'DEF-'].map((p) => p + base)].filter((n, i, all) => has(n) && all.indexOf(n) === i);
}
