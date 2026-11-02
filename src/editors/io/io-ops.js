// File > Import and File > Export (editors/io in Blender): the importers and exporters are Blender's own operators in
// the module (wm.obj_import, wm.ply_export, ...), drawn by Blender's TOPBAR_MT_file_import and TOPBAR_MT_file_export
// and run through the browser's file dialogs (windowmanager/wm-fileselect.js). Those Bylonder cannot run yet are listed
// greyed out with the reason: Blender's own that the module does not build, and the entries of the add-ons Blender
// enables by default (their menu_func_import and menu_func_export), which are Blender's Python.
import { hasOperator } from '../../bmesh/bmesh-wasm.js';
import { registerOperator, appendMenu, unavailableReason, kw } from '../../windowmanager/wm-operators.js';

const ALEMBIC = 'Alembic needs C++ exceptions in the WebAssembly module (its reader catches what it throws), which a later module build adds';
const USD = 'Universal Scene Description is not in Bylonder: its library, OpenUSD, needs threads and loads its plugins at run time, which the WebAssembly module cannot';
const PYTHON = (addon) => `Blender's ${addon} add-on runs on Blender's Python, which Bylonder does not embed yet`;

// Blender's operators by idname, with why they do not run here.
const UNAVAILABLE = {
  'wm.alembic_import': ALEMBIC,
  'wm.alembic_export': ALEMBIC,
  'wm.usd_import': USD,
  'wm.usd_export': USD,
  'import_anim.bvh': PYTHON('BioVision Motion Capture (BVH)'),
  'export_anim.bvh': PYTHON('BioVision Motion Capture (BVH)'),
  'import_curve.svg': PYTHON('Scalable Vector Graphics (SVG)'),
  'import_scene.fbx': PYTHON('FBX'),
  'export_scene.fbx': PYTHON('FBX'),
  'import_scene.gltf': PYTHON('glTF 2.0'),
  'export_scene.gltf': PYTHON('glTF 2.0'),
};
for (const [idname, unavailable] of Object.entries(UNAVAILABLE)) {
  if (!hasOperator(idname)) registerOperator(idname, { unavailable, run: () => 'CANCELLED' });
}

// The default add-ons' entries, in the order they register (io_anim_bvh, io_curve_svg, io_scene_fbx, io_scene_gltf2),
// while their operators are not here; once an add-on runs, its own menu functions draw them.
const entries = (list) => ({ layout }) => {
  for (const [idname, text] of list) if (unavailableReason(idname)) layout.operator(idname, kw({ text }));
};
appendMenu('TOPBAR_MT_file_import', entries([['import_anim.bvh', 'Motion Capture (.bvh)'], ['import_curve.svg', 'SVG as Curves (.svg)'],
  ['import_scene.fbx', 'FBX (.fbx) (Legacy)'], ['import_scene.gltf', 'glTF 2.0 (.glb/.gltf)']]));
appendMenu('TOPBAR_MT_file_export', entries([['export_anim.bvh', 'Motion Capture (.bvh)'], ['export_scene.fbx', 'FBX (.fbx)'],
  ['export_scene.gltf', 'glTF 2.0 (.glb/.gltf)']]));
