# platform for Blender's scripts: the module's Blender is built as a Linux one (WASI, not Darwin or Windows), which is
# what its Python sees, as sys.platform says.
def system():
    return "Linux"


def machine():
    return "wasm32"


def python_version():
    return "3.11.0"
