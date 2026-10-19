// Configuración de Vite para TanStack Start + React + Tailwind v4.
import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";
import tailwindcss from "@tailwindcss/vite";
import tsConfigPaths from "vite-tsconfig-paths";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";

// En GitHub Pages la app vive en /josias-credit-hub/ (ver .github/workflows).
const base = process.env.GITHUB_PAGES === "true" ? "/josias-credit-hub/" : "/";

export default defineConfig({
  base,
  // Puerto 8080 en todas las interfaces: así se prueba desde el celular en la
  // LAN (ojo: Bluetooth y GPS exigen HTTPS o localhost).
  server: { host: "::", port: 8080 },
  // Lightning CSS también en desarrollo, no solo en el build: si no, una regla
  // que el build reescribe (p. ej. -webkit-backdrop-filter) se ve bien en dev y
  // rota en producción.
  css: { transformer: "lightningcss" },
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
    // Una sola copia de React y de React Query aunque alguna dependencia
    // traiga la suya: dos copias rompen los hooks.
    dedupe: [
      "react",
      "react-dom",
      "react/jsx-runtime",
      "react/jsx-dev-runtime",
      "@tanstack/react-query",
      "@tanstack/query-core",
    ],
  },
  plugins: [
    tailwindcss(),
    tsConfigPaths({ projects: ["./tsconfig.json"] }),
    tanstackStart({
      // Lo que esté en una carpeta server/ o importe "server-only" no puede
      // terminar en el bundle del navegador.
      importProtection: {
        behavior: "error",
        client: { files: ["**/server/**"], specifiers: ["server-only"] },
      },
      // El entry del servidor es src/server.ts (el wrapper de errores de SSR).
      server: { entry: "server" },
      // SPA: se prerenderiza solo el shell a index.html (sin SSR por ruta),
      // para hosting estático (GitHub Pages).
      spa: { enabled: true },
      prerender: { enabled: true, crawlLinks: false },
    }),
    viteReact(),
  ],
});
