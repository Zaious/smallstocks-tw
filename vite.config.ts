import { defineConfig } from "vitest/config";
export default defineConfig({
  clearScreen: false,
  server: { port: 1432, strictPort: true, host: "127.0.0.1" },
  build: {
    target: "es2022",
    rollupOptions: {
      input: {
        main: "index.html",
        notify: "notify.html",
        detail: "detail.html",
      },
    },
  },
  test: { include: ["tests/**/*.test.ts"] },
});
