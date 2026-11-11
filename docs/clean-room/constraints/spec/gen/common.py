# Random scene builders shared by the case generators.
import random, json, sys
def rv(a, b, n=3): return [round(random.uniform(a, b), 3) for _ in range(n)]
def obj(name, **kw):
    o = {"name": name, "loc": rv(-2, 2), "rot": rv(-180, 180), "scale": rv(0.5, 2)}
    o.update(kw); return o
def sheared_target(name="T"):
    """A target object parented to a non-uniformly scaled, rotated parent: its world matrix is sheared."""
    return [obj(name + "P", scale=[2.0, 0.6, 1.0]), obj(name, parent=name + "P")]
def armature(name="Arm", pose=True, flags=None):
    """Root bone A, child B (offset head, rolled) and a free root bone C; random pose."""
    bones = [{"name": "A", "head": [0, 0, 0], "tail": [0, 0.2, 1], "roll": 15},
             dict({"name": "B", "head": [0.1, 0.3, 1.2], "tail": [0.6, 0.5, 2.0], "roll": -40, "parent": "A"}, **(flags or {})),
             {"name": "C", "head": [1.5, 0, 0], "tail": [1.5, -0.5, 1], "roll": 70}]
    a = {"name": name, "kind": "ARMATURE", "loc": rv(-1, 1), "rot": rv(-40, 40), "scale": [1, 1, 1], "bones": bones}
    if pose:
        a["pose"] = {b: {"loc": rv(-0.5, 0.5), "rot": rv(-60, 60), "scale": rv(0.6, 1.5)} for b in "ABC"}
    return a
def save(cases, path):
    json.dump(cases, open(path, "w"), indent=1); print(len(cases), "cases")
