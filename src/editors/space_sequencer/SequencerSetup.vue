<script setup>
// Offered when the Video Sequencer opens on an empty edit: render to video, the scene as a strip and its sound.
import { reactive, watch } from "vue";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/editors/interface/components/ui/dialog";
import { Button } from "@/editors/interface/components/ui/button";
import { Checkbox } from "@/editors/interface/components/ui/checkbox";

const props = defineProps({ scene: String, video: Boolean });
const emit = defineEmits(["done"]);
const open = defineModel("open", { default: true });
const choice = reactive({ video: !props.video, scene: true, audio: true, remember: false });
const options = [
  ...(props.video ? [] : [["video", "Render to video", "MPEG-4 (H.264, AAC audio) instead of PNG images"]]),
  ["scene", `Add this scene (${props.scene})`, "The scene as a strip, from its first frame"],
  ["audio", "Include its sound", "A Scene Audio strip beside it"],
];
let answered = false;
const done = (setUp) => { answered = true; emit("done", setUp ? { ...choice } : { video: false, scene: false, audio: false, remember: choice.remember }); open.value = false; };
watch(open, (value) => { if (!value && !answered) emit("done", null); });
</script>

<template>
  <Dialog v-model:open="open">
    <DialogContent class="max-w-sm">
      <DialogHeader>
        <DialogTitle>Set Up for Video Editing</DialogTitle>
        <DialogDescription>The sequencer is empty.</DialogDescription>
      </DialogHeader>
      <div class="flex flex-col gap-2 px-4 py-3 text-sm">
        <label v-for="[key, label, help] in options" :key="key" :title="help" class="flex items-center gap-2"
          :class="{ 'opacity-50': key === 'audio' && !choice.scene }">
          <Checkbox v-model="choice[key]" :disabled="key === 'audio' && !choice.scene" />
          <span>{{ label }}</span>
        </label>
      </div>
      <div class="flex items-center gap-2 border-t border-border px-4 py-2">
        <label class="mr-auto flex items-center gap-2 text-xs text-muted-foreground">
          <Checkbox v-model="choice.remember" />
          <span>Remember my choice</span>
        </label>
        <Button variant="ghost" @click="done(false)">Not Now</Button>
        <Button @click="done(true)">Set Up</Button>
      </div>
    </DialogContent>
  </Dialog>
</template>
