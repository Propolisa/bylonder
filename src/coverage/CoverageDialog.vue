<script setup>
import { computed, nextTick, ref, shallowRef } from "vue";
import { TreeItem, TreeRoot } from "reka-ui";
import { marked } from "marked";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/editors/interface/components/ui/dialog";
import { TooltipProvider } from "@/editors/interface/components/ui/tooltip";
import { Input } from "@/editors/interface/components/ui/input";
import { Button } from "@/editors/interface/components/ui/button";
import BlIcon from "@/editors/interface/components/BlIcon.vue";
import CoverageBar from "./CoverageBar.vue";
import { STATUS, computeCoverage } from "./coverage.js";
import { AREA_ICONS, KIND_ICONS, KIND_LABELS, percent } from "./format.js";

const open = defineModel("open", { default: true });
const data = shallowRef(null);
const query = ref("");
const filter = ref("all");
const area = ref(null);
const expanded = ref([]);
const selected = ref(null);
const logo = import.meta.env.BASE_URL + "logo/bylonder.svg";

// Menus drawn from Blender's scripts count by what they show, found by drawing them.
Promise.all([import("./blender-surface.json"), import("virtual:blender-coverage"), import("../../docs/blender-coverage.md?raw"), import("../editors/space_view3d/view3d-menus-edit-mesh.js"),
  import("../editors/space_buttons/modifier-add-menu.js")])
  .then(([surface, implemented, notes, menus, modifierMenus]) => (data.value = computeCoverage(surface.default,
    [...implemented.default, ...menus.editMeshMenuCoverage(), ...modifierMenus.modifierMenuCoverage()], notes.default)));

const FILTERS = {
  all: { label: "All", test: () => true },
  missing: { label: "Missing", test: (n) => n.status === "missing" || n.status === "planned" },
  covered: { label: "Covered", test: (n) => ["done", "equivalent", "replaced"].includes(n.status) },
  partial: { label: "Partial", test: (n) => n.status === "partial" },
  notes: { label: "Notes", test: (n) => !!n.note },
};
const LEGEND = [["done", "bg-status-done"], ["equivalent", "bg-status-alt"], ["replaced", "bg-status-alt"], ["partial", "bg-status-partial"], ["missing", "bg-status-track"]];
const DOT = { done: "bg-status-done", equivalent: "bg-status-alt", replaced: "bg-status-alt", partial: "bg-status-partial", planned: "bg-status-track", missing: "bg-status-track", skip: "bg-transparent border border-border" };

const areas = computed(() => [...(data.value?.tree ?? [])].sort((a, b) => b.score / (b.total || 1) - a.score / (a.total || 1) || b.total - a.total));
const roots = computed(() => (area.value ? [area.value] : data.value?.tree ?? []));
const filtering = computed(() => query.value.trim() !== "" || filter.value !== "all");

// The tree as shown: wrappers over coverage nodes, pruned to matches and their ancestors while filtering.
const items = computed(() => {
  const text = query.value.trim().toLowerCase();
  const keep = (n) => (!text || n.l?.toLowerCase().includes(text) || n.id.toLowerCase().includes(text)) && FILTERS[filter.value].test(n);
  const wrap = (n) => {
    const c = n.c?.map(wrap).filter(Boolean);
    return !filtering.value || keep(n) || c?.length ? { node: n, c: c?.length ? c : undefined } : null;
  };
  return roots.value.map(wrap).filter(Boolean);
});
const MAX_AUTO_EXPANDED = 400;
const shownExpanded = computed(() => {
  if (!filtering.value) return expanded.value;
  const keys = [];
  const walk = (w) => { if (w.c && keys.length < MAX_AUTO_EXPANDED) { keys.push(w.node.key); w.c.forEach(walk); } };
  items.value.forEach(walk);
  return keys;
});
const setExpanded = (keys) => { if (!filtering.value) expanded.value = keys; };

const notesHtml = (note) => marked.parseInline(note.text);
const chooseArea = (a) => { area.value = a; expanded.value = a ? [a.key] : []; selected.value = null; };

async function reveal(node) {
  query.value = "";
  filter.value = "all";
  if (area.value && !node.key.startsWith(area.value.key + "/")) area.value = null;
  expanded.value = [...new Set([...expanded.value, ...node.ancestors.map((a) => a.key)])];
  selected.value = node.key;
  await nextTick();
  document.querySelector(`[data-coverage-key="${node.key}"]`)?.scrollIntoView({ block: "center" });
}
</script>

