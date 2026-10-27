# The base classes Blender's UI scripts derive from; drawing gives them `layout`. Structs carry the RNA the scripts
# read when they load.
from bpy import _rna


class Modifier:
    bl_rna = _rna.Modifier


class Menu:
    pass


class Panel:
    pass


class Header:
    pass


class UIList:
    pass


class SurfaceCurve:
    pass


class Operator:
    pass
