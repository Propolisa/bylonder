# What Bylonder gives the scripts at run time, set from JS: its application templates (examples) by name.
templates = []


# bpy.data, as the scripts read it: the blend file's state, set from JS.
class _BlendData:
    def __init__(self):
        self.is_saved = True
        self.is_dirty = False
        self.use_autopack = False
        self.filepath = ''


data = _BlendData()


# What JS answers for the scripts: whether add-ons (Bylonder) added draw functions to a menu (Menu.is_extended).
class _Hooks:
    def menu_extended(self, name):
        return False


hooks = _Hooks()


# bpy.context, which some scripts read in place of the context they are given: the one being drawn with, set from JS.
class _Context:
    pass


context = _Context()


# bpy.types at draw time: the registered classes and RNA structs, set from JS (editors/interface/panels.js).
class _Types:
    pass


types = _Types()
