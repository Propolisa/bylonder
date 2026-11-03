<script setup>
// A value dragged by a finger (docs/mobile.md Dragging a value): its name and live value in a readout clear of the
// finger, and Shift (fine) above the control and Ctrl (snap) below it, held with a second finger; they are the touch
// bar's modifiers, so the drag reads them as Blender's number buttons read the keys.
//   drag: { rect: DOMRect of the field, label, text }; modifiers: the touch bar's { shift, ctrl }
import { computed } from "vue";
import BlIcon from "../../BlIcon.vue";
import { cn } from "../../utils.js";

const props = defineProps({ drag: { type: Object, required: true }, modifiers: { type: Object, required: true } });
const emit = defineEmits(["modifier"]);
const below = computed(() => props.drag.rect.top < innerHeight / 3);
const at = (top) => ({ left: `clamp(var(--bl-row), ${props.drag.rect.left + props.drag.rect.width / 2}px, 100vw - var(--bl-row))`, top });
const readout = computed(() => at(below.value
  ? `calc(${props.drag.rect.bottom}px + var(--bl-finger) + var(--bl-row) * 1.6)`
  : `calc(${props.drag.rect.top}px - var(--bl-finger) - var(--bl-row) * 1.6)`));
const shift = computed(() => at(`calc(${props.drag.rect.top}px - var(--bl-row) * 1.4)`));
const ctrl = computed(() => at(`calc(${props.drag.rect.bottom}px + var(--bl-row) * 0.2)`));
const held = (name) => props.modifiers[name] !== "off";
const button = "bl-touch-own absolute flex h-[calc(var(--bl-row)*1.2)] -translate-x-1/2 items-center gap-1 rounded-md px-2 text-xs shadow-[var(--bl-shadow-menu)] pointer-events-auto";
</script>

<template>
  <div class="bl-ui bl-touch-own pointer-events-none fixed inset-0 z-[2150]">
    <div role="status" class="absolute -translate-x-1/2 whitespace-nowrap rounded-md bg-[var(--bl-tooltip)] px-2 py-1 text-xs text-popover-foreground shadow-[var(--bl-shadow-popup)]" :style="readout">
      <span class="text-muted-foreground">{{ drag.label }}</span> <span class="font-semibold tabular-nums">{{ drag.text }}</span>
    </div>
    <button type="button" aria-label="Shift" :aria-pressed="held('shift')" :class="cn(button, held('shift') ? 'bg-primary text-primary-foreground' : 'bg-wcol-toggle text-foreground')" :style="shift"
      @pointerdown="emit('modifier', 'shift', 'held')" @pointerup="emit('modifier', 'shift', 'off')" @pointercancel="emit('modifier', 'shift', 'off')">
      <BlIcon name="key_shift" /><span>Fine</span>
    </button>
    <button type="button" aria-label="Ctrl" :aria-pressed="held('ctrl')" :class="cn(button, held('ctrl') ? 'bg-primary text-primary-foreground' : 'bg-wcol-toggle text-foreground')" :style="ctrl"
      @pointerdown="emit('modifier', 'ctrl', 'held')" @pointerup="emit('modifier', 'ctrl', 'off')" @pointercancel="emit('modifier', 'ctrl', 'off')">
      <BlIcon name="key_control" /><span>Snap</span>
    </button>
  </div>
</template>
