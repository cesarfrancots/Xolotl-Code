import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;

// https://vite.dev/config/
export default defineConfig(async () => ({
  plugins: [tailwindcss(), react()],

  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },

  build: {
    // Phaser is only needed by the lazy Civ tab. Keep it isolated so the main
    // workbench and Mac utility surfaces stay lightweight.
    chunkSizeWarningLimit: 1600,
    rollupOptions: {
      output: {
        manualChunks: {
          "game-vendor": ["phaser"],
          "markdown-vendor": ["react-markdown", "rehype-highlight", "highlight.js"],
          "icons-vendor": ["lucide-react"],
          "ui-vendor": ["radix-ui", "cmdk"],
          "tauri-vendor": [
            "@tauri-apps/api",
            "@tauri-apps/plugin-clipboard-manager",
            "@tauri-apps/plugin-notification",
          ],
        },
      },
    },
  },
}));
