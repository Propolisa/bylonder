# The browser's JSON.


class JSONDecodeError(ValueError):
    pass


def dumps(value, indent=None, **kwargs):
    __pragma__('js', '{}', 'return JSON.stringify(value, null, indent ?? undefined);')


def loads(text, **kwargs):
    __pragma__('js', '{}', 'return JSON.parse(text);')


def dump(value, file, **kwargs):
    file.write(dumps(value, **kwargs))


def load(file, **kwargs):
    return loads(file.read())
