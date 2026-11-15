// The Explorer's tree of a project's files: folders first, then files, each by name, as VS Code's Explorer sorts them.
const byName = (a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" });

export function fileTree(paths, folders = []) {
  const root = { path: "", name: "", folder: true, children: [] };
  const nodes = new Map([["", root]]);
  const node = (path, folder) => {
    if (nodes.has(path)) return nodes.get(path);
    const cut = path.lastIndexOf("/");
    const made = { path, name: path.slice(cut + 1), folder, ...(folder && { children: [] }) };
    nodes.set(path, made);
    node(path.slice(0, Math.max(cut, 0)), true).children.push(made);
    return made;
  };
  for (const path of folders) node(path, true);
  for (const path of paths) node(path, false);
  const sort = (n) => {
    if (!n.children) return;
    n.children.sort((a, b) => (a.folder === b.folder ? byName(a, b) : a.folder ? -1 : 1));
    n.children.forEach(sort);
  };
  sort(root);
  return root.children;
}

// The folder a new file or folder goes in, from the selected row: the folder itself, or a file's folder.
export const parentFolder = (path, isFolder) => (isFolder ? path : path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "");

// Where a row dropped on a folder (or a file, meaning its folder) moves to; null when it would not move.
export function dropTarget(from, onto, ontoIsFolder) {
  const folder = parentFolder(onto, ontoIsFolder);
  const to = (folder ? folder + "/" : "") + from.split("/").pop();
  return to === from || folder === from || folder.startsWith(from + "/") ? null : to;
}

// A file's icon, from Blender's file browser icons.
const ICONS = [[/\.blend$/i, "file_blend"], [/\.(png|jpe?g|webp|gif|hdr|exr|svg)$/i, "file_image"], [/\.(wav|mp3|ogg|flac)$/i, "file_sound"],
  [/\.(mp4|webm|mov)$/i, "file_movie"], [/\.(glb|gltf|obj|fbx|babylon|stl)$/i, "file_3d"], [/\.py$/i, "file_script"], [/\.(m?[jt]sx?|glsl|wgsl)$/i, "text"], [/\.(ttf|otf|woff2?)$/i, "file_font"]];
export const fileIcon = (name) => ICONS.find(([test]) => test.test(name))?.[1] ?? "file_text";
