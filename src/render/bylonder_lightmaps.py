"""Bake Lightmaps (docs/features/lightmaps.md): an object's light baked by Cycles into its Bylonder lightmap
(object.bylonder.lightmap), the same in Bylonder's Bake Lightmaps (src/render/bake-lightmaps.js, which runs each bake
as Blender's bake job and denoises with Open Image Denoise on WebGPU) and in desktop Blender (bake_lightmap, as
examples/meditation/meditation.py bakes).

What the image holds follows the setting's Direct. On: all the light reaching the surface, without its colour (Diffuse,
Direct and Indirect). Off: the light it gives back of everything but the lamps' direct light, which a page gives it
live (Diffuse with Color, less the same bake's direct light with the world hidden from diffuse rays). The light is
stored over its peak, as an sRGB JPEG, dithered, its Intensity the peak, so 8 bits neither clip nor band.
"""
import os

import bpy
import numpy as np

UV_MAP = 'Lightmap'
MARGIN = 8
QUALITY = 97


def lightmap_uvs(ob):
    """The object's lightmap UV map, made by Lightmap Pack where it has none (its function, as uv.lightmap_pack runs it on
    all faces at its default margin); its own UV map stays the one it renders."""
    from bl_operators.uvcalc_lightmap import lightmap_uvpack
    layers = ob.data.uv_layers
    if UV_MAP in layers:
        return
    if not layers:
        layers.new(name='UVMap')
    active, layers.active = layers.active, layers.new(name=UV_MAP)
    lightmap_uvpack([ob.data], PREF_SEL_ONLY=False, PREF_PACK_IN_ONE=True, PREF_MARGIN_DIV=1000)
    layers.active = active


def only(ob):
    """Selects the object alone and makes it active, as a bake of it needs."""
    for other in bpy.context.view_layer.objects:
        other.select_set(other == ob)
    bpy.context.view_layer.objects.active = ob


def steps(direct):
    """The bakes a lightmap takes, by name: object.bake's arguments, and whether the world is hidden from diffuse rays."""
    light = {'DIRECT', 'INDIRECT'} if direct else {'DIRECT', 'INDIRECT', 'COLOR'}
    bakes = {'light': (dict(type='DIFFUSE', pass_filter=light), False), 'normal': (dict(type='NORMAL', normal_space='OBJECT'), False)}
    if not direct:
        bakes['lamps'] = (dict(type='DIFFUSE', pass_filter={'DIRECT', 'COLOR'}), True)
        bakes['albedo'] = (dict(type='DIFFUSE', pass_filter={'COLOR'}), False)
    return bakes


