# Tallies the settings constraints use in the open file (type, spaces, mix modes and other enums).
import bpy, sys, collections, json
out = collections.Counter()
for ob in bpy.data.objects:
    owners = [ob] + (list(ob.pose.bones) if ob.pose else [])
    for o in owners:
        for c in o.constraints:
            key = [c.type, "bone" if o != ob else "obj", c.owner_space, getattr(c, "target_space", "")]
            for p in ("mix_mode", "volume", "keep_axis", "track_axis", "up_axis", "use_offset", "euler_order", "limit_mode", "chain_count", "use_tail", "use_stretch", "pole_target", "use_deform_preserve_volume", "use_bone_envelopes", "use_current_location", "remove_target_shear", "use_make_uniform", "power", "use_transform_limit", "use_legacy_behavior"):
                if hasattr(c, p):
                    v = getattr(c, p); key.append(f"{p}={v.name if hasattr(v, 'name') else v}")
            if c.driver_add if False else False: pass
            out[" ".join(map(str, key))] += 1
drv = collections.Counter()
for ob in bpy.data.objects:
    ad = ob.animation_data
    if ad:
        for fc in ad.drivers:
            if "constraints" in fc.data_path: drv[fc.data_path.split(".")[-1]] += 1
print("CENSUS", json.dumps({"settings": out.most_common(), "constraint_drivers": drv.most_common()}))
