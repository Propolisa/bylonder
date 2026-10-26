<script setup>
import { DialogDescription } from "reka-ui";
import { cn } from "../../utils.js";

const props = defineProps({ class: null });
</script>

<template>
  <DialogDescription :class="cn('text-sm text-muted-foreground', props.class)"><slot /></DialogDescription>
</template>
