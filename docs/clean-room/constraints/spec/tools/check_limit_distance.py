import sys, json; sys.path.insert(0, "tools"); from ref import *
def limit_distance(O, T, c):
    d = c.get("distance", 0.0); v = O[:3, 3] - T[:3, 3]; L = np.linalg.norm(v)
    if d == 0: d = L
    mode = c.get("limit_mode", "LIMITDIST_INSIDE")
    if L < 1e-9: return O
    if (mode == "LIMITDIST_INSIDE" and L > d) or (mode == "LIMITDIST_OUTSIDE" and L < d) or (mode == "LIMITDIST_ONSURFACE" and L != d):
        out = O.copy(); out[:3, 3] = T[:3, 3] + v / L * d; return out
    return O
if __name__ == "__main__": check(sys.argv[1], limit_distance)
