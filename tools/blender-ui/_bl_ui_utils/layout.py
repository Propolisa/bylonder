# Blender's _bl_ui_utils.layout as Transcrypt compiles it: the operator_context manager as a class, since Transcrypt has
# no contextlib.
class operator_context:
    def __init__(self, layout, op_context):
        self.layout = layout
        self.op_context = op_context

    def __enter__(self):
        self.orig_context = self.layout.operator_context
        self.layout.operator_context = self.op_context

    def __exit__(self, *args):
        self.layout.operator_context = self.orig_context
