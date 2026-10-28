<script setup>
// A color ramp as uiTemplateColorRamp draws it in a node (colorband_buttons_layout): add, remove, color mode and
// interpolation; the band, where a press picks the nearest stop within reach and a drag moves it; the active stop's
// index and position; its color. `field` gets the ramp and tells what changed (rebuild or not).
import { computed } from "vue";
import BlIcon from "@/editors/interface/components/BlIcon.vue";
import NodeValue from "./NodeValue.vue";
import { rnaProperty } from "@/makesrna/rna.js";
import { activeElement, addElement, colorRampTable, removeElement, setElementPosition, TABLE_SIZE } from "@/blenkernel/colorband.js";

const props = defineProps({ field: { type: Object, required: true } });
const emit = defineEmits(["changed"]);
const ramp = computed(() => props.field.get());
const edit = (fn, rebuild = true) => { fn(ramp.value); props.field.changed(rebuild); emit("changed"); };
const cur = computed(() => activeElement(ramp.value));
const element = computed(() => ramp.value.elements[cur.value]);

const items = (name) => rnaProperty("ColorRamp", name)?.items?.filter(Boolean).map(([id, label]) => [id, label]) ?? [];
const enumField = (name) => ({ get: () => ramp.value[name], set: (v) => edit((r) => { r[name] = v; }) });
const hue = computed(() => ramp.value.color_mode !== "RGB");

// The band in display colors, from the ramp's table (scene linear) through the sRGB transform the display applies.
const toDisplay = (c) => Math.round(255 * Math.min(1, Math.max(0, c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055)));
const gradient = computed(() => {
  const table = colorRampTable(ramp.value), steps = 32;
  const stops = Array.from({ length: steps + 1 }, (_, i) => {
    const k = Math.round((i / steps) * (TABLE_SIZE - 1)) * 4;
    return `rgba(${toDisplay(table[k])}, ${toDisplay(table[k + 1])}, ${toDisplay(table[k + 2])}, ${table[k + 3]}) ${(i / steps) * 100}%`;
  });
  return `linear-gradient(to right, ${stops.join(", ")})`;
});

// ui_do_but_COLORBAND: the nearest stop within 50 pixels, the active one at a 5 pixel disadvantage, then dragged.
function bandDown(e) {
  if (e.button !== 0) return;
  const box = e.currentTarget.getBoundingClientRect(), at = (x) => (x - box.left) / box.width;
  let best = -1, distance = 50;
  ramp.value.elements.forEach((el, i) => {
    const d = Math.abs(el.position * box.width + box.left - e.clientX) + (i === cur.value ? 5 : 0);
    if (d < distance) { best = i; distance = d; }
  });
  if (best < 0) return;
  edit((r) => { r.cur = best; }, false);
  const target = e.currentTarget;
  target.setPointerCapture(e.pointerId);
  const offset = ramp.value.elements[best].position - at(e.clientX);
  target.onpointermove = (m) => edit((r) => setElementPosition(r, activeElement(r), at(m.clientX) + offset));
  target.onpointerup = () => { target.onpointermove = target.onpointerup = null; };
}
const positionField = { get: () => element.value.position, set: (v) => edit((r) => setElementPosition(r, activeElement(r), v)) };
const indexField = { get: () => cur.value, set: (v) => edit((r) => { r.cur = Math.max(0, Math.min(r.elements.length - 1, Math.round(v))); }, false) };
const colorField = { get: () => element.value.color, set: (v) => edit((r) => { r.elements[activeElement(r)].color = [...v]; }) };
</script>

<template>
  <div class="flex size-full flex-col gap-1" @pointerdown.stop>
    <div class="flex h-[var(--node-row)] min-h-0 flex-1 items-center gap-1">
      <button type="button" class="bl-node-widget flex h-full items-center px-1" aria-label="Add color stop" @click="edit(addElement)"><BlIcon name="add" class="size-3.5" /></button>
      <button type="button" class="bl-node-widget flex h-full items-center px-1" aria-label="Remove color stop" @click="edit(removeElement)"><BlIcon name="remove" class="size-3.5" /></button>
      <NodeValue class="flex-1" :field="enumField('color_mode')" kind="ENUM" :items="items('color_mode')" />
      <NodeValue class="flex-1" :field="enumField(hue ? 'hue_interpolation' : 'interpolation')" kind="ENUM" :items="items(hue ? 'hue_interpolation' : 'interpolation')" />
    </div>
    <div class="bl-node-widget relative min-h-0 flex-1 cursor-pointer" aria-label="Color ramp" :style="{ background: gradient }" @pointerdown="bandDown">
      <span v-for="(el, i) in ramp.elements" :key="i" class="absolute inset-y-0 w-px -translate-x-1/2"
        :class="i === cur ? 'bg-foreground' : 'bg-background'" :style="{ left: el.position * 100 + '%' }" />
    </div>
    <div class="flex min-h-0 flex-1 items-center gap-1">
      <NodeValue class="w-1/3" :field="indexField" kind="INT" :min="0" :max="ramp.elements.length - 1" />
      <NodeValue class="flex-1" :field="positionField" kind="VALUE" label="Pos" subtype="FACTOR" />
    </div>
    <NodeValue class="min-h-0 flex-1" :field="colorField" kind="RGBA" label="" aria-label="Color stop color" />
  </div>
</template>
