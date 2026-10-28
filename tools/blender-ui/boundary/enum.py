# Enum classes as plain classes: members stay their values.


class Enum:
    pass


class IntEnum(Enum):
    pass


class StrEnum(Enum):
    pass


class Flag(Enum):
    pass


IntFlag = Flag
_counter = [0]


def auto():
    _counter[0] += 1
    return _counter[0]
