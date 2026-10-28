// File > Save As and Save Copy (wm_files.cc's wm.save_as_mainfile): the scene as a .blend file, which Blender's own
// writer writes from Main (blenkernel/main-sync.js), downloaded as the scene's name.
export function saveBlend(world) {
  const name = (world.sceneSettings.state.name || 'untitled').replace(/[\\/:*?"<>|]/g, '_');
  const bytes = world.mainSync.writeBlend(`/${name}.blend`);
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(new Blob([bytes], { type: 'application/x-blender' })), download: `${name}.blend` });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 60000);
  return bytes.length;
}
