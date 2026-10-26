<script setup>
// Adjust Last Operation (the HUD region's redo panel): the last operator's properties, re-run on change.
import { Panel, PropertyRow } from "../primitives.js";

const props = defineProps({ title: String, schema: Object, values: Object, state: Object });
const emit = defineEmits(["change"]);

const field = (key, def) => ({
  ...def,
  integer: def.step === 1,
  get: () => props.values[key],
  set: (value, finish) => {
    props.values[key] = value;
    if (finish) emit("change");
  },
});
</script>

<template>
  <div class="bl-ui bl-properties">
    <Panel :title="title" panel-id="redo" :state="state">
      <PropertyRow v-for="(def, key) in schema" :key="key" :field="field(key, def)" />
    </Panel>
  </div>
</template>
