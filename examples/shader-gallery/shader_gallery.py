"""Builds shader_gallery.blend: twenty spheres, each with a material made of Blender's common shader nodes, seen from
above by an orthographic camera, in Blender 5.2.3. With an output path, also renders it in EEVEE there (the reference
tests/e2e/shader-gallery.mjs compares Bylonder's render with).

usage: blender -b --factory-startup -P shader_gallery.py [-- RENDER.png]
"""
import os
import sys

import bpy

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.render.engine = 'BLENDER_EEVEE'
scene.render.resolution_x, scene.render.resolution_y = 256, 320
scene.view_settings.view_transform = 'Standard'
scene.world = bpy.data.worlds.new('World')
scene.world.node_tree.nodes['Background'].inputs['Color'].default_value = (0.05, 0.05, 0.05, 1)

camera = bpy.data.objects.new('Camera', bpy.data.cameras.new('Camera'))
camera.data.type, camera.data.ortho_scale, camera.location = 'ORTHO', 5.0, (0, 0, 10)
scene.collection.objects.link(camera)
scene.camera = camera
sun = bpy.data.objects.new('Sun', bpy.data.lights.new('Sun', 'SUN'))
sun.data.energy = 3.0
sun.rotation_euler = (0.6, 0.3, 0.0)
scene.collection.objects.link(sun)


def material(name, build):
    """A material whose node tree `build(nodes, link, output)` makes; output is the Material Output's Surface."""
    ma = bpy.data.materials.new(name)
    nodes = ma.node_tree.nodes
    nodes.remove(nodes['Principled BSDF'])
    output = nodes['Material Output']
    build(nodes, ma.node_tree.links.new, output.inputs['Surface'])
    return ma


def emit(nodes, link, surface, socket):
    """The socket's value shown as it is: an Emission of strength 1."""
    emission = nodes.new('ShaderNodeEmission')
    link(socket, emission.inputs['Color'])
    link(emission.outputs['Emission'], surface)


def node(nodes, idname, inputs=None, **properties):
    made = nodes.new(idname)
    for key, value in properties.items():
        setattr(made, key, value)
    for key, value in (inputs or {}).items():
        made.inputs[key].default_value = value
    return made


def checker(nodes, link, surface):
    tex = node(nodes, 'ShaderNodeTexChecker', {'Scale': 6.0, 'Color1': (0.9, 0.5, 0.1, 1), 'Color2': (0.1, 0.2, 0.6, 1)})
    emit(nodes, link, surface, tex.outputs['Color'])


def voronoi(nodes, link, surface):
    coord = nodes.new('ShaderNodeTexCoord')
    tex = node(nodes, 'ShaderNodeTexVoronoi', {'Scale': 4.0})
    link(coord.outputs['Object'], tex.inputs['Vector'])
    emit(nodes, link, surface, tex.outputs['Color'])


def wave(nodes, link, surface):
    tex = node(nodes, 'ShaderNodeTexWave', {'Scale': 3.0, 'Distortion': 4.0}, wave_type='RINGS')
    ramp = nodes.new('ShaderNodeValToRGB')
    ramp.color_ramp.elements[1].color = (0.2, 0.8, 0.4, 1)
    link(tex.outputs['Fac'], ramp.inputs['Fac'])
    emit(nodes, link, surface, ramp.outputs['Color'])


def brick(nodes, link, surface):
    tex = node(nodes, 'ShaderNodeTexBrick', {'Scale': 4.0})
    emit(nodes, link, surface, tex.outputs['Color'])


def magic(nodes, link, surface):
    tex = node(nodes, 'ShaderNodeTexMagic', {'Scale': 2.0}, turbulence_depth=3)
    emit(nodes, link, surface, tex.outputs['Color'])


def gradient(nodes, link, surface):
    coord = nodes.new('ShaderNodeTexCoord')
    mapping = node(nodes, 'ShaderNodeMapping', {'Location': (0.2, 0.1, 0.0), 'Rotation': (0.0, 0.0, 0.5)})
    tex = node(nodes, 'ShaderNodeTexGradient', gradient_type='SPHERICAL')
    hsv = node(nodes, 'ShaderNodeHueSaturation', {'Hue': 0.7, 'Saturation': 1.0, 'Color': (0.9, 0.2, 0.2, 1)})
    link(coord.outputs['Object'], mapping.inputs['Vector'])
    link(mapping.outputs['Vector'], tex.inputs['Vector'])
    link(tex.outputs['Fac'], hsv.inputs['Fac'])
    emit(nodes, link, surface, hsv.outputs['Color'])


