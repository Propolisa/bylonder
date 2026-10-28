# Functions Blender's RNA gives its structs in C (rna_*_api.cc), as Bylonder has them: tree.py puts each class's body
# into bpy.types' struct of the same name.


# wm_draw_cursor_add (rna_wm_api.cc): the draw callbacks a tool adds for its cursor (Select Circle's circle);
# Bylonder's views draw tool cursors themselves.
class WindowManager:
    @staticmethod
    def draw_cursor_add(callback, args, space_type, region_type):
        return None

    @staticmethod
    def draw_cursor_remove(handle):
        pass
