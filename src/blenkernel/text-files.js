// The project's text files as Blender's Texts in Main (bpy.data.texts): each file a Text of its name; after edits the
// files follow Main's Texts (written, renamed, removed), as a .blend keeps its texts.
import { blendData } from '../python/bpy_rna.js';

//   files: { name: content }; save(name, content): writes a file (content null removes it).
export function createTextFiles({ files = {}, save = () => {} } = {}) {
  const texts = () => blendData().texts;
  let saved = new Map();
  const contents = () => new Map([...texts()].map((text) => [text.name, text.as_string()]));
  // A project file changed elsewhere (the Code workspace): its Text follows.
  function load(name, content) {
    const text = texts().get(name);
    if (content === null) text && texts().remove(text);
    else if (!text) texts().new(name).from_string(content);
    else if (text.as_string() !== content) text.from_string(content);
    saved = contents();
  }
  for (const [name, content] of Object.entries(files)) load(name, content);
  return {
    load,
    // Main's Texts written to the project where they changed.
    flush() {
      const now = contents();
      for (const name of saved.keys()) if (!now.has(name)) save(name, null);
      for (const [name, content] of now) if (saved.get(name) !== content) save(name, content);
      saved = now;
    },
  };
}
