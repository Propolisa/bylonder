# The module registry (tree.py): every module of the tree registers itself in globalThis.__py_modules once it has
# loaded, and imports Transcrypt cannot compile statically (in functions, or closing a cycle) look modules up here.
def _module(name):
    return __pragma__('js', '{}', 'globalThis.__py_modules[name]')


def _member(module, name):
    found = getattr(_module(module), name, None)
    return found if found is not None else _module(module + '.' + name)


def _lazy(name):
    return __pragma__('js', '{}', 'new Proxy({}, {get: (target, key) => globalThis.__py_modules[name][key], has: (target, key) => key in globalThis.__py_modules[name]})')
