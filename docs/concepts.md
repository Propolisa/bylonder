# Blender and Babylon concepts

Reference map for bringing Blender functionality onto Babylon. Snapshot as of 2026-10-25, written from Blender `main` source (DNA, RNA, `scripts/startup/bl_ui`), the Blender manual source, Babylon's documentation source and Babylon 8.32 typings. "Ours" describes the current state of this project. Items marked "unverified" were not checked against source.

## Reference clones

Kept outside the repo (not committed). Recreate with:

    mkdir -p ~/refs && cd ~/refs
    git clone --depth 1 --filter=blob:none --sparse https://github.com/blender/blender.git blender
    git -C blender sparse-checkout set source/blender/makesdna source/blender/makesrna/intern \
      source/blender/animrig source/blender/blenkernel/intern scripts/startup/bl_ui \
      scripts/startup/bl_operators release/datafiles/icons_svg release/datafiles/colormanagement
    git clone --depth 1 --filter=blob:none --sparse https://projects.blender.org/blender/blender-manual.git manual
    git -C manual sparse-checkout set manual/scene_layout manual/render manual/animation manual/editors manual/interface manual/files
    git clone --depth 1 --filter=blob:none --sparse https://github.com/BabylonJS/Documentation.git babylon-docs
    git -C babylon-docs sparse-checkout set content

Most useful files: `scripts/startup/bl_ui/properties_*.py` (exact panel layout and properties), `makesdna/DNA_*_types.h` (data), `blenkernel/intern/anim_sys.cc` (animation evaluation), Babylon `node_modules/@babylonjs/core/**/*.d.ts`.

## Two models in one sentence each

- **Blender**: a file is a database of typed, named, reference-counted datablocks (IDs). Scenes reference collections of objects; objects reference data (mesh, camera, light); evaluation runs on copies through the dependency graph.
- **Babylon**: a runtime `Scene` owns nodes, meshes, materials, cameras, lights and textures directly; there is no file database, user counting or evaluated copy. Code builds the scene each run.

## Concept map

| Blender | Babylon | Ours |
|---|---|---|
| Datablock (ID), users, fake user, link/append | Plain objects in `Scene`; `AssetContainer` for add/remove sets | IDs by `wbId` or name; users counted for materials only |
| Scene | `Scene` | One scene per run |
| Scene collection, collections (nested, objects in many) | No equivalent. Parenting via `TransformNode`; `AssetContainer` groups assets | Groups are `TransformNode` parents (one parent only) |
| View layer (per-scene include/exclude, holdout, passes) | `layerMask` on meshes and cameras; rendering groups | None |
| Object vs object data (mesh, camera, light shared by many objects) | Mesh holds geometry; `InstancedMesh`, `clone`, thin instances share geometry | Not modelled |
| Object restriction toggles (hide viewport, disable viewport/render, selectable) | `setEnabled`, `isVisible`, `isPickable` | Eye and selectable toggles |
| Modifiers stack | No stack; Node Geometry, thin instances | Own stack (Array, Geometry Nodes) |
| Constraints | Behaviours, `lookAt`, physics constraints | None |
| Armature, bones, poses | `Skeleton`, `Bone`, glTF skins | None |
| Shape keys | `MorphTargetManager` | None |
| Materials, node shaders | Standard, PBR, Node Material | Material tab, Shader Editor |
| World (environment shader, volume, mist) | `clearColor`, `environmentTexture`, skybox, fog | Viewport background only |
| Camera data (lens, clipping, DOF, sensor) | `Camera` (fov, minZ/maxZ), pipeline DOF | Authored camera via Scene mode |
| Lights (point, sun, spot, area) | Point, Directional, Spot, Hemispheric, `RectAreaLight` | Shown in Outliner only |
| Render engine (EEVEE, Cycles, Workbench) | One rasterizer; quality via pipelines and settings | Viewport shading modes |
| Color management (view transform, look, exposure, gamma) | `ImageProcessingConfiguration` | None |
| Render settings (sampling, motion blur, DOF, raytracing, volumes) | Default rendering pipeline, SSAO, SSR, motion blur, IBL shadows | None |
| Output (resolution, fps, frame range, format) | Engine size, hardware scaling; `VideoRecorder` | Hardware scaling, action fps and range |
| Compositor | Frame graph / Node Render Graph | Compositor (Use Nodes) |
| Actions, slots, F-Curves | `Animation`, `AnimationGroup` | One action, tracks by address |
| NLA (tracks, strips, blend, influence) | `AnimationGroup` weight, `isAdditive`, masks, blending | None |
| Drivers | None (code observers) | None (store effects are code) |
| Keying sets | None | Insert LocRotScale or per property |
| Markers | None (animation events exist) | None |
| Particles (legacy, geometry nodes) | `ParticleSystem`, GPU, Node Particle, SPS | Node particle systems |
| Physics (rigid body world, fields) | Havok plugin, physics v2 | None |
| Grease Pencil | None | None |
| Audio, speakers | Audio engine v2, spatial sound | None |
| Light probes | `ReflectionProbe`, IBL | None |
| Units | Unitless world units | Lengths shown in m |
| Workspaces, areas, editors | None (UI is ours) | Layout, Scripting; dock areas |
| Undo (global memfile, per mode) | None | Document snapshots |
| Axes Z-up, right-handed | Y-up, left-handed (`useRightHandedSystem` optional) | Babylon axes |

