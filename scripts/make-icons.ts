/**
 * Genere les icones PWA (PNG) sans dependance externe : petit rasteriseur
 * de cercles et de capsules, puis encodage PNG via zlib.
 *
 *   npm run make-icons
 */
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');

type RGB = [number, number, number];

interface Circle { kind: 'circle'; x: number; y: number; r: number; color: RGB }
interface Capsule { kind: 'capsule'; x1: number; y1: number; x2: number; y2: number; r: number; color: RGB }
type Shape = Circle | Capsule;

const WOOD: RGB = [228, 168, 83];
const JOINT: RGB = [139, 90, 43];
const WHITE: RGB = [255, 255, 255];
const PUPIL: RGB = [42, 42, 42];

/** Mannequin desarticule, en coordonnees normalisees 0..1. */
const SHAPES: Shape[] = [
  { kind: 'capsule', x1: 0.16, y1: 0.30, x2: 0.34, y2: 0.20, r: 0.045, color: WOOD },
  { kind: 'capsule', x1: 0.34, y1: 0.20, x2: 0.50, y2: 0.26, r: 0.042, color: WOOD },
  { kind: 'circle', x: 0.34, y: 0.20, r: 0.048, color: JOINT },

  { kind: 'capsule', x1: 0.30, y1: 0.55, x2: 0.30, y2: 0.72, r: 0.052, color: WOOD },
  { kind: 'capsule', x1: 0.30, y1: 0.72, x2: 0.24, y2: 0.88, r: 0.048, color: WOOD },
  { kind: 'circle', x: 0.30, y: 0.72, r: 0.054, color: JOINT },

  { kind: 'capsule', x1: 0.55, y1: 0.56, x2: 0.62, y2: 0.74, r: 0.052, color: WOOD },
  { kind: 'capsule', x1: 0.62, y1: 0.74, x2: 0.74, y2: 0.86, r: 0.048, color: WOOD },
  { kind: 'circle', x: 0.62, y: 0.74, r: 0.054, color: JOINT },

  { kind: 'capsule', x1: 0.34, y1: 0.44, x2: 0.56, y2: 0.50, r: 0.105, color: WOOD },
  { kind: 'circle', x: 0.30, y: 0.55, r: 0.055, color: JOINT },
  { kind: 'circle', x: 0.55, y: 0.56, r: 0.055, color: JOINT },

  { kind: 'capsule', x1: 0.62, y1: 0.30, x2: 0.80, y2: 0.36, r: 0.042, color: WOOD },
  { kind: 'capsule', x1: 0.80, y1: 0.36, x2: 0.88, y2: 0.52, r: 0.040, color: WOOD },
  { kind: 'circle', x: 0.80, y: 0.36, r: 0.046, color: JOINT },

  { kind: 'circle', x: 0.66, y: 0.24, r: 0.115, color: WOOD },
  { kind: 'circle', x: 0.625, y: 0.215, r: 0.033, color: WHITE },
  { kind: 'circle', x: 0.705, y: 0.215, r: 0.033, color: WHITE },
  { kind: 'circle', x: 0.628, y: 0.218, r: 0.016, color: PUPIL },
  { kind: 'circle', x: 0.708, y: 0.218, r: 0.016, color: PUPIL },
];

function distanceToSegment(px: number, py: number, x1: number, y1: number, x2: number, y2: number): number {
  const dx = x2 - x1, dy = y2 - y1;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / len2));
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}

function render(size: number, rounded: boolean): Buffer {
  const pixels = Buffer.alloc(size * size * 4);
  const ss = 2; // 2x2 suraechantillonnage

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < ss; sy++) {
        for (let sx = 0; sx < ss; sx++) {
          const u = (x + (sx + 0.5) / ss) / size;
          const v = (y + (sy + 0.5) / ss) / size;

          // Fond : degrade bleu tres clair vers blanc.
          let cr = 219 + (255 - 219) * v;
          let cg = 236 + (255 - 236) * v;
          let cb = 250 + (255 - 250) * v;
          let ca = 255;

          if (rounded) {
            // Coins arrondis facon icone iOS.
            const k = 0.22;
            const cx = Math.min(u, 1 - u);
            const cy = Math.min(v, 1 - v);
            if (cx < k && cy < k && Math.hypot(k - cx, k - cy) > k) ca = 0;
          }

          for (const shape of SHAPES) {
            const d = shape.kind === 'circle'
              ? Math.hypot(u - shape.x, v - shape.y) - shape.r
              : distanceToSegment(u, v, shape.x1, shape.y1, shape.x2, shape.y2) - shape.r;
            if (d <= 0) {
              [cr, cg, cb] = shape.color;
            }
          }
          r += cr; g += cg; b += cb; a += ca;
        }
      }
      const n = ss * ss;
      const i = (y * size + x) * 4;
      pixels[i] = Math.round(r / n);
      pixels[i + 1] = Math.round(g / n);
      pixels[i + 2] = Math.round(b / n);
      pixels[i + 3] = Math.round(a / n);
    }
  }
  return pixels;
}

/* -------------------------------------------------------------- Encodage PNG */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

function encodePng(size: number, pixels: Buffer): Buffer {
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0; // filtre None
    pixels.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;   // profondeur
  ihdr[9] = 6;   // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const out = resolve(root, 'public/icons');
mkdirSync(out, { recursive: true });

for (const [name, size, rounded] of [
  ['icon-512.png', 512, false],
  ['icon-192.png', 192, false],
  ['apple-touch-icon.png', 180, false],
  ['maskable-512.png', 512, true],
] as const) {
  const png = encodePng(size, render(size, rounded));
  writeFileSync(resolve(out, name), png);
  console.log(`${name.padEnd(22)} ${size}x${size}  ${(png.length / 1024).toFixed(1)} Ko`);
}
