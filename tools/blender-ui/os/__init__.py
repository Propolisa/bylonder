# Bylonder's os for Blender's scripts: the application templates path (bpy.utils.app_template_paths) lists Bylonder's
# templates; there is no other file system.
from bpy import _app


def listdir(directory):
    return _app.templates if directory == 'APP_TEMPLATES' else []


class path:
    @staticmethod
    def join(*parts):
        return '/'.join(parts)

    @staticmethod
    def isdir(name):
        return name.startswith('APP_TEMPLATES/')
