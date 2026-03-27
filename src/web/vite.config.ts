import { defineConfig } from "vite";
import { resolve } from "node:path";

export default defineConfig({
  root: resolve(process.cwd(), "src/web"),
  base: "/",
  server: {
    port: 5173,
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    rollupOptions: {
      input: resolve(process.cwd(), "src/web/index.html"),
      output: {
        entryFileNames: "assets/app.js",
        chunkFileNames: "assets/[name].js",
        assetFileNames: "assets/[name][extname]",
      },
    },
  },
});