class Bake:
    """One object's lightmap bake: each step's image and the temporary image nodes Cycles bakes into, then the light
    and the passes its denoising is guided by."""

    def __init__(self, ob, size, direct, samples=None):
        layer = bpy.context.view_layer
        self.selection = [o for o in layer.objects if o.select_get()], layer.objects.active
        self.ob, self.size, self.direct, self.samples = ob, size, direct, samples
        self.steps = steps(direct)
        self.pixels = {}
        self.step = None
        lightmap_uvs(ob)

    def begin(self, name):
        """Sets up the step's bake: a float image in a temporary node active in each material, the lightmap UV map
        active, the object alone selected; returns object.bake's arguments."""
        scene, ob = bpy.context.scene, self.ob
        args, world_hidden = self.steps[name]
        self.step = name
        self.kept = (scene.render.engine, scene.cycles.samples, ob.data.uv_layers.active.name)
        scene.render.engine = 'CYCLES'
        if self.samples:
            scene.cycles.samples = self.samples
        self.world = scene.world if world_hidden and scene.world and scene.world.cycles_visibility.diffuse else None
        if self.world:
            self.world.cycles_visibility.diffuse = False
        self.image = bpy.data.images.new(f'{ob.name} Bake', self.size, self.size, float_buffer=True)
        self.temporary = []
        if not any(slot.material for slot in ob.material_slots):
            ob.data.materials.append(bpy.data.materials.new(f'{ob.name} Bake'))
            self.temporary.append(ob.data.materials[-1])
        self.nodes = []
        for mat in {slot.material for slot in ob.material_slots if slot.material}:
            node = mat.node_tree.nodes.new('ShaderNodeTexImage')
            node.image = self.image
            mat.node_tree.nodes.active = node
            self.nodes.append((mat, node))
        ob.data.uv_layers.active = ob.data.uv_layers[UV_MAP]
        only(ob)
        return dict(args, margin=MARGIN, use_clear=True, target='IMAGE_TEXTURES', use_selected_to_active=False)

    def end(self, name):
        """The step's image as RGB floats, and what begin set up gone."""
        scene, ob = bpy.context.scene, self.ob
        pixels = np.empty(self.size * self.size * 4, np.float32)
        self.image.pixels.foreach_get(pixels)
        self.pixels[name] = pixels.reshape(self.size, self.size, 4)[..., :3]
        for mat, node in self.nodes:
            mat.node_tree.nodes.remove(node)
        for mat in self.temporary:
            ob.data.materials.pop(index=len(ob.data.materials) - 1)
            bpy.data.materials.remove(mat)
        bpy.data.images.remove(self.image)
        if self.world:
            self.world.cycles_visibility.diffuse = True
        scene.render.engine, scene.cycles.samples, uv = self.kept
        ob.data.uv_layers.active = ob.data.uv_layers[uv]
        self.step = None

    def restore(self):
        """Ends a step begun, and selects what was selected before."""
        if self.step:
            self.end(self.step)
        selected, active = self.selection
        for other in bpy.context.view_layer.objects:
            other.select_set(other in selected)
        bpy.context.view_layer.objects.active = active

    def inputs(self):
        """The light to store and its denoiser's guides: albedo (white for light without colour) and normals (-1..1)."""
        light = self.pixels['light'] if self.direct else self.pixels['light'] - self.pixels['lamps']
        albedo = self.pixels['albedo'] if 'albedo' in self.pixels else np.ones_like(light)
        return np.clip(light, 0, None), albedo, self.pixels['normal'] * 2 - 1

    def store(self, light):
        """The light, denoised, as the object's lightmap; returns its Intensity."""
        return store(self.ob, light, self.direct)


def store(ob, light, direct):
    """Light (RGB floats, rows from the bottom) as the object's lightmap: over its peak, sRGB, dithered, saved as a JPEG
    packed in the .blend, its Intensity the peak, with the UV map and Direct. Returns the Intensity."""
    light = np.clip(light, 0, None)
    size = light.shape[0]
    intensity = float(light.max()) or 1.0
    linear = np.clip(light / intensity, 0, 1)
    srgb = np.where(linear <= 0.0031308, linear * 12.92, 1.055 * np.power(linear, 1 / 2.4) - 0.055)
    srgb = np.clip(srgb + np.random.default_rng(1).uniform(-0.5, 0.5, srgb.shape) / 255, 0, 1)
    settings = ob.bylonder.lightmap
    old, name = settings.image, f'{ob.name} Lightmap'
    image = bpy.data.images.new(name, size, size)
    image.pixels.foreach_set(np.concatenate([srgb, np.ones((size, size, 1))], axis=2).astype(np.float32).ravel())
    # Blender in a page has no temporary directory of its own: its files are in memory.
    directory = bpy.app.tempdir or '/tmp'
    os.makedirs(directory, exist_ok=True)
    path = os.path.join(directory, f'{name}.jpg')
    image.file_format = 'JPEG'
    image.save(filepath=path, quality=QUALITY)
    image.source, image.filepath = 'FILE', path
    image.reload()
    image.pack()
    os.remove(path)
    if old and old.users <= 1:
        bpy.data.images.remove(old)
    image.name = name
    settings.image, settings.uv_map, settings.intensity, settings.direct = image, UV_MAP, round(intensity, 4), direct
    return intensity


