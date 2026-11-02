// The Image Editor and the UV Editor (SPACE_IMAGE): Blender's own area (editors/screen/blender-area.js). Its header,
// menus, toolbar, tool settings and sidebar are Blender's (IMAGE_HT_header, IMAGE_PT_tools_active), its image.* and uv.* operators Blender's, run in Blender's window with the
// Image and UV Editor keymaps; the page registers only what reaches outside Blender (the file browser of Open and Save
// As). Its main region's image and UVs are drawn by Babylon (image-view.js) under what Blender's region draw records,
// through the region's View2D.
import { mountBlenderArea } from '../screen/blender-area.js';
import { registerOperators, contextArea } from '../../windowmanager/wm-operators.js';
import { report } from '../../windowmanager/wm-reports.js';
import { pointerStruct, structFind } from '../../python/bpy_rna.js';
import { blenderMain, blenderModule } from '../../bmesh/bmesh-wasm.js';
import { files } from '../../port/wasm.js';
import { registered, module } from '../../python/bpy_interface.js';
import { kw } from '../../windowmanager/wm-operators.js';
import { createImageView } from './image-view.js';

const { exports: x, withArrays } = blenderModule;
const SPACE_IMAGE = 6;
// WM_toolsystem_default_tool for the Image Editor's modes.
const DEFAULT_TOOLS = { PAINT: 'builtin.brush', UV: 'builtin.select_box', VIEW: 'builtin.sample' };

//   engine, views: the app's (space_view3d/views.js); sync: the scene sync; editObject(): the object in Edit Mode and
//   its edit mesh ({ ob, mesh }), or null.
export function mountImageEditor(section, { header, engine, views, sync, editObject }) {
  const editor = { area: { space: 'IMAGE_EDITOR' } };
  let view = null;
  const area = mountBlenderArea(section, { spacetype: SPACE_IMAGE, name: 'IMAGE_EDITOR', operators: ['image.', 'uv.', 'paint.', 'brush.'], keymaps: ['Image Generic', 'Image'], header, tools: registered.IMAGE_PT_tools_active,
    finished: () => sync.view(), report: (error) => report('ERROR', error.message ?? String(error)), context: { imageEditor: editor },
    drawn: (main) => {
      view ??= createImageView(main, engine, views);
      const view2d = area.inContext((C) => withArrays([new Float32Array(8)], ([p]) => { x.region_view2d(C, p); return Array.from(new Float32Array(x.memory.buffer, p, 8)); }));
      view.draw({ space: editor.space(), view2d, edit: editObject() });
    } });
  editor.space = () => pointerStruct(structFind('Area'), 0, area.area.pointer).spaces.active;
  editor.refresh = area.refresh;
  editor.inContext = (fn) => area.inContext(fn);
  // The editor type menu's Image Editor and UV Editor, and each screen's mode (runtime.js IMAGE_MODES).
  // The UV Editing and Texture Paint workspaces' editors show their toolbar and tool settings, as in Blender's startup file.
  editor.setMode = (mode) => {
    const space = editor.space();
    space.mode = mode;
    if (mode !== 'VIEW') space.show_region_toolbar = space.show_region_tool_header = true;
    // A mode's tool starts as its default, as WM_toolsystem_refresh_screen_area sets it.
    area.python((context) => {
      if (!context.workspace.tools.from_space_image_mode(mode, kw({ create: false }))) module('bl_ui.space_toolsystem_common').activate_by_id(context, 'IMAGE_EDITOR', DEFAULT_TOOLS[mode]);
    });
    area.refresh();
  };
  section.addEventListener('image-mode', (e) => editor.setMode(e.detail));
  editor.dispose = () => { view?.dispose(); area.dispose(); };
  area.refresh();
  return editor;
}

const editor = () => contextArea()?.imageEditor ?? null;
const image = () => editor()?.space().image ?? null;
// A local file chosen in the browser's file dialog, as bytes.
const chooseFile = (accept) => new Promise((resolve) => {
  const input = Object.assign(document.createElement('input'), { type: 'file', accept });
  input.onchange = () => input.files[0]?.arrayBuffer().then((bytes) => resolve({ name: input.files[0].name, bytes: new Uint8Array(bytes) }));
  input.click();
});
const download = (name, bytes) => {
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(new Blob([bytes])), download: name });
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
};
const IMAGE_FILES = '.png,.jpg,.jpeg,.exr,.hdr,.tif,.tiff,.tga,.bmp,.psd,.dds,.dpx,.cin,.sgi,.rgb,.bw,image/*';
// The module's folder for the image files the page reads and Blender writes; a .blend refers to them by path, so they
// are packed into it (Image > Pack) to stay with the project.
const FOLDER = '/images/';
// Blender's own operator in the Image Editor's main region, with the file it reads or writes.
const inEditor = (target, idname, props) => target.inContext(() => blenderMain().run(idname, props));
const stem = (name) => name.replace(/\.[^.]*$/, '');

registerOperators({
  // The file browser of image.open and image.save_as is the browser's: Blender's operators read and write the file.
  'image.open': {
    run: () => {
      const target = editor();
      chooseFile(IMAGE_FILES).then(({ name, bytes }) => {
        files.set(FOLDER + name, bytes);
        inEditor(target, 'image.open', { filepath: FOLDER + name });
        target.refresh();
      });
    },
  },
  'image.save_as': {
    poll: () => !!image(),
    run: () => {
      const target = editor(), name = stem(image().name) + '.png', filepath = FOLDER + name;
      if (inEditor(target, 'image.save_as', { filepath, copy: true }).status & 4) download(name, files.get(filepath));
    },
  },
});
