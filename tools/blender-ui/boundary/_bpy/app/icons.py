# bpy.app.icons (bpy_app_icons.cc): a tool's icon (release/datafiles/icons/NAME.dat) registered in Blender's icon system
# in the module, so its icon_value is Blender's own; the web draws it from public/icons/blender/tools/NAME.svg
# (tools/blender-ui/icons.py converts them), by the name the module keeps for it (ui_icon_name).
__pragma__('js', '{}', '/* js-import {geometryIcon, releaseIcon} from ../python/bpy_icons.js */')


def new_triangles_from_file(filepath):
    return geometryIcon(filepath)


def release(icon_value):
    releaseIcon(icon_value)
