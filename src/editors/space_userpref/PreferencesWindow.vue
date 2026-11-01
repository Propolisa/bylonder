<script setup>
// The window Edit > Preferences opens (WM_window_open of a temporary Preferences screen): a movable window over the
// app holding the Preferences editor, which stays usable beside it as Blender's second window is.
import { onMounted, onBeforeUnmount, reactive, ref } from "vue";
import BlIcon from "@/editors/interface/components/BlIcon.vue";
import { mountPreferences } from "./editor.js";

const emit = defineEmits(["close"]);
const body = ref(null);
const place = reactive({ x: Math.max(12, (innerWidth - 1020) / 2), y: Math.max(12, (innerHeight - 700) / 2) });
let editor = null;
onMounted(() => { editor = mountPreferences(body.value); });
onBeforeUnmount(() => editor?.dispose());

const drag = (event) => {
  if (event.button !== 0 || event.target.closest("button")) return;
  const start = { x: event.clientX - place.x, y: event.clientY - place.y };
  const move = (e) => Object.assign(place, { x: e.clientX - start.x, y: Math.max(0, e.clientY - start.y) });
  const up = () => { removeEventListener("pointermove", move); removeEventListener("pointerup", up); };
  addEventListener("pointermove", move);
  addEventListener("pointerup", up);
};
</script>

<template>
  <div class="bl-ui fixed z-[1500] flex h-[min(700px,calc(100dvh-24px))] w-[min(1020px,calc(100vw-24px))] flex-col overflow-hidden rounded-lg border border-border bg-background text-foreground shadow-[var(--bl-shadow-popup)]"
    :style="{ left: place.x + 'px', top: place.y + 'px' }" role="dialog" aria-label="Blender Preferences" data-blender="PREFERENCES_WINDOW">
    <div class="flex h-(--bl-header-h) shrink-0 cursor-move items-center bg-header px-2 text-sm" @pointerdown="drag">
      <span class="flex-1 text-center">Blender Preferences</span>
      <button type="button" class="inline-flex size-5 cursor-pointer items-center justify-center rounded-md text-muted-foreground hover:text-foreground" aria-label="Close" @click="emit('close')">
        <BlIcon name="x" />
      </button>
    </div>
    <div ref="body" class="min-h-0 flex-1" />
  </div>
</template>
