# The module registry (tree.py): every module of the tree registers itself in globalThis.__py_modules once it has
# loaded, and imports Transcrypt cannot compile statically (in functions, or closing a cycle) look modules up here.
# The JS below names its variables module_id and member_id: Transcrypt renames `name` and others.
def _module(module_id):
    """A module, with its submodules as attributes (import a.b in a function binds a), and the attributes code sets on
    it that it does not define (addon_utils marks an add-on's module), kept beside its ES module, which is sealed."""
    return __pragma__('js', '{}', 'globalThis.__py_modules[module_id] && new Proxy(globalThis.__py_modules[module_id], {get: (target, key) => key in target || typeof key !== "string" ? target[key] : key in ((globalThis.__py_module_attrs ??= {})[module_id] ??= {}) ? globalThis.__py_module_attrs[module_id][key] : globalThis.__py_modules[module_id + "." + key], set: (target, key, value) => { if (key in target) target.__py_setattr__(key, value); else ((globalThis.__py_module_attrs ??= {})[module_id] ??= {})[key] = value; return true; }})')


def _member(module_id, member_id):
    found = getattr(_module(module_id), member_id, None)
    return found if found is not None else _module(module_id + '.' + member_id)


def _lazy(module_id):
    return __pragma__('js', '{}', 'new Proxy({}, {get: (target, key) => globalThis.__py_modules[module_id][key], has: (target, key) => key in globalThis.__py_modules[module_id], set: (target, key, value) => { globalThis.__py_modules[module_id].__py_setattr__(key, value); return true; }})')


def _import(name, globals=None, locals=None, fromlist=(), level=0):
    """__import__: the tree's modules are all loaded by its entry, so this only looks the module up."""
    return _lazy(name)


def _globals(module_id):
    """globals() of a module: its names, then its submodules (a package's `globals()[name]` after __import__)."""
    return __pragma__('js', '{}', 'new Proxy({}, {get: (target, key) => { const own = globalThis.__py_modules[module_id]; return own && key in own ? own[key] : _lazy(module_id + "." + String(key)); }})')


# Python's built-in exceptions Transcrypt's runtime lacks, as globals every module sees: addon_utils raises and catches
# ImportError and RuntimeError.
class ImportError(Exception):
    pass


class ModuleNotFoundError(ImportError):
    pass


class RuntimeError(Exception):
    pass


__pragma__('js', '{}', 'Object.assign(globalThis, {ImportError, ModuleNotFoundError, RuntimeError});')
