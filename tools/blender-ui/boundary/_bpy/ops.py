# Blender's bpy.ops (C, bpy_operator.cc): operators by Blender's idname, run by Bylonder's operator registry
# (windowmanager/wm-operators.js), which python/bpy_interface.js installs as globalThis.__bylonder_operators__.
__pragma__('js', '{}', '/* js-import {operatorNames} from ../python/operator-names.js */')


def dir():
    __pragma__('js', '{}', 'return operatorNames();')


def _registry():
    __pragma__('js', '{}', 'return globalThis.__bylonder_operators__;')


class _Operator:
    """BPyOpsCallable: bpy.ops.object.delete(execution_context, undo, **properties)."""

    def __init__(self, module, function):
        self.module, self.function = module, function

    def idname(self):
        return self.module.upper() + '_OT_' + self.function

    def idname_py(self):
        return self.module + '.' + self.function

    def poll(self, execution_context='EXEC_DEFAULT'):
        return _registry().poll(self.idname_py(), {})

    def __call__(self, *args, **properties):
        context = next((a for a in args if isinstance(a, str)), 'EXEC_DEFAULT')
        return _registry().call(self.idname_py(), properties, context)


def create_function(module, function):
    operator = _Operator(module, function)
    __pragma__('js', '{}', 'return Object.assign((...args) => operator.__call__(...args), {idname: () => operator.idname(), idname_py: () => operator.idname_py(), poll: (...a) => operator.poll(...a)});')


# type(bpy.ops)("bpy.ops.object"): a module whose attributes come from its __getattr__ once set, as PEP 562 gives
# modules.
__pragma__('js', '{}', '''
export function ModuleType(name) {
    const module = { __name__: name };
    return new Proxy(module, { get: (target, key) => (key in target || typeof key !== 'string' || !target.__getattr__ ? target[key] : target.__getattr__(key)) });
}
export { ModuleType as __class__ };
''')
