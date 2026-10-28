# Writes Blender's shader and compositor node types as Blender declares them: per node its label, description, color
# tag, width, sockets (identifier, name, type, default, range, subtype, shape, color) and properties (enums with their
# items, and the sockets and color tag each item gives); and the Node Editor theme. The nodes are the types bpy.types
# has and the idnames Blender's Add menus name (some are aliases, as ShaderNodeBsdfGlossy is of
# ShaderNodeBsdfAnisotropic).
# usage: blender -b --factory-startup --python tools/blender-reference/nodes.py -- OUT.json
import bpy, glob, json, os, re, sys

out_path = sys.argv[sys.argv.index("--") + 1]
BASE = {p.identifier for p in bpy.types.Node.bl_rna.properties}


def value(v):
    if hasattr(v, "__len__") and not isinstance(v, str):
        return [round(x, 6) if isinstance(x, float) else x for x in v]
    return round(v, 6) if isinstance(v, float) else v


def socket(s):
    d = {"identifier": s.identifier, "name": s.name, "idname": s.bl_idname, "type": s.type, "shape": s.display_shape}
    if s.label:
        d["label"] = s.label
    if not s.enabled:
        d["enabled"] = False
    if s.hide_value:
        d["hide_value"] = True
    if s.is_multi_input:
        d["multi_input"] = True
    if "default_value" in s.bl_rna.properties:
        p = s.bl_rna.properties["default_value"]
        if p.type not in {"POINTER", "COLLECTION"}:
            d["default"] = value(s.default_value)
            if p.type in {"FLOAT", "INT"}:
                d["min"], d["max"] = value(p.soft_min), value(p.soft_max)
                if p.subtype != "NONE":
                    d["subtype"] = p.subtype
            if p.type == "ENUM":
                d["items"] = [i.name for i in s.bl_rna.properties["default_value"].enum_items]
    try:
        d["color"] = value(s.draw_color_simple())
    except Exception:
        pass
    return d


def availability(node):
    return {"inputs": [s.identifier for s in node.inputs if s.enabled], "outputs": [s.identifier for s in node.outputs if s.enabled],
            "labels": {s.identifier: s.label for s in node.inputs if s.enabled and s.label}, "color_tag": node.color_tag}


def prop(node, p):
    d = {"name": p.name, "type": p.type}
    if p.type == "ENUM":
        d["items"] = [[i.identifier, i.name, i.description] for i in p.enum_items]
        d["default"] = getattr(node, p.identifier)
        variants = {}
        for identifier, _, _ in d["items"]:
            try:
                setattr(node, p.identifier, identifier)
            except Exception:
                continue
            variants[identifier] = availability(node)
        if d["default"]:
            setattr(node, p.identifier, d["default"])
        d["variants"] = variants
    elif p.type in {"BOOLEAN", "INT", "FLOAT", "STRING"}:
        d["default"] = value(getattr(node, p.identifier))
    return d


MENUS = os.path.join(bpy.utils.resource_path("LOCAL"), "scripts", "startup", "bl_ui", "node_add_menu*.py")
MENU_IDNAMES = {name for path in glob.glob(MENUS) for name in re.findall(r'"((?:Shader|Compositor|Function|Geometry)?Node[A-Z]\w+)"', open(path).read())}


def tree_nodes(tree, prefixes):
    nodes = {}
    for idname in sorted(set(dir(bpy.types)) | MENU_IDNAMES):
        if not idname.startswith(prefixes):
            continue
        try:
            node = tree.nodes.new(idname)
        except Exception:
            continue
        rna = node.bl_rna
        nodes[idname] = {
            "name": rna.name, "description": rna.description, "color_tag": node.color_tag, "width": node.width,
            "inputs": [socket(s) for s in node.inputs], "outputs": [socket(s) for s in node.outputs],
            "properties": {p.identifier: prop(node, p) for p in rna.properties if p.identifier not in BASE and not p.is_readonly},
        }
    return nodes


material = bpy.data.materials.new("Nodes")
compositor = bpy.data.node_groups.new("Compositor", "CompositorNodeTree")
theme = bpy.context.preferences.themes[0].node_editor
data = {
    "blender": bpy.app.version_string,
    "theme": {p.identifier: value(getattr(theme, p.identifier)) for p in theme.bl_rna.properties if p.type in {"FLOAT", "INT"}},
    "shader": tree_nodes(material.node_tree, ("ShaderNode", "FunctionNode", "GeometryNode", "Node")),
    "compositor": tree_nodes(compositor, ("CompositorNode", "ShaderNode", "FunctionNode", "GeometryNode", "Node")),
}
json.dump(data, open(out_path, "w"), indent=1)
print("wrote", out_path, len(data["shader"]), "shader and", len(data["compositor"]), "compositor nodes")
