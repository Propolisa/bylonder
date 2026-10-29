// The 3D View's tools beyond selection and the transform gizmos: their operators by Blender idname (view3d.cursor3d,
// view3d.ruler_add and view3d.ruler_remove, gpencil.annotate, view3d.interactive_add, transform.from_gizmo) and the
// gizmo map of the active tool's gizmo group (Measure's rulers, the Add Primitive grid, Edit Mode's handles).
import { registerOperators, invokeOperator, inArea } from '../../windowmanager/wm-operators.js';
import { keymapHandler } from '../../windowmanager/keyconfig.js';
import { createGizmoMap } from '../../windowmanager/wm-gizmo-map.js';
import { tagRedraw } from '../../draw/overlay-tool.js';
import { viewProjection } from './view3d-project.js';
import { cursor3d_update } from './view3d-cursor.js';
import { createRuler } from './view3d-gizmo-ruler.js';
import { createPlacement } from './view3d-placement.js';
import { registerToolGizmos } from './view3d-gizmo-tool.js';
import { registerMeshGizmos } from './view3d-gizmo-mesh.js';
import { createAnnotate } from '../gpencil/annotate.js';
import { objectMesh } from '../object/object-mesh.js';
import { worldAxes } from './view3d-project.js';
import { unit_m3 } from '../../blenlib/math-matrix.js';

// The drag actions of the Transform tool's gizmo group (VIEW3D_GGT_xform_gizmo's drag_action).
const DRAG_ACTIONS = { TRANSLATE: ['transform.translate', 'move'], ROTATE: ['transform.rotate', 'rotate'], SCALE: ['transform.resize', 'scale'] };

