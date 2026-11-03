EDITS = [
('src/editors/interface/components/ui/number-field/NumberField.vue', [
("""// Ctrl V copy and paste, Enter edits. Every edit ends in one `commit` (one undo step), as Blender pushes undo on release.""",
 """// Ctrl V copy and paste, Enter edits. Every edit ends in one `commit` (one undo step), as Blender pushes undo on release.
// A finger's drag announces itself to the touch layer (`bl-value-drag` on the document: { rect, label, text }, then
// null), which shows the value clear of the finger (docs/mobile.md Dragging a value); a vertical drag scrolls."""),
("""const set = (value) => emit("update:modelValue", clamp(value));""", """const announce = (drag) => root.value?.ownerDocument.dispatchEvent(new CustomEvent("bl-value-drag", { detail: drag }));
const set = (value) => {
  emit("update:modelValue", clamp(value));
  if (press?.touch) announce({ rect: root.value.getBoundingClientRect(), label: name.value, text: props.display(clamp(value)) });
};"""),
("""  press = { x: event.clientX, value: props.modelValue, dx: 0, offset: event.clientX - root.value.getBoundingClientRect().left };""",
 """  press = { x: event.clientX, value: props.modelValue, dx: 0, offset: event.clientX - root.value.getBoundingClientRect().left, touch: event.pointerType === "touch" };"""),
("""  if (mode.value === "drag") windowCapture().release();
  mode.value = "idle";""", """  if (mode.value === "drag") windowCapture().release();
  if (press?.touch) announce(null);
  mode.value = "idle";"""),
("""      'bl-ui relative flex h-unit min-w-0 flex-1 cursor-ew-resize select-none items-center overflow-hidden rounded-md text-xs text-foreground""",
 """      'bl-ui relative flex h-unit min-w-0 flex-1 cursor-ew-resize touch-pan-y select-none items-center overflow-hidden rounded-md text-xs text-foreground"""),
]),
]
