# Independent reimplementation of the spec's bone formulas, used to check them against the oracle.
import numpy as np
inv = np.linalg.inv
def nrm(v): return v / np.linalg.norm(v)
def polar(m):
    u, s, vt = np.linalg.svd(m); return u @ vt
def fix_shear(M):
    ly = np.linalg.norm(M[:, 1]); y = M[:, 1] / ly
    xp = M[:, 0] - y * (y @ M[:, 0]); zp = M[:, 2] - y * (y @ M[:, 2])
    xd = nrm(nrm(xp) + np.cross(y, nrm(zp))); zd = np.cross(xd, y)
    k = np.sqrt(np.linalg.det(M) / (ly * np.linalg.norm(xp) * np.linalg.norm(zp)))
    return np.stack([xd * k * np.linalg.norm(xp), y * ly, zd * k * np.linalg.norm(zp)], 1)
def parent_frames(Pa, Ra, Rb, f):
    """Returns (orientation 3x3 Q, extra right scale S or None, origin t, location matrix L3)."""
    O = inv(Ra) @ Rb; O3 = O[:3, :3]; P3 = Pa[:3, :3]
    t = (Pa @ O)[:3, 3]
    L3 = (P3 @ O3) if f["use_local_location"] else P3
    S = np.linalg.norm(P3, axis=0)
    if not f["use_inherit_rotation"]:
        P3 = Ra[:3, :3] @ np.diag(S)
    m = f["inherit_scale"]
    if m == "FULL": return P3 @ O3, None, t, L3
    if m == "FIX_SHEAR": return fix_shear(P3 @ O3), None, t, L3
    if m == "AVERAGE": return polar(P3) * np.cbrt(np.linalg.det(P3)) @ O3, None, t, L3
    if m == "NONE": return polar(P3) @ O3, None, t, L3
    if m == "NONE_LEGACY": return (P3 / np.linalg.norm(P3, axis=0)) @ O3, None, t, L3
    if m == "ALIGNED": return polar(P3) @ O3, S, t, L3
def pose_from_basis(Pa, Ra, Rb, f, basis):
    Q, S, t, L3 = parent_frames(Pa, Ra, Rb, f)
    b3 = basis[:3, :3]; loc = np.zeros(3) if f["use_connect"] else basis[:3, 3]
    out = np.eye(4)
    out[:3, :3] = Q @ b3 if S is None else Q @ b3 @ np.diag(S)
    out[:3, 3] = t + L3 @ loc
    return out
def basis_from_pose(Pa, Ra, Rb, f, x):
    Q, S, t, L3 = parent_frames(Pa, Ra, Rb, f)
    out = np.eye(4)
    out[:3, :3] = inv(Q) @ x[:3, :3] if S is None else inv(Q) @ x[:3, :3] @ np.diag(1 / S)
    out[:3, 3] = inv(L3) @ (x[:3, 3] - t)
    return out

def quat_from_mat3(R):
    w = np.sqrt(max(0, 1 + R[0,0] + R[1,1] + R[2,2])) / 2
    x = np.sqrt(max(0, 1 + R[0,0] - R[1,1] - R[2,2])) / 2 * np.sign(R[2,1] - R[1,2] or 1)
    y = np.sqrt(max(0, 1 - R[0,0] + R[1,1] - R[2,2])) / 2 * np.sign(R[0,2] - R[2,0] or 1)
    z = np.sqrt(max(0, 1 - R[0,0] - R[1,1] + R[2,2])) / 2 * np.sign(R[1,0] - R[0,1] or 1)
    return np.array([w, x, y, z])
def mat3_from_quat(q):
    w, x, y, z = q / np.linalg.norm(q)
    return np.array([[1-2*(y*y+z*z), 2*(x*y-w*z), 2*(x*z+w*y)], [2*(x*y+w*z), 1-2*(x*x+z*z), 2*(y*z-w*x)], [2*(x*z-w*y), 2*(y*z+w*x), 1-2*(x*x+y*y)]])
def slerp(a, b, t):
    d = a @ b
    if d < 0: b, d = -b, -d
    if d > 0.9999: q = a + t * (b - a); return q / np.linalg.norm(q)
    th = np.arccos(d); return (np.sin((1 - t) * th) * a + np.sin(t * th) * b) / np.sin(th)
def blend_polar(A, B, t):
    """Blend two 4x4 matrices: translation lerp, polar rotation slerp, polar stretch lerp."""
    def split(M):
        u, s, vt = np.linalg.svd(M[:3, :3]); R = u @ vt
        if np.linalg.det(R) < 0: R = -R
        return R, R.T @ M[:3, :3]
    Ra, Sa = split(A); Rb, Sb = split(B)
    R = mat3_from_quat(slerp(quat_from_mat3(Ra), quat_from_mat3(Rb), t))
    out = np.eye(4); out[:3, :3] = R @ ((1 - t) * Sa + t * Sb); out[:3, 3] = (1 - t) * A[:3, 3] + t * B[:3, 3]
    return out

FLAGS = {"use_connect": False, "use_inherit_rotation": True, "inherit_scale": "FULL", "use_local_location": True}
def bone_world_to_space(space, W, arm_world, bone, parent, flags=FLAGS, custom=None):
    """bone and parent are dicts with 'pose' (parent final) and 'rest' arrays; W is a world matrix."""
    P = inv(arm_world) @ W
    if space == "WORLD": return W
    if space == "POSE": return P
    if space == "CUSTOM": return inv(custom) @ W
    if space == "LOCAL_WITH_PARENT": return inv(bone["rest"]) @ P
    if space == "LOCAL":
        if parent is None: return inv(bone["rest"]) @ P
        return basis_from_pose(parent["pose"], parent["rest"], bone["rest"], dict(flags, use_connect=False), P)
def bone_space_to_world(space, X, arm_world, bone, parent, flags=FLAGS, custom=None):
    if space == "WORLD": return X
    if space == "POSE": return arm_world @ X
    if space == "CUSTOM": return custom @ X
    if space == "LOCAL_WITH_PARENT": return arm_world @ bone["rest"] @ X
    if space == "LOCAL":
        if parent is None: return arm_world @ bone["rest"] @ X
        return arm_world @ pose_from_basis(parent["pose"], parent["rest"], bone["rest"], dict(flags, use_connect=False), X)
