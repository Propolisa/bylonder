---
id: project-files
title: Project Files
summary: A project's files in the code editor's Explorer, kept in the browser or in a folder on disk opened with File > Open Folder, where the .blend, the code and the content are plain files other tools can edit.
expect: The Explorer works as VS Code's (new, rename, delete, drag, a right-click menu, keys, dots on unsaved files); a folder on disk holds the project as plain files and its scene as a .blend, File > Save writes them, and edits made there show when the page has the focus again. Open Folder needs Chromium's File System Access API.
blender_version: 5.2.3
blender_manual:
  - https://docs.blender.org/manual/en/5.2/files/blend/save_load.html
example: project-files
thumbnail: project-files/thumbnail.png
media:
  - project-files/explorer.gif
  - project-files/open-folder.png
  - project-files/outside-edit.gif
ui:
  - TOPBAR_MT_file
operators:
  - wm.save_mainfile
code:
  - src/workspace/folder-repository.js
  - src/workspace/repository.js
  - src/workspace/explorer/FileTree.vue
  - src/workspace/explorer/file-tree.js
  - src/workspace/app.js
tests:
  - tests/folder-repository.test.js
  - tests/file-tree.test.js
  - tests/repository.test.js
  - tests/menu-icon-fallback.test.js
  - tests/e2e/prod.mjs
limits:
  - Open Folder needs the File System Access API, which Chromium browsers have; elsewhere projects stay in the browser.
  - A folder keeps no versions of its own; History lists none, and git or another tool keeps them.
  - The browser asks again for a folder's permission after a reload, with Reconnect in the status bar.
  - Edits made outside the app show when the page regains focus; Chromium's FileSystemObserver reports them sooner where it has it.
  - A folder holds the active scene as its .blend; the project's other scenes are kept in .bylonder/state.json.
  - Renames do not rewrite import statements.
---
# Project Files

A project is its files: the entry `index.js`, modules in folders such as `src/`, content such as text in `content/`,
and its scene. The code editor's Explorer shows them as VS Code's does. A project lives in the browser by default, or
in a folder on disk opened with File > Open Folder: the folder holds the project's files as they are, its scene as a
.blend (File > Save writes it, as desktop Blender's does) and `bylonder.json`, the project's settings, so the
folder works with git and any editor.

[Open in Bylonder](https://propolisa.github.io/bylonder/#example=project-files)

The demo, Project Files, is a café counter and a cup built by `index.js` with its module in `src/` and a text in
`content/`.

## Steps

1. **Work in the Explorer.** Window > Toggle Project Code shows the code beside the scene. In the Explorer, New Folder
   and New File (its header's buttons, or the right-click menu) name the new item in place; F2 renames, Delete
   deletes, a drag moves a file or folder, and the arrow keys walk the tree and open and close folders. A file with
   unsaved changes shows a dot in the tree and in its tab.

   ![New folder, new file, rename, drag and the right-click menu](../media/features/project-files/explorer.gif)

2. **Open a folder.** File > Open Folder picks a folder on disk. An empty folder takes the open project's files, and
   its .blend once the scene runs; a folder that holds a project opens it. The status bar names the folder, and File >
   Save (Ctrl S) writes the .blend and every changed file, while Ctrl S in the code editor writes its file.

   ![The status bar after File > Open Folder](../media/features/project-files/open-folder.png)

3. **Edit outside the app.** Change a file in the folder with any other tool. When the page has the focus again, the
   Explorer and the code editor show the change; a file with unsaved edits in the app keeps them, and a changed .blend
   opens the project again.

   ![A file changed on disk shows in the app](../media/features/project-files/outside-edit.gif)

## Project files

- [index.js](../../examples/project-files/index.js): builds the scene from its module.
- [src/counter.js](../../examples/project-files/src/counter.js): the counter and the cup.
- [content/menu.txt](../../examples/project-files/content/menu.txt): a text the project keeps.
- Recorded by [record-project-files.mjs](../../tools/docs/record-project-files.mjs).
