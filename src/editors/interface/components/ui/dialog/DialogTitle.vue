<script setup>
import { DialogTitle } from "reka-ui";
import { cn } from "../../utils.js";

const props = defineProps({ class: null });
</script>

<template>
  <DialogTitle :class="cn('text-base font-semibold text-foreground', props.class)"><slot /></DialogTitle>
</template>
