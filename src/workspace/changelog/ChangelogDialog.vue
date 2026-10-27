<script setup>
import { shallowRef } from "vue";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/editors/interface/components/ui/dialog";
import { fullDate, timeAgo, withinWeek } from "../relative-time.js";

const open = defineModel("open", { default: true });
const version = __BYLONDER_VERSION__;
const commits = shallowRef(null);
import("virtual:bylonder-changelog").then((m) => (commits.value = m.default));
// Changes from the last week read as relative times, older ones as dates; the full date shows on hover.
const when = (time) => (withinWeek(time) ? timeAgo(time) : new Date(time).toLocaleDateString(undefined, { dateStyle: "medium" }));
</script>

<template>
  <Dialog v-model:open="open">
    <DialogContent class="max-h-[min(720px,calc(100dvh-24px))] max-w-2xl">
      <DialogHeader>
        <DialogTitle>Changelog</DialogTitle>
        <DialogDescription>Version {{ version }}, newest changes first.</DialogDescription>
      </DialogHeader>
      <div v-if="!commits" class="p-6 text-muted-foreground">Reading the history…</div>
      <p v-else-if="!commits.length" class="p-6 text-muted-foreground">This build carries no history.</p>
      <ol v-else class="min-h-0 flex-1 overflow-auto px-4 pb-4">
        <li v-for="commit in commits" :key="commit.hash" class="flex items-baseline gap-3 border-b border-border py-1.5 last:border-b-0">
          <span class="flex-1">{{ commit.subject }}</span>
          <time :datetime="commit.time" :title="fullDate(commit.time)" class="shrink-0 tabular-nums text-muted-foreground">{{ when(commit.time) }}</time>
          <code class="shrink-0 text-muted-foreground">{{ commit.hash }}</code>
        </li>
      </ol>
    </DialogContent>
  </Dialog>
</template>
