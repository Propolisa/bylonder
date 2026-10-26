<script setup>
import { iconUrl } from "../icon.js";

defineProps({ name: { type: String, required: true } });
</script>

<template>
  <span class="bl-icon" aria-hidden="true" :style="{ maskImage: `url(${iconUrl(name)})` }" />
</template>
