/**
 * Makes the web app's install icons from the logo: run once after changing the logo
 * (node scripts/web-icons.ts). The PNGs are committed, so builds don't need sharp.
 */
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import sharp from 'sharp';

const out = resolve(import.meta.dirname, '../../web/public/icons');
const BG = '#16181d';
const GILT = '#d9b25c';
// The gem from favicon.svg, drawn on a 32-unit grid.
const gem = `<path d="M16 6 25 13 16 26 7 13Z" fill="none" stroke="${GILT}" stroke-width="2.2" stroke-linejoin="round"/><path d="M7 13h18M12 13l4 13 4-13M12 13l4-7 4 7" fill="none" stroke="${GILT}" stroke-width="1.2" stroke-linejoin="round"/>`;

/** `pad` is the share of the icon left around the gem: maskable icons need a wide safe zone. */
const svg = (pad: number, rounded: boolean) => {
  const scale = 1 - pad * 2;
  const offset = 16 - 16 * scale;
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" ${rounded ? 'rx="7"' : ''} fill="${BG}"/><g transform="translate(${offset} ${offset + 0.6 * scale}) scale(${scale})">${gem}</g></svg>`,
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
