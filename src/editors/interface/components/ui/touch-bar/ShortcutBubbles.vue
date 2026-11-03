<script setup>
// Shortcut bubbles (docs/mobile.md Shortcuts made tappable): the keys the running modal operator takes now, from its
// modal keymap, as Blender's status bar lists them, each a tap that presses its key; and the numbers pad for Blender's
// numeric input. They sit in the touch bar while the operator runs.
//   items: [{ id, label, keys, type, shift, ctrl, alt }]
import { ref } from "vue";
import BlIcon from "../../BlIcon.vue";
import { cn } from "../../utils.js";
import { item as bubble, active } from "./touch-bar.js";

defineProps({ items: { type: Array, required: true } });
const emit = defineEmits(["press"]);
const numbers = ref(false);
const PAD = [["ONE", "1"], ["TWO", "2"], ["THREE", "3"], ["FOUR", "4"], ["FIVE", "5"], ["SIX", "6"], ["SEVEN", "7"], ["EIGHT", "8"], ["NINE", "9"], ["ZERO", "0"],
  ["MINUS", "-"], ["PERIOD", "."], ["BACK_SPACE", "Backspace"], ["TAB", "Tab"]];
</script>

<template>
  <button type="button" :class="cn(bubble, numbers && active)" aria-label="Numbers" title="Numbers: type a value" :aria-pressed="numbers" @click="numbers = !numbers">
    <BlIcon name="linenumbers_on" />
  </button>
  <template v-if="numbers">
    <button v-for="[type, label] in PAD" :key="type" type="button" :class="bubble" :aria-label="label" @click="emit('press', { type })">{{ label }}</button>
  </template>
  <template v-else>
    <button v-for="i in items" :key="i.id" type="button" :class="cn(bubble, 'bl-bubble')" :aria-label="i.label" :title="`${i.label} (${i.keys})`" :data-item="i.id" @click="emit('press', i)">
      <kbd class="rounded-sm bg-wcol-num px-1 font-sans">{{ i.keys }}</kbd><span>{{ i.label }}</span>
    </button>
  </template>
</template>
