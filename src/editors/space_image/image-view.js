// The Image Editor's main region as Blender's draw engines draw it (image engine and overlay_edit_uv.cc), drawn by
// Babylon in a scene of its own on the app's engine: the image through the region's View2D, over the transparency
// checkerboard, and the UV editor's view of the edit mesh (image-api.cc view_edit_uv_extract): faces, edges and
// vertices colored by their UV selection in the theme's Image Editor colors.
import { Color4, Constants, Effect, FreeCamera, Mesh, MeshBuilder, Scene, ShaderMaterial, Vector3, VertexBuffer, VertexData } from '@babylonjs/core';
import { blenderModule } from '../../bmesh/bmesh-wasm.js';
import { contextStruct, pointerOf } from '../../python/bpy_rna.js';
import { imageTexture, imagePremultiplied } from '../../imbuf/image-textures.js';
import { overlayMaterial } from '../../draw/overlay-edit-mesh.js';

const { exports: x, withArrays } = blenderModule;
// overlay_shader_shared.hh's flags, as view_edit_uv_extract gives them per corner.
const VERT_UV_SELECT = 1 << 3, EDGE_UV_SELECT = 1 << 5, FACE_UV_SELECT = 1 << 7;
// SCE_SELECT_* and UV_SELECT_* of ToolSettings.
const UV_SELECT_VERT = 1;

// The image, its alpha over Blender's transparency checkerboard (image_engine_color_frag), shown in the Standard view
// transform's sRGB until the display transform is OpenColorIO's.
Effect.ShadersStore.blImageVertexShader = `precision highp float;
attribute vec3 position; attribute vec2 uv; uniform mat4 worldViewProjection; varying vec2 vUV;
void main() { vUV = uv; gl_Position = worldViewProjection * vec4(position, 1.0); }`;
Effect.ShadersStore.blImageFragmentShader = `precision highp float;
varying vec2 vUV; uniform sampler2D image; uniform bool imagePremultiplied; uniform float checkerSize; uniform vec3 checkerA; uniform vec3 checkerB;
vec3 srgb(vec3 c) { return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c)); }
void main() {
  vec4 color = texture(image, vUV);
  if (imagePremultiplied && !(color.a == 0.0 || color.a == 1.0)) color.rgb /= color.a;
  vec2 cell = floor(gl_FragCoord.xy / checkerSize);
  vec3 checker = mod(cell.x + cell.y, 2.0) < 1.0 ? checkerA : checkerB;
  gl_FragColor = vec4(mix(checker, srgb(max(color.rgb, 0.0)), clamp(color.a, 0.0, 1.0)), 1.0);
}`;

const rgba = (c, alpha = 1) => [c[0], c[1], c[2], c[3] ?? alpha];

