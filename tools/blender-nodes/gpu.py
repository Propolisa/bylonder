"""Blender's GPU code as a JS module (src/nodes/blender/gpu-library.js): the GLSL libraries the nodes Bylonder runs
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
from transpile import TAG, fetch  # noqa: E402

OUT = os.path.join(REPO, 'src', 'nodes', 'blender', 'gpu-library.js')
# Where Blender's shader includes are found, in order.
DIRS = ['source/blender/gpu/shaders/common', 'source/blender/gpu/shaders/material', 'source/blender/compositor/shaders/library',
        'source/blender/gpu/shaders', 'source/blender/draw/intern/shaders']
ROOTS = [
    'gpu_shader_compat_glsl.glsl',
    'gpu_shader_common_math.glsl',
    'gpu_shader_material_clamp.glsl',
    'gpu_shader_material_mix_color.glsl',
    'gpu_shader_compositor_color_balance.glsl',
    'gpu_shader_material_tex_noise.glsl',
    'gpu_shader_common_color_ramp.glsl',
    'gpu_shader_material_bump.glsl',
    'gpu_shader_material_set.glsl',
    # Curves drawing (particle hair, Curves objects): the curve shape library and the hash its strands vary by.
    'draw_curves_lib.glsl',
    'gpu_shader_common_hash.glsl',
    'gpu_shader_utildefines_lib.glsl',
]
# Functions of shaders written in Blender's shader language (.bsl.hh), which the libraries above leave out, as a
# library of their own: (its name, the file, the functions' signatures).
BSL = [('workbench_hair.glsl', 'source/blender/draw/engines/workbench/shaders/workbench_prepass.bsl.hh',
        ['float3 hair_random_normal(', 'void hair_random_material('])]
# Draw engines' shaders the view runs whole (src/draw/overlay-particle.js), by file.
DRAW = ['overlay_particle_vert.glsl', 'overlay_particle_frag.glsl', 'overlay_particle_shape_vert.glsl', 'overlay_particle_shape_frag.glsl',
        'overlay_particle_hair_vert.glsl']
DRAW_DIR = 'source/blender/draw/engines/overlay/shaders'
# name: (C++ file, signature of the function whose switch names the GLSL functions, RNA file, RNA enum items).
TABLES = {
    'math': ('source/blender/nodes/intern/math_functions.cc', 'FloatMathOperationInfo *get_float_math_operation_info(const int operation)',
             'source/blender/makesrna/intern/rna_nodetree.cc', 'rna_enum_node_math_items'),
    'mix_color': ('source/blender/nodes/shader/nodes/node_shader_mix.cc', 'static const char *gpu_shader_get_name(',
                  'source/blender/makesrna/intern/rna_material.cc', 'rna_enum_ramp_blend_items'),
    # Per type, its functions by dimension (1D to 4D).
    'noise': ('source/blender/nodes/shader/nodes/node_shader_tex_noise.cc', 'static const char *gpu_shader_get_name(',
              'source/blender/makesrna/intern/rna_nodetree.cc', 'prop_noise_type'),
}
# The nodes Bylonder runs, by their C++ file.
DECLARATIONS = {
    'ShaderNodeMath': 'source/blender/nodes/shader/nodes/node_shader_math.cc',
    'ShaderNodeMix': 'source/blender/nodes/shader/nodes/node_shader_mix.cc',
    'CompositorNodeColorBalance': 'source/blender/nodes/composite/nodes/node_composite_color_balance.cc',
}


def find(name):
    for directory in DIRS:
        try:
            return fetch(f'{directory}/{name}')
        except Exception:
            continue
    raise FileNotFoundError(name)


def libraries():
    sources, todo = {name: '\n\n'.join(signature.split('(')[0] + '(' + function(fetch(path), signature) for signature in signatures)
                     for name, path, signatures in BSL}, list(ROOTS)
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


def table(cc, function, rna, items):
    """An enum identifier to its function name, or to their list where the switch picks one from an array."""
    switch = body(fetch(cc), function)
    names = dict(re.findall(r'case (\w+):\s*(?:RETURN_OPERATION_INFO\(\s*"[^"]*",\s*|return\s+)"(\w+)"', switch))
    names.update({macro: re.findall(r'"(\w+)"', array) for macro, array in re.findall(r'case (\w+):\s*return std::array\{([^}]*)\}', switch)})
    identifiers = dict(re.findall(r'\{(\w+),\s*"(\w+)"', body(fetch(rna), f'EnumPropertyItem {items}[]')))
    return {identifiers[macro]: name for macro, name in names.items() if macro in identifiers}


def declaration(cc):
    """Per menu socket: its item names in order, and the item each socket it governs is used with (usage_by_menu);
    per output declared align_with_previous, the input whose row it shares."""
    source = fetch(cc)
    tables = {name: re.findall(r'\{(\w+),\s*"\w+",\s*\w+,\s*N_\("([^"]+)"\)', body(source, f'EnumPropertyItem {name}[]'))
              for name in re.findall(r'EnumPropertyItem (\w+)\[\]', source)}
    declare = body(source, re.search(r'static void \w*declare\(', source)[0])
    # The sockets in declaration order: (side, identifier, the builder calls chained on it).
    sockets = [(m[1], m[3] or m[2], declare[m.end():].split('b.add_', 1)[0])
               for m in re.finditer(r'add_(input|output)<decl::\w+>\("([^"]+)"_ustr(?:,\s*"([^"]+)"_ustr)?\)', declare)]
    inputs = {identifier: text for side, identifier, text in sockets if side == 'input'}
    items = {identifier: tables[m[1]] for identifier, text in inputs.items() if (m := re.search(r'\.static_items\((\w+)\)', text))}
    menus = {identifier: {'items': [name for _, name in table], 'usage': {}} for identifier, table in items.items()}
    for identifier, text in inputs.items():
        for menu, macro in re.findall(r'\.usage_by_menu\("([^"]+)"_ustr,\s*(\w+)\)', text):
            menus[menu]['usage'][identifier] = [m for m, _ in items[menu]].index(macro)
    aligned = {identifier: sockets[i - 1][1] for i, (side, identifier, text) in enumerate(sockets)
               if side == 'output' and '.align_with_previous()' in text and i and sockets[i - 1][0] == 'input'}
    return {'menus': menus, 'aligned': aligned}


def main():
    data = {'glsl': libraries(), 'draw': {name: fetch(f'{DRAW_DIR}/{name}') for name in DRAW}, 'functions': {name: table(*spec) for name, spec in TABLES.items()},
            'declarations': {node: declaration(cc) for node, cc in DECLARATIONS.items()}}
    lines = [f'// Generated by tools/blender-nodes/gpu.py from Blender {TAG}; do not edit.']
    lines += [f'export const {key} = {json.dumps(value, indent=1, sort_keys=True)};' for key, value in data.items()]
    open(OUT, 'w').write('\n'.join(lines) + '\n')
    print('wrote', os.path.relpath(OUT, REPO), len(data['glsl']), 'libraries')


if __name__ == '__main__':
    main()