def normals(nodes, link, surface):
    geometry = nodes.new('ShaderNodeNewGeometry')
    scale = node(nodes, 'ShaderNodeVectorMath', {1: (0.5, 0.5, 0.5), 2: (0.5, 0.5, 0.5)}, operation='MULTIPLY_ADD')
    link(geometry.outputs['Normal'], scale.inputs[0])
    emit(nodes, link, surface, scale.outputs['Vector'])


def fresnel(nodes, link, surface):
    fac = node(nodes, 'ShaderNodeFresnel', {'IOR': 1.8})
    mix = node(nodes, 'ShaderNodeMix', {'A': (0.05, 0.1, 0.4, 1), 'B': (1.0, 0.9, 0.6, 1)}, data_type='RGBA')
    link(fac.outputs['Fac'], mix.inputs['Factor'])
    emit(nodes, link, surface, mix.outputs['Result'])


def facing(nodes, link, surface):
    weight = node(nodes, 'ShaderNodeLayerWeight', {'Blend': 0.3})
    remap = node(nodes, 'ShaderNodeMapRange', {'From Min': 0.2, 'From Max': 0.9})
    combine = nodes.new('ShaderNodeCombineColor')
    link(weight.outputs['Facing'], remap.inputs['Value'])
    link(remap.outputs['Result'], combine.inputs['Red'])
    link(weight.outputs['Fresnel'], combine.inputs['Blue'])
    emit(nodes, link, surface, combine.outputs['Color'])


def noise_math(nodes, link, surface):
    noise = node(nodes, 'ShaderNodeTexWhiteNoise', noise_dimensions='2D')
    coord = nodes.new('ShaderNodeTexCoord')
    snap = node(nodes, 'ShaderNodeVectorMath', {1: (0.25, 0.25, 0.25)}, operation='SNAP')
    invert = node(nodes, 'ShaderNodeInvert', {'Fac': 0.8})
    contrast = node(nodes, 'ShaderNodeBrightContrast', {'Bright': 0.05, 'Contrast': 0.3})
    link(coord.outputs['Generated'], snap.inputs[0])
    link(snap.outputs['Vector'], noise.inputs['Vector'])
    link(noise.outputs['Color'], invert.inputs['Color'])
    link(invert.outputs['Color'], contrast.inputs['Color'])
    emit(nodes, link, surface, contrast.outputs['Color'])


def principled(nodes, link, surface):
    bsdf = node(nodes, 'ShaderNodeBsdfPrincipled', {'Base Color': (0.8, 0.1, 0.05, 1), 'Roughness': 0.4})
    link(bsdf.outputs['BSDF'], surface)


def glossy(nodes, link, surface):
    bsdf = node(nodes, 'ShaderNodeBsdfGlossy', {'Color': (0.9, 0.7, 0.3, 1), 'Roughness': 0.3})
    link(bsdf.outputs['BSDF'], surface)


def mixed(nodes, link, surface):
    diffuse = node(nodes, 'ShaderNodeBsdfDiffuse', {'Color': (0.1, 0.4, 0.8, 1)})
    gloss = node(nodes, 'ShaderNodeBsdfGlossy', {'Roughness': 0.2})
    weight = node(nodes, 'ShaderNodeLayerWeight', {'Blend': 0.4})
    mix = nodes.new('ShaderNodeMixShader')
    link(weight.outputs['Fresnel'], mix.inputs['Fac'])
    link(diffuse.outputs['BSDF'], mix.inputs[1])
    link(gloss.outputs['BSDF'], mix.inputs[2])
    link(mix.outputs['Shader'], surface)


