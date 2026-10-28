# Blender's bpy.utils.units (C, bpy_utils_units.cc): unit systems and categories; values shown as Blender formats them.
systems = {'NONE': 'NONE', 'METRIC': 'METRIC', 'IMPERIAL': 'IMPERIAL'}
categories = {'NONE': 'NONE', 'LENGTH': 'LENGTH', 'AREA': 'AREA', 'VOLUME': 'VOLUME', 'MASS': 'MASS', 'ROTATION': 'ROTATION',
              'TIME': 'TIME', 'TIME_ABSOLUTE': 'TIME_ABSOLUTE', 'VELOCITY': 'VELOCITY', 'ACCELERATION': 'ACCELERATION',
              'CAMERA': 'CAMERA', 'POWER': 'POWER', 'TEMPERATURE': 'TEMPERATURE'}


def to_value(unit_system, unit_category, str_input, str_ref_unit=None):
    return float(str_input)


def to_string(unit_system, unit_category, value, precision=3, split_unit=False, compatible_unit=False):
    return str(round(value, precision))
