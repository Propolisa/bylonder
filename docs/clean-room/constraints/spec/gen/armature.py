import random, sys
sys.path.insert(0, "gen"); from common import *
random.seed(91)
cases = []
for i in range(14):
    n = 1 + i % 3
    ws = [round(random.uniform(0.1, 1), 3) for _ in range(n)]
    if i % 2: s = sum(ws); ws = [round(w / s, 6) for w in ws]
    tg = [{"target": "@Arm", "subtarget": "ABC"[k], "weight": ws[k]} for k in range(n)]
    if i < 7:
        objs = [armature(), obj("O")]; c = {"owner": "O", "type": "ARMATURE", "targets": tg}
    else:
        a = armature(); a["bones"].append({"name": "D", "head": [0.5, 0.5, 0.5], "tail": [0.5, 0.9, 1.0], "roll": 20, **({"parent": "C"} if i % 2 else {})})
        a["pose"]["D"] = {"loc": rv(-0.3, 0.3), "rot": rv(-40, 40)}
        objs = [a]; c = {"owner": "Arm", "bone": "D", "type": "ARMATURE", "targets": tg}
    if i % 5 == 4: c["influence"] = 0.5
    cases.append({"name": f"{'object' if i < 7 else 'bone'}_{n}targets_{i}", "objects": objs, "constraints": [c]})
cases.append({"name": "object_parented", "objects": [armature(), obj("P"), obj("O", parent="P")], "constraints": [{"owner": "O", "type": "ARMATURE", "targets": [{"target": "@Arm", "subtarget": "B", "weight": 1.0}]}]})
cases.append({"name": "preserve_volume", "objects": [armature(), obj("O")], "constraints": [{"owner": "O", "type": "ARMATURE", "use_deform_preserve_volume": True, "targets": [{"target": "@Arm", "subtarget": "A", "weight": 0.5}, {"target": "@Arm", "subtarget": "C", "weight": 0.5}]}]})
save(cases, "oracle/armature.cases.json")
