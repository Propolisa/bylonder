// tags: storage, explorer
// The Explorer's tree (workspace/explorer/file-tree.js): folders first then files by name, empty folders kept, and
// where a dragged row lands.
import assert from "node:assert/strict";
import { dropTarget, fileIcon, fileTree, parentFolder } from "../src/workspace/explorer/file-tree.js";

const names = (nodes) => nodes.map((n) => (n.children ? [n.name, names(n.children)] : n.name));
const tree = fileTree(["index.js", "src/game.js", "src/behaviors/rock.js", "src/behaviors/barista.js", "content/cafe.ink", "a.md", "item10.js", "item9.js"], ["types", "src/systems"]);
assert.deepEqual(names(tree), [
  ["content", ["cafe.ink"]],
  ["src", [["behaviors", ["barista.js", "rock.js"]], ["systems", []], "game.js"]],
  ["types", []],
  "a.md", "index.js", "item9.js", "item10.js",
]);
assert.equal(tree[1].children[0].children[1].path, "src/behaviors/rock.js");

assert.equal(parentFolder("src/behaviors/rock.js", false), "src/behaviors");
assert.equal(parentFolder("src/behaviors", true), "src/behaviors");
assert.equal(parentFolder("index.js", false), "");

assert.equal(dropTarget("src/behaviors/rock.js", "content", true), "content/rock.js");
assert.equal(dropTarget("src/behaviors/rock.js", "content/cafe.ink", false), "content/rock.js", "dropped on a file: into its folder");
assert.equal(dropTarget("src/behaviors/rock.js", "", true), "rock.js", "dropped on the empty space: to the top");
assert.equal(dropTarget("src/behaviors/rock.js", "src/behaviors", true), null, "already there");
assert.equal(dropTarget("src", "src/behaviors", true), null, "not into itself");

assert.equal(fileIcon("rock.js"), "script", "a script, not Python's icon");
assert.equal(fileIcon("tool.py"), "file_script");
assert.equal(fileIcon("cafe.blend"), "file_blend");
assert.equal(fileIcon("cafe.ink"), "file_text");
console.log("file tree: ok");
