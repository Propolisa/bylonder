// Blender's Preferences that do not apply in a browser or that Bylonder does not honor yet: the Preferences editor
// shows them greyed out (never hidden), each with its reason as the tooltip's last line. Everything else works: read by
// Blender's own code in the module (editing, animation, undo, keymaps, input events), or mapped by Bylonder
// (themes, drawing, navigation). By RNA struct, then property ('*' for all of a struct's).
import { THEMED } from '../interface/theme-tokens.js';
import { BYLONDER_ICON } from '../../python/bpy_icons.js';

const BROWSER = 'Not available in a browser';
const GPU = 'The browser chooses the graphics device and drawing backend';
const AUDIO = 'The browser plays sound through its own output';
const FONTS = 'The interface uses the browser\'s fonts';
const NO_NDOF = 'Bylonder is built without NDOF device input';
const NOT_YET = 'Not honored by Bylonder yet';

export const UNSUPPORTED = {
  PreferencesView: {
    font_path_ui: FONTS, font_path_ui_mono: FONTS, use_text_antialiasing: FONTS, use_text_render_subpixelaa: FONTS, text_hinting: FONTS,
    language: 'Bylonder has no translations', use_translate_tooltips: 'Bylonder has no translations', use_translate_interface: 'Bylonder has no translations',
    use_translate_reports: 'Bylonder has no translations', use_translate_new_dataname: 'Bylonder has no translations',
    show_statusbar_vram: GPU, show_statusbar_memory: BROWSER, show_splash: 'The splash screen opens with a new session',
    render_display_type: NOT_YET, filebrowser_display_type: NOT_YET, show_developer_ui: NOT_YET, show_tooltips_python: NOT_YET,
    use_mouse_over_open: NOT_YET, open_toplevel_delay: NOT_YET, open_sublevel_delay: NOT_YET, color_picker_type: NOT_YET,
    pie_initial_timeout: NOT_YET, pie_tap_timeout: NOT_YET, pie_animation_timeout: NOT_YET, pie_menu_radius: NOT_YET,
    pie_menu_threshold: NOT_YET, pie_menu_confirm: NOT_YET, show_playback_fps: NOT_YET, playback_fps_samples: NOT_YET,
    mini_axis_type: NOT_YET, mini_axis_size: NOT_YET, mini_axis_brightness: NOT_YET, gizmo_size: NOT_YET, gizmo_size_navigate_v3d: NOT_YET,
    lookdev_sphere_size: NOT_YET, show_extensions_updates: BROWSER, use_save_prompt: 'The browser keeps every project saved',
  },
  PreferencesSystem: {
    dpi: BROWSER, pixel_size: BROWSER, gpu_backend: GPU, gpu_preferred_device: GPU, gpu_shader_workers: GPU, shader_compilation_method: GPU,
    use_gpu_subdivision: 'Subdivision is evaluated on the CPU in the module', legacy_compute_device_type: 'Cycles is not part of Bylonder',
    audio_mixing_buffer: AUDIO, audio_device: AUDIO, audio_sample_rate: AUDIO, audio_sample_format: AUDIO, audio_channels: AUDIO,
    use_online_access: BROWSER, network_timeout: BROWSER, network_connection_limit: BROWSER, register_all_users: BROWSER,
    is_microsoft_store_install: BROWSER, memory_cache_limit: BROWSER, sequencer_proxy_setup: NOT_YET, scrollback: NOT_YET,
    texture_time_out: GPU, texture_collection_rate: GPU, vbo_time_out: GPU, vbo_collection_rate: GPU,
    use_overlay_smooth_wire: NOT_YET, use_edit_mode_smooth_wire: NOT_YET, use_region_overlap: NOT_YET, show_panel_tabs_compact: NOT_YET,
    solid_lights: NOT_YET, light_ambient: NOT_YET, use_studio_light_edit: NOT_YET, gl_clip_alpha: NOT_YET,
    viewport_aa: NOT_YET, gl_texture_limit: NOT_YET, anisotropic_filter: NOT_YET,
  },
  PreferencesInput: {
    ...Object.fromEntries(['ndof_translation_sensitivity', 'ndof_rotation_sensitivity', 'ndof_deadzone', 'ndof_zoom_direction', 'ndof_show_guide_orbit_axis',
      'ndof_show_guide_orbit_center', 'ndof_navigation_mode', 'ndof_lock_horizon', 'ndof_fly_speed_auto', 'ndof_orbit_center_auto', 'ndof_orbit_center_selected',
      'ndof_rotx_invert_axis', 'ndof_roty_invert_axis', 'ndof_rotz_invert_axis', 'ndof_panx_invert_axis', 'ndof_pany_invert_axis', 'ndof_panz_invert_axis',
      'ndof_fly_helicopter', 'ndof_lock_camera_pan_zoom'].map((name) => [name, NO_NDOF])),
    tablet_api: 'The browser reads tablets through pointer events', show_tablet_debug_values: BROWSER, xr_navigation: BROWSER,
    use_multitouch_gestures: NOT_YET, view_zoom_method: NOT_YET, view_zoom_axis: NOT_YET, use_mouse_continuous: NOT_YET,
    navigation_mode: NOT_YET, walk_navigation: NOT_YET,
  },
  PreferencesFilePaths: { '*': 'Bylonder keeps its files in the browser, not in folders' },
  PreferencesExtensions: { '*': BROWSER },
  PreferencesApps: { '*': BROWSER },
  PreferencesExperimental: { '*': NOT_YET },
  StudioLight: { '*': NOT_YET },
};

