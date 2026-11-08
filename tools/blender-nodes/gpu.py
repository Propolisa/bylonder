"""Blender's GPU code as JS modules (src/nodes/blender/gpu-library.js, src/compositor/compositor-shaders.js): the GLSL libraries the nodes Bylonder runs
link (ROOTS, with what they include); the draw engines' shaders the view runs whole (DRAW); the tables Blender's node code selects a node's GLSL
function with (TABLES: an enum identifier to a function name, read from the node's C++ switch and the RNA enum's
items); and what a node's declaration says that Python does not show (DECLARATIONS): menu sockets' items with the
sockets each item uses, and outputs drawn on the row of the input before them.

usage: python3 tools/blender-nodes/gpu.py
"""
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(os.path.dirname(HERE))
sys.path.insert(0, os.path.join(REPO, 'tools', 'blender-ui'))
from transpile import TAG, fetch, listing  # noqa: E402

OUT = os.path.join(REPO, 'src', 'nodes', 'blender', 'gpu-library.js')
# The compositor's compute shaders, with the libraries they include that gpu-library.js has not, which the views replay
# (src/compositor/compositor-replay.js); a module of their own, loaded when a view composites.
COMPUTE_OUT = os.path.join(REPO, 'src', 'compositor', 'compositor-shaders.js')
COMPUTE = 'source/blender/compositor/shaders'
# Where Blender's shader includes are found, in order.
DIRS = ['source/blender/gpu/shaders/common', 'source/blender/gpu/shaders/material', 'source/blender/compositor/shaders/library',
        'source/blender/gpu/shaders', 'source/blender/draw/intern/shaders', COMPUTE]
ROOTS = [
    'gpu_shader_compat_glsl.glsl',
    'gpu_shader_common_math.glsl',
    'gpu_shader_material_clamp.glsl',
    'gpu_shader_material_mix_color.glsl',
    'gpu_shader_compositor_color_balance.glsl',
    'gpu_shader_material_tex_noise.glsl',
    'gpu_shader_material_tex_image.glsl',
    'gpu_shader_common_color_ramp.glsl',
    'gpu_shader_material_bump.glsl',
    'gpu_shader_material_hair_info.glsl',
    'gpu_shader_material_set.glsl',
    'gpu_shader_material_vector_math.glsl',
    'gpu_shader_material_map_range.glsl',
    'gpu_shader_material_mapping.glsl',
    'gpu_shader_common_mix_rgb.glsl',
    'gpu_shader_material_hue_sat_val.glsl',
    'gpu_shader_material_bright_contrast.glsl',
    'gpu_shader_material_invert.glsl',
    'gpu_shader_material_gamma.glsl',
    'gpu_shader_material_separate_xyz.glsl',
    'gpu_shader_material_combine_xyz.glsl',
    'gpu_shader_material_separate_color.glsl',
    'gpu_shader_material_combine_color.glsl',
    'gpu_shader_material_rgb_to_bw.glsl',
    'gpu_shader_material_normal.glsl',
    'gpu_shader_material_vector_rotate.glsl',
    'gpu_shader_material_tex_gradient.glsl',
    'gpu_shader_material_tex_wave.glsl',
    'gpu_shader_material_tex_voronoi.glsl',
    'gpu_shader_material_tex_checker.glsl',
    'gpu_shader_material_tex_brick.glsl',
    'gpu_shader_material_tex_magic.glsl',
    'gpu_shader_material_tex_white_noise.glsl',
    'gpu_shader_material_geometry.glsl',
    'gpu_shader_material_object_info.glsl',
    'gpu_shader_material_attribute.glsl',
    'gpu_shader_material_vertex_color.glsl',
    'gpu_shader_material_uv_map.glsl',
    'gpu_shader_material_fresnel.glsl',
    'gpu_shader_material_layer_weight.glsl',
    'gpu_shader_material_normal_map.glsl',
    'gpu_shader_material_light_path.glsl',
    'gpu_shader_material_camera.glsl',
    'gpu_shader_material_tangent.glsl',
    'gpu_shader_material_wireframe.glsl',
    'gpu_shader_material_blackbody.glsl',
    'gpu_shader_material_wavelength.glsl',
    'gpu_shader_common_curves.glsl',
    'gpu_shader_material_tex_gabor.glsl',
    'gpu_shader_material_squeeze.glsl',
    'gpu_shader_material_radial_tiling.glsl',
    'gpu_shader_material_light_falloff.glsl',
    'gpu_shader_material_bevel.glsl',
    'gpu_shader_material_ambient_occlusion.glsl',
    'gpu_shader_material_displacement.glsl',
    'gpu_shader_material_vector_displacement.glsl',
    'gpu_shader_material_transform_utils.glsl',
    'gpu_shader_common_math_utils.glsl',
    # A world's shader: its Background and the sky and environment textures it reads.
    'gpu_shader_material_background.glsl',
    'gpu_shader_material_tex_sky.glsl',
    'gpu_shader_material_tex_environment.glsl',
    # Curves drawing (particle hair, Curves objects): the curve shape library and the hash its strands vary by.
    'draw_curves_lib.glsl',
    'gpu_shader_common_hash.glsl',
    'gpu_shader_utildefines_lib.glsl',
]
# Every GLSL library of Blender's compositor: the functions its pixel nodes' GPU code links (node_gpu_material).
COMPOSITOR_LIBRARY = 'source/blender/compositor/shaders/library'
# Functions of shaders written in Blender's shader language (.bsl.hh), which the libraries above leave out, as a
# library of their own: (its name, the file, the functions' signatures).
BSL = [('workbench_hair.glsl', 'source/blender/draw/engines/workbench/shaders/workbench_prepass.bsl.hh',
        ['float3 hair_random_normal(', 'void hair_random_material('])]
