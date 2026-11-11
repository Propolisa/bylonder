import random, sys
sys.path.insert(0, "gen"); from common import *
random.seed(21)
cases = []
mixes = ["REPLACE", "BEFORE_FULL", "BEFORE", "BEFORE_SPLIT", "AFTER_FULL", "AFTER", "AFTER_SPLIT"]
for i, mix in enumerate(mixes * 3):
    shear = i >= 7
    for rts in ([False, True] if shear else [False]):
        objs = (sheared_target() if shear else [obj("T")]) + [obj("O")]
        cases.append({"name": f"object_{mix}_{'shear' if shear else 'plain'}_{'rts' if rts else 'keep'}_{i}", "objects": objs,
                      "constraints": [{"owner": "O", "type": "COPY_TRANSFORMS", "target": "@T", "mix_mode": mix, "remove_target_shear": rts,
                                       "influence": 1.0 if i < 14 else round(random.uniform(0.1, 0.9), 3)}]})
# Bone owners in local space copying a bone in local space (the Rigify pattern), and pose space.
for i, mix in enumerate(mixes):
    for sp in ("LOCAL", "POSE", "WORLD"):
        cases.append({"name": f"bone_{mix}_{sp}", "objects": [armature()],
                      "constraints": [{"owner": "Arm", "bone": "B", "type": "COPY_TRANSFORMS", "target": "@Arm", "subtarget": "C", "mix_mode": mix,
                                       "owner_space": sp, "target_space": sp}]})
save(cases, "oracle/copy_transforms.cases.json")
