"""The demo environment the character examples share: a 60 m field of gently rolling terrain, ringed by a rim of
hills that keeps the character in, under a soft sky and a warm sun,
its turf a small generated image that repeats without showing it, with a slope, steps, lanterns to look at, sparse
instanced grass and a few rocks, bushes and pines from Quaternius' Stylized Nature MegaKit (CC0 1.0, downloaded into
downloads/ and checked against its hash). Kept cheap for phones: about 240 grass instances and images of at most 512 px.

usage, from a script run in Blender: sys.path.insert(0, <this folder>); import environment; environment.build()
"""
import hashlib
import math
import os
import random
import urllib.request
import zipfile

import bpy

DOWNLOADS = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'downloads')
NATURE = ('https://opengameart.org/sites/default/files/stylized_nature_megakitstandard.zip',
          '298f6732b872e4cf7b30e6e7abf9641c7f6dc6b326df37ac089533ed7e3d58c9', 'glTF/Grass_Common_Short.gltf')


def fetch(url, sha256, member):
    """A file of a downloaded zip, the zip checked against its hash."""
    os.makedirs(DOWNLOADS, exist_ok=True)
    archive = os.path.join(DOWNLOADS, sha256[:16] + '.zip')
    if not os.path.exists(archive):
        request = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
        with urllib.request.urlopen(request) as response, open(archive, 'wb') as out:
            out.write(response.read())
    with open(archive, 'rb') as f:
        digest = hashlib.sha256(f.read()).hexdigest()
    if digest != sha256:
        raise RuntimeError(f'{url}: sha256 {digest}, expected {sha256}')
    folder = archive[:-4]
    if not os.path.exists(os.path.join(folder, member)):
        zipfile.ZipFile(archive).extractall(folder)
    return os.path.join(folder, member)


def surface(name, color, roughness):
    """A material of one Principled BSDF's color and roughness."""
    material = bpy.data.materials.new(name)
    material.use_nodes = True
    bsdf = material.node_tree.nodes['Principled BSDF']
    bsdf.inputs['Base Color'].default_value = (*color, 1)
    bsdf.inputs['Roughness'].default_value = roughness
    material.diffuse_color = (*color, 1)
    return material


def periodic_noise(rng, size, cycles, width=0.5):
    """Noise that tiles seamlessly: white noise kept to a band of frequencies around `cycles` per tile, scaled to 0..1."""
    import numpy as np
    f = np.fft.fftfreq(size) * size
    radius = np.hypot(*np.meshgrid(f, f))
    band = np.exp(-((np.log(radius + 1e-6) - math.log(cycles)) / width) ** 2)
    noise = np.fft.ifft2(np.fft.fft2(np.random.default_rng(rng.randrange(1 << 30)).standard_normal((size, size))) * band).real
    return (noise - noise.min()) / (noise.max() - noise.min())


def packed_image(name, rgb, quality=88):
    """An image of the project's own (rows bottom up, sRGB 0..1), packed as a JPEG."""
    import numpy as np
    size = rgb.shape[0]
    image = bpy.data.images.new(name, size, size)
    image.pixels.foreach_set(np.concatenate([rgb, np.ones((size, size, 1))], axis=2).astype(np.float32).ravel())
    path = os.path.join(DOWNLOADS, 'web', name + '.jpg')
    os.makedirs(os.path.dirname(path), exist_ok=True)
    image.file_format = 'JPEG'
    image.save(filepath=path, quality=quality)
    image.source, image.filepath = 'FILE', path
    image.reload()
    image.pack()
    return image


