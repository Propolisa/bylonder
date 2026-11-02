<script setup>
// Blender's "Blender File View" window (wm_handler_fileselect_do opens it 800 by 600 at 1x scale): the File Browser
// area that mount(element) puts in it. Closing it emits close.
import { onBeforeUnmount, ref, watch } from "vue";
import { Dialog, DialogContent, DialogTitle } from "@/editors/interface/components/ui/dialog";

const props = defineProps({ title: String, mount: Function });
const emit = defineEmits(["close"]);
const section = ref(null);
let area = null;
// The dialog's content renders after the window mounts.
watch(section, (element) => { if (element && !area) area = props.mount(element); }, { flush: "post" });
onBeforeUnmount(() => area?.dispose());
</script>

<template>
  <Dialog :open="true" @update:open="(open) => open || emit('close')">
    <!-- Keys go to the area under the pointer, as Blender's do, not to the window's first button. -->
    <DialogContent class="h-[min(calc(var(--bl-row)*30),calc(100dvh-24px))] max-w-[calc(var(--bl-row)*40)] gap-0 rounded-md p-0" :aria-describedby="undefined" @open-auto-focus.prevent>
      <DialogTitle class="flex h-(--bl-header-h) shrink-0 items-center justify-center bg-header text-sm font-normal">{{ title }}</DialogTitle>
      <div ref="section" class="min-h-0 flex-1" />
    </DialogContent>
  </Dialog>
</template>
