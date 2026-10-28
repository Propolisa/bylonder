# CPython's view of Blender's Python tree (src/bl_py, transpiled to JS): any module the tree has and CPython lacks
# (bpy, mathutils, bpy_extras, bl_ui, ...) imports as a JS-backed module, and every value from it is a thin proxy that
# forwards attribute access, calls, items, iteration and operators to the JS object with Python's meaning
# (_bylonder_js, src/python/pyodide.js). Nothing of bpy is reimplemented here.
import builtins
import importlib.abc
import importlib.machinery
import sys
import traceback
import types

from pyodide.ffi import JsException, JsProxy, create_proxy, to_js

import _bylonder_js as js


def wrap(value, this=None):
    if not isinstance(value, JsProxy):
        return value
    module = sys.modules.get(js.moduleName(value)) if js.isModule(value) else None
    if isinstance(module, JsModule):
        return module
    return (JsFunction if js.isCallable(value) else JsObject)(value, this)


def unwrap(value):
    if isinstance(value, JsObject):
        return object.__getattribute__(value, '_js')
    if isinstance(value, JsModule):
        return js.module(value.__name__)
    if isinstance(value, (list, tuple)):
        return to_js([unwrap(v) for v in value])
    if isinstance(value, (set, frozenset)):
        return js.pySet(to_js([unwrap(v) for v in value]))
    if isinstance(value, dict):
        return to_js({k: unwrap(v) for k, v in value.items()}, dict_converter=js.pyDict)
    if callable(value):
        return js.pyFunction(create_proxy(lambda args, kwargs: unwrap(value(*map(wrap, args), **{k: wrap(v) for k, v in kwargs}))))
    return value


def _js_error(error):
    message = str(error).removeprefix('Error: ')
    return (AttributeError if 'AttributeError' in message else KeyError if 'KeyError' in message else IndexError if 'IndexError' in message
            else TypeError if 'TypeError' in message else RuntimeError)(message)


class JsObject:
    __slots__ = ('_js', '_this')

    def __init__(self, value, this=None):
        object.__setattr__(self, '_js', value)
        object.__setattr__(self, '_this', this)

    def __getattr__(self, name):
        if name in ('foreach_get', 'foreach_set') and js.isCollection(self._js):
            return lambda attr, seq: (_foreach_get if name == 'foreach_get' else _foreach_set)(self._js, attr, seq)
        try:
            return wrap(js.getattr(self._js, name), self._js)
        except JsException as error:
            raise AttributeError(name) from _js_error(error)

    def __setattr__(self, name, value):
        try:
            js.setattr(self._js, name, unwrap(value))
        except JsException as error:
            raise _js_error(error) from None

    def __getitem__(self, key):
        if isinstance(key, slice):
            return [self[i] for i in range(*key.indices(len(self)))]
        try:
            return wrap(js.getitem(self._js, unwrap(key)))
        except JsException as error:
            raise _js_error(error) from None

    def __setitem__(self, key, value):
        js.setitem(self._js, unwrap(key), unwrap(value))

    def __len__(self):
        return js.len(self._js)

    def __iter__(self):
        return (wrap(v) for v in js.iterate(self._js))

    def __contains__(self, value):
        return js.contains(self._js, unwrap(value))

    def __bool__(self):
        return js.truth(self._js)

    def __repr__(self):
        return js.repr(self._js)

    def __str__(self):
        return js.str(self._js)

    def __dir__(self):
        return list(js.dir(self._js))

    def __eq__(self, other):
        return js.equals(self._js, unwrap(other))

    def __hash__(self):
        return js.identity(self._js)


class JsFunction(JsObject):
    __slots__ = ()

    def __call__(self, *args, **kwargs):
        try:
            return wrap(js.call(self._js, self._this, to_js([unwrap(a) for a in args]), to_js({k: unwrap(v) for k, v in kwargs.items()}, dict_converter=js.pyDict)))
        except JsException as error:
            raise _js_error(error) from None


