// The 3D View's gizmo map (wm_gizmo_map.cc) for the gizmo groups Bylonder draws itself (the active tool's): the group
// shows while it polls, the gizmo part under the pointer is highlighted (wm_gizmomap_highlight_find), and events go
// to the highlighted gizmo first, as the gizmo map's handler runs before the region's keymaps. Bylonder's transform
// gizmos are Babylon's (editors/object/editor.js).
//
// A gizmo group type is { poll(), test_select(event) -> part or null, handle(event, part) -> handled, draw(ctx,
// region, highlight) }: test_select finds the part under a pointer event (in its view), handle runs the gizmo's
// keymap for the highlighted part (its operator, or the tool's keymap for a tool's handle), draw draws in pixel space
// (draw/overlay-tool.js).
import { drawCallbackAdd, tagRedraw } from '../draw/overlay-tool.js';

const types = new Map();

// WM_gizmogrouptype_append.
export const registerGizmoGroupType = (idname, type) => types.set(idname, type);

// `group()` names the gizmo group the map shows (the active tool's), or ''.
export function createGizmoMap({ group }) {
  let highlight = null;
  const active = () => {
    const type = types.get(group());
    return type && type.poll() ? type : null;
  };
  const removeDraw = drawCallbackAdd((ctx, region) => active()?.draw(ctx, region, highlight?.view === region.view ? highlight.part : null));
  const setHighlight = (next) => {
    if (next?.part === highlight?.part && next?.view === highlight?.view) return;
    highlight = next;
    tagRedraw();
  };
  return {
    // Whether the group shows, and a part is under the event's pointer (for wm_event_get_keymap_from_toolsystem_ex).
    state(event) {
      const type = active();
      if (!type || !event?.view) return { visible: !!type };
      return { visible: true, highlight: type.test_select(event) !== null };
    },
    // Pointer motion: the highlighted part follows it.
    mousemove(event) {
      const type = active(), part = type && event.view ? type.test_select(event) : null;
      setHighlight(part === null ? null : { part, view: event.view });
    },
    // The gizmo map's handler: an event on the highlighted part goes to its gizmo.
    keymap(event) {
      const type = active();
      if (!type || !event.view) return false;
      const part = highlight?.view === event.view ? highlight.part : type.test_select(event);
      return part !== null && !!type.handle(event, part);
    },
    tag: tagRedraw,
    dispose: removeDraw,
  };
}
