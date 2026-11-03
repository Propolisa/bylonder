<script setup>
// The keyboard sheet (docs/mobile.md Input model): Blender's keys a touch device lacks, as a sheet at the window's
// bottom; a key presses its Blender event type with the touch bar's sticky modifiers, where the last finger was.
import { cn } from "../../utils.js";

const emit = defineEmits(["press", "close"]);
const letters = (text) => [...text].map((c) => [c, c]);
const ROWS = [
  [["ESC", "Esc"], ...Array.from({ length: 12 }, (_, i) => [`F${i + 1}`, `F${i + 1}`]), ["DEL", "Delete"]],
  [["ACCENT_GRAVE", "`"], ["ONE", "1"], ["TWO", "2"], ["THREE", "3"], ["FOUR", "4"], ["FIVE", "5"], ["SIX", "6"], ["SEVEN", "7"], ["EIGHT", "8"], ["NINE", "9"], ["ZERO", "0"], ["MINUS", "-"], ["EQUAL", "="], ["BACK_SPACE", "Backspace"]],
  [["TAB", "Tab"], ...letters("QWERTYUIOP"), ["LEFT_BRACKET", "["], ["RIGHT_BRACKET", "]"]],
  [...letters("ASDFGHJKL"), ["SEMI_COLON", ";"], ["QUOTE", "'"], ["RET", "Return"]],
  [...letters("ZXCVBNM"), ["COMMA", ","], ["PERIOD", "."], ["SLASH", "/"], ["SPACE", "Space"]],
  [["HOME", "Home"], ["END", "End"], ["PAGE_UP", "Page Up"], ["PAGE_DOWN", "Page Down"], ["LEFT_ARROW", "Left"], ["UP_ARROW", "Up"], ["DOWN_ARROW", "Down"], ["RIGHT_ARROW", "Right"]],
  [...Array.from({ length: 10 }, (_, i) => [`NUMPAD_${i}`, `Numpad ${i}`]), ["NUMPAD_PERIOD", "Numpad ."], ["NUMPAD_PLUS", "Numpad +"], ["NUMPAD_MINUS", "Numpad -"], ["NUMPAD_SLASH", "Numpad /"], ["NUMPAD_ASTERIX", "Numpad *"], ["NUMPAD_ENTER", "Numpad Enter"]],
];
const key = "bl-touch-own h-[calc(var(--bl-row)*1.4)] min-w-[calc(var(--bl-row)*1.4)] shrink-0 rounded-md bg-wcol-toggle px-1 text-xs text-foreground";
</script>

<template>
  <div class="bl-ui bl-touch-own flex max-h-[50vh] shrink-0 flex-col gap-[var(--bl-button-gap)] overflow-auto bg-header p-[calc(var(--bl-row)*.2)]" role="toolbar" aria-label="Keyboard">
    <div v-for="(row, r) in ROWS" :key="r" class="flex gap-[var(--bl-button-gap)]">
      <button v-for="[type, label] in row" :key="type" type="button" :class="cn(key, label.length > 2 && 'px-1.5')" :aria-label="label" @click="emit('press', type)">{{ label }}</button>
      <button v-if="r === 0" type="button" :class="cn(key, 'ml-auto px-1.5')" aria-label="Close Keyboard" @click="emit('close')">Close</button>
    </div>
  </div>
</template>
