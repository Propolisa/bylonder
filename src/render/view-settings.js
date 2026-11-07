// The one place Blender's view settings (scene.view_settings) become what a view displays with.
// blender-port: draw_color_management.cc drw_color_management_type_for_v3d, viewport_settings_apply: a rendered view
// displays with the scene's whole view settings; Material Preview and Solid with its view transform and look only, as
// their exposure would follow the scene's lights, which they do not show.
export const displayedViewSettings = (view, rendered) => (rendered ? view : { ...view, exposure: 0, gamma: 1 });

// blender-port: colormanagement.cc colormanage_exponent: the displayed color's exponent for a view gamma, at most 100.
export const displayExponent = (gamma) => Math.min(1 / Math.max(Number.EPSILON, gamma), 100);