def compositor_denoise(light, albedo, normal):
    """Light denoised by the compositor's Denoise node (Open Image Denoise), guided by albedo and normals, as a render of
    it alone: desktop Blender's way, where its build has Open Image Denoise."""
    scene, size = bpy.context.scene, light.shape[0]

    def image(name, rgb):
        made = bpy.data.images.new(name, size, size, float_buffer=True)
        made.pixels.foreach_set(np.concatenate([rgb, np.ones((size, size, 1))], axis=2).astype(np.float32).ravel())
        return made

    sources = [image('Bake', light), image('Bake Albedo', albedo), image('Bake Normal', normal)]
    tree = bpy.data.node_groups.new('Denoise Bake', 'CompositorNodeTree')
    tree.interface.new_socket('Image', in_out='OUTPUT', socket_type='NodeSocketColor')
    denoise, output = tree.nodes.new('CompositorNodeDenoise'), tree.nodes.new('NodeGroupOutput')
    for source, socket in zip(sources, ('Image', 'Albedo', 'Normal')):
        node = tree.nodes.new('CompositorNodeImage')
        node.image = source
        tree.links.new(node.outputs['Image'], denoise.inputs[socket])
    tree.links.new(denoise.outputs['Image'], output.inputs[0])
    render, path = scene.render, os.path.join(bpy.app.tempdir, 'denoised.exr')
    kept = (render.resolution_x, render.resolution_y, render.resolution_percentage, render.filepath,
            render.image_settings.file_format, render.image_settings.color_depth, scene.compositing_node_group)
    # The scene itself is not rendered: no view layer is used.
    scene.compositing_node_group, bpy.context.view_layer.use = tree, False
    render.resolution_x = render.resolution_y = size
    render.resolution_percentage = 100
    render.image_settings.file_format, render.image_settings.color_depth = 'OPEN_EXR', '32'
    render.filepath = path
    bpy.ops.render.render(write_still=True)
    (render.resolution_x, render.resolution_y, render.resolution_percentage, render.filepath,
     render.image_settings.file_format, render.image_settings.color_depth, scene.compositing_node_group) = kept
    bpy.context.view_layer.use = True
    result = bpy.data.images.load(path)
    pixels = np.empty(size * size * 4, np.float32)
    result.pixels.foreach_get(pixels)
    for data in (result, *sources):
        bpy.data.images.remove(data)
    bpy.data.node_groups.remove(tree)
    os.remove(path)
    return pixels.reshape(size, size, 4)[..., :3]


def bake_lightmap(ob, size, direct=True, samples=None, denoise=compositor_denoise):
    """Bakes the object's lightmap with Cycles in this Blender, each bake run by object.bake; returns its Intensity."""
    bake = Bake(ob, size, direct, samples)
    for name in bake.steps:
        bpy.ops.object.bake(**bake.begin(name))
        bake.end(name)
    bake.restore()
    light, albedo, normal = bake.inputs()
    return bake.store(denoise(light, albedo, normal) if denoise else light)


# Bylonder's Bake Lightmaps (src/render/bake-lightmaps.js) runs each bake as Blender's job and denoises on WebGPU
# between these calls, the arrays passing through files: RGB float32 images, rows from the bottom.
current = None


def start(name, resolution, samples):
    """Starts the bake of the named object's lightmap, by its setting's Direct, at its image's size, else `resolution`;
    returns the steps' names."""
    global current
    ob = bpy.data.objects[name]
    settings = ob.bylonder.lightmap
    size = settings.image.size[0] if settings.image and settings.image.size[0] else resolution
    current = Bake(ob, size, settings.direct, samples)
    return list(current.steps)


def begin(step):
    args = current.begin(step)
    return {key: sorted(value) if isinstance(value, set) else value for key, value in args.items()}


def end(step):
    current.end(step)


def write_inputs(path):
    """The light, albedo and normals (0..1, as baked) one after the other in a file; returns the size."""
    current.restore()
    light, albedo, normal = current.inputs()
    with open(path, 'wb') as file:
        file.write(np.stack([light, albedo, normal * 0.5 + 0.5]).astype('<f4').tobytes())
    return current.size


def store_from(path):
    """The light in a file (denoised) as the object's lightmap; returns its Intensity."""
    global current
    with open(path, 'rb') as file:
        light = np.frombuffer(file.read(), '<f4').reshape(current.size, current.size, 3)
    intensity, current = current.store(light), None
    return intensity


def cancel():
    global current
    if current:
        current.restore()
    current = None
