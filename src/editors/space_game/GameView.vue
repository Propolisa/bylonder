<script setup>
import { onMounted, ref } from "vue";
import BlIcon from "../interface/components/BlIcon.vue";
import { Button } from "../interface/components/ui/button";

const props = defineProps({ header: Object, canvas: Object, status: String, shared: String, busy: Boolean, running: Boolean, paused: Boolean, evaluation: String, evaluations: Array });
defineEmits(["play", "pause", "reset", "evaluation"]);
const host = ref(null);
onMounted(() => host.value.append(props.canvas));
</script>

<template>
  <Teleport :to="header">
    <div class="bl-ui flex min-w-0 flex-1 items-center gap-2 text-sm text-foreground">
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
      <span class="flex items-center gap-0.5" title="Which modifier stack the game's package evaluates (the scene's export setting)">
        <BlIcon name="BYLONDER" />
        <Button v-for="[id, label, description] in evaluations" :key="id" size="sm" :variant="evaluation === id ? 'default' : 'secondary'" :disabled="busy" :title="description"
          @click="evaluation !== id && $emit('evaluation', id)">{{ label }}</Button>
      </span>
      <span class="truncate text-muted-foreground">{{ status }}</span>
      <span v-if="shared" class="ml-auto truncate text-muted-foreground">{{ shared }}</span>
    </div>
  </Teleport>
  <div ref="host" class="bl-ui relative h-full bg-background text-foreground">
    <p v-if="!running" class="absolute inset-0 p-4 text-muted-foreground">Play runs the scene as File > Export > JavaScript ships it; edits reach it as you make them.</p>
  </div>
</template>
