<script setup>
import { CheckboxIndicator, CheckboxRoot } from "reka-ui";
import { cn } from "../../utils.js";
import BlIcon from "../../BlIcon.vue";

const props = defineProps({ class: null });
const checked = defineModel({ type: Boolean, default: false });
</script>

<template>
  <CheckboxRoot v-model="checked"
    :class="cn('peer inline-flex size-3.5 shrink-0 cursor-pointer items-center justify-center rounded-sm border border-border bg-input outline-none focus-visible:ring-1 focus-visible:ring-ring data-[state=checked]:border-primary data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground', props.class)">
    <CheckboxIndicator class="flex items-center justify-center">
      <BlIcon name="checkmark" />
    </CheckboxIndicator>
  </CheckboxRoot>
</template>
