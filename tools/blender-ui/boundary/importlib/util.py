# importlib.util for the scripts Blender loads by file (bpy.utils.execfile): the module the tree compiled from that
# file, which loaded with the tree, so executing it again does nothing.
from _files import modules as _modules_by_path
from _modules import _module


class _Loader:
    def exec_module(self, module):
        pass


class ModuleSpec:
    def __init__(self, name, origin):
        self.name, self.origin, self.loader = name, origin, _Loader()


def spec_from_file_location(name, location=None, loader=None, submodule_search_locations=None):
    return ModuleSpec(name, location)


def module_from_spec(spec):
    return _module(_modules_by_path[spec.origin])


def find_spec(name, package=None):
    return ModuleSpec(name, None) if _module(name) is not None else None
