# Blender's bpy.app.translations (C, bpy_app_translations.cc): untranslated, as Blender in English. The contexts are
# Blender 5.2.3's (bpy.app.translations in the reference binary).
locale = ''
locales = ()


def pgettext(text, context=None):
    return text

pgettext_iface = pgettext_tip = pgettext_rpt = pgettext_data = pgettext_n = pgettext


def locale_explode(locale):
    return (None, None, None, None, None)


def register(module_name, translations_dict):
    pass


def unregister(module_name):
    pass


class contexts:
    amount = 'Amount'
    color = 'Color'
    constraint = 'Constraint'
    countable = 'Countable'
    default = '*'
    default_real = None
    editor_filebrowser = 'File browser'
    editor_preferences = 'Preferences'
    editor_python_console = 'Python console'
    editor_view3d = 'View3D'
    id_action = 'Action'
    id_armature = 'Armature'
    id_brush = 'Brush'
    id_cachefile = 'CacheFile'
    id_camera = 'Camera'
    id_collection = 'Collection'
    id_curve = 'Curve'
    id_curves = 'Curves'
    id_fs_linestyle = 'FreestyleLineStyle'
    id_gpencil = 'GPencil'
    id_id = 'ID'
    id_image = 'Image'
    id_lattice = 'Lattice'
    id_library = 'Library'
    id_light = 'Light'
    id_lightprobe = 'LightProbe'
    id_mask = 'Mask'
    id_material = 'Material'
    id_mesh = 'Mesh'
    id_metaball = 'Metaball'
    id_movieclip = 'MovieClip'
    id_nodetree = 'NodeTree'
    id_object = 'Object'
    id_paintcurve = 'PaintCurve'
    id_palette = 'Palette'
    id_particlesettings = 'ParticleSettings'
    id_pointcloud = 'PointCloud'
    id_scene = 'Scene'
    id_screen = 'Screen'
    id_sequence = 'Sequence'
    id_shapekey = 'Key'
    id_simulation = 'Simulation'
    id_sound = 'Sound'
    id_speaker = 'Speaker'
    id_text = 'Text'
    id_texture = 'Texture'
    id_vfont = 'VFont'
    id_volume = 'Volume'
    id_windowmanager = 'WindowManager'
    id_workspace = 'WorkSpace'
    id_world = 'World'
    modifier = 'Modifier'
    navigation = 'Navigation'
    no_translation = 'Do not translate'
    operator_default = 'Operator'
    plural = 'Plural'
    render_layer = 'Render Layer'
    time = 'Time'
    ui_events_keymaps = 'UI_Events_KeyMaps'
    unit = 'Unit'


