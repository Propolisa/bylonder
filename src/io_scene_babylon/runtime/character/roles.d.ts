/**
 * The rig's roles: single bones by name, `arm.L`, `arm.R`, `leg.L`, `leg.R` as chains (root to end) with their ends
 * `hand.*` and `foot.*`, `arms` and `legs` listing them, and `lid.L`, `lid.R` as [upper, lower] lid controls; `given`
 * roles (from the character's options) win.
 * @param {string[]} names the rig's bones @param {Record<string, string | string[] | string[][]>} [given]
 * @param {ArrayLike<number> | null} [parents] each bone's parent index (-1 for none), to find the hips above the legs
 * @returns {Record<string, string | string[] | string[][]>}
 */
export function findRoles(names: string[], given?: Record<string, string | string[] | string[][]>, parents?: ArrayLike<number> | null): Record<string, string | string[] | string[][]>;
/**
 * The bones a role's bone stands for in a layer's mask: itself and the controls a rig plays it by (CloudRig's FK- and
 * IK- bones, Rigify's ORG- and DEF- ones).
 * @param {string} name @param {(name: string) => boolean} has
 */
export function playedBy(name: string, has: (name: string) => boolean): string[];
