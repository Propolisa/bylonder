<script setup>
// One node as node_draw.cc draws it: a header in its class's color with the collapse arrow and name, then the
// body's rows (outputs right-aligned, buttons, inputs with their values when unlinked), sockets on the edges in
// their type's color and shape. Selected nodes are outlined orange, the active one white; a muted node is dimmed
// with its pass-through drawn red.
import { computed } from "vue";
import BlIcon from "@/editors/interface/components/BlIcon.vue";
import NodeValue from "./NodeValue.vue";
import NodeColorRamp from "./NodeColorRamp.vue";
import { HEADER, ROW, SOCKET_RADIUS, headerColor, socketColor } from "./node-layout.js";

const props = defineProps({ layout: { type: Object, required: true }, selected: Boolean, active: Boolean });
const emit = defineEmits(["changed", "toggle-hidden"]);
const node = computed(() => props.layout.node);
const outline = computed(() => (props.active ? "var(--bl-node-active)" : props.selected ? "var(--bl-node-selected)" : "var(--bl-node-outline)"));
// Socket shapes (display_shape): a diamond for fields, a square for single values.
const shape = (s) => (s.shape === "DIAMOND" || s.shape === "DIAMOND_DOT" ? "rotate-45 rounded-[1px]" : s.shape === "SQUARE" ? "rounded-[1px]" : "rounded-full");
const valueKind = (s) => (s.type === "INT" || s.type === "BOOLEAN" || s.type === "MENU" || s.type === "RGBA" || s.type === "VECTOR" ? s.type : "VALUE");
const firstInput = computed(() => props.layout.sockets.find((s) => s.side === "in"));
const firstOutput = computed(() => props.layout.sockets.find((s) => s.side === "out"));
</script>

<template>
  <div v-if="node.reroute" class="absolute size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border border-black"
    :style="{ left: node.x + 'px', top: node.y + 'px', background: socketColor(node.outputs[0]?.type ?? 'CUSTOM'), boxShadow: selected ? `0 0 0 1.5px ${outline}` : 'none' }" />
  <div v-else class="absolute rounded-[var(--node-radius)] text-[length:var(--node-font)] text-foreground" :data-node="node.blender ?? node.block.getClassName()"
    :class="{ 'opacity-60': node.muted }"
    :style="{ left: node.x + 'px', top: node.y + 'px', width: layout.width + 'px', height: layout.height + 'px', boxShadow: `0 0 0 1px ${outline}, 0 3px 8px #0006` }">
    <div class="flex items-center gap-1 overflow-hidden rounded-t-[var(--node-radius)] px-1 text-white"
      :class="{ 'rounded-b-[var(--node-radius)]': node.hidden }"
      :style="{ height: HEADER + 'px', background: node.muted ? 'var(--bl-widget)' : headerColor(node.tag) }">
      <BlIcon :name="node.hidden ? 'rightarrow_thin' : 'downarrow_hlt'" class="size-3 shrink-0 cursor-pointer opacity-80" @pointerdown.stop @click="emit('toggle-hidden')" />
      <span class="truncate">{{ node.label }}</span>
    </div>
    <div v-if="!node.hidden" class="relative rounded-b-[var(--node-radius)] bg-[var(--bl-node-back)]" :style="{ height: layout.height - HEADER + 'px' }">
      <template v-for="row in layout.rows" :key="row.kind + (row.item.id ?? row.item.key ?? '')">
        <div class="absolute inset-x-0 flex items-center px-2.5" :style="{ top: row.y - HEADER + 'px', height: row.h + 'px' }">
          <span v-if="row.kind === 'output'" class="w-full truncate text-right">{{ row.item.label }}</span>
          <NodeValue v-else-if="row.kind === 'value'" class="w-full" :style="{ height: row.h - 4 + 'px' }" :field="row.item.value" :kind="valueKind(row.item.value.socket)" :subtype="row.item.value.socket.subtype" @changed="emit('changed')" />
          <NodeColorRamp v-else-if="row.kind === 'ramp'" class="w-full py-0.5" :style="{ height: row.h + 'px' }" :field="row.item" @changed="emit('changed')" />
          <NodeValue v-else-if="row.kind === 'button'" class="w-full" :style="{ height: ROW - 4 + 'px' }" :field="row.item" :kind="row.item.type" :label="row.item.label" :items="row.item.items" :min="row.item.min" :max="row.item.max" @changed="emit('changed')" />
          <NodeValue v-else-if="row.item.value && !row.item.linked" class="w-full" :style="{ height: row.h - 4 + 'px' }" :field="row.item.value" :kind="valueKind(row.item)"
            :label="row.item.label" :subtype="row.item.value.socket.subtype" :items="row.item.value.socket.items?.map((i) => [i, i])" :min="row.item.value.socket.min" :max="row.item.value.socket.max" @changed="emit('changed')" />
          <span v-else class="truncate">{{ row.item.label }}</span>
        </div>
      </template>
      <svg v-if="node.muted && firstInput && firstOutput" class="pointer-events-none absolute inset-0 size-full overflow-visible">
        <line :x1="0" :y1="firstInput.y - node.y - HEADER" :x2="layout.width" :y2="firstOutput.y - node.y - HEADER" stroke="var(--bl-node-muted-link)" stroke-width="2" />
      </svg>
    </div>
    <span v-for="s in layout.sockets" :key="s.key" class="absolute border border-black" :class="shape(s.socket)" :data-socket="s.side + ':' + s.socket.id"
      :style="{ width: SOCKET_RADIUS * 2 + 'px', height: SOCKET_RADIUS * 2 + 'px', left: s.x - node.x - SOCKET_RADIUS + 'px', top: s.y - node.y - SOCKET_RADIUS + 'px', background: socketColor(s.socket.type) }" />
  </div>
</template>
