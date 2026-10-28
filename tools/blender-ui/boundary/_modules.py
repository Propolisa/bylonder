# The module registry (tree.py): every module of the tree registers itself in globalThis.__py_modules once it has
# loaded, and imports Transcrypt cannot compile statically (in functions, or closing a cycle) look modules up here.
# The JS below names its variables module_id and member_id: Transcrypt renames `name` and others.
def _module(module_id):
    return __pragma__('js', '{}', 'globalThis.__py_modules[module_id]')


def _member(module_id, member_id):
    found = getattr(_module(module_id), member_id, None)
    return found if found is not None else _module(module_id + '.' + member_id)


def _lazy(module_id):
    return __pragma__('js', '{}', 'new Proxy({}, {get: (target, key) => globalThis.__py_modules[module_id][key], has: (target, key) => key in globalThis.__py_modules[module_id]})')


def _import(name, globals=None, locals=None, fromlist=(), level=0):
    """__import__: the tree's modules are all loaded by its entry, so this only looks the module up."""
    return _lazy(name)


def _globals(module_id):
    """globals() of a module: its names, then its submodules (a package's `globals()[name]` after __import__)."""
    return __pragma__('js', '{}', 'new Proxy({}, {get: (target, key) => { const own = globalThis.__py_modules[module_id]; return own && key in own ? own[key] : _lazy(module_id + "." + String(key)); }})')
