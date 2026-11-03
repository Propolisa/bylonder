<script setup>
// A press and hold's feedback (docs/mobile.md Press and hold): a ring filling toward the right click above the
// finger, and the held control's tooltip beside it, kept on the screen and clear of the finger.
import { computed } from "vue";

const props = defineProps({
  hold: { type: Object, default: null },
  tip: { type: Object, default: null },
  duration: { type: Number, required: true },
});
const tipStyle = computed(() => {
  const { x, y } = props.tip.point, above = y > innerHeight / 2;
  return {
    left: `clamp(var(--bl-row), ${x}px - 8em, 100vw - 16em - var(--bl-row))`,
    ...(above ? { bottom: `calc(${innerHeight - y}px + var(--bl-finger))` } : { top: `calc(${y}px + var(--bl-finger))` }),
  };
});
const lines = computed(() => props.tip.text.split("\n"));
</script>

<template>
  <div class="bl-ui bl-touch-own pointer-events-none fixed inset-0 z-[2200]">
    <svg v-if="hold" :key="hold.x + ',' + hold.y" class="absolute size-[calc(var(--bl-row)*1.6)] -translate-1/2 overflow-visible text-primary"
      :style="{ left: hold.x + 'px', top: `calc(${hold.y}px - var(--bl-finger))` }" viewBox="0 0 20 20" aria-hidden="true">
      <circle cx="10" cy="10" r="9" fill="none" stroke="var(--bl-popup)" stroke-width="3" />
      <circle cx="10" cy="10" r="9" fill="none" stroke="currentColor" stroke-width="2" pathLength="1" stroke-dasharray="1"
        class="bl-touch-ring origin-center -rotate-90" :style="{ animationDuration: duration + 'ms' }" />
    </svg>
    <div v-if="tip" role="tooltip" class="absolute w-max max-w-[16em] rounded-md bg-[var(--bl-tooltip)] px-2 py-1 text-xs text-popover-foreground shadow-[var(--bl-shadow-popup)]" :style="tipStyle">
      <div v-for="(line, i) in lines" :key="i" :class="i ? 'mt-1 text-muted-foreground' : 'font-semibold'">{{ line }}</div>
    </div>
  </div>
</template>

<style>
.bl-touch-ring { animation: bl-touch-ring linear forwards; }
@keyframes bl-touch-ring { from { stroke-dashoffset: 1; } to { stroke-dashoffset: 0; } }
</style>
