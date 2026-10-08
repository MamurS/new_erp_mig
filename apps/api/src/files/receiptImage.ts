/*
 * The picture of a seeded receipt (the seed has its lines, not a photo): a small PNG drawn without an image
 * library — a paper slip with a bar per word, so screens show a receipt-like image instead of an empty one.
 * Deterministic (the same lines give the same bytes); no text is rendered, so no font is needed.
 */
import { deflateSync } from 'node:zlib';

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(b: Uint8Array): number {
  let c = 0xffffffff;
  for (const x of b) c = CRC_TABLE[(c ^ x) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Buffer {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
  return Buffer.concat([head, data, crc]);
}

/** An RGB PNG from a pixel function. */
export function encodePng(
  width: number,
  height: number,
  pixel: (x: number, y: number) => [number, number, number],
): Uint8Array {
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) {
    const row = y * (width * 3 + 1);
    raw[row] = 0;
    for (let x = 0; x < width; x++) {
      const [r, g, b] = pixel(x, y);
      raw[row + 1 + x * 3] = r;
      raw[row + 2 + x * 3] = g;
      raw[row + 3 + x * 3] = b;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // RGB
  return new Uint8Array(
    Buffer.concat([
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
      chunk('IHDR', ihdr),
      chunk('IDAT', deflateSync(raw)),
      chunk('IEND', new Uint8Array(0)),
    ]),
  );
}

const W = 320;
const PAD = 20;
const LINE = 22;
const BAR = 9;
const CHAR = 6;

/** A receipt slip: one row of word bars per line; the first line (the shop) darker, a dashed rule before the total. */
export function receiptPng(lines: readonly string[]): Uint8Array {
  const rows = lines.length ? lines : [''];
  const height = PAD * 2 + rows.length * LINE + 14;
  const bars: { x0: number; x1: number; y0: number; y1: number; shade: number }[] = [];
  rows.forEach((line, i) => {
    const y0 = PAD + i * LINE + (LINE - BAR) / 2;
    let x = PAD;
    const words = line.trim().split(/\s+/).filter(Boolean);
    words.forEach((w, j) => {
      const width = Math.min(W - PAD - x, Math.max(CHAR, w.length * CHAR));
      if (width <= 0) return;
      // Amounts at the end of a line sit on the right edge, as on a till slip.
      const right = j === words.length - 1 && /\d/.test(w) && words.length > 1;
      const x0 = right ? W - PAD - width : x;
      bars.push({ x0, x1: x0 + width, y0, y1: y0 + BAR, shade: i === 0 ? 60 : 130 });
      x += width + CHAR;
    });
  });
  const ruleY = PAD + (rows.length - 1) * LINE;
  return encodePng(W, height, (x, y) => {
    if (x < 2 || x >= W - 2 || y < 2 || y >= height - 2) return [210, 210, 210];
    if (rows.length > 2 && y === ruleY && x >= PAD && x < W - PAD && Math.floor(x / 4) % 2 === 0)
      return [170, 170, 170];
    for (const b of bars)
      if (x >= b.x0 && x < b.x1 && y >= b.y0 && y < b.y1) return [b.shade, b.shade, b.shade];
    return [252, 252, 248];
  });
}