# Draw engines' shaders the view runs whole (src/draw/overlay-particle.js, overlay-armature.js), by file.
DRAW = ['overlay_particle_vert.glsl', 'overlay_particle_frag.glsl', 'overlay_particle_shape_vert.glsl', 'overlay_particle_shape_frag.glsl',
        'overlay_particle_hair_vert.glsl', 'overlay_edit_particle_strand_vert.glsl', 'overlay_varying_color.glsl',
        'overlay_edit_particle_point_vert.glsl', 'overlay_point_varying_color_frag.glsl', 'overlay_common_lib.glsl',
        'overlay_armature_shape_solid_vert.glsl', 'overlay_armature_shape_solid_frag.glsl', 'overlay_armature_shape_outline_vert.glsl',
        'overlay_armature_shape_wire_vert.glsl', 'overlay_armature_shape_wire_frag.glsl', 'overlay_armature_wire_frag.glsl',
        'overlay_armature_sphere_solid_vert.glsl', 'overlay_armature_sphere_solid_frag.glsl', 'overlay_armature_sphere_outline_vert.glsl',
        'overlay_armature_envelope_solid_vert.glsl', 'overlay_armature_envelope_solid_frag.glsl',
        'overlay_armature_envelope_outline_vert.glsl', 'overlay_armature_stick_vert.glsl', 'overlay_armature_stick_frag.glsl',
        'overlay_armature_wire_vert.glsl', 'overlay_armature_dof_vert.glsl', 'overlay_armature_dof_solid_frag.glsl',
        'overlay_extra_vert.glsl', 'overlay_extra_frag.glsl', 'overlay_extra_wire_vert.glsl', 'overlay_extra_wire_frag.glsl',
        'overlay_paint_weight_vert.glsl', 'overlay_paint_weight_frag.glsl']
