<script setup>
// File > Export's options (io_scene_babylon/export-dialog.js): Blender's props dialog with the export's checkboxes, then
// its settings tree (SettingRow), each row inheriting from the one above it until set. Enter exports, Escape or a click
// outside cancels; Blender's menus the rows open are not outside.
import { onMounted, ref } from "vue";
import BlIcon from "./BlIcon.vue";
import SettingRow from "./SettingRow.vue";
import { Button } from "./ui/button";
import { Checkbox } from "./ui/checkbox";

const props = defineProps({ title: String, fields: Array, values: Object, tree: Array, note: String });
const emit = defineEmits(["done"]);
const root = ref(null);
const done = (ok) => emit("done", ok);
const outside = (e) => { if (!root.value.contains(e.target) && !e.target.closest?.(".bl-menu")) done(false); };
onMounted(() => root.value.querySelector("button")?.focus());
</script>

<template>
  <div class="bl-ui fixed inset-0 z-[2000]" @pointerdown="outside">
    <div ref="root" role="dialog" :aria-label="title"
      class="absolute left-1/2 top-1/2 flex max-h-[calc(100vh-16px)] w-[360px] -translate-x-1/2 -translate-y-1/2 flex-col gap-2 overflow-y-auto rounded-md border border-border bg-background p-2 text-sm text-foreground shadow-[var(--bl-shadow-popup)]"
      @keydown.enter.prevent="done(true)" @keydown.esc.prevent="done(false)">
      <div class="px-1 font-semibold">{{ title }}</div>
      <template v-for="field in fields" :key="field.name">
        <label class="flex items-center gap-2 px-1">
          <Checkbox v-model="values[field.name]" :aria-label="field.label" />
          <span class="flex-1">{{ field.label }}</span>
          <BlIcon name="BYLONDER" />
        </label>
        <p class="px-1 text-muted-foreground">{{ field.note }}</p>
      </template>
      <div v-if="tree.length" role="tree" aria-label="Settings" class="flex flex-col rounded-sm bg-muted py-0.5">
        <SettingRow v-for="node in tree" :key="node.key" :node="node" />
      </div>
      <p v-if="note" class="px-1 text-muted-foreground">{{ note }}</p>
      <Button @click="done(true)">Export</Button>
    </div>
  </div>
</template>
