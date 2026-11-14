<script setup>
import BlIcon from "../interface/components/BlIcon.vue";
import { Button } from "../interface/components/ui/button";

defineProps({ url: String, status: String, busy: Boolean });
defineEmits(["reload"]);
</script>

<template>
  <div class="bl-ui flex h-full flex-col bg-background text-foreground">
    <div class="flex items-center gap-2 border-b border-border bg-header px-2 py-1 text-sm">
      <BlIcon name="BYLONDER" />
      <span>Package View</span>
      <Button size="sm" variant="secondary" :disabled="busy" @click="$emit('reload')">Reload</Button>
      <span class="text-muted-foreground">{{ status }}</span>
    </div>
    <iframe v-if="url" :src="url" title="Package View" class="min-h-0 flex-1 border-0" />
    <p v-else class="p-4 text-muted-foreground">Reload writes the scene as File > Export > JavaScript does and shows it here.</p>
  </div>
</template>