def turf_images(rng):
    """Turf, 512 px for 2 m: grass of two greens with fine blades, light and dark mottling, soft patches and
    flecks of earth, soft in hue but with enough mid-scale contrast that the ground reads as moving under the character without drawing the eye; and, 64 px, the field's slow variation."""
    import numpy as np
    size = 512
    smooth = lambda e0, e1, x: np.clip((x - e0) / (e1 - e0), 0, 1) ** 2 * (3 - 2 * np.clip((x - e0) / (e1 - e0), 0, 1))
    earth = smooth(0.62, 0.78, periodic_noise(rng, size, 3) * 0.75 + periodic_noise(rng, size, 9) * 0.25)
    flecks = smooth(0.7, 0.8, periodic_noise(rng, size, 28, 0.4))
    mottle = periodic_noise(rng, size, 6) - 0.5
    tone = periodic_noise(rng, size, 14)
    blades = periodic_noise(rng, size, 90, 0.8)
    dark, light, soil = np.array((0.32, 0.36, 0.2)), np.array((0.47, 0.5, 0.3)), np.array((0.47, 0.41, 0.3))
    grass = dark + (light - dark) * (tone * 0.6 + blades * 0.4)[..., None]
    rgb = grass + (soil * (0.85 + 0.3 * blades[..., None]) - grass) * np.maximum(earth * 0.8, flecks * 0.6)[..., None]
    rgb *= 1 + 0.28 * mottle[..., None]
    variation = periodic_noise(rng, 64, 2, 0.6)
    return packed_image('Turf', rgb), packed_image('Turf Variation', np.repeat(variation[..., None], 3, axis=2))


def turf(rng):
    """The ground's material: the turf image repeating every 2 m, its tone and hue shifted by the variation image,
    which repeats every 29 m at an angle, so the repeats do not line up into a visible grid."""
    detail, slow = turf_images(rng)
    material = bpy.data.materials.new('Turf')
    material.use_nodes = True
    nodes, links = material.node_tree.nodes, material.node_tree.links
    bsdf = nodes['Principled BSDF']
    bsdf.inputs['Roughness'].default_value, bsdf.inputs['Specular IOR Level'].default_value = 0.95, 0.2
    uv = nodes.new('ShaderNodeTexCoord').outputs['UV']

    def sampled(image, scale, angle):
        mapping = nodes.new('ShaderNodeMapping')
        mapping.inputs['Scale'].default_value, mapping.inputs['Rotation'].default_value[2] = (scale, scale, 1), angle
        texture = nodes.new('ShaderNodeTexImage')
        texture.image = image
        links.new(uv, mapping.inputs['Vector'])
        links.new(mapping.outputs['Vector'], texture.inputs['Vector'])
        return texture.outputs['Color']

    ramp = nodes.new('ShaderNodeValToRGB')
    ramp.color_ramp.elements[0].color, ramp.color_ramp.elements[1].color = (0.82, 0.86, 0.82, 1), (1.15, 1.1, 0.92, 1)
    links.new(sampled(slow, SIZE / 29, 0.5), ramp.inputs['Fac'])
    shade = nodes.new('ShaderNodeMix')
    shade.data_type, shade.blend_type = 'RGBA', 'MULTIPLY'
    shade.inputs['Factor'].default_value = 1
    links.new(sampled(detail, SIZE / 2, 0), shade.inputs['A'])
    links.new(ramp.outputs['Color'], shade.inputs['B'])
    links.new(shade.outputs['Result'], bsdf.inputs['Base Color'])
    material.diffuse_color = (0.38, 0.4, 0.25, 1)
    return material


def megakit(name):
    """One of the Stylized Nature MegaKit's models (CC0), imported with its images made small for the web (color as
    JPEG, color with alpha as PNG, an image or material the models share once); normal maps are left out."""
    bpy.ops.import_scene.gltf(filepath=os.path.join(os.path.dirname(fetch(*NATURE)), name + '.gltf'))
    model = next(o for o in bpy.context.selected_objects if o.type == 'MESH')
    for slot in model.material_slots:
        # A material another model brought already (the rocks share one) is used once.
        known = bpy.data.materials.get(slot.material.name.rsplit('.', 1)[0])
        if known and known != slot.material:
            bpy.data.materials.remove(slot.material)
            slot.material = known
    for material in {s.material for s in model.material_slots}:
        nodes = material.node_tree.nodes
        for node in [n for n in nodes if n.type == 'NORMAL_MAP']:
            nodes.remove(node)
        for node in [n for n in nodes if n.type == 'TEX_IMAGE']:
            if not node.outputs['Color'].links and not node.outputs['Alpha'].links:
                nodes.remove(node)
            else:
                node.image = web_image(node.image, bool(node.outputs['Alpha'].links))
    return model


