import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import electron from "vite-plugin-electron/simple";

export default defineConfig({
  // Electron loads the packaged app via file://, so asset URLs must be
  // relative — an absolute base resolves against the filesystem root and
  // renders a blank window (learned on UC-Ultra-Desktop).
  base: "./",
  server: { host: "localhost", port: 5174 },
  plugins: [
    react(),
    tailwindcss(),
    electron({
      main: {
        entry: "electron/main.ts",
        // The encrypted SQLite module loads its own binary from beside it, so
        // it stays in node_modules (unpacked from the asar) rather than bundled.
        vite: { build: { rolldownOptions: { external: ["better-sqlite3-multiple-ciphers"] } } },
      },
      preload: {
        input: "electron/preload.ts",
        // A sandboxed renderer can only run a CommonJS preload.
        vite: { build: { rollupOptions: { output: { format: "cjs", entryFileNames: "[name].cjs" } } } },
      },
    }),
  ],
});
