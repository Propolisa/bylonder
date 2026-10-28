<script setup>
// Blender's number button and slider (interface_handlers.cc: ui_do_but_NUM, ui_do_but_SLI, ui_numedit_*): drag
// horizontally past a threshold to change the value live, with the pointer locked so the drag goes on past the screen
// edge and the cursor comes back where it started; Ctrl snaps (ui_numedit_apply_snapf), Shift is precise; Escape or a
// right click cancels. A click without a drag edits the text, which takes expressions and units; the arrows at a
// number button's ends step it. Over the button: Ctrl wheel steps, Backspace clears to zero, Minus negates, Ctrl C and
// Ctrl V copy and paste, Enter edits. Every edit ends in one `commit` (one undo step), as Blender pushes undo on release.
//   meta: the RNA property (makesrna/rna.js rnaProperty): type I or F, min, max, soft_min, soft_max, step, precision
//   display(value), editText(value), parse(text): the value as text, as edited text, and back (units, expressions)
import { computed, onBeforeUnmount, ref } from "vue";
import { cn } from "../../utils.js";

const props = defineProps({
  modelValue: { type: Number, default: 0 },
  label: { type: String, default: "" },
  meta: { type: Object, default: () => ({}) },
  slider: Boolean,
  disabled: Boolean,
  inactive: Boolean,
  display: { type: Function, default: (value) => String(value) },
  editText: { type: Function, default: (value) => String(value) },
  parse: { type: Function, default: Number },
  class: null,
});
const emit = defineEmits(["update:modelValue", "commit"]);

// Blender's drag threshold (U.drag_threshold_mouse) and the number of pixels per step of an integer.
const DRAG_THRESHOLD = 3, PIXELS_PER_INT = 2;
const root = ref(null), input = ref(null), mode = ref("idle"), draft = ref(""), hovered = ref(false), error = ref("");
let press = null;

const isInt = computed(() => props.meta.type === "I");
const hard = computed(() => [props.meta.min ?? -Infinity, props.meta.max ?? Infinity]);
const soft = computed(() => [Math.max(hard.value[0], props.meta.soft_min ?? -Infinity), Math.min(hard.value[1], props.meta.soft_max ?? Infinity)]);
const clamp = (value) => Math.min(hard.value[1], Math.max(hard.value[0], isInt.value ? Math.round(value) : value));
// RNA's step of a float is in hundredths of its unit (degrees for rotations, which the display converts).
const step = computed(() => (isInt.value ? props.meta.step || 1 : ((props.meta.step || 1) / 100) * (props.meta.unit === "ROTATION" ? Math.PI / 180 : 1)));
const fraction = computed(() => {
  const [min, max] = soft.value;
  return Number.isFinite(max - min) && max > min ? Math.min(1, Math.max(0, (props.modelValue - min) / (max - min))) : 0;
});

// ui_numedit_apply_snapf: Ctrl rounds to the soft range's tens, units or tenths; Ctrl Shift one step finer.
function snap(value, event) {
  if (!event.ctrlKey) return value;
  const [min, max] = soft.value, range = max - min, fine = event.shiftKey ? 10 : 1;
  const scale = (range < 2.1 ? 10 : range < 21 ? 1 : 0.1) * fine;
  return Math.round(value * scale) / scale;
}

const set = (value) => emit("update:modelValue", clamp(value));
const finish = (value) => { set(value); emit("commit"); };

function dragValue(event) {
  const precise = event.shiftKey ? 0.1 : 1;
  if (props.slider) {
    const [min, max] = soft.value, width = root.value.getBoundingClientRect().width || 1;
    return snap(press.value + (press.dx / width) * (max - min) * precise, event);
  }
  if (isInt.value) return press.value + Math.round((press.dx / PIXELS_PER_INT) * precise) * step.value;
  return snap(press.value + press.dx * step.value * precise, event);
}

function onPointerDown(event) {
  if (props.disabled || mode.value === "edit") return;
  if (event.button === 2 && mode.value === "drag") return cancel();
  if (event.button !== 0) return;
  event.preventDefault();
  press = { x: event.clientX, value: props.modelValue, dx: 0, offset: event.clientX - root.value.getBoundingClientRect().left };
  mode.value = "press";
  addEventListener("pointermove", onPointerMove);
  addEventListener("pointerup", onPointerUp);
  addEventListener("keydown", onDragKey, true);
}

function onPointerMove(event) {
  if (!press) return;
  if (mode.value === "press") {
    if (Math.abs(event.clientX - press.x) < DRAG_THRESHOLD) return;
    mode.value = "drag";
    press.dx = event.clientX - press.x;
    root.value.requestPointerLock?.()?.catch?.(() => {});
  } else press.dx += document.pointerLockElement === root.value ? event.movementX : event.clientX - press.x - press.dx;
  set(dragValue(event));
}

