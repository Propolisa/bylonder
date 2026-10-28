# Blender's _bpy (C, source/blender/python/intern/bpy.cc): Bylonder's side of Blender's Python API. Registered classes
# are kept in `registered` by name, for Bylonder to draw and run; the scripts' paths are Blender's layout, with no
# files behind them.
import _bpy.app as app
import _bpy.data as data
import _bpy.msgbus as msgbus
import _bpy.props as props
import _bpy.types as types
import _bpy.ops as ops
import _bpy._utils_previews as _utils_previews
import _bpy._utils_units as _utils_units

registered = {}

# bpy.context: the context Bylonder sets for the editor drawing or running (blenkernel/context.js), as Blender sets
# the window manager's; with none set, Blender's empty preferences.
_contexts = [{'preferences': {'filepaths': {'script_directories': []}, 'addons': {}, 'view': {}, 'experimental': {}}}]
context = None
__pragma__('js', '{}', '''context = new Proxy({}, {
    get: (target, key) => _contexts.at(-1)[key] ?? null,
    set: (target, key, value) => { _contexts.at(-1)[key] = value; return true; },
});''')


def _context_push(context):
    _contexts.append(context)


def _context_pop():
    _contexts.pop()


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
    return ['/blender/scripts']


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
