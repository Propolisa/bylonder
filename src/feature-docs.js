// What the feature docs (docs/features/*.md) share between the docs viewer and scripts/feature-docs.mjs.

// The deployed app (.github/workflows/pages.yml); a page's Open in Bylonder link opens its example there.
export const LIVE_SITE = "https://propolisa.github.io/bylonder/";
export const openLink = (example) => `${LIVE_SITE}#example=${example}`;
export const MEDIA = "docs/media/features/";
export const SOURCE = "https://github.com/Propolisa/bylonder/blob/main/";
// A page body's sections, in order; the viewer appends the generated ones from the front matter (limits, then ui,
// operators, code and tests).
export const SECTIONS = ["Steps", "Project files"];
export const LIMITS = "Not done yet", REFERENCE = "Reference";

const scalar = (text) => text.trim().replace(/^(["'])(.*)\1$/, "$2");

// A Markdown page's YAML front matter, in the subset the feature docs use: `key: value` scalars, `[a, b]` lists and
// block lists of `- item` lines. Returns { data, body }; a page without front matter has empty data.
export function frontMatter(text) {
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!match) return { data: {}, body: text };
  const data = {};
  let list = null;
  for (const line of match[1].split(/\r?\n/)) {
    const item = line.match(/^\s+-\s+(.*)$/);
    const entry = line.match(/^(\w+):\s*(.*)$/);
    if (item && list) list.push(scalar(item[1]));
    else if (entry) {
      const [, key, value] = entry, flow = value.match(/^\[(.*)\]$/);
      list = value ? null : [];
      data[key] = flow ? flow[1].split(",").map(scalar).filter(Boolean) : value ? scalar(value) : list;
    } else if (line.trim()) throw Error(`front matter: cannot read "${line}"`);
  }
  return { data, body: text.slice(match[0].length) };
}

// A feature's coverage of Blender's surface (index.json, made by scripts/feature-docs.mjs) in words.
export const coverageText = ({ operators = {}, ui = {} }) => [['Operators', operators], ['Menus and panels', ui]]
  .filter(([, { total }]) => total)
  .map(([name, { supported, partial, total }]) => (partial ? `${name}: ${supported} complete, ${partial} working in part, of ${total}` : `${name}: ${supported} of ${total}`));
