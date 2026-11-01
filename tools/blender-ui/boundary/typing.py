# Python's typing for Blender's scripts: annotations do nothing at run time, so the names are placeholders; the generic
# ones can be subscripted (an alias such as Union[float, int]).
TYPE_CHECKING = False
Any = Callable = Iterable = Iterator = Protocol = TypeAlias = Sequence = Mapping = object


class _Generic:
    def __getitem__(self, _parameters):
        return self


Optional = Union = List = Tuple = Set = FrozenSet = _Generic()


def cast(_type, value):
    return value
