# Bylonder's collections for Blender's scripts, as Transcrypt compiles them: namedtuple as a record of its fields.
def namedtuple(typename, field_names, defaults=()):
    names = field_names.split() if isinstance(field_names, str) else list(field_names)

    def make(*args, **kwargs):
        record = {}
        for i, name in enumerate(names):
            record[name] = args[i] if i < len(args) else kwargs.get(name)
        return record
    return make