contexts_C_to_py = {
    'BLT_I18NCONTEXT_DEFAULT': 'default_real',
    'BLT_I18NCONTEXT_DEFAULT_BPYRNA': 'default',
    'BLT_I18NCONTEXT_OPERATOR_DEFAULT': 'operator_default',
    'BLT_I18NCONTEXT_UI_EVENTS': 'ui_events_keymaps',
    'BLT_I18NCONTEXT_PLURAL': 'plural',
    'BLT_I18NCONTEXT_COUNTABLE': 'countable',
    'BLT_I18NCONTEXT_ID_ACTION': 'id_action',
    'BLT_I18NCONTEXT_ID_ARMATURE': 'id_armature',
    'BLT_I18NCONTEXT_NO_TRANSLATION': 'no_translation',
    'BLT_I18NCONTEXT_ID_BRUSH': 'id_brush',
    'BLT_I18NCONTEXT_ID_CACHEFILE': 'id_cachefile',
    'BLT_I18NCONTEXT_ID_CAMERA': 'id_camera',
    'BLT_I18NCONTEXT_ID_COLLECTION': 'id_collection',
    'BLT_I18NCONTEXT_ID_CURVES': 'id_curves',
    'BLT_I18NCONTEXT_ID_CURVE_LEGACY': 'id_curve',
    'BLT_I18NCONTEXT_ID_FREESTYLELINESTYLE': 'id_fs_linestyle',
    'BLT_I18NCONTEXT_ID_GPENCIL': 'id_gpencil',
    'BLT_I18NCONTEXT_ID_ID': 'id_id',
    'BLT_I18NCONTEXT_ID_IMAGE': 'id_image',
    'BLT_I18NCONTEXT_ID_LATTICE': 'id_lattice',
    'BLT_I18NCONTEXT_ID_LIBRARY': 'id_library',
    'BLT_I18NCONTEXT_ID_LIGHT': 'id_light',
    'BLT_I18NCONTEXT_ID_LIGHTPROBE': 'id_lightprobe',
    'BLT_I18NCONTEXT_ID_MASK': 'id_mask',
    'BLT_I18NCONTEXT_ID_MATERIAL': 'id_material',
    'BLT_I18NCONTEXT_ID_MESH': 'id_mesh',
    'BLT_I18NCONTEXT_ID_METABALL': 'id_metaball',
    'BLT_I18NCONTEXT_ID_MOVIECLIP': 'id_movieclip',
    'BLT_I18NCONTEXT_ID_NODETREE': 'id_nodetree',
    'BLT_I18NCONTEXT_ID_OBJECT': 'id_object',
    'BLT_I18NCONTEXT_ID_PAINTCURVE': 'id_paintcurve',
    'BLT_I18NCONTEXT_ID_PALETTE': 'id_palette',
    'BLT_I18NCONTEXT_ID_PARTICLESETTINGS': 'id_particlesettings',
    'BLT_I18NCONTEXT_ID_POINTCLOUD': 'id_pointcloud',
    'BLT_I18NCONTEXT_ID_SCENE': 'id_scene',
    'BLT_I18NCONTEXT_ID_SCREEN': 'id_screen',
    'BLT_I18NCONTEXT_ID_SEQUENCE': 'id_sequence',
    'BLT_I18NCONTEXT_ID_SHAPEKEY': 'id_shapekey',
    'BLT_I18NCONTEXT_ID_SIMULATION': 'id_simulation',
    'BLT_I18NCONTEXT_ID_SOUND': 'id_sound',
    'BLT_I18NCONTEXT_ID_SPEAKER': 'id_speaker',
    'BLT_I18NCONTEXT_ID_TEXT': 'id_text',
    'BLT_I18NCONTEXT_ID_TEXTURE': 'id_texture',
    'BLT_I18NCONTEXT_ID_VFONT': 'id_vfont',
    'BLT_I18NCONTEXT_ID_VOLUME': 'id_volume',
    'BLT_I18NCONTEXT_ID_WINDOWMANAGER': 'id_windowmanager',
    'BLT_I18NCONTEXT_ID_WORKSPACE': 'id_workspace',
    'BLT_I18NCONTEXT_ID_WORLD': 'id_world',
    'BLT_I18NCONTEXT_EDITOR_FILEBROWSER': 'editor_filebrowser',
    'BLT_I18NCONTEXT_EDITOR_PYTHON_CONSOLE': 'editor_python_console',
    'BLT_I18NCONTEXT_EDITOR_PREFERENCES': 'editor_preferences',
    'BLT_I18NCONTEXT_EDITOR_VIEW3D': 'editor_view3d',
    'BLT_I18NCONTEXT_AMOUNT': 'amount',
    'BLT_I18NCONTEXT_COLOR': 'color',
    'BLT_I18NCONTEXT_CONSTRAINT': 'constraint',
    'BLT_I18NCONTEXT_MODIFIER': 'modifier',
    'BLT_I18NCONTEXT_NAVIGATION': 'navigation',
    'BLT_I18NCONTEXT_RENDER_LAYER': 'render_layer',
    'BLT_I18NCONTEXT_TIME': 'time',
    'BLT_I18NCONTEXT_UNIT': 'unit',
}
