<script setup>
import { Primitive } from "reka-ui";
import { cn } from "../../utils.js";
import { buttonVariants } from ".";

const props = defineProps({ variant: String, size: String, class: null, as: { type: String, default: "button" }, asChild: Boolean });
</script>

<template>
  <Primitive :as="as" :as-child="asChild" :class="cn(buttonVariants({ variant, size }), props.class)">
    <slot />
  </Primitive>
</template>
