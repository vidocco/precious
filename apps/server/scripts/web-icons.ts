/**
 * Makes the web app's install icons from the logo (the golden ring): run once after changing the logo
 * (node scripts/web-icons.ts). The PNGs are committed, so builds don't need sharp.
 */
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import sharp from 'sharp';

const out = resolve(import.meta.dirname, '../../web/public/icons');
const BG = '#16181d';
const GILT = '#d9b25c';
// The ring from favicon.svg ("my precious"), drawn on a 32-unit grid.
const ring = `<defs><linearGradient id="gold" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#f7e09a"/><stop offset=".45" stop-color="${GILT}"/><stop offset="1" stop-color="#9c6f22"/></linearGradient></defs><circle cx="16" cy="16" r="8.6" fill="none" stroke="url(#gold)" stroke-width="4.2"/><path d="M9.6 12.2a7.4 7.4 0 0 1 6.4-3.6" fill="none" stroke="#fff6d6" stroke-opacity=".55" stroke-width="1.1" stroke-linecap="round"/>`;

/** `pad` is the share of the icon left around the ring: maskable icons need a wide safe zone. */
const svg = (pad: number, rounded: boolean) => {
  const scale = 1 - pad * 2;
  const offset = 16 - 16 * scale;
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" ${rounded ? 'rx="7"' : ''} fill="${BG}"/><g transform="translate(${offset} ${offset}) scale(${scale})">${ring}</g></svg>`,
  );
};

await mkdir(out, { recursive: true });
const jobs: [string, number, number, boolean][] = [
  ['icon-192.png', 192, 0.06, false],
  ['icon-512.png', 512, 0.06, false],
  ['maskable-512.png', 512, 0.2, false],
  ['apple-touch-icon.png', 180, 0.12, false],
];
for (const [name, size, pad, rounded] of jobs) {
  await sharp(svg(pad, rounded), { density: (size / 32) * 72 })
    .resize(size, size)
    .png()
    .toFile(resolve(out, name));
  console.log('wrote', name);
}