DRAW_DIR = 'source/blender/draw/engines/overlay/shaders'
# name: (C++ file, signature of the function whose switch names the GLSL functions, RNA file, RNA enum items, and
# where in the C++ file to look when it has two such functions).
NODES, RNA = 'source/blender/nodes/shader/nodes/', 'source/blender/makesrna/intern/rna_nodetree.cc'
GET_NAME = 'static const char *gpu_shader_get_name('
TABLES = {
    'math': ('source/blender/nodes/intern/math_functions.cc', 'FloatMathOperationInfo *get_float_math_operation_info(const int operation)',
             'source/blender/makesrna/intern/rna_nodetree.cc', 'rna_enum_node_math_items'),
    'mix_color': ('source/blender/nodes/shader/nodes/node_shader_mix.cc', 'static const char *gpu_shader_get_name(',
                  'source/blender/makesrna/intern/rna_material.cc', 'rna_enum_ramp_blend_items'),
    # Per type, its functions by dimension (1D to 4D).
    'noise': ('source/blender/nodes/shader/nodes/node_shader_tex_noise.cc', 'static const char *gpu_shader_get_name(',
              'source/blender/makesrna/intern/rna_nodetree.cc', 'prop_noise_type'),
    'vector_math': (NODES + 'node_shader_vector_math.cc', GET_NAME, RNA, 'rna_enum_node_vec_math_items'),
    # The float functions; the vector ones are named with vector_ before them.
    'map_range': (NODES + 'node_shader_map_range.cc', GET_NAME, RNA, 'rna_enum_node_map_range_items'),
    'mapping': (NODES + 'node_shader_mapping.cc', GET_NAME, RNA, 'rna_enum_mapping_type_items'),
    'mix_rgb': (NODES + 'node_shader_mix_rgb.cc', GET_NAME, 'source/blender/makesrna/intern/rna_material.cc', 'rna_enum_ramp_blend_items'),
    'separate_color': (NODES + 'node_shader_sepcomb_color.cc', GET_NAME, RNA, 'rna_enum_node_combsep_color_items', 'node_shader_separate_color_cc {'),
    'combine_color': (NODES + 'node_shader_sepcomb_color.cc', GET_NAME, RNA, 'rna_enum_node_combsep_color_items', 'node_shader_combine_color_cc {'),
    'vector_rotate': (NODES + 'node_shader_vector_rotate.cc', GET_NAME, RNA, 'rna_enum_vector_rotate_type_items'),
    # Per feature, its functions by dimension (1D to 4D).
    'voronoi': (NODES + 'node_shader_tex_voronoi.cc', 'static const char *gpu_shader_get_name(const int feature', RNA, 'prop_feature_items'),
}
# The shader nodes Bylonder runs whose declarations have menus, by their C++ file; every compositor node is added
# (compositor_declarations).
DECLARATIONS = {
    'ShaderNodeMath': 'source/blender/nodes/shader/nodes/node_shader_math.cc',
    'ShaderNodeMix': 'source/blender/nodes/shader/nodes/node_shader_mix.cc',
}
COMPOSITOR_NODES = 'source/blender/nodes/composite/nodes'
# Where the RNA enums node declarations take their items from (static_items) are defined.
ENUM_FILES = [RNA, 'source/blender/makesrna/intern/rna_scene.cc', 'source/blender/makesrna/intern/rna_material.cc']


def compositor_declarations():
    """Every compositor node's C++ file, by the idname it registers, that declares sockets."""
    files = {}
    for path in listing(COMPOSITOR_NODES, '.cc'):
        source = fetch(path)
        idname = re.search(r'cmp_node_type_base\(&ntype,\s*"(\w+)"', source)
        if idname and re.search(r'static void \w*declare\(', source):
            files[idname[1]] = path
    return files


def find(name):
    for directory in DIRS:
        try:
            return fetch(f'{directory}/{name}')
        except Exception:
            continue
    raise FileNotFoundError(name)


def libraries():
    return with_includes({name: '\n\n'.join(signature.split('(')[0] + '(' + function(fetch(path), signature) for signature in signatures)
                          for name, path, signatures in BSL}, ROOTS + [os.path.basename(p) for p in listing(COMPOSITOR_LIBRARY, '.glsl')])


def compute_shaders(libraries):
    """The compositor's compute shaders (its shaders directory, without its library) and what they include that
    `libraries` has not."""
    names = [os.path.basename(p) for p in listing(COMPUTE, '.glsl') if os.path.dirname(p) == COMPUTE]
    sources = with_includes(dict(libraries), names)
    return {name: text for name, text in sources.items() if name not in libraries}


def with_includes(sources, todo):
    """`sources` with the files named in `todo` and the GLSL files they include, by name."""
    while todo:
        name = todo.pop(0)
        if name in sources:
            continue
        sources[name] = find(name)
        todo += [n for n in re.findall(r'^#include "([^"]+\.glsl)"', sources[name], re.M) if n not in sources]
    return sources


def function(source, signature):
    """A function's text from its signature's parameters to its closing brace."""
    start = source.index(signature) + len(signature)
    return source[start:start + len(body(source, signature))  + source[start:].index('{')]


def body(source, signature):
    """The braced body following the first occurrence of signature."""
    start = source.index('{', source.index(signature))
    depth = 0
    for i in range(start, len(source)):
        depth += {'{': 1, '}': -1}.get(source[i], 0)
        if depth == 0:
            return source[start:i + 1]
    raise ValueError(signature)


