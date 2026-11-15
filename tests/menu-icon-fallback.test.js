// tags: menus
// A menu entry drawn with an icon Blender does not know (wm-operators.js iconFallback) is drawn without it, and the
// entries after it still draw.
import assert from "node:assert/strict";
import { iconFallback, kw } from "../src/windowmanager/wm-operators.js";

const ICONS = new Set(["FILE_BLEND", "NONE"]);
const drawn = [];
const layout = {
  operator(idname, keywords) {
    if (keywords.icon && !ICONS.has(keywords.icon)) throw TypeError(`enum "${keywords.icon}" not found`);
    drawn.push([idname, keywords.icon ?? null]);
    return { idname };
  },
  separator: () => drawn.push(["-"]),
};
const safe = iconFallback(layout);
safe.operator("bylonder.project_open", kw({ text: "Open Project...", icon: "FILE_BLEND" }));
assert.equal(safe.operator("bylonder.folder_open", kw({ text: "Open Folder...", icon: "NOT_AN_ICON" })).idname, "bylonder.folder_open");
safe.separator();
safe.operator("bylonder.project_fork", kw({ text: "Save Project As..." }));
assert.deepEqual(drawn, [["bylonder.project_open", "FILE_BLEND"], ["bylonder.folder_open", null], ["-"], ["bylonder.project_fork", null]]);
assert.throws(() => iconFallback({ operator: () => { throw Error("other"); } }).operator("x", kw({ text: "x" })), /other/, "other errors still raise");
console.log("menu icon fallback: ok");
