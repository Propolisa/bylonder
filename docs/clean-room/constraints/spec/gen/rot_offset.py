import sys; sys.path.insert(0, "gen"); from common import *
cases = []
for orot in ([0, 0, 0], [30, 0, 0], [0, 30, 0], [0, 0, 30], [20, 30, 40]):
    for trot in ([10, 0, 0], [0, 10, 0], [0, 0, 10], [10, 20, 0], [10, 20, 30]):
        for flags in ({}, {"use_y": False, "use_z": False}, {"use_x": False}, {"invert_y": True}):
            cases.append({"name": f"o{orot}_t{trot}_{'-'.join(k for k in flags)}".replace(" ", ""),
                          "objects": [{"name": "T", "rot": trot}, {"name": "O", "rot": orot}],
                          "constraints": [dict({"owner": "O", "type": "COPY_ROTATION", "target": "@T", "mix_mode": "OFFSET"}, **flags)]})
save(cases, "oracle/rot_offset.cases.json")