function onPointerUp() {
  const dragged = mode.value === "drag";
  release();
  if (dragged) return emit("commit");
  const width = root.value.getBoundingClientRect().width, handle = Math.min(width / 3, root.value.offsetHeight);
  if (!props.slider && press.offset < handle) finish(props.modelValue - step.value);
  else if (!props.slider && press.offset > width - handle) finish(props.modelValue + step.value);
  else edit();
}

function cancel() {
  if (press && mode.value === "drag") set(press.value);
  release();
}

function onDragKey(event) {
  if (event.key === "Escape") {
    event.preventDefault();
    event.stopPropagation();
    cancel();
  }
}

function release() {
  removeEventListener("pointermove", onPointerMove);
  removeEventListener("pointerup", onPointerUp);
  removeEventListener("keydown", onDragKey, true);
  if (document.pointerLockElement === root.value) document.exitPointerLock();
  mode.value = "idle";
}

function edit() {
  if (props.disabled) return;
  mode.value = "edit";
  draft.value = props.editText(props.modelValue);
  error.value = "";
  queueMicrotask(() => { input.value?.focus(); input.value?.select(); });
}

function accept() {
  if (mode.value !== "edit") return;
  try {
    const value = props.parse(draft.value);
    mode.value = "idle";
    if (Number.isFinite(value)) finish(value);
  } catch (failure) {
    error.value = failure.message;
  }
}

function onEditKey(event) {
  event.stopPropagation();
  if (event.key === "Enter") { event.preventDefault(); accept(); }
  if (event.key === "Escape") { event.preventDefault(); mode.value = "idle"; }
}

function onWheel(event) {
  if (!event.ctrlKey || props.disabled || mode.value !== "idle") return;
  event.preventDefault();
  finish(props.modelValue + (event.deltaY < 0 ? 1 : -1) * step.value);
}

// Keys over the hovered button, as Blender handles them before the editor's keymap.
async function onHoverKey(event) {
  if (!hovered.value || mode.value !== "idle" || props.disabled || event.target.closest?.("input,textarea")) return;
  const handled = { Backspace: () => finish(0), Delete: () => finish(0), "-": () => finish(-props.modelValue), Enter: edit }[event.key];
  const copy = (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "c", paste = (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "v";
  if (!handled && !copy && !paste) return;
  event.preventDefault();
  event.stopPropagation();
  if (handled && !event.ctrlKey) handled();
  if (copy) navigator.clipboard?.writeText(String(props.modelValue));
  if (paste) {
    try { finish(props.parse(await navigator.clipboard.readText())); } catch { /* Not a number: Blender ignores the paste. */ }
  }
}
addEventListener("keydown", onHoverKey, true);
onBeforeUnmount(() => { removeEventListener("keydown", onHoverKey, true); release(); });

const arrows = computed(() => !props.slider && hovered.value && mode.value === "idle" && !props.disabled);
</script>

<template>
  <div
    ref="root"
    :class="cn(
      'bl-ui relative flex h-unit min-w-0 flex-1 cursor-ew-resize select-none items-center overflow-hidden rounded-md text-xs text-foreground shadow-[inset_0_0_0_1px_var(--bl-wcol-outline),0_1px_0_var(--bl-wcol-emboss)]',
      mode === 'edit' ? 'cursor-text bg-wcol-text-sel' : mode === 'drag' || mode === 'press' ? 'bg-wcol-num-sel text-text-sel' : 'bg-wcol-num',
      hovered && mode === 'idle' && !disabled && 'bg-[color-mix(in_srgb,var(--bl-wcol-num),white_9%)]',
      (inactive || disabled) && 'opacity-50',
      disabled && 'cursor-default',
      props.class,
    )"
    :title="error || meta.description"
    role="spinbutton"
    :aria-label="label || meta.name"
    :aria-valuenow="modelValue"
    :aria-disabled="disabled"
    @pointerdown="onPointerDown"
    @pointerenter="hovered = true"
    @pointerleave="hovered = false"
    @wheel="onWheel"
    @contextmenu="mode === 'drag' && ($event.preventDefault(), cancel())"
  >
    <input
      v-if="mode === 'edit'"
      ref="input"
      v-model="draft"
      class="h-full w-full min-w-0 px-1.5 text-xs outline-none selection:bg-wcol-text-item"
      :aria-invalid="!!error"
      @keydown="onEditKey"
      @blur="accept"
    />
    <template v-else>
      <span v-if="slider" class="absolute inset-y-0 left-0 bg-wcol-num-item" :style="{ width: fraction * 100 + '%' }" />
      <span v-if="arrows" class="absolute left-1 size-0 border-y-[4px] border-r-[4px] border-y-transparent border-r-current opacity-70" />
      <span v-if="arrows" class="absolute right-1 size-0 border-y-[4px] border-l-[4px] border-y-transparent border-l-current opacity-70" />
      <span v-if="label" class="relative min-w-0 flex-1 truncate pl-2.5 pr-1">{{ label }}</span>
      <span :class="cn('relative truncate tabular-nums', label ? 'pr-2.5' : 'w-full px-2.5 text-center')">{{ display(modelValue) }}</span>
    </template>
  </div>
</template>