def table(cc, function, rna, items, after=''):
    """An enum identifier to its function name, or to their list where the switch picks one from an array."""
    source = fetch(cc)
    switch = body(source[source.index(after):], function)
    names = dict(re.findall(r'case (\w+):\s*(?:RETURN_OPERATION_INFO\(\s*"[^"]*",\s*|return\s+)"(\w+)"', switch))
    names.update({macro: re.findall(r'"(\w+)"', array) for macro, array in re.findall(r'case (\w+):\s*return std::array\{([^}]*)\}', switch)})
    identifiers = dict(re.findall(r'\{(\w+),\s*"(\w+)"', body(fetch(rna), f'EnumPropertyItem {items}[]')))
    return {identifiers[macro]: name for macro, name in names.items() if macro in identifiers}


def enum_tables(source):
    """A file's enum item arrays: per array, each item's macro and UI name."""
    return {name: re.findall(r'\{(\w+),\s*"\w+",\s*\w+,\s*N_\("([^"]+)"\)', body(source, f'EnumPropertyItem {name}[]'))
            for name in re.findall(r'EnumPropertyItem (\w+)\[\]', source)}


def declaration(cc):
    """Per menu socket: its item names in order, and the items each socket it governs is used with (usage_by_menu);
    per output declared align_with_previous, the input whose row it shares."""
    source = fetch(cc)
    tables = {**{k: v for f in ENUM_FILES for k, v in enum_tables(fetch(f)).items()}, **enum_tables(source)}
    declare = body(source, re.search(r'static void \w*declare\(', source)[0])
    # The sockets in declaration order: (side, identifier, the builder calls chained on it).
    sockets = [(m[1], m[3] or m[2], re.split(r'\.add_(?:input|output|panel|layout)', declare[m.end():], maxsplit=1)[0])
               for m in re.finditer(r'add_(input|output)<decl::\w+>\("([^"]+)"_ustr(?:,\s*"([^"]+)"_ustr)?\)', declare)]
    inputs = {identifier: text for side, identifier, text in sockets if side == 'input'}
    items = {identifier: tables[m[1]] for identifier, text in inputs.items() if (m := re.search(r'\.static_items\((\w+)\)', text)) and m[1] in tables}
    menus = {identifier: {'items': [name for _, name in table], 'usage': {}} for identifier, table in items.items()}
    for identifier, text in inputs.items():
        for menu, values in re.findall(r'\.usage_by_menu\("([^"]+)"_ustr,\s*(\w+|\{[^}]*\})\)', text):
            macros = [m for m, _ in items.get(menu, [])]
            used = [macros.index(v) for v in re.findall(r'\w+', values) if v in macros]
            if used:
                menus[menu]['usage'][identifier] = used
    aligned = {identifier: sockets[i - 1][1] for i, (side, identifier, text) in enumerate(sockets)
               if side == 'output' and '.align_with_previous()' in text and i and sockets[i - 1][0] == 'input'}
    return {'menus': menus, 'aligned': aligned}


def main():
    data = {'glsl': libraries(), 'draw': {name: fetch(f'{DRAW_DIR}/{name}') for name in DRAW}, 'functions': {name: table(*spec) for name, spec in TABLES.items()},
            'declarations': {node: declaration(cc) for node, cc in {**DECLARATIONS, **compositor_declarations()}.items()}}
    lines = [f'// Generated by tools/blender-nodes/gpu.py from Blender {TAG}; do not edit.']
    lines += [f'export const {key} = {json.dumps(value, indent=1, sort_keys=True)};' for key, value in data.items()]
    open(OUT, 'w', newline='\n').write('\n'.join(lines) + '\n')
    print('wrote', os.path.relpath(OUT, REPO), len(data['glsl']), 'libraries')
    compute = compute_shaders(data['glsl'])
    open(COMPUTE_OUT, 'w', newline='\n').write(f'// Generated by tools/blender-nodes/gpu.py from Blender {TAG}; do not edit.\n'
                                              f'export const compute = {json.dumps(compute, indent=1, sort_keys=True)};\n')
    print('wrote', os.path.relpath(COMPUTE_OUT, REPO), len(compute), 'shaders')


if __name__ == '__main__':
    main()
