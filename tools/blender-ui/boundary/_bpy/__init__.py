# Blender's _bpy (C, source/blender/python/intern/bpy.cc): Bylonder's side of Blender's Python API. Registered classes
# are kept in `registered` by name, for Bylonder to draw and run; the scripts' paths are Blender's layout, with no
# files behind them.
import _bpy.app as app
import _bpy.msgbus as msgbus
import _bpy.props as props
import _bpy.types as types
import _bpy.ops as ops
import _bpy._utils_previews as _utils_previews
import _bpy._utils_units as _utils_units
from _bpy._keyconfigs import KeyConfigs

registered = {}

# bpy.context and bpy.data: what Bylonder sets for the editor drawing or running (blenkernel/context.js), as Blender
# sets the window manager's context; with none set, Blender's defaults for its RNA (makesrna/rna.js). Variables:
# _bpy_restrict_state swaps them while scripts load.
__pragma__('js', '{}', '/* js-import {rna, collection} from ../makesrna/rna.js */')
_contexts = []
_datas = []
__pragma__('js', '{}', '''
const window_manager = rna('WindowManager', { keyconfigs: KeyConfigs () });
_datas.push(rna('BlendData', { window_managers: collection([window_manager]) }));
_contexts.push(rna('Context', { window_manager, preferences: rna('Preferences', {}), blend_data: _datas[0] }));
const top = (stack) => new Proxy({}, {
    get: (target, key) => stack.at(-1)[key],
    set: (target, key, value) => { stack.at(-1)[key] = value; return true; },
    has: (target, key) => key in stack.at(-1),
});''')
context = None
data = None
__pragma__('js', '{}', 'context = top(_contexts); data = top(_datas);')


def _context_set(context, data=None):
    """The context Bylonder draws or runs with, in place of the one it set before (Blender's defaults stay below)."""
    if len(_contexts) > 1:
        _context_pop()
    _context_push(context, data)


def _context_push(context, data=None):
    _contexts.append(context)
    _datas.append(data or _datas[-1])


def _context_pop():
    _contexts.pop()
    _datas.pop()


def register_class(cls):
    registered[getattr(cls, 'bl_idname', None) or cls.__name__] = cls
    if hasattr(cls, 'register'):
        cls.register()


def unregister_class(cls):
    registered.pop(getattr(cls, 'bl_idname', None) or cls.__name__, None)
    if hasattr(cls, 'unregister'):
        cls.unregister()


def register_cli_command(identifier, execute):
    return None


def unregister_cli_command(handle):
    return None


def resource_path(resource_type, major=5, minor=2):
    return '/blender/' + resource_type.lower()


def user_resource(resource_type, path='', create=False):
    return '/blender/user/' + resource_type.lower() + ('/' + path if path else '')


def system_resource(resource_type, path=''):
    return '/blender/system/' + resource_type.lower() + ('/' + path if path else '')


def script_paths():
    """(system, user): Blender's scripts; the browser has no user scripts folder."""
    return ('/blender/scripts', '')


def blend_paths(absolute=False, packed=False, local=False):
    return []


def escape_identifier(text):
    return text.replace('\\', '\\\\').replace('"', '\\"')


def unescape_identifier(text):
    return text.replace('\\"', '"').replace('\\\\', '\\')


def flip_name(name, strip_digits=False):
    for left, right in (('.L', '.R'), ('_L', '_R'), ('Left', 'Right'), ('left', 'right')):
        if name.endswith(left):
            return name[:-len(left)] + right
        if name.endswith(right):
            return name[:-len(right)] + left
    return name


def _bl_owner_id_get():
    return None


def _bl_owner_id_set(owner):
    return None


def _wm_capabilities():
    return {}


def _ghost_backend():
    return 'BROWSER'
