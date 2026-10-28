# bpy.app.icons: a tool's icon (release/datafiles/icons/NAME.dat, drawn from its triangles) is known by its file's name,
# which Bylonder's toolbar draws from public/icons/blender/tools/NAME.svg (tools/blender-ui/icons.py converts them).
def new_triangles_from_file(filepath):
    name = filepath.split('/').pop()
    return name[:len(name) - len('.dat')]


def release(icon_value):
    pass
