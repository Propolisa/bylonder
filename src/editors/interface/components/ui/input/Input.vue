<script setup>
import { cn } from "../../utils.js";

const props = defineProps({ class: null });
const model = defineModel();
</script>

<template>
  <input
    v-model="model"
    :class="cn('h-6 w-full min-w-0 rounded-md bg-input px-2 text-sm text-foreground shadow-[inset_0_0_0_1px_var(--bl-widget-line)] outline-none placeholder:text-muted-foreground focus-visible:shadow-[inset_0_0_0_1px_var(--bl-select)]', props.class)"
  />
</template>
