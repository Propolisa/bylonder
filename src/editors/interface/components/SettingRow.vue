<script setup>
// A row of a settings tree, drawn as the Outliner draws a row (disclosure triangle, icon, name), with the setting's value
// as an enum field. Unset, it shows what it inherits, muted, and where from; set, it is drawn as Blender draws an
// overridden property. Its decorator and its context menu define or remove the override.
import { computed, ref } from "vue";
import { openMenu } from "../menu.js";
import BlIcon from "./BlIcon.vue";
import { Button } from "./ui/button";

const props = defineProps({ node: Object, depth: { type: Number, default: 0 } });
const open = ref(props.depth === 0);
const set = computed(() => props.node.get() !== null);
const shown = computed(() => (set.value ? { value: props.node.get(), source: null } : props.node.inherited()));
const issue = computed(() => (set.value ? props.node.issue(props.node.get()) : shown.value.issue ?? null));
const labelOf = (value) => props.node.items.find(([id]) => id === value)?.[1] ?? value ?? "";
const choose = (value) => props.node.set(value);
const valueItems = () => props.node.items.map(([id, label, description]) => ({ label, tip: description, checked: () => props.node.get() === id, run: () => choose(id) }));
const defineOverride = () => choose(shown.value.value ?? props.node.items[0][0]);
const removeOverride = () => choose(null);
const menu = (event) => openMenu([
  ...valueItems(), "-",
  { label: "Define Override", icon: "decorate_override", enabled: () => !set.value, run: defineOverride },
  { label: "Remove Override", icon: "x", enabled: () => set.value, run: removeOverride },
], event, props.node.label);
const dropdown = (event) => openMenu(valueItems(), event.currentTarget);
const indent = computed(() => ({ paddingLeft: `calc(var(--bl-row) * ${props.depth})` }));
</script>

<template>
  <div role="treeitem" :aria-expanded="node.children.length ? open : undefined" :aria-label="node.label">
    <div class="group flex h-unit items-center gap-1 rounded-sm pr-0.5 hover:bg-accent" :style="indent" @contextmenu.prevent="menu">
      <button v-if="node.children.length" type="button" class="flex w-4 shrink-0 justify-center" :aria-label="open ? 'Collapse' : 'Expand'" @click="open = !open" @keydown.enter.stop>
        <BlIcon :name="open ? 'disclosure_tri_down' : 'disclosure_tri_right'" />
      </button>
      <span v-else class="w-4 shrink-0" />
      <BlIcon :name="node.icon" class="shrink-0" />
      <span class="min-w-0 flex-1 truncate">{{ node.label }}</span>
      <BlIcon v-if="issue" name="error" class="shrink-0" :title="issue" />
      <Button variant="secondary" size="sm" :aria-label="`${node.label}: ${labelOf(shown.value)}${set ? '' : ', inherited'}`"
        :title="set ? 'Set here' : `Inherited from ${shown.source}`"
        :class="['h-[calc(var(--bl-row)-2px)] w-36 shrink-0 justify-between', set ? 'bg-overridden' : 'text-muted-foreground']"
        @click="dropdown" @keydown.enter.stop>
        <span class="truncate">{{ labelOf(shown.value) }}</span>
        <span v-if="!set" class="truncate text-xs">{{ shown.source }}</span>
      </Button>
      <button type="button" class="flex w-4 shrink-0 justify-center" :class="set ? '' : 'opacity-0 group-hover:opacity-100 focus-visible:opacity-100'"
        :aria-label="set ? 'Remove Override' : 'Define Override'" :title="set ? 'Remove Override' : 'Define Override'" @click="set ? removeOverride() : defineOverride()">
        <BlIcon :name="set ? 'decorate_override' : 'decorate'" />
      </button>
    </div>
    <div v-if="open && node.children.length" role="group">
      <SettingRow v-for="child in node.children" :key="child.key" :node="child" :depth="depth + 1" />
    </div>
  </div>
</template>
