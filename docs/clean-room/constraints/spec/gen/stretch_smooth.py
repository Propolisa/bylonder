import sys; sys.path.insert(0, "gen"); from common import *
cases = []
for sm in (0.0, 0.25, 0.5, 1.0):
    for lim in (("max", 2.0), ("min", 0.5)):
        for k in range(25):
            v = 0.2 * (1.12 ** (k * 1.3))  # raw thickness factor 0.2 .. ~7
            d = 1.0 / v
            c = {"owner": "O", "type": "STRETCH_TO", "target": "@T", "volume": "VOLUME_X", "rest_length": 1.0, "bulge": 1.0, "bulge_smooth": sm}
            if lim[0] == "max": c.update(use_bulge_max=True, bulge_max=lim[1])
            else: c.update(use_bulge_min=True, bulge_min=lim[1])
            cases.append({"name": f"smooth_{sm}_{lim[0]}_{round(v, 4)}", "objects": [{"name": "O"}, {"name": "T", "loc": [0, d, 0]}], "constraints": [c]})
save(cases, "oracle/stretch_smooth.cases.json")
