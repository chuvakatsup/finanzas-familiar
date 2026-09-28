// Sirve el build "standalone" igual que en Docker (para e2e locales).
// Copia public/ y .next/static/ junto a server.js y lo arranca.
import { cpSync } from "node:fs";
import { pathToFileURL } from "node:url";
import path from "node:path";

const dir = path.resolve(".next/standalone");
cpSync("public", path.join(dir, "public"), { recursive: true });
cpSync(".next/static", path.join(dir, ".next/static"), { recursive: true });
process.chdir(dir);
await import(pathToFileURL(path.join(dir, "server.js")).href);
