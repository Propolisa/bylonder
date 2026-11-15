<script setup>
// Blender's corner action zone of an area in Focus Mode (AZONE_FULLSCREEN): its icon goes back to the layout. Faint, and
// always shown, as a finger has no hover to find it.
import BlIcon from "../../BlIcon.vue";
import { Button } from "../button";

defineEmits(["exit"]);
</script>

<template>
  <Button variant="ghost" size="icon" class="bl-ui absolute top-1 right-1 z-10 opacity-40 hover:opacity-100 focus-visible:opacity-100"
    title="Back to Previous" aria-label="Back to Previous" @click="$emit('exit')">
    <BlIcon name="FULLSCREEN_EXIT" />
  </Button>
</template>