<template>
  <Dialog v-model:open="open">
    <DialogContent class="h-[min(880px,calc(100dvh-24px))] max-w-6xl">
      <TooltipProvider :delay-duration="300">
        <DialogHeader class="flex-row items-center gap-3">
          <img :src="logo" alt="" class="size-8 shrink-0" />
          <div class="min-w-0">
            <DialogTitle>Blender Coverage</DialogTitle>
            <DialogDescription>
              Bylonder's interface against Blender {{ data?.blender ?? "" }}: menus, panels, operators and key bindings, read from Blender itself.
              Notes come from docs/blender-coverage.md.
            </DialogDescription>
          </div>
        </DialogHeader>
        <div v-if="!data" class="p-6 text-muted-foreground">Reading Blender's interface…</div>
        <div v-else class="grid min-h-0 flex-1 grid-rows-[auto_1fr] md:grid-cols-[340px_1fr] md:grid-rows-1">
          <aside class="max-h-[34dvh] overflow-auto border-b border-border p-3 md:max-h-none md:border-b-0 md:border-r">
            <div class="flex items-baseline gap-2">
              <span class="text-2xl font-semibold leading-none tabular-nums">{{ percent(data) }}</span>
              <span class="text-muted-foreground">of {{ data.total.toLocaleString() }} items</span>
            </div>
            <ul class="mt-2 grid grid-cols-2 gap-x-3 gap-y-1">
              <li v-for="[status, color] in LEGEND" :key="status" class="flex items-center gap-1.5">
                <span :class="['size-2 shrink-0 rounded-[2px]', color]" />
                <span class="flex-1">{{ STATUS[status].label }}</span>
                <span class="tabular-nums text-muted-foreground">{{ data.counts[status].toLocaleString() }}</span>
              </li>
            </ul>
            <h3 class="mb-1 mt-4 text-xs text-muted-foreground">Editors, strongest first</h3>
            <button
              type="button"
              :class="['flex w-full cursor-pointer items-center gap-2 rounded-sm px-1.5 py-1 text-left hover:bg-accent', !area && 'bg-[var(--bl-list-active)]']"
              @click="chooseArea(null)"
            >
              <BlIcon name="bylonder" />
              <span class="w-36 shrink-0 truncate">All editors</span>
              <CoverageBar :node="data" class="flex-1" />
            </button>
            <button
              v-for="a in areas"
              :key="a.key"
              type="button"
              :class="['flex w-full cursor-pointer items-center gap-2 rounded-sm px-1.5 py-1 text-left hover:bg-accent', area === a && 'bg-[var(--bl-list-active)]']"
              @click="chooseArea(a)"
            >
              <BlIcon :name="AREA_ICONS[a.id] ?? 'window'" />
              <span class="w-36 shrink-0 truncate" :title="a.l">{{ a.l }}</span>
              <CoverageBar :node="a" class="flex-1" />
            </button>
          </aside>
          <section class="flex min-h-0 flex-col">
            <div class="flex flex-wrap items-center gap-1.5 border-b border-border p-2">
              <Input v-model="query" placeholder="Search names and Blender ids" class="max-w-64 flex-1" aria-label="Search" />
              <Button v-for="(f, id) in FILTERS" :key="id" size="sm" :variant="filter === id ? 'default' : 'ghost'" @click="filter = id">{{ f.label }}</Button>
            </div>
            <div v-if="area?.inherited" class="m-2 mb-0 rounded-md border-l-2 border-status-alt bg-muted px-3 py-2">
              <span class="font-semibold">{{ STATUS[area.inherited.status]?.label ?? "Note" }}.</span>
              <span v-html="notesHtml(area.inherited)" />
            </div>
            <div class="min-h-0 flex-1 overflow-auto p-1">
              <p v-if="!items.length" class="p-4 text-muted-foreground">Nothing matches.</p>
              <TreeRoot
                v-slot="{ flattenItems }"
                :items="items"
                :get-key="(w) => w.node?.key"
                :get-children="(w) => w.c"
                :expanded="shownExpanded"
                class="select-none"
                @update:expanded="setExpanded"
              >
                <TreeItem
                  v-for="item in flattenItems"
                  :key="item._id"
                  v-slot="{ isExpanded }"
                  v-bind="item.bind"
                  :data-coverage-key="item.value.node.key"
                  :style="{ paddingLeft: (item.level - 1) * 14 + 4 + 'px' }"
                  :class="['group rounded-sm pr-2 outline-none hover:bg-accent focus-visible:shadow-[inset_0_0_0_1px_var(--bl-select)]', selected === item.value.node.key && 'bg-[var(--bl-list-select)]']"
                >
                  <div class="flex h-6 items-center gap-1.5">
                    <BlIcon v-if="item.hasChildren" :name="isExpanded ? 'disclosure_tri_down' : 'disclosure_tri_right'" class="size-3 opacity-70" />
                    <span v-else class="w-3 shrink-0" />
                    <BlIcon v-if="item.value.node.k === 'area'" :name="AREA_ICONS[item.value.node.id] ?? 'window'" />
                    <BlIcon v-else-if="KIND_ICONS[item.value.node.k]" :name="KIND_ICONS[item.value.node.k]" class="opacity-70" />
                    <span v-else :class="['ml-1 mr-0.5 size-2 shrink-0 rounded-[2px]', DOT[item.value.node.status]]" :title="STATUS[item.value.node.status]?.label" />
                    <span class="min-w-0 shrink truncate" :title="KIND_LABELS[item.value.node.k]">{{ item.value.node.l || item.value.node.id }}</span>
                    <kbd v-if="item.value.node.x" class="shrink-0 rounded-sm border border-border px-1 text-xs text-muted-foreground">{{ item.value.node.x }}</kbd>
                    <span class="hidden min-w-0 shrink-[2] truncate font-mono text-xs text-[var(--bl-text-off)] group-hover:text-muted-foreground sm:inline">{{ item.value.node.id }}</span>
                    <span class="flex-1" />
                    <CoverageBar v-if="item.hasChildren || !item.value.node.status" :node="item.value.node" class="w-32 shrink-0" />
                    <span v-else class="shrink-0 text-xs text-muted-foreground">{{ STATUS[item.value.node.status].label }}</span>
                  </div>
                  <div v-if="item.value.node.note" class="mb-1 ml-5 rounded-sm border-l-2 border-status-alt bg-muted px-2 py-1 text-xs text-muted-foreground">
                    <span v-html="notesHtml(item.value.node.note)" />
                    <button v-if="item.value.node.target" type="button" class="ml-1 cursor-pointer text-[var(--bl-select)] underline-offset-2 hover:underline" @click.stop="reveal(item.value.node.target)">
                      See {{ item.value.node.target.l }}
                    </button>
                  </div>
                </TreeItem>
              </TreeRoot>
            </div>
          </section>
        </div>
      </TooltipProvider>
    </DialogContent>
  </Dialog>
</template>
