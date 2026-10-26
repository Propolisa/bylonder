<script setup>
import { TooltipContent, TooltipPortal } from "reka-ui";
import { cn } from "../../utils.js";

const props = defineProps({ class: null, side: { type: String, default: "top" }, sideOffset: { type: Number, default: 4 } });
</script>

<template>
  <TooltipPortal>
    <TooltipContent :side="side" :side-offset="sideOffset" :class="cn('bl-ui z-[2100] max-w-xs rounded-md border border-border bg-popover px-2 py-1 text-xs text-popover-foreground shadow-[var(--bl-shadow-menu)]', props.class)">
      <slot />
    </TooltipContent>
  </TooltipPortal>
</template>
