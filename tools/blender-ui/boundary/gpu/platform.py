# gpu.platform: the browser's WebGL, an OpenGL ES, stands for Blender's OpenGL backend (the Preferences' default).
def backend_type_get():
    return 'OPENGL'


def device_type_get():
    return 'UNKNOWN'


def vendor_get():
    return 'Browser'


def renderer_get():
    return 'WebGL'


def version_get():
    return ''
