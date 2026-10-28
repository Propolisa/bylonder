// Blender's icon SVGs (public/icons/blender) as one module, name to markup, without the editor metadata Blender's
// sources carry: the interface draws every icon at once instead of fetching each on first use.
import { readdir, readFile } from "node:fs/promises";

const EDITOR = "(?:sodipodi|inkscape|rdf|cc|dc)";
const strip = (svg) => svg
  .replace(/<\?xml[^>]*>|<!--[\s\S]*?-->/g, "")
  .replace(new RegExp(`<${EDITOR}:[\\w-]+[^>]*/>|<(${EDITOR}:[\\w-]+|metadata)\\b[^>]*>[\\s\\S]*?</\\1>`, "g"), "")
  .replace(new RegExp(`\\s(?:xmlns:)?${EDITOR}(?::[\\w-]+)?="[^"]*"`, "g"), "")
  .replace(/>\s+</g, "><")
  .trim();

export async function blenderIcons(dir) {
  const files = await readdir(dir, { recursive: true });
  const svgs = files.filter((file) => file.endsWith(".svg"));
  return Object.fromEntries(await Promise.all(svgs.map(async (file) => [file.slice(0, -4), strip(await readFile(`${dir}/${file}`, "utf8"))])));
}