def web_image(image, alpha):
    """The image at most 128 px, packed; the one made before for the same file if there is one."""
    path = os.path.join(DOWNLOADS, 'web', bpy.path.clean_name(os.path.splitext(os.path.basename(image.filepath))[0]) + ('.png' if alpha else '.jpg'))
    made = next((i for i in bpy.data.images if i.filepath == path and i != image), None)
    if image.filepath == path:
        return image
    if made:
        bpy.data.images.remove(image)
        return made
    image.scale(*(min(s, 128) for s in image.size))
    image.file_format = 'PNG' if alpha else 'JPEG'
    image.save(filepath=path, quality=85)
    if image.packed_file:
        image.unpack(method='REMOVE')
    image.filepath = path
    image.reload()
    image.pack()
    return image


def tinted(model, name, tint):
    """A copy of the model whose material's color is multiplied by tint."""
    copy = model.copy()
    copy.data = model.data.copy()
    copy.name = name
    bpy.context.scene.collection.objects.link(copy)
    material = copy.data.materials[0] = model.data.materials[0].copy()
    nodes, links = material.node_tree.nodes, material.node_tree.links
    texture = next(n for n in nodes if n.type == 'TEX_IMAGE')
    bsdf = next(n for n in nodes if n.type == 'BSDF_PRINCIPLED')
    mix = nodes.new('ShaderNodeMix')
    mix.data_type, mix.blend_type = 'RGBA', 'MULTIPLY'
    mix.inputs['Factor'].default_value, mix.inputs['B'].default_value = 1, (*tint, 1)
    links.new(texture.outputs['Color'], mix.inputs['A'])
    links.new(mix.outputs['Result'], bsdf.inputs['Base Color'])
    return copy


# Kept free of grass: where the character starts, and the line before and behind it where a camera first looks.
clear = lambda x, y: math.hypot(x, y) < 3 or (abs(x) < 1.5 and abs(y) < 7)


def instanced(model, name, placements):
    """`model` at each (x, y, z, size, turn) of `placements`, as instances on the faces of a scatter mesh (Instancing
    Faces, scaled by face): each small triangle sets one's place, turn and size, and the page draws them all as thin
    instances of one geometry."""
    # The scatter object stands 50 m under the field, so the model itself, which the viewport shows at its origin as
    # Blender's does, is out of sight.
    triangles, below = [], 50
    for x, y, z, size, turn in placements:
        # A triangle's area is 1.3 r^2; the instance takes the square root of it as its scale.
        corner = size / math.sqrt(1.299)
        triangles.append([(x + corner * math.cos(turn + k * math.tau / 3), y + corner * math.sin(turn + k * math.tau / 3), z + below) for k in range(3)])
    mesh = bpy.data.meshes.new(name + ' Scatter')
    mesh.from_pydata([v for t in triangles for v in t], [], [[3 * i, 3 * i + 1, 3 * i + 2] for i in range(len(triangles))])
    scatter = bpy.data.objects.new(name + ' Scatter', mesh)
    bpy.context.scene.collection.objects.link(scatter)
    scatter.location.z = -below
    scatter.instance_type, scatter.use_instance_faces_scale = 'FACES', True
    scatter.show_instancer_for_viewport = scatter.show_instancer_for_render = False
    model.parent = scatter