## Scene

Blender (`Scene`, Properties > Scene): active camera, background scene (`set`, recursive), active clip; Units (system, scale, rotation, length/mass/time/temperature); Keying Sets and keyframing settings; Audio (volume, distance model, doppler); Gravity; Simulation frame range; Rigid Body World; Light Probes (EEVEE). The scene also owns `RenderData` (render and output settings), color management settings, markers, keying sets, the world pointer, the master (scene) collection and the list of view layers.

Babylon: `Scene` holds clear color, ambient color, environment texture and intensity, fog (`fogMode` NONE/EXP/EXP2/LINEAR, density, start, end, color), `imageProcessingConfiguration`, `gravity`, `animationTimeScale`, `activeCamera`/`activeCameras`, toggles such as `shadowsEnabled`, `postProcessesEnabled`, `skeletonsEnabled`, and `useRightHandedSystem`.

Mapping notes: active camera maps to `scene.activeCamera` (ours already switches between editor and authored camera). Units are presentation only on both sides. Background scene has no Babylon equivalent other than rendering several scenes into one canvas (`autoClear` off).

## View layers and collections

Blender: objects live in the file and are referenced by collections; every scene has a scene collection and any number of nested user collections; an object can be in several collections. A view layer is a per-scene configuration over the collection tree, stored as `LayerCollection` nodes mirroring the collections, plus `Base` entries per object. Per view layer and collection: Exclude (removes from viewport, render and outliner), Holdout, Indirect Only (Cycles), Hide in Viewport. Per collection or object, for all view layers: Disable in Viewports, Disable in Renders, Disable Selection. View layer properties: Use for Rendering, Render Single Layer, Passes (data, light, cryptomatte, shader AOVs), Light Groups, Filter (sky, solid, volumes, motion blur), Override (material, world, samples).

Babylon: no collections or view layers. Closest tools: `layerMask` bitmasks on meshes vs cameras (camera renders meshes whose mask overlaps), `renderingGroupId` for draw ordering, `setEnabled`/`isVisible`/`isPickable` per node, `AssetContainer` for adding and removing sets, multiple cameras. Render passes correspond to frame graph tasks (depth, normals, geometry buffers).

Ours: none of this exists yet. Outliner shows a single "Scene Collection" root over object parenting.

## Render settings

Blender (Properties > Render, `properties_render.py`): engine selector; per engine panels. EEVEE: Sampling (viewport, render, shadows), Clamping, Raytracing (method, resolution, screen tracing, fast GI, denoise), Volumes, Curves, Depth of Field, Motion Blur, Film (filter size, transparent background, overscan), Performance, Grease Pencil, Simplify, Color Management. Color Management: display device, view transform (Standard, AgX, Filmic, ACES, Khronos PBR Neutral, False Color, Raw), look, exposure, gamma, curves, white balance. Workbench has its own lighting, color and options panels.

Babylon: one rasterizer. Quality and effects come from `DefaultRenderingPipeline` (MSAA samples, FXAA, sharpen, depth of field, bloom, chromatic aberration, grain, image processing), `SSAO2RenderingPipeline`, `SSRRenderingPipeline`, `MotionBlurPostProcess`, `IBLShadowsRenderingPipeline`, shadow generators, and hardware scaling. Color management maps to `ImageProcessingConfiguration`: exposure, contrast, tone mapping (`TONEMAPPING_STANDARD`, `_ACES`, `_KHR_PBR_NEUTRAL`), color curves, color grading LUT, vignette, dithering.

Mapping notes: Blender view transforms Standard, ACES and Khronos PBR Neutral have direct Babylon tone mapping counterparts; AgX and Filmic do not (would need a LUT or custom post process, unverified). Film transparent maps to clear color alpha. Engine selection could map to presets of these pipelines rather than to separate renderers.

Ours: Render menu offers hardware scaling only; the compositor exists separately.

## Output settings

Blender (Properties > Output, `properties_output.py`): Format (resolution X/Y, percentage, pixel aspect, border/crop, frame rate `fps`/`fps_base`), Frame Range (start, end, step, time stretching old/new), Stereoscopy, Output (path, file format, color management override, encoding, video codec, audio), Metadata (stamps), Post Processing (compositing, sequencer, dither).

