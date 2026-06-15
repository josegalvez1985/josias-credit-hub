// Import configuration wrapper for TanStack Start with React, Tailwind, and Nitro support.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";

const base = process.env.GITHUB_PAGES === "true" ? "/josias-credit-hub/" : "/";

export default defineConfig({
  vite: { base },
  tanstackStart: {
    // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
    // nitro/vite builds from this
    server: { entry: "server" },
    // SPA mode: prerender solo el shell a index.html (sin SSR por ruta) para hosting estático (GitHub Pages).
    spa: { enabled: true },
    prerender: { enabled: true, crawlLinks: false },
  },
});
