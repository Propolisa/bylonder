// The 3D View's Edit Mode menus (VIEW3D_MT_select_edit_mesh, VIEW3D_MT_edit_mesh and its submenus in space_view3d.py),
// in Blender's order with Blender's labels, holding the operators the module runs. `api` is Edit Mode's:
// exec(idname, props) runs one as an undo step; move(idname, props, { normal }) runs one and then moves the result,
// as Blender's *_move macros do; slide(idname, props) runs one and then Edge Slide; start(type) starts a transform.
import rna from '../../makesrna/rna-operators.json' with { type: 'json' };
import { SCE_SELECT_VERTEX, SCE_SELECT_EDGE } from '../../bmesh/intern/bmesh-marking.js';

export function editMeshMenus(api) {
  const op = (label, blender, props, keys) => ({ label, blender, keys, run: () => api.exec(blender, props) });
  // layout.operator_enum: one item per enum value, named as Blender names it.
  const operatorEnum = (blender, prop, values) => rna[blender].properties[prop].items
    .filter(([value]) => !values || values.includes(value))
    .map(([value, label]) => ({ label, blender: `${blender}:${value}`, run: () => api.exec(blender, { [prop]: value }) }));
  const menu = (label, blender, items, keys) => ({ label, blender, keys, items });

  // select_similar_type_itemf: the types of the lowest enabled select mode; Freestyle's need a Freestyle build.
  const similarTypes = () => {
    const mode = api.selectmode(), prefix = mode & SCE_SELECT_VERTEX ? 'VERT_' : mode & SCE_SELECT_EDGE ? 'EDGE_' : 'FACE_';
    return rna['mesh.select_similar'].properties.type.items.map(([value]) => value).filter((value) => value.startsWith(prefix) && !value.endsWith('FREESTYLE'));
  };
  const similar = () => [
    ...operatorEnum('mesh.select_similar', 'type', similarTypes()),
    '-',
    op('Face Regions', 'mesh.select_similar_region'),
  ];
  const select = () => [
    { label: 'All', blender: 'mesh.select_all:SELECT', keys: 'A', run: () => api.exec('mesh.select_all', { action: 'SELECT' }) },
    { label: 'None', blender: 'mesh.select_all:DESELECT', keys: 'Alt A', run: () => api.exec('mesh.select_all', { action: 'DESELECT' }) },
    { label: 'Invert', blender: 'mesh.select_all:INVERT', keys: 'Ctrl I', run: () => api.exec('mesh.select_all', { action: 'INVERT' }) },
    '-',
    { label: 'Box Select', blender: 'view3d.select_box', keys: 'B', run: api.selectBox },
    '-',
    op('Select Mirror', 'mesh.select_mirror'),
    op('Select Random', 'mesh.select_random'),
    op('Checker Deselect', 'mesh.select_nth'),
    '-',
    menu('More/Less', 'VIEW3D_MT_edit_mesh_select_more_less', [
      op('More', 'mesh.select_more', undefined, 'Ctrl Numpad +'),
      op('Less', 'mesh.select_less', undefined, 'Ctrl Numpad -'),
    ]),
    '-',
    menu('Select Similar', 'VIEW3D_MT_edit_mesh_select_similar', similar, 'Shift G'),
    menu('Select All by Trait', 'VIEW3D_MT_edit_mesh_select_by_trait', () => [
      ...(api.selectmode() === 4 ? [] : [op('Non Manifold', 'mesh.select_non_manifold')]),
      op('Loose Geometry', 'mesh.select_loose'),
      op('Interior Faces', 'mesh.select_interior_faces'),
      op('Faces by Sides', 'mesh.select_face_by_sides'),
      op('Poles by Count', 'mesh.select_by_pole_count'),
    ]),
    menu('Select Linked', 'VIEW3D_MT_edit_mesh_select_linked', [
      op('Linked', 'mesh.select_linked', undefined, 'Ctrl L'),
      op('Shortest Path', 'mesh.shortest_path_select'),
      op('Linked Flat Faces', 'mesh.faces_select_linked_flat'),
    ]),
    menu('Select Loops', 'VIEW3D_MT_edit_mesh_select_loops', [
      op('Edge Loops', 'mesh.select_edge_loop_multi'),
      op('Edge Rings', 'mesh.select_edge_ring_multi'),
      op('Boundary Loops', 'mesh.select_boundary_loop_multi'),
      '-',
      op('Loop Inner-Region', 'mesh.loop_to_region'),
      op('Boundary of Selected', 'mesh.region_to_loop'),
    ]),
    '-',
    op('Sharp Edges', 'mesh.edges_select_sharp'),
    op('Side of Active', 'mesh.select_axis'),
  ];

  const extrude = () => {
    const { totvertsel, totedgesel, totfacesel } = api.totals(), mode = api.selectmode();
    return [
      ...(totfacesel ? [
        { label: 'Extrude Faces', blender: 'view3d.edit_mesh_extrude_move_normal', keys: 'E', run: api.extrudeMove },
        // Stand-in: Blender follows extrude_faces_indiv with Shrink/Fatten, which moves each face along its own normal.
        { label: 'Extrude Individual Faces', blender: 'mesh.extrude_faces_move', run: () => api.move('mesh.extrude_faces_indiv', {}, { normal: true }) },
      ] : []),
      ...(totedgesel && mode & (SCE_SELECT_VERTEX | SCE_SELECT_EDGE) ? [{ label: 'Extrude Edges', blender: 'mesh.extrude_edges_move', run: () => api.move('mesh.extrude_edges_indiv') }] : []),
      ...(totvertsel && mode & SCE_SELECT_VERTEX ? [{ label: 'Extrude Vertices', blender: 'mesh.extrude_vertices_move', run: () => api.move('mesh.extrude_verts_indiv') }] : []),
      '-',
      op('Extrude Repeat', 'mesh.extrude_repeat'),
    ];
  };
  const normals = () => [
    op('Flip', 'mesh.flip_normals'),
    op('Recalculate Outside', 'mesh.normals_make_consistent', { inside: false }, 'Shift N'),
    op('Recalculate Inside', 'mesh.normals_make_consistent', { inside: true }, 'Shift Ctrl N'),
    '-',
    op('Set from Faces', 'mesh.set_normals_from_faces'),
    op('Point to Target', 'mesh.point_normals'),
    op('Merge', 'mesh.merge_normals'),
    op('Split', 'mesh.split_normals'),
    menu('Average', 'VIEW3D_MT_edit_mesh_normals_average', operatorEnum('mesh.average_normals', 'average_type')),
    '-',
    op('Copy Vector', 'mesh.normals_tools', { mode: 'COPY' }),
    op('Paste Vector', 'mesh.normals_tools', { mode: 'PASTE' }),
    op('Smooth Vectors', 'mesh.smooth_normals'),
    op('Reset Vectors', 'mesh.normals_tools', { mode: 'RESET' }),
    '-',
    menu('Select by Face Strength', 'VIEW3D_MT_edit_mesh_normals_select_strength', ['WEAK', 'MEDIUM', 'STRONG'].map((s) => op(s[0] + s.slice(1).toLowerCase(), 'mesh.mod_weighted_strength', { set: false, face_strength: s }))),
    menu('Set Face Strength', 'VIEW3D_MT_edit_mesh_normals_set_strength', ['WEAK', 'MEDIUM', 'STRONG'].map((s) => op(s[0] + s.slice(1).toLowerCase(), 'mesh.mod_weighted_strength', { set: true, face_strength: s }))),
  ];
  const shading = [
    op('Smooth Faces', 'mesh.faces_shade_smooth'),
    op('Flat Faces', 'mesh.faces_shade_flat'),
    '-',
    op('Smooth Edges', 'mesh.mark_sharp', { clear: true }),
    op('Sharp Edges', 'mesh.mark_sharp'),
    '-',
    op('Smooth Vertices', 'mesh.mark_sharp', { use_verts: true, clear: true }),
    op('Sharp Vertices', 'mesh.mark_sharp', { use_verts: true }),
  ];
  const clean = [
    op('Delete Loose', 'mesh.delete_loose'),
    '-',
    op('Decimate Geometry', 'mesh.decimate'),
    op('Degenerate Dissolve', 'mesh.dissolve_degenerate'),
    op('Limited Dissolve', 'mesh.dissolve_limited'),
    op('Make Planar Faces', 'mesh.face_make_planar'),
    '-',
    op('Split Non-Planar Faces', 'mesh.vert_connect_nonplanar'),
    op('Split Concave Faces', 'mesh.vert_connect_concave'),
    op('Merge by Distance', 'mesh.remove_doubles'),
    op('Fill Holes', 'mesh.fill_holes'),
  ];
  const del = () => [
    ...operatorEnum('mesh.delete', 'type'),
    '-',
    op('Dissolve Vertices', 'mesh.dissolve_verts'),
    op('Dissolve Edges', 'mesh.dissolve_edges'),
    op('Dissolve Faces', 'mesh.dissolve_faces'),
    '-',
    op('Limited Dissolve', 'mesh.dissolve_limited'),
    '-',
    op('Collapse Edges & Faces', 'mesh.edge_collapse'),
    op('Edge Loops', 'mesh.delete_edgeloop'),
  ];
  const split = [
    op('Selection', 'mesh.split', undefined, 'Y'),
    '-',
    ...operatorEnum('mesh.edge_split', 'type'),
  ];

  const mesh = () => [
    menu('Transform', 'VIEW3D_MT_transform', [['Move', 'transform.translate', 'G', 'move'], ['Rotate', 'transform.rotate', 'R', 'rotate'], ['Scale', 'transform.resize', 'S', 'scale']]
      .map(([label, blender, keys, type]) => ({ label, blender, keys, run: () => api.start(type) }))),
    '-',
    { label: 'Duplicate', blender: 'mesh.duplicate_move', keys: 'Shift D', run: () => api.move('mesh.duplicate') },
    menu('Extrude', 'VIEW3D_MT_edit_mesh_extrude', extrude, 'Alt E'),
    '-',
    menu('Merge', 'VIEW3D_MT_edit_mesh_merge', api.mergeMenu, 'M'),
    menu('Split', 'VIEW3D_MT_edit_mesh_split', split, 'Alt M'),
    '-',
    op('Symmetrize', 'mesh.symmetrize'),
    op('Snap to Symmetry', 'mesh.symmetry_snap'),
    '-',
    menu('Normals', 'VIEW3D_MT_edit_mesh_normals', normals, 'Alt N'),
    menu('Shading', 'VIEW3D_MT_edit_mesh_shading', shading),
    '-',
    menu('Show/Hide', 'VIEW3D_MT_edit_mesh_showhide', [
      op('Reveal Hidden', 'mesh.reveal', undefined, 'Alt H'),
      op('Hide Selected', 'mesh.hide', undefined, 'H'),
      op('Hide Unselected', 'mesh.hide', { unselected: true }, 'Shift H'),
    ]),
    menu('Clean Up', 'VIEW3D_MT_edit_mesh_clean', clean),
    '-',
    menu('Delete', 'VIEW3D_MT_edit_mesh_delete', del, 'X'),
  ];
  const vertex = () => [
    { label: 'Extrude Vertices', blender: 'mesh.extrude_vertices_move', run: () => api.move('mesh.extrude_verts_indiv') },
    { label: 'Bevel Vertices', blender: 'mesh.bevel', keys: 'Shift Ctrl B', run: () => api.bevel('VERTICES') },
    '-',
    op('New Edge/Face from Vertices', 'mesh.edge_face_add', undefined, 'F'),
    op('Connect Vertex Path', 'mesh.vert_connect_path', undefined, 'J'),
    op('Connect Vertex Pairs', 'mesh.vert_connect'),
    '-',
    op('Smooth Vertices', 'mesh.vertices_smooth', { factor: 0.5 }),
    op('Smooth Vertices (Laplacian)', 'mesh.vertices_smooth_laplacian'),
  ];
  const edge = () => [
    { label: 'Extrude Edges', blender: 'mesh.extrude_edges_move', run: () => api.move('mesh.extrude_edges_indiv') },
    { label: 'Bevel Edges', blender: 'mesh.bevel', keys: 'Ctrl B', run: () => api.bevel('EDGES') },
    op('Bridge Edge Loops', 'mesh.bridge_edge_loops'),
    op('Screw', 'mesh.screw'),
    '-',
    op('Subdivide', 'mesh.subdivide'),
    op('Subdivide Edge-Ring', 'mesh.subdivide_edgering'),
    op('Un-Subdivide', 'mesh.unsubdivide'),
    '-',
    op('Rotate Edge CW', 'mesh.edge_rotate', { use_ccw: false }),
    op('Rotate Edge CCW', 'mesh.edge_rotate', { use_ccw: true }),
    '-',
    { label: 'Edge Slide', blender: 'transform.edge_slide', run: () => api.start('edge_slide') },
    { label: 'Loop Cut and Slide', blender: 'mesh.loopcut_slide', keys: 'Ctrl R', run: api.loopcut },
    { label: 'Offset Edge Slide', blender: 'mesh.offset_edge_loops_slide', run: () => api.slide('mesh.offset_edge_loops') },
    '-',
    op('Mark Sharp', 'mesh.mark_sharp'),
    op('Clear Sharp', 'mesh.mark_sharp', { clear: true }),
    op('Mark Sharp from Vertices', 'mesh.mark_sharp', { use_verts: true }),
    op('Clear Sharp from Vertices', 'mesh.mark_sharp', { use_verts: true, clear: true }),
    op('Set Sharpness by Angle', 'mesh.set_sharpness_by_angle'),
  ];
  const face = () => [
    { label: 'Extrude Faces', blender: 'view3d.edit_mesh_extrude_move_normal', keys: 'E', run: api.extrudeMove },
    { label: 'Extrude Individual Faces', blender: 'mesh.extrude_faces_move', run: () => api.move('mesh.extrude_faces_indiv', {}, { normal: true }) },
    '-',
    { label: 'Inset Faces', blender: 'mesh.inset', keys: 'I', run: api.inset },
    op('Poke Faces', 'mesh.poke'),
    op('Triangulate Faces', 'mesh.quads_convert_to_tris', { quad_method: 'BEAUTY', ngon_method: 'BEAUTY' }, 'Ctrl T'),
    op('Tris to Quads', 'mesh.tris_convert_to_quads', undefined, 'Alt J'),
    op('Solidify Faces', 'mesh.solidify'),
    op('Wireframe', 'mesh.wireframe'),
    '-',
    op('Fill', 'mesh.fill', undefined, 'Alt F'),
    op('Grid Fill', 'mesh.fill_grid'),
    op('Beautify Faces', 'mesh.beautify_fill', undefined, 'Shift Alt F'),
    '-',
    op('Intersect (Knife)', 'mesh.intersect'),
    op('Intersect (Boolean)', 'mesh.intersect_boolean'),
    '-',
    op('Weld Edges into Faces', 'mesh.face_split_by_edges'),
    '-',
    op('Shade Smooth', 'mesh.faces_shade_smooth'),
    op('Shade Flat', 'mesh.faces_shade_flat'),
    '-',
    menu('Face Data', 'VIEW3D_MT_edit_mesh_faces_data', [
      op('Rotate UVs', 'mesh.uvs_rotate'),
      op('Reverse UVs', 'mesh.uvs_reverse'),
      '-',
      op('Flip Quad Tessellation', 'mesh.flip_quad_tessellation'),
    ]),
  ];
  return { select, mesh, vertex, edge, face, extrude, similar, split, delete: del, normals };
}
