# Modules are loaded with the tree; importing names one returns it.
from _modules import _module


def import_module(name, package=None):
    return _module(name)


def reload(module):
    return module
