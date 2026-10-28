# Bylonder's struct for Blender's scripts, as Transcrypt compiles them: a value packed and unpacked as a 32-bit float,
# which properties_output.py uses to compare a property with float constants.
def pack(format, value):
    return value


def unpack(format, value):
    return [Math.fround(value)] if format == 'f' else [value]
