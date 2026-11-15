<script setup>
// The project's files as VS Code's Explorer shows them: folders that expand and collapse, inline new file, new folder
// and rename, delete, drag to move, a context menu (Blender's menus) and the tree's keyboard navigation (reka-ui Tree).
import { computed, nextTick, ref, watch } from "vue";
import { TreeItem, TreeRoot } from "reka-ui";
import BlIcon from "@/editors/interface/components/BlIcon.vue";
import { openMenu } from "@/editors/interface/menu.js";
import { dropTarget, fileIcon, fileTree, parentFolder } from "./file-tree.js";

const props = defineProps({
  title: String,
  paths: { type: Array, required: true },
  folders: { type: Array, default: () => [] },
  active: String,
  dirty: { type: Array, default: () => [] },
  locked: { type: Array, default: () => ["index.js"] },
});
const emit = defineEmits(["open", "create", "rename", "remove", "move"]);

const editing = ref(null); // { kind: 'rename' | 'file' | 'folder', path } (path: the renamed row, or the new row's folder)
const draft = ref("");
const dropOn = ref(null);
const expanded = ref([]);
const selected = ref();
const pending = (kind, folder) => ({ path: (folder ? folder + "/" : "") + "\u0000" + kind, name: "", folder: kind === "folder", pending: kind });
const items = computed(() => {
  const tree = fileTree(props.paths, props.folders);
  const edit = editing.value;
  if (!edit || edit.kind === "rename") return tree;
  const insert = (list, folder) => {
    if (folder === edit.path) return [pending(edit.kind, folder), ...list];
    return list.map((n) => (n.children && (edit.path === n.path || edit.path.startsWith(n.path + "/")) ? { ...n, children: insert(n.children, n.path) } : n));
  };
  return insert(tree, "");
});
const dirtySet = computed(() => new Set(props.dirty));

// The active file shows: its folders open and its row selected.
watch(() => props.active, (path) => {
  if (!path) return;
  const parts = path.split("/").slice(0, -1);
  const open = parts.map((_, i) => parts.slice(0, i + 1).join("/"));
  expanded.value = [...new Set([...expanded.value, ...open])];
  selected.value = { path };
}, { immediate: true });

const focusInput = () => nextTick(() => document.querySelector(".bl-file-tree input[data-edit]")?.select());
function start(kind, path) {
  if (kind !== "rename" && path && !expanded.value.includes(path)) expanded.value = [...expanded.value, path];
  editing.value = { kind, path };
  draft.value = kind === "rename" ? path.split("/").pop() : "";
  focusInput();
}
function commit() {
  const edit = editing.value, name = draft.value.trim();
  editing.value = null;
  if (!edit || !name) return;
  if (edit.kind === "rename") {
    const to = parentFolder(edit.path, false) ? parentFolder(edit.path, false) + "/" + name : name;
    if (to !== edit.path) emit("rename", edit.path, to);
  } else emit("create", (edit.path ? edit.path + "/" : "") + name, edit.kind === "folder");
}
const cancel = () => (editing.value = null);
const here = () => (selected.value ? parentFolder(selected.value.path, !!selected.value.folder) : "");

function onSelect(event, node) {
  if (node.pending) return event.preventDefault();
  if (!node.folder) emit("open", node.path);
}
function onKey(event, node) {
  if (editing.value) return;
  const locked = props.locked.includes(node.path);
  if (event.key === "F2" && !locked) { event.preventDefault(); start("rename", node.path); }
  if (event.key === "Delete" && !locked) { event.preventDefault(); emit("remove", node.path, !!node.folder); }
}
function menu(event, node) {
  event.preventDefault();
  if (node) selected.value = node;
  const folder = node ? parentFolder(node.path, !!node.folder) : "";
  const locked = node && props.locked.includes(node.path);
  openMenu([
    { label: "New File...", icon: "file_new", run: () => start("file", folder) },
    { label: "New Folder...", icon: "newfolder", run: () => start("folder", folder) },
    ...(node ? ["-",
      { label: "Rename...", keys: "F2", enabled: () => !locked, run: () => start("rename", node.path) },
      { label: "Delete", icon: "trash", keys: "Delete", enabled: () => !locked, run: () => emit("remove", node.path, !!node.folder) },
      "-",
      { label: "Copy Path", run: () => navigator.clipboard?.writeText(node.path) }] : []),
  ], { x: event.clientX, y: event.clientY });
}

