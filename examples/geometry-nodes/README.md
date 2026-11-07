# Geometry Nodes Planet

A tiny planet made in Blender 5.2 by `geometry-nodes.py` (`blender -b --factory-startup -P geometry-nodes.py`) and
opened here with Blender's own reader. Everything on it comes from one Geometry Nodes modifier on an ico sphere.

- **Terrain.** 4D noise (its W is the Seed input) lifts the sphere along its normals; below Sea Level the ground sinks
  under a second, smooth sphere. The height is stored as the `height` attribute, which the Terrain material reads
  through a color ramp: sand, meadow, forest, rock and snow.
- **Forests.** Points are distributed where the land is between the shore and the tree line and a second noise says
  woods. Each point instances one of the Trees collection's objects (Pick Instance), stands on the ground (the points'
  Rotation) and is turned and scaled at random. The scale is stored on the instances as `tree_scale`.
- **Clouds.** Points on a larger sphere, kept where a noise is above Cloud Cover, their radius growing with it. A point
  cloud draws each point as a sphere.
- **Inputs.** Properties > Modifiers shows Seed, Mountains, Sea Level, Forest Density and Cloud Cover.
- **Inspecting.** The Geometry Nodes workspace's Spreadsheet lists the mesh with its `height`, the cloud points with
  their radius, and the tree instances.
