/**
 * アイコン生成（外部ライブラリなし。node:zlib だけでPNGを書き出す）
 *   npm run icons
 * 丸太の木口（年輪）をモチーフにしたTERRAブランドアイコンを描く。
 */
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'icons');
mkdirSync(OUT, { recursive: true });

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = -1;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function encodePng(width, height, rgba) {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0; // フィルタなし
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;   // bit depth
  ihdr[9] = 6;   // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const BG = hex('#1f6b2d');       // ブランドの森緑
const WOOD_LIGHT = hex('#f2d9a8');
const WOOD_DARK = hex('#c8994f');
const BARK = hex('#5a3a1c');
const HEART = hex('#ff8a00');    // 髄＝アクセント色

/**
 * @param {number} size 出力サイズ
 * @param {boolean} maskable maskable用に図案を内側80%へ収める
 */
function draw(size, maskable) {
  const buf = Buffer.alloc(size * size * 4);
  const cx = size / 2;
  const cy = size / 2;
  // maskable はセーフゾーン(中心80%)内に収める必要がある
  const outer = size * (maskable ? 0.34 : 0.42);
  const corner = size * 0.22;

  const put = (x, y, [r, g, b], a = 255) => {
    const i = (y * size + x) * 4;
    buf[i] = r; buf[i + 1] = g; buf[i + 2] = b; buf[i + 3] = a;
  };

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      // 角丸の背景
      const dxE = Math.max(corner - x, x - (size - 1 - corner), 0);
      const dyE = Math.max(corner - y, y - (size - 1 - corner), 0);
      const inBg = maskable ? true : Math.hypot(dxE, dyE) <= corner;
      if (!inBg) { put(x, y, BG, 0); continue; }
      put(x, y, BG);

      // 丸太の木口（年輪）
      const d = Math.hypot(x - cx + 0.5, y - cy + 0.5);
      if (d > outer) continue;
      if (d > outer * 0.88) { put(x, y, BARK); continue; }   // 樹皮
      if (d < outer * 0.09) { put(x, y, HEART); continue; }  // 髄
      const ring = Math.sin(d / outer * Math.PI * 9);
      put(x, y, ring > 0 ? WOOD_LIGHT : WOOD_DARK);
    }
  }
  return encodePng(size, size, buf);
}

writeFileSync(join(OUT, 'icon-192.png'), draw(192, false));
writeFileSync(join(OUT, 'icon-512.png'), draw(512, false));
writeFileSync(join(OUT, 'icon-maskable-512.png'), draw(512, true));

// ベクタ版（対応ブラウザではこちらが使われる）
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <rect width="512" height="512" rx="112" fill="#1f6b2d"/>
  <circle cx="256" cy="256" r="215" fill="#5a3a1c"/>
  <circle cx="256" cy="256" r="190" fill="#f2d9a8"/>
  <g fill="none" stroke="#c8994f" stroke-width="16">
    <circle cx="256" cy="256" r="160"/>
    <circle cx="256" cy="256" r="122"/>
    <circle cx="256" cy="256" r="84"/>
    <circle cx="256" cy="256" r="46"/>
  </g>
  <circle cx="256" cy="256" r="20" fill="#ff8a00"/>
</svg>
`;
writeFileSync(join(OUT, 'icon.svg'), svg);

console.log('icons written to', OUT);
