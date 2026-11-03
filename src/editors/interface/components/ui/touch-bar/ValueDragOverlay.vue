<script setup>
// A value dragged by a finger (docs/mobile.md Dragging a value): its name and live value in a readout clear of the
// finger, above the field (below it near the window's top), between soft Shift (fine) and Ctrl (snap) buttons that a
// second finger holds. They are the touch bar's modifiers, so the drag reads them as Blender's number buttons read
// the keys. The row stays where the drag started, so a held button does not move under its finger.
//   drag: { rect: the field's DOMRect, x: where the finger pressed, label, text }; modifiers: the touch bar's
import { computed, onMounted, onUpdated, ref } from "vue";
import BlIcon from "../../BlIcon.vue";
import { cn } from "../../utils.js";

const props = defineProps({ drag: { type: Object, required: true }, modifiers: { type: Object, required: true } });
const emit = defineEmits(["modifier"]);
const row = ref(null), width = ref(0);
const measure = () => { width.value = row.value?.offsetWidth ?? 0; };
onMounted(measure);
onUpdated(measure);
const below = computed(() => props.drag.rect.top < innerHeight / 4);
const style = computed(() => ({
  left: `clamp(var(--bl-text-margin), ${props.drag.x - width.value / 2}px, 100vw - ${width.value}px - var(--bl-text-margin))`,
  ...(below.value ? { top: `calc(${props.drag.rect.bottom}px + var(--bl-finger))` } : { bottom: `calc(${innerHeight - props.drag.rect.top}px + var(--bl-finger))` }),
}));
const held = (name) => props.modifiers[name] !== "off";
const BUTTONS = { shift: ["Shift", "key_shift", "Fine"], ctrl: ["Ctrl", "key_control", "Snap"] };
const button = (name) => cn("bl-touch-own flex h-full touch-none items-center gap-1 rounded-md px-2 text-xs shadow-[var(--bl-shadow-menu)]",
  held(name) ? "bg-primary text-primary-foreground" : "bg-wcol-toggle text-foreground");
</script>

<template>
  <div class="bl-ui bl-touch-own pointer-events-none fixed inset-0 z-[2150]">
    <div ref="row" class="bl-value-drag pointer-events-auto absolute flex h-[calc(var(--bl-row)*1.6)] items-stretch gap-[var(--bl-button-gap)]" :style="style">
      <template v-for="(name, i) in ['shift', 'ctrl']" :key="name">
        <div v-if="i" role="status" class="bl-value-readout flex min-w-[calc(var(--bl-row)*5)] flex-col items-center justify-center whitespace-nowrap rounded-md bg-[var(--bl-tooltip)] px-2 text-xs text-popover-foreground shadow-[var(--bl-shadow-popup)]">
          <span class="text-muted-foreground">{{ drag.label }}</span><span class="font-semibold tabular-nums">{{ drag.text }}</span>
        </div>
        <button type="button" :aria-label="BUTTONS[name][0]" :title="BUTTONS[name][0]" :aria-pressed="held(name)" :class="button(name)"
          @pointerdown="emit('modifier', name, 'held')" @pointerup="emit('modifier', name, 'off')" @pointercancel="emit('modifier', name, 'off')">
          <BlIcon :name="BUTTONS[name][1]" /><span>{{ BUTTONS[name][2] }}</span>
        </button>
      </template>
    </div>
  </div>
</template>
