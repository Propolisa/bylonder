---
id: link-append
title: Link and Append
summary: Bring collections, objects, materials and any other data-block in from another .blend with File > Link and File > Append, browsing inside the file in Blender's own File Browser, and make linked data editable with library overrides.
expect: Link and Append run Blender's own code with all their options and browse the .blend in Blender's File Browser; the .blend comes from the browser's file dialog, the project keeps it in its libraries folder, and a .blend saved with File > Save As refers to it at /libraries/.
blender_version: 5.2.3
blender_manual:
  - https://docs.blender.org/manual/en/5.2/files/linked_libraries/link_append.html
  - https://docs.blender.org/manual/en/5.2/files/linked_libraries/library_overrides.html
  - https://docs.blender.org/manual/en/5.2/editors/file_browser.html
example: link-append
thumbnail: link-append/thumbnail.png
media:
  - link-append/file-browser.png
  - link-append/linked.png
  - link-append/override.png
  - link-append/appended.png
  - link-append/blender-file.png
ui:
  - TOPBAR_MT_file
  - FILEBROWSER_MT_context_menu
  - FILEBROWSER_PT*
  - VIEW3D_MT_object_liboverride
  - OUTLINER_HT_header
  - OBJECT
operators:
  - wm.link
  - wm.append
  - file.select
  - file.mouse_execute
  - file.execute
  - file.cancel
  - file.parent
  - object.make_override_library
code:
  - src/editors/space_file/file-browser.js
  - src/editors/space_file/FileBrowserWindow.vue
  - src/windowmanager/wm-fileselect.js
  - tools/blender-port/wasm/fileselect.cc
  - src/blenkernel/libraries.js
tests:
  - tests/link-append-wasm.test.js
limits:
  - The .blend to link from is chosen in the browser's file dialog first; Blender's File Browser then opens inside it, so its bookmarks and parent folders do not reach your computer's other files.
  - A library's path is /libraries/<name>.blend in Bylonder's file system, where the project keeps it; a .blend saved with File > Save As refers to it there, so Blender on your computer asks to relocate it.
  - The File Browser shows no previews of data-blocks: the module draws without a GPU, so files carry none it makes.
---
# Link and Append

File > Link and File > Append bring data-blocks from another .blend file into the scene with Blender's own code. Link
keeps them in the other file, the library: they are read from it each time the project opens and cannot be edited
here, except through a library override. Append copies them into the scene, where they are like anything made here.
After choosing the .blend in the browser's file dialog, Blender's File Browser opens inside it, as in Blender: the
data-block types, then their names, with the operator's options at the right (Instance Collections, Localize All,
Select, Active Collection and the others). The project keeps the library in its `libraries` folder, so a saved project
finds its links again. What comes in is Main's, drawn by Babylon, listed by the Outliner's Blender File view and undone
with Ctrl Z.

[Open in Bylonder](https://propolisa.github.io/bylonder/#example=link-append)

The demo, Link and Append, links the Props collection from the example's
[library.blend](../../examples/link-append/libraries/library.blend), makes it a library override and appends the Lamp
Post. The steps below make it from the Default Cube.

## Steps

1. **Link a collection.** In the Default Cube example, click the cube and press Delete. Open File > Link... and pick
   library.blend in the file dialog. Blender's File Browser lists the file's data-block types; double click Collection,
   then Props.

   ![Blender's File Browser inside library.blend](../media/features/link-append/file-browser.png)

2. **The linked collection.** An empty instances the linked collection at the 3D cursor, with the crate and the ball.

   ![Props linked](../media/features/link-append/linked.png)

3. **Make it editable.** With the empty selected, choose Object > Library Override > Make. The crate and the ball are
   now local overrides in the Props collection, kept in sync with the library.

   ![Props as a library override](../media/features/link-append/override.png)

4. **Append an object.** Open File > Append..., pick library.blend, double click Object, then Lamp Post. The lamp post
   is a local copy with its own mesh.

   ![The lamp post appended](../media/features/link-append/appended.png)

5. **The library.** Set the Outliner's Display Mode to Blender File: library.blend lists what the scene links from it.

   ![The Outliner's Blender File view](../media/features/link-append/blender-file.png)

## Project files

- [link-append.py](../../examples/link-append/link-append.py): writes libraries/library.blend with Blender 5.2, then
  links, overrides and appends from it in the Default Cube's scene and saves link-append.blend.
- [link-append.blend](../../examples/link-append/link-append.blend): the file the script saves.
- [library.blend](../../examples/link-append/libraries/library.blend): the library.
- [index.js](../../examples/link-append/index.js): opens the .blend with Blender's reader.
- [link-append-fixtures.py](../../tools/blender-reference/link-append-fixtures.py): Blender's own results the test
  compares with ([link-append-wasm.test.js](../../tests/link-append-wasm.test.js)).
- [record-link-append.mjs](../../tools/docs/record-link-append.mjs): records this page's pictures.
