# The base classes Blender's UI scripts derive from; drawing gives them `layout`. Structs carry the RNA the scripts
# read when they load.
from bpy import _rna, _app


class Modifier:
    bl_rna = _rna.Modifier


# Menu's helpers as Blender's _bpy_types.py defines them.
class Menu:
    @classmethod
    def is_extended(cls):
        return _app.hooks.menu_extended(cls.__name__)

    @classmethod
    def draw_collapsible(cls, context, layout):
        if context.area.show_menus:
            layout.row(align=True).menu_contents(cls.__name__)
        else:
            layout.menu(cls.__name__, icon='COLLAPSEMENU')

    # Presets are files, which Bylonder does not have yet: a preset menu shows none.
    def draw_preset(self, context):
        pass


class Panel:
    pass


class Header:
    pass


class UIList:
    pass


class SurfaceCurve:
    pass


class Collection:
    pass


class Curve:
    pass


class TextCurve:
    pass


class GreasePencil:
    pass


class GreasePencilLayer:
    pass


class GreasePencilLayerGroup:
    pass


class GreasePencilTreeNode:
    pass


class Brush:
    pass


class ViewLayer:
    pass


class FreestyleLineStyle:
    pass


class ParticleSettings:
    pass


class Texture:
    pass


class Context:
    pass


class WindowManager:
    pass


class Theme:
    pass


class AssetShelf:
    pass


class UILayout:
    pass


class Operator:
    pass
