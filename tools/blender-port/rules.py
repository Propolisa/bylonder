"""How Blender's C++ maps onto Bylonder's JS. This is the file to edit as Blender's API changes: each table states one
convention; the converter applies them through Clang's AST."""

# BMesh element types and their pools: `BMEdge *e` is an index into bm.e.
POOL = {'BMVert': 'v', 'BMEdge': 'e', 'BMFace': 'f', 'BMLoop': 'l'}
HTYPE = {'v': 'BM_VERT', 'e': 'BM_EDGE', 'f': 'BM_FACE', 'l': 'BM_LOOP'}
# Vector fields of elements, read through a helper: `v->co` is `vco(bm, v)`.
VEC_FIELDS = {('v', 'co'): 'vco', ('v', 'no'): 'vno', ('f', 'no'): 'fno'}
# Header fields that are pool fields: `v->head.hflag` is `bm.v.hflag[v]`.
HEADER_FIELDS = {'hflag', 'index', 'api_flag'}

# Vector and matrix functions writing their first argument: fn(out, ...args) is `out = js(...args)`.
OUT_FIRST = {
    'copy_v3_v3': lambda a: f'{a[0]}.slice(0, 3)', 'copy_v3_v3_db': lambda a: f'{a[0]}.slice(0, 3)', 'copy_v2_v2': lambda a: f'{a[0]}.slice(0, 2)',
    'copy_v4_v4': lambda a: f'{a[0]}.slice(0, 4)', 'copy_v3_fl': lambda a: f'[{a[0]}, {a[0]}, {a[0]}]', 'copy_v3_fl3': lambda a: f'[{", ".join(a)}]',
    'zero_v3': lambda a: '[0, 0, 0]', 'unit_m4': lambda a: 'unit_m4()', 'unit_m3': lambda a: 'unit_m3()',
    'copy_m4_m4': lambda a: f'{a[0]}.map((c) => [...c])',
    'add_v3_v3v3': 'add_v3', 'sub_v3_v3v3': 'sub_v3', 'mul_v3_v3fl': 'mul_v3_fl', 'madd_v3_v3v3fl': 'madd', 'cross_v3_v3v3': 'cross_v3',
    'interp_v3_v3v3': 'interp_v3', 'mid_v3_v3v3': 'mid_v3', 'negate_v3_v3': 'negate_v3', 'normalize_v3_v3': 'normalize_v3',
    'mul_v3_m4v3': 'mul_m4_v3', 'mul_v3_m3v3': 'mul_m3_v3',
}
# Functions updating one argument in place, the first unless an index says: fn(inout, ...args) is
# `inout = js(inout, ...args)`; mul_m4_v3(M, r) transforms r.
IN_OUT = {'add_v3_v3': 'add_v3', 'sub_v3_v3': 'sub_v3', 'mul_v3_fl': 'mul_v3_fl', 'madd_v3_v3fl': 'madd', 'negate_v3': 'negate_v3',
          'normalize_v3': 'normalize_v3', 'mul_m4_v4': ('mul_m4_v4', 1), 'mul_m4_v3': ('mul_m4_v3', 1), 'mul_m3_v3': ('mul_m3_v3', 1)}
# Functions returning a value whose port has another name.
RENAME = {
    'dot_v3v3': 'dot_v3', 'fabsf': 'Math.abs', 'fabs': 'Math.abs', 'abs': 'Math.abs', 'sqrtf': 'Math.sqrt', 'sqrt': 'Math.sqrt',
    'cosf': 'Math.cos', 'cos': 'Math.cos', 'sinf': 'Math.sin', 'sin': 'Math.sin', 'tanf': 'Math.tan', 'acosf': 'Math.acos',
    'asinf': 'Math.asin', 'atan2f': 'Math.atan2', 'atan2': 'Math.atan2', 'powf': 'Math.pow', 'pow': 'Math.pow', 'floorf': 'Math.floor',
    'ceilf': 'Math.ceil', 'expf': 'Math.exp', 'logf': 'Math.log', 'min_ff': 'Math.min', 'max_ff': 'Math.max', 'min_ii': 'Math.min',
    'max_ii': 'Math.max', 'min_dd': 'Math.min', 'max_dd': 'Math.max', 'fmaxf': 'Math.max', 'fminf': 'Math.min', 'min': 'Math.min',
    'max': 'Math.max', 'safe_acosf': 'saacos', 'cbrtf': 'Math.cbrt', 'cbrt': 'Math.cbrt', 'hypotf': 'Math.hypot', 'isfinite': 'Number.isFinite',
    'isnan': 'Number.isNaN',
}
# Macros and constants with a JS equivalent.
CONSTANTS = {'M_PI': 'Math.PI', 'M_PI_2': 'Math.PI / 2', 'M_PI_4': 'Math.PI / 4', 'M_SQRT2': 'Math.SQRT2', 'M_SQRT1_2': 'Math.SQRT1_2',
             'M_SQRT3': 'Math.sqrt(3)', 'M_SQRT1_3': 'Math.sqrt(1 / 3)', 'FLT_MAX': 'Number.MAX_VALUE', 'DBL_MAX': 'Number.MAX_VALUE',
             'FLT_EPSILON': '1.1920929e-7', 'INT_MAX': '2147483647', 'UINT_MAX': '4294967295', 'M_2PI': '2 * Math.PI', '__func__': "''"}