// `world` and `editor` are the app's; `mode()` is context.mode, `area` the 3D View's context area for keymaps,
// `toolSettings()` the scene's ToolSettings RNA, `addPreset(idname, placement)` adds an Object Mode primitive.
export function createView3DTools({ world, editor, views, area, mode, toolSettings, commit, notify, addPreset }) {
  const activeView = () => views.input;
  const tool = () => world.toolsystem.active(mode());
  const region = Object.assign((view) => view && viewProjection(view), { tag: tagRedraw });
  const toolActive = (gizmo) => () => tool()?.gizmo_group === gizmo;
  // What snapping reaches: the objects drawn, the edited one as its edit mesh.
  const meshes = new WeakMap();
  const meshOf = (node) => {
    const creation = node.metadata?.wbCreation, cached = meshes.get(node);
    if (cached?.creation === creation) return cached.mesh;
    const mesh = objectMesh(node);
    meshes.set(node, { creation, mesh });
    return mesh;
  };
  const sources = () => world.objects.filter((node) => node.getTotalVertices?.() && node.isEnabled() && node.isVisible !== false && !node.metadata?.wbDeleted)
    .map((node) => ({ node, mesh: node === world.editMode.object ? world.editMode.mesh : meshOf(node) })).filter(({ mesh }) => mesh);
  // The scene's orientation as the ruler's constraints use it: Global, then Local (the active object's axes).
  const orientation = (constrainMode) => {
    const active = editor.selection.nodes.at(-1);
    return constrainMode === 2 && active ? worldAxes(active.computeWorldMatrix(true)) : unit_m3();
  };
  // The active tool's gizmo group, then the redo gizmos the last operator asked for (MESH_GGT_spin_redo).
  const toolGroup = () => (activeView() && !activeView().state.cameraView ? tool()?.gizmo_group ?? '' : '');
  const gizmoMap = createGizmoMap({ groups: () => [toolGroup(), ...(world.editMode.active ? world.editMode.lastOperation?.gizmos ?? [] : [])] });
  const ruler = createRuler({ world, region, sources, wm: world.wm, commit, orientation, active: toolActive('VIEW3D_GGT_ruler') });
  const annotate = createAnnotate({
    annotations: () => world.annotations, region, cursor: () => world.sceneSettings.state.cursor.location,
    placement: () => toolSettings().annotation_stroke_placement_view3d ?? 'CURSOR', wm: world.wm, commit, notify,
  });
  // A primitive the Add Primitive tools placed: Blender's operator, into the edit mesh in Edit Mode.
  const addPrimitive = (idname, { location, rotation, scale, ...sizes }) => {
    if (world.editMode.active) { world.editMode.addPrimitive(idname, { location, rotation, scale, ...sizes }); return; }
    addPreset(idname, { options: { ...sizes, scale }, location, rotation });
  };
  const placement = createPlacement({
    region, sources, cursor: () => world.sceneSettings.state.cursor.location, settings: toolSettings, wm: world.wm,
    toolActive: toolActive('VIEW3D_GGT_placement'), tool: () => tool()?.idname, add: addPrimitive, notify,
  });
  // A tool's handle runs the tool's own keymap (gz->keymap of view3d_gizmo_tool_generic.cc).
  const toolKeymap = (event) => {
    const ref = tool();
    return inArea(area, () => keymapHandler([ref.keymap], () => true, (name, idname) => world.toolsystem.keymapProperties(mode(), name, idname))(event));
  };
  registerToolGizmos({
    region, stats: () => world.editMode.gizmoStats(), active: (gizmo) => world.editMode.active && toolActive(gizmo)(), toolKeymap,
    properties: (group) => world.toolsystem.properties(tool(), group),
    extrude: (event, { normal }) => invokeOperator('mesh.extrude_context_move',
      { TRANSFORM_OT_translate: [['release_confirm', true], ...(normal ? [['orient_type', 'NORMAL']] : [])] }, event),
  });
  registerMeshGizmos({
    region, wm: world.wm, active: (gizmo) => world.editMode.active && toolActive(gizmo)(), toolKeymap,
    preselect: { edgeRing: (event, cuts) => world.editMode.preselectEdgeRing(event, cuts), elem: (event) => world.editMode.preselectElem(event) },
    cuts: () => world.toolsystem.properties(tool(), 'mesh.loopcut_slide').MESH_OT_loopcut?.number_cuts ?? 1,
    spinAxes: () => {
      const axis = world.toolsystem.properties(tool(), 'MESH_GGT_spin').axis ?? ['Z'];
      return ['X', 'Y', 'Z'].flatMap((name, i) => ([...(typeof axis === 'string' ? [axis] : axis)].includes(name) ? [i] : []));
    },
    cursor: () => world.sceneSettings.state.cursor.location,
    spin: (event, axis) => invokeOperator('mesh.spin', { ...world.toolsystem.keymapProperties(mode(), tool().keymap, 'mesh.spin'), axis }, event),
    lastOperation: () => world.editMode.lastOperation,
  });
  const inView = (props, event) => !!(event?.view ?? activeView());

  registerOperators({
    // Finishes and passes the press through as Blender's does, so a drag from the same press moves the cursor.
    'view3d.cursor3d': {
      poll: inView,
      run: ({ use_depth = true, orientation: orient = 'VIEW' }, event) => {
        const view = event?.view ?? activeView(), mouse = event ?? editor.pointer;
        cursor3d_update(viewProjection(view), [mouse.x, mouse.y], { use_depth, orientation: orient }, world.sceneSettings);
        views.wake();
        return 'FINISHED|PASS_THROUGH';
      },
    },
    // transform_from_gizmo_invoke: the Transform tool's drag off its gizmo runs its drag action.
    'transform.from_gizmo': {
      poll: () => tool()?.gizmo_group === 'VIEW3D_GGT_xform_gizmo' && editor.selection.size > 0,
      run: (props, event) => {
        const action = world.toolsystem.properties(tool(), 'VIEW3D_GGT_xform_gizmo').drag_action ?? 'TRANSLATE';
        const [idname] = DRAG_ACTIONS[action] ?? [];
        return idname ? invokeOperator(idname, { release_confirm: true }, event) || 'PASS_THROUGH' : 'PASS_THROUGH';
      },
    },
    'view3d.ruler_add': { poll: (props, event) => toolActive('VIEW3D_GGT_ruler')() && !!event?.view, run: (props, event) => (ruler.add(event) ? 'FINISHED' : 'CANCELLED') },
    'view3d.ruler_remove': { poll: toolActive('VIEW3D_GGT_ruler'), run: () => (ruler.remove() ? 'FINISHED' : 'PASS_THROUGH') },
    'gpencil.annotate': { poll: (props, event) => !!event?.view, run: (props, event) => (annotate.invoke(event, props) ? 'FINISHED' : 'CANCELLED') },
    'view3d.interactive_add': {
      poll: (props, event) => !!event?.view && ['OBJECT', 'EDIT_MESH'].includes(mode()),
      run: (props, event) => (placement.invoke(event) ? 'FINISHED' : 'CANCELLED'),
    },
  });

  const withToolGroup = (handle) => {
    world.editMode.toolGizmoGroup = toolGroup();
    return handle();
  };

  return {
    // The gizmo map's state for the tool system's keymap order, its handler, and pointer hovering; each tells the
    // module which group shows, as its operators read the preselection from it.
    gizmoState: (event) => withToolGroup(() => gizmoMap.state(event)),
    keymap: (event) => withToolGroup(() => inArea(area, () => gizmoMap.keymap(event))),
    hover: (event) => withToolGroup(() => gizmoMap.mousemove(event)),
    dispose: gizmoMap.dispose,
  };
}
