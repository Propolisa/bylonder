export function normalizePath(value) {
  if (value === ".workbench.json")
    throw Error(".workbench.json is reserved for export metadata.");
  if (
    typeof value !== "string" ||
    !value ||
    value.startsWith("/") ||
    value.includes("\\") ||
    /[\x00-\x1f?#]/.test(value)
  )
    throw Error(
      "Use a relative file path without query strings or control characters.",
    );
  const parts = value.split("/");
  if (parts.some((p) => !p || p === "." || p === ".." || p.startsWith("__wb")))
    throw Error("Invalid or reserved path.");
  return parts.join("/");
}
export function validateFiles(files) {
  if (
    !files ||
    typeof files !== "object" ||
    Array.isArray(files) ||
    !files["index.js"] ||
    files["index.js"].kind !== "text"
  )
    throw Error("Every project must contain an editable index.js entry file.");
  for (const [path, file] of Object.entries(files)) {
    normalizePath(path);
    const parts = path.split("/");
    for (let i = 1; i < parts.length; i++)
      if (files[parts.slice(0, i).join("/")])
        throw Error("File/folder collision: " + path);
    if (
      !file ||
      !["text", "binary"].includes(file.kind) ||
      typeof file.content !== "string"
    )
      throw Error("Invalid file: " + path);
  }
  return files;
}
export function removePath(files, path) {
  normalizePath(path);
  if (path === "index.js") throw Error("index.js cannot be deleted.");
  return Object.fromEntries(
    Object.entries(files).filter(
      ([p]) => p !== path && !p.startsWith(path + "/"),
    ),
  );
}
export function renamePath(files, from, to) {
  normalizePath(from);
  normalizePath(to);
  if (from === "index.js" || to === "index.js")
    throw Error("index.js cannot be renamed or replaced by a rename.");
  if (to.startsWith(from + "/"))
    throw Error("Cannot move a folder into itself.");
  const result = { ...files };
  const entries = Object.entries(files).filter(
    ([p]) => p === from || p.startsWith(from + "/"),
  );
  for (const [p] of entries) {
    const target = to + p.slice(from.length);
    if (files[target]) throw Error("Destination already exists: " + target);
  }
  for (const [p, f] of entries) {
    delete result[p];
    result[to + p.slice(from.length)] = f;
  }
  return result;
}
export function validateProject(project) {
  validateFiles(project.files);
  return project;
}
export const textFile = (content) => ({ kind: "text", content });
