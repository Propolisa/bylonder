import sys; sys.path.insert(0, "gen"); from common import *
cases = []
for orot in ([0, 100, 0], [180, 80, 180], [30, 120, 40], [0, 60, 0], [170, 10, 0], [0, 10, 170], [100, 0, 0], [0, 0, 100]):
    for trot in ([10, 0, 0], [0, 0, 10], [0, 130, 0], [200, 0, 0], [-170, 20, 30]):
        for flags in ({"use_y": False, "use_z": False}, {"use_x": False, "use_y": False}, {}):
            for mix in ("REPLACE", "ADD"):
                cases.append({"name": f"o{orot}_t{trot}_{'x' if 'use_x' not in flags else ''}{'z' if 'use_z' not in flags else ''}_{mix}".replace(" ", ""),
                              "objects": [{"name": "T", "rot": trot}, {"name": "O", "rot": orot}],
                              "constraints": [dict({"owner": "O", "type": "COPY_ROTATION", "target": "@T", "mix_mode": mix}, **flags)]})
save(cases, "oracle/rot_branch.cases.json")
