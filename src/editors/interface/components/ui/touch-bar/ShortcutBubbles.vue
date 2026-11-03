<script setup>
// Shortcut bubbles (docs/mobile.md Shortcuts made tappable): the keys the running modal operator takes now, from its
// modal keymap, as Blender's status bar lists them, each a tap that presses its key; and the numbers pad for Blender's
// numeric input.
//   items: [{ id, label, keys }]
import { ref } from "vue";
import BlIcon from "../../BlIcon.vue";
import { cn } from "../../utils.js";

defineProps({ items: { type: Array, required: true } });
const emit = defineEmits(["press"]);
const numbers = ref(false);
const PAD = [["ONE", "1"], ["TWO", "2"], ["THREE", "3"], ["FOUR", "4"], ["FIVE", "5"], ["SIX", "6"], ["SEVEN", "7"], ["EIGHT", "8"], ["NINE", "9"], ["ZERO", "0"],
  ["MINUS", "-"], ["PERIOD", "."], ["BACK_SPACE", "Backspace"], ["TAB", "Tab"]];
const bubble = "bl-touch-own flex h-full shrink-0 items-center gap-1 rounded-md bg-wcol-toggle px-1.5 text-xs text-foreground";
</script>

<template>
  <div class="bl-ui bl-touch-own flex h-[calc(var(--bl-row)*1.6)] shrink-0 items-stretch gap-[var(--bl-button-gap)] overflow-x-auto bg-header p-[calc(var(--bl-row)*.15)]"
    role="toolbar" aria-label="Shortcut Bubbles">
    <template v-if="numbers">
      <button v-for="[type, label] in PAD" :key="type" type="button" :class="cn(bubble, 'min-w-[calc(var(--bl-row)*1.4)] justify-center')" :aria-label="label" @click="emit('press', type)">{{ label }}</button>
    </template>
    <template v-else>
      <button v-for="item in items" :key="item.id" type="button" :class="bubble" :aria-label="item.label" :title="item.keys" @click="emit('press', item.type, item)">
        <kbd class="rounded-sm bg-wcol-num px-1 font-sans">{{ item.keys }}</kbd><span>{{ item.label }}</span>
      </button>
    </template>
    <span class="flex-1" />
    <button type="button" :class="cn(bubble, numbers && 'bg-primary text-primary-foreground')" aria-label="Numbers" title="Numbers: type a value" :aria-pressed="numbers" @click="numbers = !numbers">
      <BlIcon name="linenumbers_on" /><span>123</span>
    </button>
  </div>
</template>