def grass(rng, height, tuft):
    """Tufts of grass in patches with bare turf between them, most near the middle where the character plays, none on
    the slope or the steps: each patch a few tufts of varied size and turn, in a fresh or a dry green."""
    kinds = {'Grass': (tinted(tuft, 'Grass Tuft', (0.72, 0.78, 0.55)), []), 'Dry Grass': (tinted(tuft, 'Dry Grass Tuft', (1.15, 0.95, 0.42)), [])}
    bpy.data.objects.remove(tuft)
    patches = 0
    while patches < 28:
        r, a = abs(rng.gauss(0, 6)) + 1.5, rng.uniform(0, math.tau)
        cx, cy = r * math.cos(a), r * math.sin(a)
        if abs(cx) > 18 or abs(cy) > 18 or (2 < cx < 10 and abs(cy) < 2.5) or (-8.5 < cx < -3.5 and 0.5 < cy < 8):
            continue
        patches += 1
        spread, kind = rng.uniform(0.15, 0.45), 'Dry Grass' if rng.random() < 0.3 else 'Grass'
        for _ in range(rng.randint(4, 12)):
            x, y = cx + rng.gauss(0, spread), cy + rng.gauss(0, spread)
            size, turn = rng.uniform(0.08, 0.26), rng.uniform(0, math.tau)
            if not clear(x, y):
                kinds[kind][1].append((x, y, height(x, y), size, turn))
    for name, (model, placements) in kinds.items():
        instanced(model, name, placements)


def scenery(height):
    """A few MegaKit models around the field, set into the ground and sunk deeper on the rim's slope so no side
    floats: rocks, bushes and pines, kept clear of the paths between the slope, the steps and the lanterns, and more
    rocks and pines along the rim. Each model's copies are instances of it."""
    spots = {'Rock_Medium_1': [((-3, -9), 0.5, 0.4), ((-12, 6), 0.7, 4)], 'Rock_Medium_2': [((11, -4), 0.4, 2.1), ((4, 11), 0.3, 1)],
             'Bush_Common_Flowers': [((-9, -3), 0.8, 0), ((7, -8), 0.7, 2.5), ((-2, 10), 0.6, 1.2)], 'Pine_5': [((-11, -10), 1, 0), ((13, 9), 0.8, 2)]}
    # Along the rim, partway up: rocks and pines at a few angles (degrees), each its distance out.
    on_rim = lambda out, angles, size: [((out * math.cos(math.radians(a)), out * math.sin(math.radians(a))), size, a / 40) for a in angles]
    spots['Rock_Medium_1'] += on_rim(25, (20, 140, 250), 1.1)
    spots['Rock_Medium_2'] += on_rim(24, (75, 200, 310), 0.9)
    spots['Pine_5'] += on_rim(26, (100, 170, 285, 345), 1.2)
    for name, places in spots.items():
        instanced(megakit(name), name, [(x, y, height(x, y) - (0.08 + 0.5 * rim(x, y)) * size, size, turn) for (x, y), size, turn in places])


# Where the terrain is flat: where the character starts, and under the steps and the slope, which stand on it.
FLAT = [((0, 0), 2.5, 6), ((-6, 3.6), 2.6, 5), ((6, 0), 3.4, 6)]


# The field's side, and its rim: from RIM metres out (along a rounded square) the ground rises RIM_HEIGHT over RIM_WIDTH,
# up to 45 degrees, too steep to walk, so the rim is the field's wall.
SIZE, RIM, RIM_WIDTH, RIM_HEIGHT = 60, 21, 7, 4.5


def rim(x, y):
    """How far up the rim a place is, 0 inside the field to 1 at its top."""
    out = ((x ** 4 + y ** 4) ** 0.25 - RIM) / RIM_WIDTH
    return (lambda c: c * c * (3 - 2 * c))(min(max(out, 0), 1))


def terrain(rng):
    """The field's height: three long, low waves (8 to 15 m, together within about 0.4 m, slopes under 20 degrees),
    eased to level ground at the FLAT places, and the rim of hills around it."""
    waves = [(rng.uniform(0, math.tau), math.tau / rng.uniform(8, 15), rng.uniform(0, math.tau), 0.14) for _ in range(3)]
    smooth = lambda t: (lambda c: c * c * (3 - 2 * c))(min(max(t, 0), 1))

    def height(x, y):
        level = min(smooth((math.hypot(x - cx, y - cy) - inner) / (outer - inner)) for (cx, cy), inner, outer in FLAT)
        return level * sum(a * math.sin(k * (x * math.cos(d) + y * math.sin(d)) + phase) for d, k, phase, a in waves) + RIM_HEIGHT * rim(x, y)
    return height


