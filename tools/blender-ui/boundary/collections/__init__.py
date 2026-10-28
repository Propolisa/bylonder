# Python's collections for Blender's scripts, as Transcrypt compiles them: namedtuple, which Transcrypt's library lacks.
def namedtuple(typename, field_names):
    fields = field_names.replace(',', ' ').split() if isinstance(field_names, str) else list(field_names)

    class _NamedTuple:
        _fields = tuple(fields)

        def __init__(self, *args, **kwargs):
            for i, name in enumerate(fields):
                setattr(self, name, args[i] if i < len(args) else kwargs[name])

        def __getitem__(self, index):
            return getattr(self, fields[index])

        def __iter__(self):
            return iter([getattr(self, name) for name in fields])

        def __len__(self):
            return len(fields)

        def _replace(self, **kwargs):
            return _NamedTuple(*[kwargs[name] if name in kwargs else getattr(self, name) for name in fields])

    _NamedTuple.__name__ = typename
    return _NamedTuple
