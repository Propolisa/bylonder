# The parts of CPython's collections Blender's scripts use, over Transcrypt's dict and list.
from collections import abc


def namedtuple(typename, field_names, defaults=None, rename=False, module=None):
    fields = tuple(field_names.replace(',', ' ').split()) if isinstance(field_names, str) else tuple(field_names)
    trailing = dict(zip(fields[len(fields) - len(defaults or ()):], defaults or ()))

    class NamedTuple:
        _fields = fields
        _field_defaults = trailing

        def __init__(self, *args, **kwargs):
            for index, name in enumerate(fields):
                setattr(self, name, args[index] if index < len(args) else kwargs.get(name, trailing.get(name)))

        def _asdict(self):
            return {name: getattr(self, name) for name in fields}

        def _replace(self, **kwargs):
            values = self._asdict()
            values.update(kwargs)
            return NamedTuple(**values)

    NamedTuple.__name__ = typename
    return NamedTuple


OrderedDict = dict


def defaultdict(default_factory=None, *args):
    """A dict that adds default_factory() for a missing key it is indexed with."""
    values = dict(*args)
    __pragma__('js', '{}', '''return new Proxy(values, {get: (target, key) => key in target || typeof key !== 'string' || !default_factory ? target[key] : (target[key] = default_factory())});''')


def Counter(iterable=()):
    counts = {}
    for item in iterable:
        counts[item] = counts.get(item, 0) + 1
    return counts


def deque(iterable=(), maxlen=None):
    items = list(iterable)
    items.appendleft = lambda item: items.insert(0, item)
    items.popleft = lambda: items.pop(0)
    return items
