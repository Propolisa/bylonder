# CPython's functools, the parts Blender's scripts use.


def reduce(function, iterable, *initial):
    items = list(iterable)
    value = initial[0] if initial else items.pop(0)
    for item in items:
        value = function(value, item)
    return value


def wraps(wrapped, assigned=None, updated=None):
    return lambda wrapper: wrapper


def partial(function, *bound, **bound_kwargs):
    def call(*args, **kwargs):
        merged = dict(bound_kwargs)
        merged.update(kwargs)
        return function(*(list(bound) + list(args)), **merged)
    return call


def _cached(function):
    results = {}

    def cached(*args):
        key = repr(args)
        if key not in results:
            results[key] = function(*args)
        return results[key]
    cached.cache_clear = lambda: results.clear()
    return cached


def lru_cache(maxsize=128, typed=False):
    return _cached(maxsize) if callable(maxsize) else _cached


cache = _cached


def cmp_to_key(compare):
    class Key:
        def __init__(self, value):
            self.value = value

        def __lt__(self, other):
            return compare(self.value, other.value) < 0
    return Key


def total_ordering(cls):
    return cls
