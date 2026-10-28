// Blender's operator names (rna-operators.json, all of Blender 5.2.3's), as bpy.ops lists them: OBJECT_OT_delete.
import operators from '../makesrna/rna-operators.json' with { type: 'json' };

export const operatorNames = () => Object.keys(operators).map((idname) => idname.replace(/^(\w+)\./, (m, group) => group.toUpperCase() + '_OT_'));
