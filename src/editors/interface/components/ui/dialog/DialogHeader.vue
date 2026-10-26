<script setup>
import { cn } from "../../utils.js";

const props = defineProps({ class: null });
</script>

<template>
  <div :class="cn('flex flex-col gap-1 border-b border-border px-4 py-3 pr-10', props.class)"><slot /></div>
</template>
