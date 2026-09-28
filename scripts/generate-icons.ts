/**
 * Genera los iconos PNG de la PWA a partir de un SVG. Uso: pnpm icons
 * (Los PNG resultantes se guardan en el repo; solo hay que correrlo si cambia el diseño.)
 */
import { mkdir, writeFile } from "node:fs/promises";
import sharp from "sharp";

const OUT = "public/icons";

// Moneda con signo de pesos sobre fondo azul. `pad` deja margen para iconos "maskable".
function svg(pad: number) {
  const r = 256 - pad;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
  <rect width="512" height="512" fill="#0b57d0"/>
  <circle cx="256" cy="256" r="${r * 0.72}" fill="#ffd54f" stroke="#f9a825" stroke-width="${r * 0.06}"/>
  <text x="256" y="256" dy="0.35em" text-anchor="middle" font-family="Arial, Helvetica, sans-serif"
        font-weight="700" font-size="${r * 0.95}" fill="#0b3d91">$</text>
</svg>`;
}

async function png(size: number, pad: number, name: string) {
  const buf = await sharp(Buffer.from(svg(pad))).resize(size, size).png().toBuffer();
  await writeFile(`${OUT}/${name}`, buf);
  console.log(`✔ ${name}`);
}

await mkdir(OUT, { recursive: true });
await writeFile(`${OUT}/icon.svg`, svg(24));
await png(192, 24, "icon-192.png");
await png(512, 24, "icon-512.png");
await png(512, 90, "maskable-512.png");
await png(180, 24, "apple-touch-icon.png");
await png(48, 24, "favicon-48.png");