# Statements that have no JS counterpart: memory management (arenas and pools hand out JS objects) and debug checks.
DROPPED_CALLS = {'UNUSED_VARS', 'MEM_freeN', 'MEM_SAFE_FREE', 'MEM_delete', 'MEM_delete_array'}
DROPPED_CALL_PREFIXES = ('BLI_memarena_', 'BLI_mempool_')
DROPPED_FIELDS = {'mem_arena'}
ALLOCATORS = {'BLI_memarena_alloc', 'BLI_memarena_calloc', 'BLI_mempool_alloc', 'BLI_mempool_calloc', 'MEM_mallocN', 'MEM_callocN', 'MEM_new_zeroed', 'MEM_new_uninitialized'}
# Allocators whose first argument is the element count.
COUNTED_ALLOCATORS = {'MEM_malloc_arrayN', 'MEM_calloc_arrayN', 'MEM_new_array_uninitialized', 'MEM_new_array_zeroed'}
REALLOCATORS = {'MEM_realloc_uninitialized_id', 'MEM_reallocN_id', 'MEM_recallocN_id'}
# Declarations the port has no use for.
DROPPED_TYPES = {'BMIter', 'MemArena', 'BLI_mempool', 'bl_port_iter'}
# blender::Vector, Map and Set as JS arrays, Maps and Sets.
ARRAY_TYPES = {'Vector', 'Array', 'Span', 'MutableSpan'}
# Types that only wrap an integer for operator overloading, used as the integer.
INTEGER_WRAPPERS = {'BitwiseNotEnumValue'}
VECTOR_CONSTRUCTORS = {'float3', 'double3', 'float2', 'float4', 'int3', 'int2'}
METHODS = {'append': 'push', 'remove_last': 'pop', 'lookup': 'get', 'contains': 'has', 'remove': 'delete'}

# The JS module of each helper the rules above emit.
HELPER_MODULES = {
    'blenlib/math-geom.js': {'add_v3', 'sub_v3', 'mul_v3_fl', 'madd', 'cross_v3', 'dot_v3', 'len_v3', 'len_squared_v3', 'interp_v3', 'mid_v3',
                             'negate_v3', 'normalize_v3', 'saacos'},
    'blenlib/math-matrix.js': {'unit_m4', 'unit_m3', 'mul_m4_v3', 'mul_m4_v4', 'mul_m3_v3'},
    'bmesh/intern/bmesh-class.js': {'vco', 'vno', 'fno', 'BM_ELEM_API_FLAG_ENABLE', 'BM_ELEM_API_FLAG_DISABLE', 'BM_ELEM_API_FLAG_TEST',
                                    'BM_elem_flag_test', 'BM_elem_flag_enable', 'BM_elem_flag_disable', 'BM_elem_flag_set',
                                    'BMO_flag_test', 'BMO_flag_enable', 'BMO_flag_disable', 'BMO_flag_set', 'BM_ELEM_CD_GET_FLOAT',
                                    'BM_ELEM_CD_GET_FLOAT_P', 'BM_ELEM_CD_GET_VOID_P', 'BM_ELEM_CD_GET_INT', 'BM_ELEM_CD_SET_FLOAT'},
}
# Where the shims of the prelude's macros live, and which of them take the mesh. The prelude keeps a macro only
# when its expansion has no JS form (BM_DISK_EDGE_NEXT indexes a struct by a comparison).
PRELUDE_HOMES = {'INIT_MINMAX': 'blenlib/utildefines.js', 'INIT_MINMAX2': 'blenlib/utildefines.js',
                 **{n: 'bmesh/intern/bmesh-class.js' for n in ('BM_DISK_EDGE_NEXT', 'BM_DISK_EDGE_PREV')}}
PRELUDE_NEEDS_BM = {'BM_DISK_EDGE_NEXT', 'BM_DISK_EDGE_PREV'}

# Blender sources whose port lives in a module of another name (paths below source/blender, or below the source root
# for the rest, as regexes).
MODULE_FOR_SOURCE = {
    r'blenlib/BLI_math_(vector|geom|base|solvers)': 'blenlib/math-geom.js', r'blenlib/BLI_math_matrix': 'blenlib/math-matrix.js',
    r'blenlib/BLI_math_rotation': 'blenlib/math-rotation.js', r'blenlib/intern/math_(vector|geom|base)': 'blenlib/math-geom.js',
    r'blenlib/intern/math_matrix': 'blenlib/math-matrix.js', r'blenlib/intern/math_rotation': 'blenlib/math-rotation.js', r'blenlib/BLI_kdtree': 'blenlib/kdtree.js',
    r'bmesh/intern/bmesh_iterators': 'bmesh/intern/bmesh-query.js', r'bmesh/intern/bmesh_inline': 'bmesh/intern/bmesh-class.js',
    r'bmesh/bmesh_class': 'bmesh/intern/bmesh-class.js', r'bmesh/intern/bmesh_private': 'bmesh/intern/bmesh-class.js',
    r'bmesh/intern/bmesh_operator_api': 'bmesh/intern/bmesh-operators.js', r'intern/eigen/': 'intern/eigen.js',
}
