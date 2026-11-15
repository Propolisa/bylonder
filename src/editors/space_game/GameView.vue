<script setup>
import { onBeforeUnmount, onMounted, ref, watch } from "vue";
import BlIcon from "../interface/components/BlIcon.vue";
import { Button } from "../interface/components/ui/button";

const props = defineProps({ header: Object, canvas: Object, status: String, shared: String, busy: Boolean, running: Boolean, paused: Boolean, evaluation: String, evaluations: Array });
defineEmits(["play", "pause", "stop", "reset", "evaluation"]);
const host = ref(null);
// The game takes keys while its canvas has focus; until a click gives it focus, the area says so.
const focused = ref(false);
const focus = () => { focused.value = true; }, blur = () => { focused.value = false; };
// Each run's canvas (game-view.js), in place of the last.
const attach = (canvas, old) => {
  old?.removeEventListener("focus", focus);
  old?.removeEventListener("blur", blur);
  old?.remove();
  focused.value = false;
  host.value.prepend(canvas);
  canvas.addEventListener("focus", focus);
  canvas.addEventListener("blur", blur);
};
onMounted(() => attach(props.canvas));
watch(() => props.canvas, attach);
onBeforeUnmount(() => {
  props.canvas.removeEventListener("focus", focus);
  props.canvas.removeEventListener("blur", blur);
});
</script>

<template>
  <Teleport :to="header">
    <div class="bl-ui flex min-w-0 flex-1 items-center gap-2 text-sm text-foreground select-none">
      <span>Game</span>
      <Button size="sm" variant="secondary" :disabled="busy || (running && !paused)" title="Play the scene as an exported page runs it" @click="$emit(running ? 'pause' : 'play')">
        <BlIcon name="PLAY" />
      </Button>
      <Button size="sm" variant="secondary" :disabled="!running || paused" title="Pause the game" @click="$emit('pause')">
        <BlIcon name="PAUSE" />
      </Button>
      <Button size="sm" variant="secondary" :disabled="!running || busy" title="Stop the game and free what it uses" aria-label="Stop" @click="$emit('stop')">
        <BlIcon name="SNAP_FACE" />
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
    <!-- While Play exports, its status shows here too: in Focus Mode the header is hidden. -->
    <p v-if="!running" class="absolute inset-0 p-4 text-muted-foreground">{{ busy ? status || "Exporting the scene" : "Play runs the scene as File > Export > JavaScript ships it; edits reach it as you make them." }}</p>
    <button v-else-if="!focused" type="button" class="absolute inset-0 flex items-center justify-center bg-background/40 text-foreground"
      @pointerdown.prevent="canvas.focus()">
      <span class="rounded-sm bg-background/80 px-3 py-1.5">Click to play</span>
    </button>
  </div>
</template>
