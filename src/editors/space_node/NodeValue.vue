<script setup>
// A value on a node, as Blender draws a socket's or a property's button there (node_draw.cc, drawnode.cc): a number
// field (dragged to change, clicked to type), a slider for factors, a color swatch, a vector's fields, a menu or a
// check box. `field` gets and sets the value; `kind` is Blender's socket or property type.
import { computed, ref, nextTick } from "vue";
import BlIcon from "@/editors/interface/components/BlIcon.vue";
import { openMenu } from "@/editors/interface/menu.js";

const props = defineProps({ field: { type: Object, required: true }, kind: { type: String, required: true }, label: String, subtype: String, items: Array, min: Number, max: Number });
const emit = defineEmits(["changed"]);
const value = computed(() => props.field.get());
const set = (v) => { props.field.set(v); emit("changed"); };

const isFactor = computed(() => props.subtype === "FACTOR" || props.subtype === "PERCENTAGE");
const range = computed(() => [props.min ?? (isFactor.value ? 0 : -Infinity), props.max ?? (isFactor.value ? 1 : Infinity)]);
const format = (v) => (props.kind === "INT" ? String(Math.round(v)) : Number(v).toFixed(3));
const fill = (v) => `${Math.max(0, Math.min(1, (v - range.value[0]) / (range.value[1] - range.value[0]))) * 100}%`;

// Blender's number button: a drag changes the value by its step per pixel (Shift slower, Ctrl snaps); a click types.
const editing = ref(null), draft = ref(""), input = ref(null);
function numberDown(e, index) {
  if (e.button !== 0) return;
  e.stopPropagation();
  const start = e.clientX, origin = component(index), step = props.kind === "INT" ? 0.1 : isFactor.value ? 0.005 : 0.01;
  let moved = false;
  const target = e.currentTarget;
  target.setPointerCapture(e.pointerId);
  target.onpointermove = (m) => {
    const dx = m.clientX - start;
    moved ||= Math.abs(dx) > 2;
    if (!moved) return;
    let v = origin + dx * step * (m.shiftKey ? 0.1 : 1);
    if (m.ctrlKey) v = Math.round(v * 10) / 10;
    setComponent(index, Math.max(range.value[0], Math.min(range.value[1], props.kind === "INT" ? Math.round(v) : v)));
  };
  target.onpointerup = () => {
    target.onpointermove = target.onpointerup = null;
    if (moved) return;
    editing.value = index ?? -1;
    draft.value = format(origin);
    nextTick(() => { const el = [input.value].flat()[0]; el?.focus(); el?.select(); });
  };
}
const component = (index) => (index === undefined ? Number(value.value) : Number(value.value[index]));
const setComponent = (index, v) => (index === undefined ? set(v) : set(value.value.map((c, i) => (i === index ? v : c))));
// Enter or leaving the field sets the typed value; Escape (editing = null first) keeps the old one.
function accept(index) {
  if (editing.value === null) return;
  const v = Number(draft.value);
  editing.value = null;
  if (Number.isFinite(v)) setComponent(index, v);
}

// Colors are scene linear; the swatch shows them as the display (sRGB) does.
const toDisplay = (c) => (c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055);
const toLinear = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const hex = computed(() => "#" + [0, 1, 2].map((i) => Math.round(Math.max(0, Math.min(1, toDisplay(value.value[i]))) * 255).toString(16).padStart(2, "0")).join(""));
const setHex = (h) => set([1, 3, 5].map((i) => toLinear(parseInt(h.slice(i, i + 2), 16) / 255)).concat(value.value.slice(3)));

function menu(e) {
  e.stopPropagation();
  openMenu(props.items.map(([id, name]) => ({ label: name, checked: () => value.value === id, run: () => set(id) })), e.currentTarget);
}
const current = computed(() => props.items?.find(([id]) => id === value.value)?.[1] ?? String(value.value));
</script>

<template>
  <div class="flex h-full min-w-0 items-center gap-1" @pointerdown.stop>
    <template v-if="kind === 'ENUM' || kind === 'MENU'">
      <button type="button" class="bl-node-widget flex min-w-0 flex-1 items-center justify-between px-1.5" @pointerdown="menu">
        <span class="truncate">{{ current }}</span><BlIcon name="downarrow_hlt" class="size-3 opacity-60" />
      </button>
    </template>
    <label v-else-if="kind === 'BOOLEAN'" class="flex min-w-0 cursor-pointer items-center gap-1">
      <BlIcon :name="value ? 'checkbox_hlt' : 'checkbox_dehlt'" class="size-3.5" @click="set(!value)" />
      <span class="truncate">{{ label }}</span>
    </label>
    <template v-else-if="kind === 'RGBA'">
      <span class="min-w-0 flex-1 truncate">{{ label }}</span>
      <label class="bl-node-widget relative h-full flex-1 cursor-pointer overflow-hidden" :style="{ background: hex }">
        <input type="color" class="absolute inset-0 opacity-0" :value="hex" @input="setHex($event.target.value)" />
      </label>
    </template>
    <div v-else-if="kind === 'VECTOR'" class="flex size-full flex-col gap-px">
      <span class="truncate leading-[var(--node-row)]">{{ label }}</span>
      <template v-for="(axis, i) in ['X', 'Y', 'Z']" :key="axis">
        <input v-if="editing === i" ref="input" v-model="draft" class="bl-node-widget flex-1 px-1.5 text-right" @keydown.enter="accept(i)" @keydown.esc="editing = null" @blur="accept(i)" />
        <button v-else type="button" class="bl-node-widget flex flex-1 items-center justify-between px-1.5" @pointerdown="numberDown($event, i)">
          <span>{{ axis }}</span><span class="tabular-nums">{{ format(value[i]) }}</span>
        </button>
      </template>
    </div>
    <template v-else>
      <input v-if="editing === -1" ref="input" v-model="draft" class="bl-node-widget h-full flex-1 px-1.5 text-right" @keydown.enter="accept()" @keydown.esc="editing = null" @blur="accept()" />
      <button v-else type="button" class="bl-node-widget relative flex h-full flex-1 items-center justify-between overflow-hidden px-1.5" @pointerdown="numberDown($event)">
        <span v-if="isFactor" class="absolute inset-y-0 left-0 bg-primary" :style="{ width: fill(value) }" />
        <span class="relative truncate">{{ label }}</span><span class="relative tabular-nums">{{ format(value) }}</span>
      </button>
    </template>
  </div>
</template>
