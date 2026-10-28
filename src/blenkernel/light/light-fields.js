// The settings Blender's DNA holds for a light of each type (Light and the type's struct, dna-data.json), by RNA
// identifier: what a Blender light keeps in its record. Pointers (its node tree) are not settings.
import data from '../../makesrna/dna-data.json' with { type: 'json' };

export const LIGHT_STRUCTS = { POINT: 'PointLight', SPOT: 'SpotLight', SUN: 'SunLight', AREA: 'AreaLight' };
const settings = (struct) => Object.entries(data[struct]?.properties ?? {}).filter(([, p]) => p.type !== 'POINTER').map(([name]) => name);

export const lightFields = (type) => [...new Set([...settings('Light'), ...settings(LIGHT_STRUCTS[type])])];
export const lightStruct = (type) => LIGHT_STRUCTS[type];
