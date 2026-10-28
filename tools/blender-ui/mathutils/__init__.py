# Bylonder's mathutils for Blender's scripts, as Transcrypt compiles them: what they use of Vector and Matrix, written
# without operators on them so it compiles the same with or without Transcrypt's operator overloading.
from math import cos, sin


class Vector:
    def __init__(self, values):
        self.values = list(values)

    def __getslice__(self, start, stop, step):
        return self.values.slice(0)


class Matrix:
    def __init__(self, rows):
        self.rows = rows

    @staticmethod
    def Rotation(angle, size, axis):
        c = cos(angle)
        s = sin(angle)
        return Matrix({'X': [[1, 0, 0], [0, c, -s], [0, s, c]], 'Y': [[c, 0, s], [0, 1, 0], [-s, 0, c]],
                       'Z': [[c, -s, 0], [s, c, 0], [0, 0, 1]]}[axis])

    def __matmul__(self, vector):
        out = []
        for row in self.rows:
            total = 0.0
            for i in range(len(row)):
                total += row[i] * vector.values[i]
            out.append(total)
        return Vector(out)


class Euler:
    def __init__(self, angles=(0.0, 0.0, 0.0), order='XYZ'):
        self.values = list(angles)
        self.order = order


class Color:
    def __init__(self, rgb=(0.0, 0.0, 0.0)):
        self.values = list(rgb)
