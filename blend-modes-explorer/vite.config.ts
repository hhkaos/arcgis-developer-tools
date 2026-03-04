import { defineConfig } from "vite";

export default defineConfig({
  optimizeDeps: {
    exclude: ["@arcgis/core"],
  },
});
