import { defineConfig } from "vite";

export default defineConfig({
  base: "./",
  optimizeDeps: {
    exclude: ["@arcgis/core"],
  },
});
