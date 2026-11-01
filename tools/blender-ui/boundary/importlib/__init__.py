# Modules are loaded with the tree; importing names one returns it, and one the tree lacks (an add-on Bylonder does not
# ship, which the tree only stubs) raises ImportError, as Python's does.
from _modules import _module


def import_module(name, package=None):
    module = _module(name)
    if not module or getattr(module, '__stubbed__', False):
        raise ImportError("No module named '" + name + "'")
    return module


def reload(module):
    return module
