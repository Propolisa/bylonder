# Python's os.path for Blender's scripts: POSIX path strings, over a read-only file system holding Blender's scripts
# where Blender has them (_files, written by tree.py).
from _files import files

_directories = set()
for _file in files:
    _parts = _file.split('/')
    for _end in range(2, len(_parts)):
        _directories.add('/'.join(_parts[:_end]))
_files_set = set(files)
sep = '/'


def join(first, *rest):
    out = first
    for part in rest:
        out = part if part.startswith('/') else (out + part if out == '' or out.endswith('/') else out + '/' + part)
    return out


def split(name):
    i = name.rfind('/')
    if i < 0:
        return '', name
    return (name[:i] or '/'), name[i + 1:]


def basename(name):
    return split(name)[1]


def dirname(name):
    return split(name)[0]


def splitext(name):
    base = basename(name)
    dot = base.rfind('.')
    return (name, '') if dot <= 0 else (name[:len(name) - len(base) + dot], base[dot:])


def normpath(name):
    parts = []
    for part in name.split('/'):
        if part == '..' and parts and parts[-1] != '..':
            parts.pop()
        elif part not in ('', '.'):
            parts.append(part)
    return ('/' if name.startswith('/') else '') + '/'.join(parts) or '.'


def abspath(name):
    return normpath(name if name.startswith('/') else '/' + name)


def expanduser(name):
    return name


def isabs(name):
    return name.startswith('/')


def isfile(name):
    return normpath(name) in _files_set


def isdir(name):
    return normpath(name) in _directories


def exists(name):
    return isfile(name) or isdir(name)


def islink(name):
    return False


def _mount(directory, names):
    """Folders Bylonder adds to the file system (its examples as Blender's app templates)."""
    for name in names:
        _directories.add(normpath(join(directory, name)))
    parts = normpath(directory).split('/')
    for end in range(2, len(parts) + 1):
        _directories.add('/'.join(parts[:end]))
