// Draws the synthetic avatars as real PNG files: src/avatars/<id>.png and unknown.png.
// No faces, no third-party assets: a colored background and a person shape.
// Run again after you change CONTACTS: `bun run avatars`.
import { mkdirSync, writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";
import { AVATAR_PX, CONTACTS, UNKNOWN } from "../src/contacts.js";

const OUT = new URL("../src/avatars/", import.meta.url);
const SS = 4; // supersampling per axis, for smooth edges

const CRC = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(w, h, rgb) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0;
    rgb.copy(raw, y * (w * 3 + 1) + 1, y * w * 3, (y + 1) * w * 3);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);

// Per-contact variation, so each avatar is a different picture.
function shapes(c, i) {
  const base = hex(c.color);
  return {
    top: mix(base, [255, 255, 255], 0.35),
    bottom: mix(base, [0, 0, 0], 0.25),
    skin: [[241, 205, 178], [224, 172, 138], [198, 134, 98], [141, 85, 54], [233, 190, 160]][i % 5],
    hair: [[52, 36, 28], [196, 150, 80], [28, 28, 32], [120, 62, 36], [90, 90, 96]][i % 5],
    shirt: mix(base, [255, 255, 255], 0.75),
    long: i % 2 === 0,
  };
}

function draw(s) {
  const N = AVATAR_PX;
  const rgb = Buffer.alloc(N * N * 3);
  for (let y = 0; y < N; y++)
    for (let x = 0; x < N; x++) {
      const acc = [0, 0, 0];
      for (let sy = 0; sy < SS; sy++)
        for (let sx = 0; sx < SS; sx++) {
          const u = (x + (sx + 0.5) / SS) / N, v = (y + (sy + 0.5) / SS) / N;
          let col = mix(s.top, s.bottom, v);
          const inEllipse = (cx, cy, rx, ry) => ((u - cx) / rx) ** 2 + ((v - cy) / ry) ** 2 <= 1;
          if (s.long && inEllipse(0.5, 0.5, 0.25, 0.3) && v > 0.3) col = s.hair;
          if (inEllipse(0.5, 0.68, 0.07, 0.13)) col = mix(s.skin, [0, 0, 0], 0.12);
          if (inEllipse(0.5, 1.08, 0.38, 0.32)) col = mix(s.shirt, s.bottom, (v - 0.78) * 0.8);
          if (inEllipse(0.5, 0.45, 0.17, 0.2)) {
            const shade = Math.max(0, (u - 0.42) * 0.5);
            col = mix(s.skin, [0, 0, 0], shade);
          }
          if (inEllipse(0.5, 0.33, 0.19, 0.12) && v < 0.36) col = s.hair;
          acc[0] += col[0]; acc[1] += col[1]; acc[2] += col[2];
        }
      const o = (y * N + x) * 3;
      for (let k = 0; k < 3; k++) rgb[o + k] = Math.round(acc[k] / (SS * SS));
    }
  return png(N, N, rgb);
}

mkdirSync(OUT, { recursive: true });
CONTACTS.forEach((c, i) => writeFileSync(new URL(`${c.id}.png`, OUT), draw(shapes(c, i))));
const gray = { top: [214, 214, 210], bottom: [176, 176, 172], skin: [236, 236, 233], hair: [236, 236, 233], shirt: [236, 236, 233], long: false };
writeFileSync(new URL("unknown.png", OUT), draw(gray));
console.log(`Wrote ${CONTACTS.length + 1} PNG files (${AVATAR_PX} × ${AVATAR_PX}) to ${OUT.pathname}`);
