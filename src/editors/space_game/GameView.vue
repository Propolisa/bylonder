<script setup>
import BlIcon from "../interface/components/BlIcon.vue";
import { Button } from "../interface/components/ui/button";

defineProps({ url: String, status: String, busy: Boolean, running: Boolean, paused: Boolean });
defineEmits(["play", "pause", "reset"]);
</script>

<template>
  <div class="bl-ui flex h-full flex-col bg-background text-foreground">
    <div class="flex items-center gap-2 border-b border-border bg-header px-2 py-1 text-sm">
      <BlIcon name="BYLONDER" />
      <span>Game</span>
      <Button size="sm" variant="secondary" :disabled="busy || (running && !paused)" title="Play the scene as an exported page runs it" @click="$emit(running ? 'pause' : 'play')">
        <BlIcon name="PLAY" />
      </Button>
      <Button size="sm" variant="secondary" :disabled="!running || paused" title="Pause the game" @click="$emit('pause')">
        <BlIcon name="PAUSE" />
      </Button>
      <Button size="sm" variant="secondary" :disabled="!running || busy" title="Reset the game to the scene as it is now" @click="$emit('reset')">
        <BlIcon name="BYLONDER" />
        <span>Reset</span>
      </Button>
      <span class="text-muted-foreground">{{ status }}</span>
    </div>
    <iframe v-if="url" :src="url" title="Game" class="min-h-0 flex-1 border-0" />
    <p v-else class="p-4 text-muted-foreground">Play runs the scene as File > Export > JavaScript ships it; edits reach it as you make them.</p>
  </div>
</template>
