# Blender's bpy.app (C, bpy_app.cc): Blender's version and the application's state as Bylonder reports them.
import _bpy.app.handlers as handlers
import _bpy.app.translations as translations
import _bpy.app.timers as timers
import _bpy.app.icons as icons

# The values Blender 5.2.3's own build reports (bpy.app in the reference binary), so its scripts draw as they do there.
version = (5, 2, 3)
version_file = (5, 2, 45)
version_string = '5.2.3 LTS'
version_cycle = 'release'
background = False
factory_startup = False
portable = True
online_access = False
online_access_override = False
debug = debug_python = debug_events = debug_handlers = debug_wm = debug_io = debug_freestyle = debug_simdata = False
debug_depsgraph = debug_depsgraph_build = debug_depsgraph_eval = debug_depsgraph_pretty = debug_depsgraph_tag = False
debug_depsgraph_time = False
debug_value = 0
autoexec_fail = autoexec_fail_quiet = False
autoexec_fail_message = ''
binary_path = '/blender/blender'
tempdir = '/tmp/'
cachedir = '/blender/cache/'
render_icon_size = 32
render_preview_size = 128
use_event_simulate = False
use_userpref_skip_save_on_exit = True
python_args = ()
driver_namespace = {}


class _Library:
    def __init__(self, supported, version):
        self.supported, self.version = supported, version
        self.version_string = ', '.join(str(v).rjust(2) for v in version)


alembic = _Library(True, (1, 8, 3))
ocio = _Library(True, (2, 5, 0))
oiio = _Library(True, (3, 1, 13))
opensubdiv = _Library(True, (3, 7, 0))
openvdb = _Library(True, (13, 0, 0))
usd = _Library(True, (0, 26, 3))
sdl = _Library(False, (0, 0, 0))
ffmpeg = _Library(True, (62, 28, 100))


class build_options:
    bullet = True
    codec_avi = False
    codec_ffmpeg = True
    codec_sndfile = True
    compositor_cpu = True
    cycles = True
    cycles_osl = True
    freestyle = True
    image_cineon = True
    image_dds = True
    image_hdr = True
    image_openexr = True
    image_openjpeg = True
    image_tiff = True
    image_webp = True
    input_ndof = True
    audaspace = True
    international = True
    openal = True
    opensubdiv = True
    sdl = False
    coreaudio = False
    jack = True
    pulseaudio = True
    wasapi = False
    libmv = True
    mod_oceansim = True
    mod_remesh = True
    io_wavefront_obj = True
    io_ply = True
    io_stl = True
    io_fbx = True
    io_gpencil = True
    opencolorio = True
    openmp = False
    openvdb = True
    alembic = True
    usd = True
    fluid = True
    xr_openxr = True
    potrace = True
    pugixml = True
    haru = True
    experimental_features = False


def is_job_running(job_type):
    return False


def help_text(all=False):
    return ''