function dragStart(event, node) {
  if (props.locked.includes(node.path)) return event.preventDefault();
  event.dataTransfer.setData("application/x-bylonder-path", node.path);
  event.dataTransfer.effectAllowed = "move";
}
function dragOver(event, node) {
  if (!event.dataTransfer.types.includes("application/x-bylonder-path")) return;
  event.preventDefault();
  dropOn.value = node ? parentFolder(node.path, !!node.folder) : "";
}
function drop(event, node) {
  const from = event.dataTransfer.getData("application/x-bylonder-path");
  dropOn.value = null;
  if (!from) return;
  event.preventDefault();
  event.stopPropagation();
  const to = dropTarget(from, node?.path ?? "", node ? !!node.folder : true);
  if (to) emit("move", from, to);
}
const inDrop = (node) => dropOn.value !== null && parentFolder(node.path, !!node.folder) === dropOn.value && (node.folder || dropOn.value !== "");
defineExpose({ start, here });
</script>

<template>
  <div class="bl-ui bl-file-tree flex h-full min-h-0 flex-col text-sm text-foreground" @contextmenu.self="menu($event)">
    <div class="group flex h-6 shrink-0 items-center gap-1 px-2 text-xs font-semibold uppercase text-muted-foreground">
      <span class="flex-1 truncate" :title="title">{{ title }}</span>
      <button class="rounded-sm p-0.5 opacity-60 hover:bg-accent hover:opacity-100" title="New File" @click="start('file', here())"><BlIcon name="file_new" /></button>
      <button class="rounded-sm p-0.5 opacity-60 hover:bg-accent hover:opacity-100" title="New Folder" @click="start('folder', here())"><BlIcon name="newfolder" /></button>
      <button class="rounded-sm p-0.5 opacity-60 hover:bg-accent hover:opacity-100" title="Collapse Folders" @click="expanded = []"><BlIcon name="collapsemenu" /></button>
    </div>
    <TreeRoot
      v-slot="{ flattenItems }"
      v-model="selected"
      v-model:expanded="expanded"
      :items="items"
      :get-key="(node) => node.path"
      :get-children="(node) => node.children"
      class="min-h-0 flex-1 list-none overflow-auto pb-3 outline-none"
      :class="dropOn === '' && 'bg-accent/40'"
      @dragover="dragOver($event, null)"
      @dragleave.self="dropOn = null"
      @drop="drop($event, null)"
      @contextmenu.self="menu($event)"
    >
      <TreeItem
        v-for="item in flattenItems"
        :key="item._id"
        v-slot="{ isExpanded }"
        v-bind="item.bind"
        class="flex h-[22px] cursor-pointer items-center gap-1 pr-2 outline-none hover:bg-accent focus-visible:shadow-[inset_0_0_0_1px_var(--bl-select)] data-[selected]:bg-secondary"
        :class="[item.value.path === active && 'bg-secondary', inDrop(item.value) && 'bg-accent']"
        :style="{ paddingLeft: `${(item.level - 1) * 12 + 6}px` }"
        :draggable="!item.value.pending && editing?.path !== item.value.path"
        :title="item.value.path"
        @select="onSelect($event, item.value)"
        @keydown="onKey($event, item.value)"
        @contextmenu.stop="menu($event, item.value)"
        @dragstart="dragStart($event, item.value)"
        @dragover.stop="dragOver($event, item.value)"
        @drop="drop($event, item.value)"
      >
        <BlIcon v-if="item.value.folder" :name="isExpanded ? 'disclosure_tri_down' : 'disclosure_tri_right'" class="shrink-0 opacity-70" />
        <span v-else class="w-4 shrink-0" />
        <BlIcon :name="item.value.folder ? 'file_folder' : fileIcon(item.value.name)" class="shrink-0" />
        <input
          v-if="item.value.pending || (editing?.kind === 'rename' && editing.path === item.value.path)"
          v-model="draft"
          data-edit
          class="h-[18px] min-w-0 flex-1 rounded-sm bg-input px-1 shadow-[inset_0_0_0_1px_var(--bl-select)] outline-none"
          @keydown.stop.enter.prevent="commit"
          @keydown.stop.esc.prevent="cancel"
          @keydown.stop
          @click.stop
          @blur="commit"
        />
        <template v-else>
          <span class="min-w-0 flex-1 truncate">{{ item.value.name }}</span>
          <span v-if="dirtySet.has(item.value.path)" class="size-2 shrink-0 rounded-full bg-foreground opacity-80" title="Unsaved changes" />
        </template>
      </TreeItem>
    </TreeRoot>
  </div>
</template>
