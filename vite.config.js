import { defineConfig } from "vite";
export default defineConfig({
  build: {
    target: "esnext",
    rollupOptions: {
      input: { workspace: "index.html", viewport: "viewport.html" },
    },
    chunkSizeWarningLimit: 7000,
  },
  worker: { format: "es" },
});
