<script setup>
// The quick keys pie (docs/mobile.md Quick keys pie): eight keys in Blender's pie order (west, east, south, north,
// north west, north east, south west, south east) around a point, each labelled with what it does here; a tap presses
// the key, a tap outside closes.
//   center: { x, y }; slots: [{ keys, label, disabled }]
import { computed } from "vue";
import { cn } from "../../utils.js";

const props = defineProps({ center: { type: Object, required: true }, slots: { type: Array, required: true } });
const emit = defineEmits(["press", "close"]);
// Blender's pie directions (UI_RADIAL_W .. UI_RADIAL_SE) as unit vectors, y down.
const DIRECTIONS = [[-1, 0], [1, 0], [0, 1], [0, -1], [-0.71, -0.71], [0.71, -0.71], [-0.71, 0.71], [0.71, 0.71]];
const RADIUS = 4.5;
const place = computed(() => ({
  left: `clamp(calc(var(--bl-row) * ${RADIUS + 3}), ${props.center.x}px, 100vw - var(--bl-row) * ${RADIUS + 3})`,
  top: `clamp(calc(var(--bl-row) * ${RADIUS + 1}), ${props.center.y}px, 100vh - var(--bl-row) * ${RADIUS + 1})`,
}));
</script>

<template>
  <div class="bl-ui bl-touch-own fixed inset-0 z-[2150]" @click.self="emit('close')">
    <div class="absolute size-0" :style="place">
      <span class="absolute size-[calc(var(--bl-row)*1.2)] -translate-1/2 rounded-full border-2 border-primary bg-popover" aria-hidden="true" />
      <button v-for="(slot, i) in slots.slice(0, 8)" :key="i" type="button" :disabled="slot.disabled" role="menuitem"
        :class="cn('bl-touch-own absolute flex h-[calc(var(--bl-row)*1.3)] -translate-1/2 items-center gap-1 whitespace-nowrap rounded-md bg-popover px-2 text-xs text-popover-foreground shadow-[var(--bl-shadow-menu)] disabled:opacity-50',
          'border border-border')"
        :style="{ left: `calc(var(--bl-row) * ${DIRECTIONS[i][0] * RADIUS * 1.25})`, top: `calc(var(--bl-row) * ${DIRECTIONS[i][1] * RADIUS * 0.75})` }"
        :aria-label="slot.label" @click="emit('press', slot)">
        <kbd class="rounded-sm bg-wcol-num px-1 font-sans">{{ slot.keys }}</kbd><span>{{ slot.label }}</span>
      </button>
    </div>
  </div>
</template>
