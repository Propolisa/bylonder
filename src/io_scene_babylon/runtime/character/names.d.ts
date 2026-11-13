// The names of each armature of a package (its actions, their markers, its bone collections, roles and keyed
// properties), which the package's scene.d.ts declares by augmenting CharacterNames, so `new Character(blend,
// 'RIG-Snow')` takes only its names and a renamed action fails the build where it is used. Without an entry, names are
// strings.
export interface CharacterNames {}

type NameOf<N, K extends string> = N extends keyof CharacterNames ? (CharacterNames[N] extends { [key in K]: infer V } ? V : string) : string;
export type ActionOf<N> = NameOf<N, 'actions'>;
export type MarkerOf<N> = NameOf<N, 'markers'>;
export type RoleOf<N> = NameOf<N, 'roles'>;
export type PropertyOf<N> = NameOf<N, 'properties'>;
export type GroupOf<N> = NameOf<N, 'groups'>;
/** An armature's name: one of the package's, or any string. */
export type ArmatureName = keyof CharacterNames | (string & {});
