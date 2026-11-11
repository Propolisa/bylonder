# Counts constraints per type in the open .blend; appends a JSON line to argv after "--".
import bpy, sys, json, collections
out = sys.argv[sys.argv.index("--") + 1]
name = sys.argv[sys.argv.index("--") + 2]
c = collections.Counter(); details = collections.Counter()
for ob in bpy.data.objects:
    for con in ob.constraints:
        c[con.type] += 1; details["object:" + con.type] += 1
    if ob.type == 'ARMATURE' and ob.pose:
        for pb in ob.pose.bones:
            for con in pb.constraints:
                c[con.type] += 1; details["bone:" + con.type] += 1
with open(out, "a") as f:
    f.write(json.dumps({"file": name, "counts": c, "details": details}) + "\n")
