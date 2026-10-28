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
import { dragStart } from './wm-event-system.js';

const types = new Map();

// WM_gizmogrouptype_append.
export const registerGizmoGroupType = (idname, type) => types.set(idname, type);

// `groups()` names the gizmo groups the map shows: the active tool's first ('' for none), then those operators asked
// for (their redo gizmos, MESH_GGT_spin_redo).
export function createGizmoMap({ groups }) {
  let highlight = null;
  const shown = () => groups().map((idname) => types.get(idname)).filter((type) => type?.poll());
  // The part of a shown group under an event's pointer, as { type, part }, or null.
  const find = (event) => {
    for (const type of shown()) {
      const part = type.test_select(event);
      if (part !== null) return { type, part };
    }
    return null;
  };
  const removeDraw = drawCallbackAdd((ctx, region) => {
    for (const type of shown()) type.draw(ctx, region, highlight?.view === region.view && highlight.type === type ? highlight.part : null);
  });
  const setHighlight = (next) => {
    if (next?.part === highlight?.part && next?.type === highlight?.type && next?.view === highlight?.view) return;
    highlight = next;
    tagRedraw();
  };
  return {
    // Whether the tool's group shows, and a part is under the event's pointer (for
    // wm_event_get_keymap_from_toolsystem_ex).
    state(event) {
      const tool = types.get(groups()[0]), visible = !!tool?.poll();
      if (!visible || !event?.view) return { visible };
      return { visible, highlight: find(dragStart(event)) !== null };
    },
    // Pointer motion: the highlighted part follows it.
    mousemove(event) {
      const found = event.view ? find(event) : null;
      setHighlight(found && { ...found, view: event.view });
    },
    // The gizmo map's handler: an event on the highlighted part goes to its gizmo.
    keymap(event) {
      if (!event.view) return false;
      const found = highlight?.view === event.view ? highlight : find(dragStart(event));
      return !!found && !!found.type.handle(event, found.part);
    },
    tag: tagRedraw,
    dispose: removeDraw,
  };
}