def glow(nodes, link, surface):
    diffuse = node(nodes, 'ShaderNodeBsdfDiffuse', {'Color': (0.5, 0.5, 0.5, 1)})
    emission = node(nodes, 'ShaderNodeEmission', {'Color': (0.1, 0.6, 0.3, 1), 'Strength': 0.6})
    add = nodes.new('ShaderNodeAddShader')
    link(diffuse.outputs['BSDF'], add.inputs[0])
    link(emission.outputs['Emission'], add.inputs[1])
    link(add.outputs['Shader'], surface)


def sheen(nodes, link, surface):
    bsdf = node(nodes, 'ShaderNodeBsdfSheen', {'Color': (0.7, 0.3, 0.8, 1)})
    link(bsdf.outputs['BSDF'], surface)


def bumped(nodes, link, surface):
    tex = node(nodes, 'ShaderNodeTexWave', {'Scale': 4.0})
    normal_map = node(nodes, 'ShaderNodeNormalMap', {'Strength': 0.8})
    color = node(nodes, 'ShaderNodeRGB')
    color.outputs['Color'].default_value = (0.6, 0.6, 0.55, 1)
    bsdf = nodes.new('ShaderNodeBsdfDiffuse')
    link(tex.outputs['Color'], normal_map.inputs['Color'])
    link(normal_map.outputs['Normal'], bsdf.inputs['Normal'])
    link(color.outputs['Color'], bsdf.inputs['Color'])
    link(bsdf.outputs['BSDF'], surface)


def two_lobes(nodes, link, surface):
    """A rough and a sharp Glossy BSDF mixed half and half."""
    rough = node(nodes, 'ShaderNodeBsdfGlossy', {'Color': (0.8, 0.8, 0.8, 1), 'Roughness': 0.8})
    sharp = node(nodes, 'ShaderNodeBsdfGlossy', {'Color': (0.8, 0.8, 0.8, 1), 'Roughness': 0.05})
    mix = nodes.new('ShaderNodeMixShader')
    link(rough.outputs['BSDF'], mix.inputs[1])
    link(sharp.outputs['BSDF'], mix.inputs[2])
    link(mix.outputs['Shader'], surface)


def glass(nodes, link, surface):
    bsdf = node(nodes, 'ShaderNodeBsdfGlass', {'Color': (0.8, 0.95, 0.9, 1), 'Roughness': 0.05, 'IOR': 1.45})
    link(bsdf.outputs['BSDF'], surface)


def half_transparent(nodes, link, surface):
    diffuse = node(nodes, 'ShaderNodeBsdfDiffuse', {'Color': (0.9, 0.5, 0.1, 1)})
    transparent = nodes.new('ShaderNodeBsdfTransparent')
    mix = node(nodes, 'ShaderNodeMixShader', {'Fac': 0.5})
    link(diffuse.outputs['BSDF'], mix.inputs[1])
    link(transparent.outputs['BSDF'], mix.inputs[2])
    link(mix.outputs['Shader'], surface)


def metal(nodes, link, surface):
    bsdf = node(nodes, 'ShaderNodeBsdfPrincipled', {'Base Color': (0.95, 0.6, 0.3, 1), 'Metallic': 1.0, 'Roughness': 0.25})
    link(bsdf.outputs['BSDF'], surface)


# Row by row from the top left, as the camera sees them.
GALLERY = [checker, voronoi, wave, brick, magic, gradient, normals, fresnel, facing, noise_math,
           principled, glossy, mixed, glow, sheen, bumped, two_lobes, glass, half_transparent, metal]
for i, build in enumerate(GALLERY):
    bpy.ops.mesh.primitive_uv_sphere_add(radius=0.45, location=(-1.5 + i % 4, 2.0 - i // 4, 0))
    sphere = bpy.context.object
    sphere.name = build.__name__.replace('_', ' ').title()
    bpy.ops.object.shade_smooth()
    sphere.data.materials.append(material(sphere.name, build))
    # Blended: a transparent closure shows without dither noise.
    if build is half_transparent:
        sphere.data.materials[0].surface_render_method = 'BLENDED'

here = os.path.dirname(os.path.abspath(__file__))
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(here, 'shader_gallery.blend'))
if '--' in sys.argv:
    scene.render.filepath = os.path.abspath(sys.argv[sys.argv.index('--') + 1])
    bpy.ops.render.render(write_still=True)
