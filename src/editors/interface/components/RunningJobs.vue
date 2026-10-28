<script setup>
// The running-jobs template (uiTemplateRunningJobs): jobs that take longer than a moment, each with a button that
// stops it, and a job's question before it goes on.
import BlIcon from "./BlIcon.vue";
import { Button } from "./ui/button";

defineProps({ jobs: Array });
defineEmits(["stop", "answer"]);
</script>

<template>
  <div class="bl-ui pointer-events-none fixed inset-x-0 bottom-8 z-[1500] flex flex-col items-center gap-1.5 px-4" role="status">
    <div
      v-for="job in jobs"
      :key="job.id"
      class="pointer-events-auto flex max-w-full flex-wrap items-center gap-2 rounded-lg border border-border bg-popover px-2.5 py-1.5 text-popover-foreground shadow-[var(--bl-shadow-popup)]"
    >
      <BlIcon :name="job.question ? 'error' : 'time'" />
      <span class="truncate">{{ job.name }}</span>
      <template v-if="job.question">
        <span class="text-muted-foreground">{{ job.question }}</span>
        <Button size="sm" @click="$emit('answer', job)">Continue</Button>
      </template>
      <template v-else>
        <span class="h-1.5 w-24 overflow-hidden rounded-sm bg-status-track"><span class="block h-full w-full animate-pulse bg-primary" /></span>
        <span class="tabular-nums text-muted-foreground">{{ job.seconds }} s</span>
      </template>
      <Button size="sm" variant="secondary" title="Stop this job" @click="$emit('stop', job)"><BlIcon name="cancel" />Cancel</Button>
    </div>
  </div>
</template>