def _foreach_get(collection, attr, seq):
    """bpy_prop_collection.foreach_get: every item's value into seq, one copy across the bridge."""
    values = memoryview(js.foreachGet(collection, attr).to_py()).cast('B').cast('d')
    if hasattr(seq, '__array_interface__'):
        import numpy
        seq.reshape(-1)[:] = numpy.frombuffer(values, dtype=numpy.float64)
    elif len(seq) != len(values):
        raise TypeError(f'foreach_get(attr, sequence): sequence length {len(seq)} does not match {len(values)}')
    else:
        numbers = values.tolist()
        seq[:] = type(seq)(seq.typecode, numbers) if hasattr(seq, 'typecode') else [type(old)(new) for old, new in zip(seq, numbers)]


def _foreach_set(collection, attr, seq):
    """bpy_prop_collection.foreach_set: seq into every item's value, one copy across the bridge."""
    import array
    if hasattr(seq, '__array_interface__'):
        import numpy
        values = numpy.ascontiguousarray(seq, dtype=numpy.float64).reshape(-1)
    else:
        values = array.array('d', seq)
    js.foreachSet(collection, attr, to_js(memoryview(values)))


# Python's operators on JS values, by the tree's runtime (__add__, ...), which dispatches to the values' own methods.
for _name in ('add', 'sub', 'mul', 'truediv', 'floordiv', 'mod', 'pow', 'matmul', 'lt', 'le', 'gt', 'ge'):
    setattr(JsObject, f'__{_name}__', lambda a, b, op=f'__{_name}__': wrap(js.binary(op, a._js, unwrap(b))))
    setattr(JsObject, f'__r{_name}__', lambda a, b, op=f'__{_name}__': wrap(js.binary(op, unwrap(b), a._js)))
JsObject.__neg__ = lambda a: wrap(js.unary('__neg__', a._js))


class JsModule(types.ModuleType):
    """A module of the tree, its attributes the JS module's (and its PEP 562 __getattr__'s)."""

    def __getattr__(self, name):
        if name.startswith('__') and name.endswith('__') and name not in ('__all__', '__doc__'):
            raise AttributeError(name)
        try:
            return wrap(js.getattr(js.module(self.__name__), name))
        except JsException:
            if js.hasModule(f'{self.__name__}.{name}'):
                return importlib.import_module(f'{self.__name__}.{name}')
            raise AttributeError(f"module '{self.__name__}' has no attribute '{name}'") from None

    def __dir__(self):
        return list(js.dir(js.module(self.__name__)))


class TreeFinder(importlib.abc.MetaPathFinder, importlib.abc.Loader):
    """Modules CPython lacks, from the tree (after CPython's own finders)."""

    def find_spec(self, name, path=None, target=None):
        if js.hasModule(name):
            return importlib.machinery.ModuleSpec(name, self, is_package=js.isPackage(name))
        return None

    def create_module(self, spec):
        module = JsModule(spec.name)
        if spec.submodule_search_locations is not None:
            module.__path__ = []
        exported = js.exported(js.module(spec.name))
        module.__all__ = list(exported)
        return module

    def exec_module(self, module):
        pass


sys.meta_path.append(TreeFinder())


def _error_line(error, filename):
    if isinstance(error, SyntaxError) and error.filename == filename:
        return error.lineno or 0
    frames = [f for f in traceback.extract_tb(error.__traceback__) if f.filename == filename]
    return frames[-1].lineno if frames else 0


def run_text(name, source):
    """A text run as Blender runs one (BPY_run_text): as __main__; returns None, or the traceback and the error's line."""
    namespace = {'__name__': '__main__', '__file__': name, '__builtins__': builtins}
    try:
        exec(compile(source, name, 'exec'), namespace)
    except SystemExit:
        pass
    except BaseException as error:
        lines = traceback.format_exception(error)
        return ''.join(lines[:1] + lines[2:] if len(lines) > 2 else lines).rstrip(), _error_line(error, name)
    return None


def console(function, context, *args):
    """A function of the console's language module (_console_python: execute, autocomplete, banner, copy_as_script)."""
    import _console_python
    return next(iter(getattr(_console_python, function)(wrap(context), *args) or ()), 'FINISHED')
