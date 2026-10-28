<script setup>
// The Node Editor's main region as Blender draws it (node_draw.cc, drawnode.cc): the dot grid, frames, links as
// curves colored by their sockets with a dark outline, nodes on top, and the modal overlays (box select, the link
// being dragged, the knife of links_cut and add_reroute). Input goes to the controller (node-editor-controller.js).
import { computed, ref } from "vue";
import NodeView from "./NodeView.vue";
import { HEADER, ROW, U, linkPath, socketColor } from "./node-layout.js";

const props = defineProps({ editor: { type: Object, required: true }, onKey: { type: Function, required: true } });
const root = ref(null);
const state = props.editor.state;
const layouts = computed(() => (state.version, props.editor.layouts()));
// Selected nodes draw over the others and the active one over all, as Blender sorts them.
const ordered = computed(() => [...layouts.value].sort((a, b) => rank(a) - rank(b)));
const rank = (l) => (l.node.id === state.active ? 2 : state.selected.has(l.node.id) ? 1 : 0);
const frames = computed(() => (state.version, props.editor.frames()));
const links = computed(() => (state.version, props.editor.links()));
const highlighted = (link) => state.selected.has(link.from.ownerBlock.uniqueId) || state.selected.has(link.to.ownerBlock.uniqueId);
const world = computed(() => `translate(${state.view.x}px, ${state.view.y}px) scale(${state.view.zoom})`);
const grid = computed(() => {
  const size = U * state.view.zoom;
  return { backgroundSize: `${size}px ${size}px`, backgroundPosition: `${state.view.x}px ${state.view.y}px` };
});
const pointerWorld = computed(() => props.editor.toWorld(state.pointer));
const dragged = computed(() => {
  const modal = state.modal;
  if (modal?.type !== "link") return null;
  const a = [modal.from.x, modal.from.y], b = pointerWorld.value;
  return { d: modal.side === "out" ? linkPath(a, b) : linkPath(b, a), color: socketColor(modal.from.socket.type) };
});
const box = computed(() => {
  const m = state.modal;
  if (m?.type !== "box") return null;
  return { left: Math.min(m.from[0], m.to[0]) + "px", top: Math.min(m.from[1], m.to[1]) + "px", width: Math.abs(m.to[0] - m.from[0]) + "px", height: Math.abs(m.to[1] - m.from[1]) + "px" };
});
const knife = computed(() => (state.modal?.path ? state.modal.path.map((p) => p.join(",")).join(" ") : null));

const at = (e) => {
  const r = root.value.getBoundingClientRect();
  return [e.clientX - r.left, e.clientY - r.top];
};
function down(e) {
  root.value.focus({ preventScroll: true });
  root.value.setPointerCapture(e.pointerId);
  props.editor.pointerDown(at(e), e);
}
// view2d.zoom with the wheel at the pointer; Ctrl and Shift with the wheel pan, as View2D's keymap does.
function wheel(e) {
  if (e.ctrlKey) return props.editor.pan(-e.deltaY, 0);
  if (e.shiftKey) return props.editor.pan(0, -e.deltaY);
  props.editor.zoom(Math.pow(1.0015, -e.deltaY), at(e));
}
</script>

<template>
  <div ref="root" tabindex="-1"
    class="bl-ui bl-node-editor absolute inset-0 select-none overflow-hidden bg-[var(--bl-node-editor-back)] outline-none"
    :style="{ ...grid, '--node-row': ROW + 'px', '--node-radius': U * 0.2 + 'px', '--node-font': U * 0.55 + 'px' }"
    @pointerenter="root.focus({ preventScroll: true })" @pointerdown="down" @pointermove="editor.pointerMove(at($event))"
    @pointerup="editor.pointerUp(at($event), $event)" @wheel.prevent="wheel" @contextmenu.prevent @keydown="onKey">
    <div class="absolute left-0 top-0 origin-top-left" :style="{ transform: world }">
      <div v-for="f in frames" :key="f.frame.blocks.join() + f.frame.name"
        class="absolute rounded-[var(--node-radius)] bg-[var(--bl-node-frame)] px-2 text-[length:calc(var(--node-font)*1.4)] text-foreground"
        :style="{ left: f.x + 'px', top: f.y + 'px', width: f.width + 'px', height: f.height + 'px', boxShadow: f.frame.blocks.length && f.frame.blocks.every((id) => state.selected.has(id)) ? '0 0 0 1px var(--bl-node-selected)' : 'none' }">
        {{ f.frame.name }}
      </div>
      <svg class="pointer-events-none absolute left-0 top-0 size-px overflow-visible">
        <defs>
          <linearGradient v-for="(l, i) in links" :id="'bl-link-' + i" :key="i" gradientUnits="userSpaceOnUse" :x1="l.a.x" :y1="l.a.y" :x2="l.b.x" :y2="l.b.y">
            <stop offset="0" :style="{ stopColor: socketColor(l.a.socket.type) }" />
            <stop offset="1" :style="{ stopColor: socketColor(l.b.socket.type) }" />
          </linearGradient>
        </defs>
        <g v-for="(l, i) in links" :key="'link' + i" :opacity="highlighted(l) ? 1 : 0.85">
          <path :d="linkPath([l.a.x, l.a.y], [l.b.x, l.b.y])" fill="none" stroke="var(--bl-wire)" stroke-width="4.5" />
          <path :d="linkPath([l.a.x, l.a.y], [l.b.x, l.b.y])" fill="none" :stroke="`url(#bl-link-${i})`" :stroke-width="highlighted(l) ? 3 : 2.5" />
        </g>
        <g v-if="dragged">
          <path :d="dragged.d" fill="none" stroke="var(--bl-wire)" stroke-width="4.5" />
          <path :d="dragged.d" fill="none" :stroke="dragged.color" stroke-width="2.5" />
        </g>
      </svg>
      <NodeView v-for="l in ordered" :key="l.node.id" :layout="l" :selected="state.selected.has(l.node.id)" :active="state.active === l.node.id"
        @changed="editor.refresh()" @toggle-hidden="editor.tree.setHidden(l.node.block, !l.node.hidden); editor.refresh()" />
      <svg v-if="knife" class="pointer-events-none absolute left-0 top-0 size-px overflow-visible">
        <polyline :points="knife" fill="none" stroke="var(--bl-text)" :stroke-width="1.5 / state.view.zoom" :stroke-dasharray="`${4 / state.view.zoom}`" />
      </svg>
    </div>
    <div v-if="box" class="pointer-events-none absolute border border-dashed border-foreground/80 bg-foreground/5" :style="box" />
    <span class="pointer-events-none absolute left-3 top-2 text-muted-foreground" :style="{ fontSize: 'var(--node-font)', height: HEADER + 'px' }">{{ editor.tree.graph.name }}</span>
  </div>
</template>

<style>
.bl-node-editor {
  background-image: radial-gradient(var(--bl-node-grid) 1.5px, transparent 1.5px);
}
/* Over the compositor's backdrop the region is see-through, as Blender draws the backdrop under the grid. */
.bl-backdrop .bl-node-editor {
  background-color: transparent;
}
.bl-node-widget {
  height: calc(var(--node-row) - 4px);
  border-radius: var(--node-radius);
  background: var(--bl-widget);
  color: var(--bl-text);
  font-size: var(--node-font);
}
.bl-node-widget:hover {
  background: var(--bl-widget-hi);
}
</style>
