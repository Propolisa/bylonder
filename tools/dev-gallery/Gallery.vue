<script setup>
import { onMounted, onUnmounted, ref, watch } from "vue";
import PhotoSwipe from "photoswipe";
import "photoswipe/style.css";
import { Button } from "@/editors/interface/components/ui/button";
import { Checkbox } from "@/editors/interface/components/ui/checkbox";
import { Input } from "@/editors/interface/components/ui/input";

const KINDS = { docs: "Docs media", comparisons: "Side by side", testing: "Testing and bug fixes" };
const stored = (key, fallback) => { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; } };
const kinds = ref(stored("kinds", { docs: true, comparisons: true, testing: true }));
const follow = ref(stored("follow", true));
const filter = ref("");
watch(kinds, (v) => localStorage.setItem("kinds", JSON.stringify(v)), { deep: true });
watch(follow, (v) => localStorage.setItem("follow", JSON.stringify(v)));

const pictures = ref([]), servers = ref([]), done = ref(false), fresh = ref(0);
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
  if (!page.length || viewer) return;
  pictures.value.unshift(...page);
  if (follow.value && scrollY < 400) scrollTo({ top: 0, behavior: "smooth" });
  else fresh.value += page.length;
}
function restart() { viewer?.close(); pictures.value = []; done.value = false; older(); }
watch([kinds, filter], restart, { deep: true });

// A thumbnail the server could not make yet (a picture still being written) is asked for again.
function retry(event, p) {
  const img = event.target, tries = Number(img.dataset.tries ?? 0);
  if (tries < 5) setTimeout(() => { img.dataset.tries = tries + 1; img.src = thumbUrl(p) + "&retry=" + (tries + 1); }, 1500 * (tries + 1));
}

// The viewer is PhotoSwipe: pinch, wheel and double tap zoom to full resolution, drag pans, swipe or arrow keys step.
// It needs each picture's size, measured as it comes near.
const sizes = new Map();
const measure = (p) => new Promise((done) => {
  const url = fileUrl(p);
  if (sizes.has(url)) return done();
  const img = new Image();
  img.onload = () => { sizes.set(url, [img.naturalWidth, img.naturalHeight]); done(); };
  img.onerror = done;
  img.src = url;
});
let viewer = null;
async function show(index) {
  await measure(pictures.value[index]);
  viewer = new PhotoSwipe({ dataSource: [], index, wheelToZoom: true, secondaryZoomLevel: 1, maxZoomLevel: 8, preload: [1, 2] });
  viewer.addFilter("numItems", () => pictures.value.length);
  viewer.addFilter("itemData", (_, i) => {
    const p = pictures.value[i], src = fileUrl(p), [width, height] = sizes.get(src) ?? [0, 0];
    if (!width) measure(p).then(() => viewer?.refreshSlideContent(i));
    return { src, width, height, alt: p.name };
  });
  viewer.on("change", () => { if (viewer.currIndex >= pictures.value.length - 3) older(); });
  viewer.on("uiRegister", () => viewer.ui.registerElement({
    name: "caption", appendTo: "root", isButton: false,
    onInit: (el) => viewer.on("change", () => {
      const p = pictures.value[viewer.currIndex];
      el.textContent = `${p.name} · ${when(p)} · ${viewer.currIndex + 1} of ${pictures.value.length}${done.value ? "" : "+"}`;
    }),
  }));
  viewer.on("destroy", () => { viewer = null; });
  viewer.init();
}
function toTop() { fresh.value = 0; scrollTo({ top: 0, behavior: "smooth" }); }

const sentinel = ref();
let observer, timer;
onMounted(() => {
  observer = new IntersectionObserver((e) => e[0].isIntersecting && older(), { rootMargin: "1200px" });
  observer.observe(sentinel.value);
  const tick = async () => { await newer().catch(() => {}); servers.value = await get("/servers").catch(() => servers.value); };
  timer = setInterval(tick, 4000);
  tick();
});
onUnmounted(() => { observer.disconnect(); clearInterval(timer); viewer?.destroy(); });
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
      <button v-for="(p, i) in pictures" :key="p.path + p.mtime" class="overflow-hidden rounded-md border border-border bg-input text-left" @click="show(i)">
        <img :src="thumbUrl(p)" loading="lazy" decoding="async" class="block aspect-video w-full object-contain" @error="retry($event, p)">
        <div class="truncate px-2 pt-1 text-xs">{{ file(p) }}</div>
        <div class="truncate px-2 pb-1 text-xs text-muted-foreground">{{ folder(p) }} · {{ when(p) }}</div>
      </button>
    </main>
    <div ref="sentinel" class="p-4 text-center text-xs text-muted-foreground">{{ done ? "No more pictures" : "Loading..." }}</div>

  </div>
</template>
