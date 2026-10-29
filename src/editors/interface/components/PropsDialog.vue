<script setup>
// Blender's operator properties dialog (WM_operator_props_dialog_popup): the title, a row per property, and the
// confirm button, at the pointer. Enter confirms, Escape or a click outside cancels.
import { onMounted, reactive, ref } from "vue";
import { Input } from "./ui/input";
import { Button } from "./ui/button";

const props = defineProps({ title: String, fields: Array, confirm: { type: String, default: "OK" }, at: Object });
const emit = defineEmits(["done"]);
const values = reactive(Object.fromEntries(props.fields.map((f) => [f.name, f.value ?? ""])));
const root = ref(null);
const first = ref(null);
const done = (ok) => emit("done", ok ? { ...values } : null);
const position = { left: `${Math.max(8, Math.min(props.at.x - 140, innerWidth - 288))}px`, top: `${Math.max(8, Math.min(props.at.y - 20, innerHeight - 140))}px` };

onMounted(() => {
  const input = first.value?.[0]?.$el ?? root.value.querySelector("input");
  input?.focus();
  input?.select();
});
const outside = (e) => { if (!root.value.contains(e.target)) done(false); };
</script>

<template>
  <div class="bl-ui fixed inset-0 z-[2000]" @pointerdown="outside">
    <div ref="root" role="dialog" :aria-label="title" class="absolute flex w-[280px] flex-col gap-2 rounded-md border border-border bg-background p-2 text-sm text-foreground shadow-[var(--bl-shadow-popup)]"
      :style="position" @keydown.enter.prevent="done(true)" @keydown.esc.prevent="done(false)">
      <div v-if="title" class="px-1 font-semibold">{{ title }}</div>
      <label v-for="field in fields" :key="field.name" class="flex items-center gap-2">
        <span class="w-1/3 shrink-0 truncate text-right text-muted-foreground">{{ field.label }}</span>
        <Input ref="first" v-model="values[field.name]" :aria-label="field.label" />
      </label>
      <Button @click="done(true)">{{ confirm }}</Button>
    </div>
  </div>
</template>
