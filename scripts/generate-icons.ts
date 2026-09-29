/**
 * Genera los iconos PNG de la PWA a partir del logo `assets/logo.png`. Uso: pnpm icons
 * (Los PNG resultantes se guardan en el repo; solo hay que correrlo si cambia el logo.)
 *
 * El logo es un cuadro redondeado con degradado sobre fondo transparente. De él salen dos versiones:
 * - "Llena": el degradado se extiende hasta los bordes (sin transparencia). Para iPhone y el icono
 *   maskable de Android, que recortan la forma ellos mismos (iOS pinta de negro lo transparente).
 * - "Redondeada": la llena recortada con el mismo radio del logo. Para favicon e icono normal.
 *   Así también se limpia el borde semitransparente que trae el archivo original.
 */
import { mkdir, rm, writeFile } from "node:fs/promises";
import sharp from "sharp";

const SRC = "assets/logo.png";
const OUT = "public/icons";

const { data, info } = await sharp(SRC).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const { width: W, height: H } = info;
const alpha = (x: number, y: number) => data[(y * W + x) * 4 + 3];
const OPAQUE = 250;

// Caja del cuadro redondeado (píxeles casi opacos) y radio de sus esquinas (por la diagonal).
let minX = W, minY = H, maxX = 0, maxY = 0;
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    if (alpha(x, y) > OPAQUE) {
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    }
  }
}
let d = 0;
while (alpha(minX + d, minY + d) <= OPAQUE) d++;
const radius = d / (1 - Math.SQRT1_2);
const cx = (minX + maxX) / 2;
const cy = (minY + maxY) / 2;
const side = Math.max(maxX - minX, maxY - minY) + 1;

// Versión llena. El fondo del logo es un degradado vertical con viñeta y grano, así que no basta
// con estirar su orilla (quedaría un contorno). Se arma un degradado liso con el color de cada
// renglón cerca de la orilla izquierda y derecha (promediado y suavizado entre renglones), y el
// logo pasa a ese degradado poco a poco en una franja (FEATHER) junto a su borde.
const INSET = Math.round(side * 0.02);
const FEATHER = side * 0.08;
const SAMPLE = 12; // píxeles promediados por lado
const SMOOTH = 16; // renglones de suavizado hacia arriba y abajo

const rawL: number[][] = [];
const rawR: number[][] = [];
for (let y = 0; y < H; y++) {
  const sy = Math.min(maxY - INSET, Math.max(minY + INSET, y));
  let left = minX;
  while (alpha(left, sy) <= OPAQUE) left++;
  let right = maxX;
  while (alpha(right, sy) <= OPAQUE) right--;
  const mean = (from: number) => {
    const sum = [0, 0, 0];
    for (let i = 0; i < SAMPLE; i++) for (let c = 0; c < 3; c++) sum[c] += data[(sy * W + from + i) * 4 + c];
    return sum.map((v) => v / SAMPLE);
  };
  rawL.push(mean(left + INSET));
  rawR.push(mean(right - INSET - SAMPLE + 1));
}
const smooth = (rows: number[][]) =>
  rows.map((_, y) => {
    const sum = [0, 0, 0];
    let n = 0;
    for (let k = Math.max(0, y - SMOOTH); k <= Math.min(H - 1, y + SMOOTH); k++, n++) {
      for (let c = 0; c < 3; c++) sum[c] += rows[k][c];
    }
    return sum.map((v) => v / n);
  });
const bgL = smooth(rawL);
const bgR = smooth(rawR);

// Distancia hacia adentro del cuadro redondeado (negativa afuera).
const hw = (maxX - minX) / 2;
const hh = (maxY - minY) / 2;
function insideDistance(x: number, y: number) {
  const qx = Math.abs(x - cx) - (hw - radius);
  const qy = Math.abs(y - cy) - (hh - radius);
  const outside = Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - radius;
  return -outside;
}

const full = Buffer.alloc(W * H * 4);
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    const t = Math.min(1, Math.max(0, (x - minX) / (maxX - minX)));
    const w = Math.min(1, Math.max(0, insideDistance(x, y) / FEATHER));
    const src = (y * W + x) * 4;
    const a = data[src + 3] / 255;
    for (let c = 0; c < 3; c++) {
      const bg = bgL[y][c] * (1 - t) + bgR[y][c] * t;
      const logo = a * data[src + c] + (1 - a) * bg;
      full[src + c] = Math.round(w * logo + (1 - w) * bg);
    }
    full[src + 3] = 255;
  }
}
const fullImg = () => sharp(full, { raw: { width: W, height: H, channels: 4 } });

/** Cuadro de `scale`× el lado del logo, centrado en él (sin salirse de la imagen). */
function square(scale: number) {
  const s = Math.min(W, H, Math.round(side * scale));
  const left = Math.min(W - s, Math.max(0, Math.round(cx - s / 2)));
  const top = Math.min(H - s, Math.max(0, Math.round(cy - s / 2)));
  return { left, top, width: s, height: s };
}

async function filled(size: number, scale: number, file: string) {
  const buf = await fullImg().extract(square(scale)).resize(size, size).png({ compressionLevel: 9 }).toBuffer();
  await writeFile(file, buf);
  console.log(`✔ ${file}`);
}

/** Redondeada, con `pad` (fracción) de margen transparente alrededor. */
async function rounded(size: number, pad: number, file: string) {
  const box = square(1);
  const inner = Math.round(size * (1 - 2 * pad));
  const r = (radius / box.width) * inner;
  const mask = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${inner}" height="${inner}"><rect width="${inner}" height="${inner}" rx="${r}" ry="${r}"/></svg>`,
  );
  const logo = await fullImg()
    .extract(box)
    .resize(inner, inner)
    .composite([{ input: mask, blend: "dest-in" }])
    .png()
    .toBuffer();
  const offset = Math.round((size - inner) / 2);
  const buf = await sharp({ create: { width: size, height: size, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: logo, left: offset, top: offset }])
    .png({ compressionLevel: 9 })
    .toBuffer();
  await writeFile(file, buf);
  console.log(`✔ ${file}`);
}

await mkdir(OUT, { recursive: true });
await rounded(192, 0.04, `${OUT}/icon-192.png`);
await rounded(512, 0.04, `${OUT}/icon-512.png`);
// Maskable: Android puede recortarlo en círculo; la cartera debe quedar dentro del 80% central.
await filled(512, 1.25, `${OUT}/maskable-512.png`);
await filled(180, 1.04, `${OUT}/apple-touch-icon.png`);
// Favicon (convención de Next: src/app/icon.png).
await rounded(64, 0, "src/app/icon.png");
// Restos del icono anterior (moneda) que ya no se usan.
await rm(`${OUT}/icon.svg`, { force: true });
