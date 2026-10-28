# Blender's bpy.props (C, bpy_props.cc): property declarations, deferred until a class registers, as Blender's are.
class _PropertyDeferred:
    def __init__(self, function, keywords):
        self.function = function
        self.keywords = keywords


def BoolProperty(**keywords):
    return _PropertyDeferred(BoolProperty, keywords)


def BoolVectorProperty(**keywords):
    return _PropertyDeferred(BoolVectorProperty, keywords)


def IntProperty(**keywords):
    return _PropertyDeferred(IntProperty, keywords)


def IntVectorProperty(**keywords):
    return _PropertyDeferred(IntVectorProperty, keywords)


def FloatProperty(**keywords):
    return _PropertyDeferred(FloatProperty, keywords)


def FloatVectorProperty(**keywords):
    return _PropertyDeferred(FloatVectorProperty, keywords)


def StringProperty(**keywords):
    return _PropertyDeferred(StringProperty, keywords)


def EnumProperty(**keywords):
    return _PropertyDeferred(EnumProperty, keywords)


def PointerProperty(**keywords):
    return _PropertyDeferred(PointerProperty, keywords)


def CollectionProperty(**keywords):
    return _PropertyDeferred(CollectionProperty, keywords)


def RemoveProperty(cls, attr=''):
    return None