const UNTHEMED = 'No part of the interface Bylonder draws takes this color yet';
export const unsupported = (owner, prop) => UNSUPPORTED[owner]?.[prop] ?? UNSUPPORTED[owner]?.['*']
  ?? (owner.startsWith('Theme') && !THEMED[owner]?.has(prop) ? UNTHEMED : null);

// The add-ons whose code the app holds (the tree's, and Bylonder's own); the others Blender ships are listed greyed out.
const ADDONS_INCLUDED = new Set(['pose_library', 'bylonder']);
const NOT_INCLUDED = 'Not included in Bylonder', USER_ADDONS = 'User add-ons are not supported yet';
const USER_ADDON_OPERATORS = new Set(['preferences.addon_install', 'preferences.addon_remove', 'preferences.addon_refresh', 'wm.path_open',
  'preferences.extension_repo_add', 'preferences.extension_repo_remove', 'extensions.userpref_allow_online', 'extensions.repo_sync_all',
  'extensions.package_install', 'extensions.package_install_files', 'preferences.theme_install', 'preferences.studiolight_install']);
const property = (node, name) => node.properties?.find?.(([key]) => key === name)?.[1] ?? node.properties?.[name];
function unsupportedOperator(node) {
  if (USER_ADDON_OPERATORS.has(node.operator)) return USER_ADDONS;
  if (/^preferences\.addon_(enable|disable|expand)$/.test(node.operator) && !ADDONS_INCLUDED.has(property(node, 'module'))) return NOT_INCLUDED;
  return null;
}

// A Preferences region's tree with the buttons of unsupported settings and operators disabled and their reason in
// their tooltip.
export function greyUnsupported(node) {
  // Bylonder's own add-on carries the Bylonder icon in the list, as Bylonder's own UI does.
  if (node.kind === 'button' && node.type === 'LABEL' && node.text === 'System: Bylonder') node.icon = BYLONDER_ICON;
  if (node.kind === 'button') {
    const reason = node.rna ? unsupported(node.rna.owner, node.rna.prop) : node.operator && unsupportedOperator(node);
    if (reason) Object.assign(node, { disabled: true, tip: node.tip ? `${node.tip}\n${reason}` : reason });
  }
  node.children?.forEach(greyUnsupported);
  node.parts?.forEach((part) => greyUnsupported(part.layout));
  return node;
}
