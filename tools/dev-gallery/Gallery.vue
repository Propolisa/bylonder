<script setup>
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import { Button } from "@/editors/interface/components/ui/button";
import { Checkbox } from "@/editors/interface/components/ui/checkbox";
import { Input } from "@/editors/interface/components/ui/input";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/editors/interface/components/ui/dialog";

const KINDS = { docs: "Docs media", comparisons: "Side by side", testing: "Testing and bug fixes" };
const stored = (key, fallback) => { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; } };
const kinds = ref(stored("kinds", { docs: true, comparisons: true, testing: true }));
const follow = ref(stored("follow", true));
const filter = ref("");
watch(kinds, (v) => localStorage.setItem("kinds", JSON.stringify(v)), { deep: true });
watch(follow, (v) => localStorage.setItem("follow", JSON.stringify(v)));

const pictures = ref([]), servers = ref([]), done = ref(false), open = ref(-1), fresh = ref(0);
let loading = false;
const query = (extra) => `/pictures?kinds=${Object.keys(kinds.value).filter((k) => kinds.value[k])}&q=${encodeURIComponent(filter.value)}&${extra}`;
const get = async (url) => (await fetch(url, { cache: "no-store" })).json();
const fileUrl = (p) => `/file?path=${encodeURIComponent(p.path)}&t=${p.mtime}`;
const thumbUrl = (p) => `/thumb?path=${encodeURIComponent(p.path)}&t=${p.mtime}`;
const folder = (p) => p.name.split("/").slice(0, -1).join("/");
const file = (p) => p.name.split("/").pop();
const when = (p) => new Date(p.mtime).toLocaleString();

async function older() {
  if (loading || done.value) return;
  loading = true;
  const last = pictures.value.at(-1);
  const page = await get(query(last ? `before=${last.mtime}` : ""));
  pictures.value.push(...page);
  done.value = page.length === 0;
  loading = false;
}
async function newer() {
  const first = pictures.value[0];
  if (!first) return older();
  const page = await get(query(`after=${first.mtime}`));
  if (!page.length) return;
  pictures.value.unshift(...page);
  if (open.value >= 0) open.value += page.length;
  if (follow.value && open.value < 0 && scrollY < 400) scrollTo({ top: 0, behavior: "smooth" });
  else fresh.value += page.length;
}
function restart() { pictures.value = []; done.value = false; open.value = -1; older(); }
watch([kinds, filter], restart, { deep: true });

// A thumbnail the server could not make yet (a picture still being written) is asked for again.
function retry(event, p) {
  const img = event.target, tries = Number(img.dataset.tries ?? 0);
  if (tries < 5) setTimeout(() => { img.dataset.tries = tries + 1; img.src = thumbUrl(p) + "&retry=" + (tries + 1); }, 1500 * (tries + 1));
}

const current = computed(() => pictures.value[open.value]);
async function step(by) {
  const next = open.value + by;
  if (next >= pictures.value.length - 2) await older();
  if (next >= 0 && next < pictures.value.length) open.value = next;
}
function keys(e) {
  if (open.value < 0) return;
  if (e.key === "ArrowRight") step(1);
  if (e.key === "ArrowLeft") step(-1);
}
let swipeX = null;
const swipeStart = (e) => { swipeX = e.clientX; };
const swipeEnd = (e) => { if (swipeX !== null && Math.abs(e.clientX - swipeX) > 50) step(e.clientX < swipeX ? 1 : -1); swipeX = null; };
function toTop() { fresh.value = 0; scrollTo({ top: 0, behavior: "smooth" }); }

const sentinel = ref();
let observer, timer;
onMounted(() => {
  observer = new IntersectionObserver((e) => e[0].isIntersecting && older(), { rootMargin: "1200px" });
  observer.observe(sentinel.value);
  const tick = async () => { await newer().catch(() => {}); servers.value = await get("/servers").catch(() => servers.value); };
  timer = setInterval(tick, 4000);
  tick();
  addEventListener("keydown", keys);
});
onUnmounted(() => { observer.disconnect(); clearInterval(timer); removeEventListener("keydown", keys); });
</script>

<template>
  <div class="bl-ui min-h-dvh bg-background text-foreground">
    <header class="sticky top-0 z-10 flex flex-col gap-2 border-b border-border bg-header px-4 py-2">
      <div class="flex flex-wrap items-center gap-2">
        <span class="text-base font-semibold">Bylonder dev</span>
        <a v-for="s in servers" :key="s.port" :href="s.url" class="text-foreground no-underline"><Button variant="outline" size="sm">{{ s.name || "localhost" }}:{{ s.port }}</Button></a>
        <span v-if="!servers.length" class="text-xs text-muted-foreground">no dev servers</span>
      </div>
      <div class="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
        <label v-for="(label, kind) in KINDS" :key="kind" class="flex items-center gap-1.5"><Checkbox v-model="kinds[kind]" /> {{ label }}</label>
        <label class="flex items-center gap-1.5"><Checkbox v-model="follow" /> Follow new</label>
        <Input v-model="filter" placeholder="Filter by path" class="w-48" />
      </div>
    </header>

    <Button v-if="fresh" class="fixed left-1/2 top-24 z-20 -translate-x-1/2 shadow" @click="toTop">{{ fresh }} new</Button>

    <main class="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-3 p-4">
      <button v-for="(p, i) in pictures" :key="p.path + p.mtime" class="overflow-hidden rounded-md border border-border bg-input text-left" @click="open = i">
        <img :src="thumbUrl(p)" loading="lazy" decoding="async" class="block aspect-video w-full object-contain" @error="retry($event, p)">
        <div class="truncate px-2 pt-1 text-xs">{{ file(p) }}</div>
        <div class="truncate px-2 pb-1 text-xs text-muted-foreground">{{ folder(p) }} · {{ when(p) }}</div>
      </button>
    </main>
    <div ref="sentinel" class="p-4 text-center text-xs text-muted-foreground">{{ done ? "No more pictures" : "Loading..." }}</div>

    <Dialog :open="open >= 0" @update:open="(v) => !v && (open = -1)">
      <DialogContent v-if="current" class="h-[calc(100dvh-24px)] max-w-[calc(100vw-24px)] gap-2 p-3" @pointerdown="swipeStart" @pointerup="swipeEnd">
        <DialogTitle class="truncate pr-8 text-sm">{{ file(current) }}</DialogTitle>
        <DialogDescription class="truncate text-xs text-muted-foreground">{{ folder(current) }} · {{ when(current) }} · {{ open + 1 }} of {{ pictures.length }}{{ done ? "" : "+" }}</DialogDescription>
        <img :src="fileUrl(current)" class="min-h-0 flex-1 touch-pan-y object-contain">
        <div class="flex justify-between gap-2">
          <Button variant="outline" :disabled="open === 0" @click="step(-1)">Newer</Button>
          <a :href="fileUrl(current)" target="_blank" class="text-foreground no-underline"><Button variant="outline">Full size</Button></a>
          <Button variant="outline" :disabled="done && open === pictures.length - 1" @click="step(1)">Older</Button>
        </div>
      </DialogContent>
    </Dialog>
  </div>
</template>
