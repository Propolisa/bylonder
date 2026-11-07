import { createApp } from "vue";
import { preloadIcons } from "@/editors/interface/icon.js";
import Gallery from "./Gallery.vue";
import "@/theme.css";
import "./gallery.css";

if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js");
preloadIcons().then(() => createApp(Gallery).mount("#app"));
