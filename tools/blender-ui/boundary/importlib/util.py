# importlib.util for the scripts Blender loads by file (bpy.utils.execfile): a module the tree compiled from that file,
# which loaded with the tree, so executing it again does nothing; or a preset's source, which runs each time it executes.
from _files import modules as _modules_by_path, scripts as _scripts
from _modules import _module


class _Script:
    pass


class _Loader:
    def __init__(self, origin):
        self.origin = origin

    def exec_module(self, module):
        if self.origin not in _scripts:
            return
        names = {}
        for line in _scripts[self.origin].splitlines():
            line = line.strip()
            if line.startswith('import '):
                names[line[7:]] = _module(line[7:])
            elif line and not line.startswith('#'):
                _py_exec(line, names)


class ModuleSpec:
    def __init__(self, name, origin):
        self.name, self.origin, self.loader = name, origin, _Loader(origin)


def spec_from_file_location(name, location=None, loader=None, submodule_search_locations=None):
    return ModuleSpec(name, location)


def module_from_spec(spec):
    return _Script() if spec.origin in _scripts else _module(_modules_by_path[spec.origin])


def find_spec(name, package=None):
    return ModuleSpec(name, None) if _module(name) is not None else None
