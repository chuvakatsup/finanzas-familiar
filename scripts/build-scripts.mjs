// Empaqueta los scripts de línea de comandos para la imagen de producción
// (la imagen no trae tsx ni el código fuente). Salida: dist-scripts/*.mjs
import { build } from "esbuild";

await build({
  entryPoints: ["scripts/migrate.ts", "scripts/create-admin.ts"],
  outdir: "dist-scripts",
  outExtension: { ".js": ".mjs" },
  bundle: true,
  platform: "node",
  target: "node22",
  format: "esm",
  // "server-only" se resuelve a vacío con esta condición (igual que dentro de Next).
  conditions: ["react-server"],
  // Módulo nativo: se toma del node_modules de la imagen.
  external: ["@node-rs/argon2"],
  banner: {
    js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);",
  },
  logLevel: "info",
});
