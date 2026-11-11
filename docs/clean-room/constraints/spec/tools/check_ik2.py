import sys, json; sys.path.insert(0, "tools"); from ik2 import *
L1 = np.linalg.norm([0, 0.15, 1]); L2 = np.linalg.norm([0, -0.15, 1.1])
for r in json.load(open(sys.argv[1])):
    c = r["input"]["constraints"][0]
    if c.get("influence", 1) < 1 or not c.get("use_tail", True) or c.get("use_rotation"): continue
    u = r["unconstrained"]["Arm"]["bones"]; b = r["output"]["Arm"]["bones"]
    P1, P2 = np.array(u["Up"]["pose"]), np.array(u["Lo"]["pose"])
    t = np.array(r["output"]["T"]["matrix_world"])[:3, 3]
    pole = np.array(r["output"]["P"]["matrix_world"])[:3, 3] if "P" in r["output"] else None
    R1, R2 = two_bone(P1, P2, L1, L2, t, pole, c.get("pole_angle", 0.0))
    e1 = np.abs(R1 - np.array(b["Up"]["pose"])).max(); e2 = np.abs(R2 - np.array(b["Lo"]["pose"])).max()
    print(f"{r['name']:28s} {e1:.4f} {e2:.4f}")
