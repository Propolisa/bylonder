<script setup>
// The touch bar (docs/mobile.md Input model): what a touch device lacks of a mouse and keyboard, as Blender's status
// bar draws keys and mouse buttons. Shift, Ctrl and Alt are sticky: a tap latches one for the next press, a second
// tap locks it, holding it keeps it down while another finger works. A mouse button chosen makes the next one finger
// press that button. The wheel steps scroll at the last finger. Keys opens the quick keys pie, a hold the keyboard.
//   state: { modifiers: { shift, ctrl, alt }: 'off' | 'once' | 'locked' | 'held', button: 0 | 1 | 2 }
import BlIcon from "../../BlIcon.vue";
import { cn } from "../../utils.js";

const props = defineProps({ state: { type: Object, required: true } });
const emit = defineEmits(["modifier", "button", "wheel", "keys", "keyboard"]);
const MODIFIERS = [["shift", "key_shift", "Shift"], ["ctrl", "key_control", "Ctrl"], ["alt", "key_option", "Alt"]];
const BUTTONS = [[1, "mouse_mmb", "Middle Mouse Button"], [2, "mouse_rmb", "Right Mouse Button"]];
const HOLD = 300;
let held = null;

// A modifier pressed: held after a while with the finger down, else on release a tap that cycles off, once, locked.
function down(name, event) {
  event.currentTarget.setPointerCapture?.(event.pointerId);
  held = { name, timer: setTimeout(() => { held.held = true; emit("modifier", name, "held"); }, HOLD) };
}
function up(name) {
  if (!held || held.name !== name) return;
  clearTimeout(held.timer);
  const next = held.held ? "off" : { off: "once", once: "locked", locked: "off", held: "off" }[props.state.modifiers[name]];
  held = null;
  emit("modifier", name, next);
}
const item = "bl-touch-own flex h-full min-w-[calc(var(--bl-row)*1.6)] shrink-0 items-center justify-center gap-1 rounded-md px-1.5 text-xs text-foreground bg-wcol-toggle";
const active = "bg-primary text-primary-foreground";
</script>

<template>
  <div class="bl-ui bl-touch-own bl-touch-bar flex h-[calc(var(--bl-row)*1.6)] shrink-0 items-stretch gap-[var(--bl-button-gap)] overflow-x-auto bg-header p-[calc(var(--bl-row)*.15)]" role="toolbar" aria-label="Touch Bar">
    <button v-for="[name, icon, label] in MODIFIERS" :key="name" type="button" :aria-label="label" :title="label"
      :aria-pressed="state.modifiers[name] !== 'off'" :data-state="state.modifiers[name]"
      :class="cn(item, state.modifiers[name] !== 'off' && active, state.modifiers[name] === 'locked' && 'underline')"
      @pointerdown="down(name, $event)" @pointerup="up(name)" @pointercancel="up(name)">
      <BlIcon :name="icon" /><span>{{ label }}</span>
    </button>
    <span class="w-[var(--bl-row-gap)] shrink-0" />
    <button v-for="[button, icon, label] in BUTTONS" :key="button" type="button" :aria-label="label" :title="label"
      :aria-pressed="state.button === button" :class="cn(item, state.button === button && active)"
      @click="emit('button', state.button === button ? 0 : button)">
      <BlIcon :name="icon" />
    </button>
    <button type="button" aria-label="Wheel Up" title="Wheel Up" :class="item" @click="emit('wheel', -1)"><BlIcon name="mouse_mmb_scroll" /><BlIcon name="tria_up" /></button>
    <button type="button" aria-label="Wheel Down" title="Wheel Down" :class="item" @click="emit('wheel', 1)"><BlIcon name="mouse_mmb_scroll" /><BlIcon name="tria_down" /></button>
    <span class="flex-1" />
    <button type="button" aria-label="Keys" title="Keys: the mode's keys as a pie; hold for the keyboard" :class="item"
      @click="emit('keys')" @contextmenu.prevent="emit('keyboard')"><BlIcon name="keyingset" /><span>Keys</span></button>
    <button type="button" aria-label="Keyboard" title="Keyboard" :class="item" @click="emit('keyboard')"><BlIcon name="key_empty3" /></button>
  </div>
</template>
