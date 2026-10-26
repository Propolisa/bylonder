<script setup>
import { DialogClose, DialogContent, DialogOverlay, DialogPortal } from "reka-ui";
import { cn } from "../../utils.js";
import BlIcon from "../../BlIcon.vue";

const props = defineProps({ class: null });
</script>

<template>
  <DialogPortal>
    <DialogOverlay class="bl-ui fixed inset-0 z-[2000] bg-black/40" />
    <DialogContent
      :class="cn('bl-ui fixed left-1/2 top-1/2 z-[2001] flex max-h-[calc(100dvh-24px)] w-[calc(100vw-24px)] max-w-lg -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-lg border border-border bg-background text-foreground shadow-[var(--bl-shadow-popup)] outline-none', props.class)"
    >
      <slot />
      <DialogClose class="absolute right-2 top-2 inline-flex size-6 cursor-pointer items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground" aria-label="Close">
        <BlIcon name="x" />
      </DialogClose>
    </DialogContent>
  </DialogPortal>
</template>
