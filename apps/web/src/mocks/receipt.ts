/* Seeded receipt images are drawn on a canvas on demand (no third-party photos). */

const FALLBACK_PNG = Uint8Array.from(
  atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII='),
  (c) => c.charCodeAt(0),
);

export async function renderReceiptPng(lines: string[]): Promise<Uint8Array> {
  if (typeof document === 'undefined') return FALLBACK_PNG;
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) return FALLBACK_PNG;
  canvas.width = 360;
  canvas.height = 520;
  ctx.fillStyle = '#fdfdfb';
  ctx.fillRect(0, 0, 360, 520);
  ctx.strokeStyle = '#d9d6cc';
  ctx.setLineDash([4, 4]);
  ctx.strokeRect(12, 12, 336, 496);
  ctx.setLineDash([]);
  ctx.fillStyle = '#1c2321';
  ctx.font = 'bold 18px sans-serif';
  ctx.fillText(lines[0] ?? 'Чек', 28, 56);
  ctx.font = '14px monospace';
  let y = 96;
  for (const line of lines.slice(1, 3)) {
    ctx.fillText(line, 28, y);
    y += 26;
  }
  ctx.fillStyle = '#8a8f8c';
  for (let i = 0; i < 7; i++) {
    ctx.fillRect(28, 170 + i * 32, 180 + ((i * 37) % 90), 10);
    ctx.fillRect(270, 170 + i * 32, 60, 10);
  }
  ctx.fillStyle = '#1c2321';
  ctx.font = 'bold 16px monospace';
  ctx.fillText(lines[3] ?? '', 28, 440);
  ctx.font = '11px sans-serif';
  ctx.fillText('ДЕМО · вымышленный документ', 28, 480);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!blob) return FALLBACK_PNG;
  return new Uint8Array(await blob.arrayBuffer());
}
