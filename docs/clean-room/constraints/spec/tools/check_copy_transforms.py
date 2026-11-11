import sys; sys.path.insert(0, "tools"); from ref import *
def solve(O, T, c):
    if c.get("remove_target_shear"):
        T = ortho(T)
    mix = c.get("mix_mode", "REPLACE")
    if mix == "REPLACE": return T
    if mix == "BEFORE_FULL": return T @ O
    if mix == "AFTER_FULL": return O @ T
    to, Ro, so = loc_rot_scale(O); tt, Rt, st = loc_rot_scale(T)
    if mix == "BEFORE_SPLIT": return compose(tt + to, Rt @ Ro, st * so)
    if mix == "AFTER_SPLIT": return compose(to + tt, Ro @ Rt, so * st)
    if mix == "BEFORE": return compose((T @ np.append(to, 1))[:3], Rt @ Ro, st * so)
    if mix == "AFTER": return compose((O @ np.append(tt, 1))[:3], Ro @ Rt, so * st)
def ortho(M):
    out = M.copy(); out[:3, :3] = fix_shear(M[:3, :3]); return out
check(sys.argv[1], solve)
