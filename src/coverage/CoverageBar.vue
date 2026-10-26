<script setup>
import { computed } from "vue";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/editors/interface/components/ui/tooltip";
import { STATUS } from "./coverage.js";
import { percent } from "./format.js";

const props = defineProps({ node: { type: Object, required: true }, showPercent: { type: Boolean, default: true } });
const segments = computed(() => {
  const { counts, total } = props.node;
  return [
    ["done", counts.done],
    ["alt", counts.equivalent + counts.replaced],
    ["partial", counts.partial],
  ].filter(([, n]) => n).map(([kind, n]) => ({ kind, width: (n / total) * 100 + "%" }));
});
const summary = computed(() => Object.entries(props.node.counts).filter(([, n]) => n).map(([k, n]) => `${n} ${STATUS[k].label.toLowerCase()}`).join(", "));
const fill = { done: "bg-status-done", alt: "bg-status-alt", partial: "bg-status-partial" };
</script>

<template>
  <Tooltip>
    <TooltipTrigger as-child>
      <span class="flex min-w-0 items-center gap-2" :aria-label="`${percent(node)} covered: ${summary}`">
        <span class="flex h-2 min-w-10 flex-1 gap-[2px] overflow-hidden rounded-sm bg-status-track">
          <span v-for="s in segments" :key="s.kind" :class="fill[s.kind]" :style="{ width: s.width }" />
        </span>
        <span v-if="showPercent" class="w-10 shrink-0 text-right tabular-nums text-muted-foreground">{{ percent(node) }}</span>
      </span>
    </TooltipTrigger>
    <TooltipContent>{{ summary }} of {{ node.total }}</TooltipContent>
  </Tooltip>
</template>