def ground():
    """A 60 m field of gentle rolling terrain inside a rim of hills, with a slope and steps, and lanterns to look at;
    turf, grass and a few rocks, bushes and trees."""
    rng = random.Random(7)
    # 36 by 36 faces, 1.67 m apart: enough for waves 8 m long and the rim's rise, and small in the package.
    bpy.ops.mesh.primitive_grid_add(x_subdivisions=36, y_subdivisions=36, size=SIZE)
    field = bpy.context.object
    field.name = 'Ground'
    height = terrain(random.Random(5))
    for v in field.data.vertices:
        v.co.z = height(v.co.x, v.co.y)
    field.data.shade_smooth()
    stone = surface('Stone', (0.42, 0.4, 0.37), 0.7)
    # The turf's own seed, so changing it leaves the grass where it is.
    field.data.materials.append(turf(random.Random(3)))
    grass(rng, height, megakit('Grass_Common_Short'))
    scenery(height)
    bpy.ops.mesh.primitive_cube_add(size=1, location=(6, 0, 0))
    ramp = bpy.context.object
    ramp.name, ramp.scale, ramp.rotation_euler = 'Slope', (6, 3, 0.3), (0, -math.radians(12), 0)
    ramp.data.materials.append(stone)
    for k in range(5):
        bpy.ops.mesh.primitive_cube_add(size=1, location=(-6, 2 + k * 0.4, 0.09 + k * 0.09))
        step = bpy.context.object
        # Each a hair narrower than the one under it: coplanar sides render as black, flickering faces.
        step.name, step.scale = f'Step {k + 1}', (3 - 0.004 * k, 0.4 + (4 - k) * 0.8, 0.18 * (k + 1))
        step.location.y = 2 + k * 0.4 + (4 - k) * 0.4
        step.location.z = 0.09 * (k + 1)
        step.data.materials.append(stone)
    for k, (x, y) in enumerate(((3, 5), (-4, -5), (9, 4))):
        bpy.ops.object.empty_add(type='SPHERE', radius=0.15, location=(x, y, 1.7))
        bpy.context.object.name = f'Look Target {k + 1}'
        bpy.ops.object.light_add(type='POINT', location=(x, y, 1.7))
        bpy.context.object.data.energy = 15
        bpy.context.object.data.color = (1, 0.7, 0.4)


def sky_and_sun():
    """A soft sky, a pale blue haze at the horizon that is clearly blue within 15 degrees of it (a following camera sees
    little more), deeper overhead; and one warm afternoon sun, whose 3 degree disc softens the shadows' edges."""
    scene = bpy.context.scene
    if not scene.world:
        scene.world = bpy.data.worlds.new('World')
        scene.world.use_nodes = True
    nodes, links = scene.world.node_tree.nodes, scene.world.node_tree.links
    up = nodes.new('ShaderNodeSeparateXYZ')
    links.new(nodes.new('ShaderNodeTexCoord').outputs['Generated'], up.inputs['Vector'])
    ramp = nodes.new('ShaderNodeValToRGB')
    # By the sine of the elevation: 0.26 is 15 degrees up.
    horizon, zenith = ramp.color_ramp.elements
    horizon.color, zenith.color, zenith.position = (0.62, 0.72, 0.86, 1), (0.22, 0.42, 0.8, 1), 0.75
    ramp.color_ramp.elements.new(0.26).color = (0.38, 0.56, 0.86, 1)
    links.new(up.outputs['Z'], ramp.inputs['Fac'])
    background = nodes['Background']
    links.new(ramp.outputs['Color'], background.inputs['Color'])
    background.inputs['Strength'].default_value = 0.9
    bpy.ops.object.light_add(type='SUN', rotation=(0.7, 0.2, 0.6))
    sun = bpy.context.object.data
    sun.energy, sun.color, sun.angle = 3.2, (1, 0.9, 0.76), math.radians(3)


def build():
    """Adds the environment to the scene; its camera is the caller's."""
    ground()
    sky_and_sun()