export function createImageView(main, engine, views) {
  const canvas = Object.assign(document.createElement('canvas'), { className: 'bl-image-view' });
  Object.assign(canvas.style, { position: 'absolute', inset: '0', width: '100%', height: '100%' });
  main.style.position = 'relative';
  main.prepend(canvas);
  const scene = new Scene(engine);
  scene.skipPointerMovePicking = true;
  const camera = new FreeCamera('Image Editor', new Vector3(0, 0, -1), scene);
  camera.mode = FreeCamera.ORTHOGRAPHIC_CAMERA;
  camera.setTarget(Vector3.Zero());
  camera.minZ = 0.01;
  // The image spans the view's 0..1 square (image_main_region_set_view2d normalizes the View2D to it).
  const quad = MeshBuilder.CreatePlane('Image', { size: 1, sideOrientation: Mesh.DOUBLESIDE }, scene);
  quad.position.set(0.5, 0.5, 0.5);
  quad.isPickable = false;
  const material = new ShaderMaterial('Image', scene, 'blImage', { attributes: ['position', 'uv'], uniforms: ['worldViewProjection', 'imagePremultiplied', 'checkerSize', 'checkerA', 'checkerB'], samplers: ['image'] });
  material.backFaceCulling = false;
  material.setFloat('checkerSize', 8);
  material.setColor3('checkerA', { r: 0.15, g: 0.15, b: 0.15 });
  material.setColor3('checkerB', { r: 0.2, g: 0.2, b: 0.2 });
  quad.material = material;
  const view = views.add({ canvas, camera, active: true, input: false });
  // The UV overlay: faces, edges and vertices, each a mesh of its own with the overlay's material (overlay-edit-mesh.js).
  const part = (name, options) => Object.assign(new Mesh(name, scene), { isPickable: false, alwaysSelectAsActiveMesh: true, material: overlayMaterial(scene, name, options) });
  const faces = part('UV Faces', { fillMode: Constants.MATERIAL_TriangleFillMode, alpha: true });
  const edges = part('UV Edges', { fillMode: Constants.MATERIAL_LineListDrawMode });
  const verts = part('UV Vertices', { fillMode: Constants.MATERIAL_PointFillMode, round: 1 });
  let shown = null;

  function setGeometry(mesh, positions, colors, indices) {
    if (!positions.length) { mesh.setEnabled(false); return; }
    const data = Object.assign(new VertexData(), { positions, indices });
    data.applyToMesh(mesh, true);
    mesh.setVerticesData(VertexBuffer.ColorKind, colors, true, 4);
    mesh.setEnabled(true);
  }
  // The edit mesh of the object in Edit Mode, as the UV editor shows it (uvedit_face_visible_test and the flags).
  function drawUVs(edit, theme, selectMode) {
    const scenePointer = pointerOf(contextStruct().scene)[2];
    const header = edit ? x.view_edit_uv_extract(scenePointer, edit.ob) >>> 0 : 0;
    if (!header) { [faces, edges, verts].forEach((m) => m.setEnabled(false)); return; }
    const [corners, faceCount, uvPointer, flagPointer, visiblePointer] = new Uint32Array(x.memory.buffer, header >>> 0, 5);
    const uvs = new Float32Array(x.memory.buffer, uvPointer >>> 0, corners * 2).slice();
    const flags = new Uint8Array(x.memory.buffer, flagPointer >>> 0, corners).slice(), visible = new Uint8Array(x.memory.buffer, visiblePointer >>> 0, faceCount).slice();
    const offs = edit.mesh.face_offsets, triangles = edit.mesh.corner_tris(), owners = edit.mesh.corner_tri_faces();
    const at = (c) => [uvs[c * 2], uvs[c * 2 + 1], 0];
    const facePositions = [], faceColors = [], faceIndices = [];
    for (let t = 0; t < owners.length; t++) {
      const f = owners[t];
      if (!visible[f]) continue;
      const color = flags[triangles[t * 3]] & FACE_UV_SELECT ? rgba(theme.face_select) : rgba(theme.face);
      for (let k = 0; k < 3; k++) { facePositions.push(...at(triangles[t * 3 + k])); faceColors.push(...color); faceIndices.push(faceIndices.length); }
    }
    setGeometry(faces, facePositions, faceColors, faceIndices);
    const edgePositions = [], edgeColors = [], edgeIndices = [], vertPositions = [], vertColors = [], vertIndices = [];
    for (let f = 0; f < faceCount; f++) {
      if (!visible[f]) continue;
      for (let c = offs[f]; c < offs[f + 1]; c++) {
        const next = c + 1 < offs[f + 1] ? c + 1 : offs[f];
        const color = flags[c] & EDGE_UV_SELECT ? rgba(theme.edge_select) : rgba(theme.wire_edit);
        for (const corner of [c, next]) { edgePositions.push(...at(corner)); edgeColors.push(...color); edgeIndices.push(edgeIndices.length); }
        if (selectMode === UV_SELECT_VERT) {
          vertPositions.push(...at(c));
          vertColors.push(...(flags[c] & VERT_UV_SELECT ? rgba(theme.vertex_select) : rgba(theme.vertex)));
          vertIndices.push(vertIndices.length);
        }
      }
    }
    setGeometry(edges, edgePositions, edgeColors, edgeIndices);
    setGeometry(verts, vertPositions, vertColors, vertIndices);
    verts.material.setFloat('pointSize', theme.vertex_size * devicePixelRatio);
  }

  return {
    // Drawn as the region's draw left its View2D ([cur xmin, xmax, ymin, ymax, mask...]): the space's image and, in the
    // UV editor, the edit mesh's UVs.
    draw({ space, view2d, edit }) {
      const [xmin, xmax, ymin, ymax] = view2d;
      Object.assign(camera, { orthoLeft: xmin, orthoRight: xmax, orthoBottom: ymin, orthoTop: ymax });
      const { preferences, tool_settings: settings } = contextStruct();
      const theme = preferences.themes[0].image_editor;
      scene.clearColor = new Color4(...theme.space.back, 1);
      const image = space.image, key = image ? image.session_uid : null;
      const texture = key !== shown && image ? imageTexture(image, scene, { extension: 'EXTEND' }) : null;
      if (texture) {
        material.setTexture('image', texture);
        material.setInt('imagePremultiplied', imagePremultiplied(texture) ? 1 : 0);
        shown = key;
      }
      quad.setEnabled(!!image && shown === key);
      drawUVs(space.mode === 'UV' || space.show_uvedit ? edit : null, theme, settings.uv_select_mode === 'VERTEX' ? UV_SELECT_VERT : 0);
      views.wake();
    },
    dispose() { views.remove(view); scene.dispose(); canvas.remove(); },
  };
}