Babylon: canvas size and `engine.setHardwareScalingLevel`; screenshots via `CreateScreenshotUsingRenderTarget`; video via `VideoRecorder` (WebM in browsers); no frame range concept outside animations.

Ours: frame range and fps live on the single action (Timeline > Playback), not on the scene. Blender keeps fps and frame range on the scene, with an optional preview range (`psfra`, `pefra`).

## World

Blender (`World`, Properties > World): a world is a datablock assigned to the scene. Surface is a shader node tree (Background shader: color, strength, often an environment texture). Volume (world volume shader). Mist Pass (start, depth, falloff; needs the mist pass enabled on the view layer). EEVEE Settings: light probe resolution, sun extraction (threshold, angle) and its shadow options. Viewport Display: color used by Solid shading when "World" background is chosen. View layers can override the world.

Babylon: no world datablock. Equivalents spread across the scene: `clearColor`, `environmentTexture` plus `environmentIntensity` (lighting and reflections), skybox mesh or `createDefaultSkybox`/`createDefaultEnvironment`, `PhotoDome`, fog for depth falloff, `ReflectionProbe` for local probes.

Mapping notes: a world slice can own background color, environment texture, intensity, skybox visibility and fog, applied to the scene, with Node Material backgrounds possible later. Solid shading already uses a theme background; Blender also lets Solid use the world viewport color.

Ours: not implemented. Rendered shading shows whatever user code set.

## Animation

Blender data (`DNA_anim_types.h`, `DNA_action_types.h`, `anim_sys.cc`):
- `AnimData` on each animatable ID: active action plus slot handle, NLA tracks, drivers, active action blend mode, influence and extrapolation.
- Action (ID): slots, layers, strips (layered actions; UI exposes one layer and strip), frame range (manual or derived), markers (pose markers), groups.
- Slot: identifier plus ID type and a permanent numeric handle; any ID can use any slot.
- Channelbag per slot: F-Curves and groups.
- F-Curve: `rna_path` plus `array_index` relative to the owning ID, keyframes (`BezTriple`: value, handles, interpolation, easing, keyframe type), extrapolation (constant, linear, cyclic via modifier), F-Curve modifiers (noise, cycles, generator, etc.), auto smoothing, color, mute, lock.
- Keyframe types (display): keyframe, breakdown, moving hold, extreme, jitter, generated.
- Interpolation: constant, linear, Bezier, plus easing families (sine, quad, cubic, quart, quint, expo, circ, back, bounce, elastic) with ease in/out.
- Evaluation: per frame, F-Curves are resolved from the owning ID through a cached parsed path and written to the evaluated copy; values can be flushed to the original.
- NLA: tracks stacked bottom to top, strips (action, transition, sound, meta) with start, action range, repeat, scale, blend in/out, blend mode (replace, combine, add, subtract, multiply), influence, extrapolation (hold, hold forward, nothing); the action track on top holds the active action; tweak mode edits a strip's action.
- Drivers: F-Curves in `AnimData.drivers` whose value comes from variables (single property, transform channel, rotational difference, distance, context property) combined by a type (average, sum, min, max, scripted expression) and mapped through the curve.
- Keying sets: named lists of paths (ID, data path, array index) used by `I`; built-in sets such as Location/Rotation/Scale; auto keying options live in scene tool settings.
- Markers: named frames on the scene timeline (and pose markers on actions); can bind cameras.
- Timeline: playback popover (sync mode: play every frame, frame dropping, audio sync; play in all editors), preview range, keyframing popover (active keying set, auto keying, new keyframe type, interpolation defaults).

Babylon: `Animation` (one property path, keys with optional in/out tangents and interpolation, easing functions, loop modes), `Animatable` (playing instance with weight and speed), `AnimationGroup` (targeted animations, `from`/`to`, `speedRatio`, `loopAnimation`, `weight`, `isAdditive`, `mask`, play order), animation blending (`enableBlending`, `blendingSpeed`), `scene.animationTimeScale`, animation events.

Mapping notes: our tracks compile to Babylon `Animation` already. A Blender action with slots maps naturally onto an `AnimationGroup` whose targeted animations come from the slot assigned to each target. NLA strips map to groups with `weight` (influence), `isAdditive` (add/combine), `from`/`to` (action range) and `speedRatio` (scale); replace blending on Babylon blends by weight, so Blender's exact stack math needs checking (unverified). Easing families map to Babylon easing functions. Drivers and keying sets have no Babylon counterpart and stay ours.

Ours: one action per project with tracks keyed by `[id, path]` (component in the path), Bezier/Linear/Constant, whole-frame keys, fps and range on the action, auto key for transforms, Timeline with summary row and channel region, keyed state colors. No slots, NLA, drivers, keying sets, markers, F-Curve modifiers, easing or handle editing.
