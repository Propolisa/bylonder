import { defineConfig } from "vite";
export default defineConfig({
  base: process.env.BASE_PATH || "/",
  build: {
    target: "esnext",
    rollupOptions: {
      input: { workspace: "index.html", viewport: "viewport.html", render: "render.html", docs: "docs.html" },
    },
    chunkSizeWarningLimit: 7000,
  },
  worker: { format: "es" },
});
