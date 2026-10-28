# Blender's bpy.app.handlers (C, bpy_app_handlers.cc): the handler lists Bylonder calls at its matching events.
def persistent(function):
    return function


load_pre = []
load_post = []
save_pre = []
save_post = []
depsgraph_update_pre = []
depsgraph_update_post = []
frame_change_pre = []
frame_change_post = []
render_pre = []
render_post = []
undo_pre = []
undo_post = []
redo_pre = []
redo_post = []
version_update = []
