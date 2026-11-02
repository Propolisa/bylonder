// Grease Pencil drawing (docs/runtimes.md): Babylon draws a Grease Pencil object's strokes as GreasedLine meshes
// (draw/grease-pencil.js) in every runtime. On Blender they look as Blender draws them as far as GreasedLine can; on
// Babylon (mapped) GreasedLine's own settings, which Blender has no counterpart for, apply: a constant thickness on screen
// (size attenuation) and dashes. They live on the GreasePencil data, so objects sharing it draw alike.
import { idStruct } from '../python/bpy_rna.js';
import { registerRuntime, APPROXIMATION } from './runtimes.js';

// What GreasedLine draws differently from Blender's Grease Pencil engine, in every runtime.
const APPROXIMATIONS = [
  ['caps', 'Stroke ends and corners are flat: GreasedLine has no round caps or joins'],
  ['mode', 'Dots and Squares strokes draw as lines'],
  ['opacity', "A layer's opacity applies per stroke, so overlapping strokes of a layer show through each other"],
  ['blend_mode', 'Hard Light and Divide layers blend as Regular'],
  ['use_masks', 'Layer masks do not mask'],
  ['fill_style', 'Gradient and texture fills draw in their fill color, texture strokes in their stroke color'],
].map(([setting, message]) => ({ kind: APPROXIMATION, setting, message }));

registerRuntime({
  id: 'GREASE_PENCIL', label: 'Grease Pencil drawing', struct: 'GreasePencil', owner: 'grease_pencil', context: 'data', icon: 'OUTLINER_DATA_GREASEPENCIL',
  runtimes: ['BLENDER', 'MAPPED'],
  settings: (props, kw) => ({
    use_size_attenuation: props.BoolProperty(kw({ name: 'Size Attenuation', description: "Strokes keep their thickness on screen at any distance (GreasedLine's sizeAttenuation)",
      default: false, options: new Set() })),
    screen_scale: props.FloatProperty(kw({ name: 'Screen Scale', description: 'With size attenuation, the pixels a stroke is wide per metre of its thickness',
      default: 1000, min: 1, soft_max: 10000, options: new Set() })),
    use_dash: props.BoolProperty(kw({ name: 'Dashes', description: "Strokes drawn dashed (GreasedLine's useDash)", default: false, options: new Set() })),
    dash_count: props.FloatProperty(kw({ name: 'Dash Count', description: 'Dashes along each stroke', default: 8, min: 1, soft_max: 100, options: new Set() })),
    dash_ratio: props.FloatProperty(kw({ name: 'Dash Ratio', description: 'The part of each dash period left empty', default: 0.5, min: 0, max: 1, subtype: 'FACTOR', options: new Set() })),
    dash_offset: props.FloatProperty(kw({ name: 'Dash Offset', description: 'Where the dashes start along each stroke', default: 0, options: new Set() })),
  }),
  poll: (data) => data?.rna_type?.identifier === 'GreasePencil',
  issues: () => APPROXIMATIONS,
  instances: (context) => [...new Set([...context.scene.objects].filter((ob) => ob.type === 'GREASEPENCIL').map((ob) => ob.data))],
  evaluates: () => false,
  evaluate: (view) => [...view.entries()].filter((entry) => entry.type === 'GREASEPENCIL').map((entry) => idStruct(entry.ob).data),
  // GreasedLine's settings for an object's drawing (draw/grease-pencil.js BLENDER_LOOK's keys).
  look(data) {
    const { use_size_attenuation, screen_scale, use_dash, dash_count, dash_ratio, dash_offset } = data.bylonder.babylon;
    return { sizeAttenuation: use_size_attenuation, screenScale: screen_scale, useDash: use_dash, dashCount: dash_count, dashRatio: dash_ratio, dashOffset: dash_offset };
  },
  export: () => ({ reports: [], animations: [], restore() {} }),
});
