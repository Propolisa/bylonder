# Python's os.path for Blender's scripts: POSIX path strings; nothing exists on a file system.
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


def exists(name):
    return False


isdir = isfile = islink = exists
