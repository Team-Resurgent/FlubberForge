// Draws the app icon and writes a multi-resolution assets/app.ico plus a PNG
// preview. Run it only when the mark changes; the .ico is committed.
//
// The mark is an original one: the glowing blob suspended in its dark chamber,
// with the same kind of lumpy outline the animation's blob has.
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

const SIZES = [16, 24, 32, 48, 64, 128, 256];
const OUT_DIR = path.join(__dirname, "..", "assets");

// ---------------------------------------------------------------- drawing

function clamp01(x) {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

function mix(a, b, t) {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

// Lumpy radius, the same trick the blob itself uses: a base circle with a few
// harmonics stacked on top so the silhouette reads as organic, not round.
function blobRadius(theta) {
  return (
    0.46 *
    (1 + 0.1 * Math.sin(3 * theta + 0.7) + 0.07 * Math.sin(5 * theta - 1.2) + 0.045 * Math.sin(7 * theta + 2.1))
  );
}

// Signed-distance-ish helper for the rounded square the blob sits in.
function roundedBox(x, y, half, radius) {
  const dx = Math.abs(x) - (half - radius);
  const dy = Math.abs(y) - (half - radius);
  const ax = Math.max(dx, 0);
  const ay = Math.max(dy, 0);
  return Math.hypot(ax, ay) + Math.min(Math.max(dx, dy), 0) - radius;
}

// One sample, in normalised coordinates where the icon spans -1..1.
// Returns premultiplied-free [r, g, b, a] in 0..1.
function sample(x, y) {
  const box = roundedBox(x, y, 0.98, 0.3);
  if (box > 0) return [0, 0, 0, 0];

  // Chamber: near-black, lifting very slightly towards the bottom so the
  // icon does not look like a flat hole on a dark taskbar.
  const base = mix([0.035, 0.055, 0.035], [0.02, 0.03, 0.02], clamp01(0.5 - y * 0.5));

  // The blob's own light filling the chamber.
  const gd = Math.hypot(x, y + 0.04);
  const glow = Math.exp(-gd * gd * 5.2);
  let rgb = [
    base[0] + glow * 0.22,
    base[1] + glow * 0.78,
    base[2] + glow * 0.16,
  ];

  // Blob body.
  const theta = Math.atan2(y, x);
  const r = Math.hypot(x, y);
  const edge = blobRadius(theta);
  if (r <= edge) {
    // Hot core offset up and left, falling off to the shield green at the rim.
    const hd = Math.hypot(x + 0.13, y + 0.15);
    const t = clamp01(hd / 0.62);
    const body = mix([0.96, 1.0, 0.94], [0.25, 1.0, 0.15], t * t);
    // Let the rim darken a touch so the silhouette stays readable.
    const rim = clamp01((edge - r) / 0.09);
    rgb = mix(mix(rgb, [0.16, 0.72, 0.1], 0.85), body, rim);
  }

  // Antialias the outer rounded square over roughly one pixel.
  const a = clamp01(-box / 0.012);
  return [clamp01(rgb[0]), clamp01(rgb[1]), clamp01(rgb[2]), a];
}

function render(size) {
  const ss = size >= 128 ? 3 : 4; // supersampling factor
  const px = Buffer.alloc(size * size * 4);
  const step = 2 / (size * ss);
  for (let py = 0; py < size; py++) {
    for (let pxi = 0; pxi < size; pxi++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let sy = 0; sy < ss; sy++) {
        for (let sx = 0; sx < ss; sx++) {
          const x = -1 + (pxi * ss + sx + 0.5) * step;
          const y = -1 + (py * ss + sy + 0.5) * step;
          const s = sample(x, y);
          r += s[0] * s[3];
          g += s[1] * s[3];
          b += s[2] * s[3];
          a += s[3];
        }
      }
      const n = ss * ss;
      const o = (py * size + pxi) * 4;
      // Un-premultiply so the PNG keeps clean edge colour.
      const av = a / n;
      px[o] = Math.round((av > 0 ? r / a : 0) * 255);
      px[o + 1] = Math.round((av > 0 ? g / a : 0) * 255);
      px[o + 2] = Math.round((av > 0 ? b / a : 0) * 255);
      px[o + 3] = Math.round(av * 255);
    }
  }
  return px;
}

// ---------------------------------------------------------------- encoding

let CRC_TABLE = null;
function crc32(buf) {
  if (!CRC_TABLE) {
    CRC_TABLE = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      CRC_TABLE[n] = c;
    }
  }
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function pngChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function encodePng(size, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0; // filter: none
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

// Classic DIB entry: BITMAPINFOHEADER, bottom-up BGRA, then a 1bpp AND mask.
// Used for the small sizes, which the shell still reads more reliably as DIB.
function encodeDib(size, rgba) {
  const header = Buffer.alloc(40);
  header.writeUInt32LE(40, 0);
  header.writeInt32LE(size, 4);
  header.writeInt32LE(size * 2, 8); // XOR + AND stacked
  header.writeUInt16LE(1, 12);
  header.writeUInt16LE(32, 14);
  const maskStride = ((size + 31) >> 5) * 4;
  header.writeUInt32LE(size * size * 4 + maskStride * size, 20);

  const xor = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    const src = (size - 1 - y) * size * 4;
    for (let x = 0; x < size; x++) {
      const s = src + x * 4;
      const d = (y * size + x) * 4;
      xor[d] = rgba[s + 2];
      xor[d + 1] = rgba[s + 1];
      xor[d + 2] = rgba[s];
      xor[d + 3] = rgba[s + 3];
    }
  }
  // Alpha carries the shape, so the legacy mask stays fully opaque.
  return Buffer.concat([header, xor, Buffer.alloc(maskStride * size)]);
}

function buildIco(entries) {
  const head = Buffer.alloc(6 + entries.length * 16);
  head.writeUInt16LE(0, 0);
  head.writeUInt16LE(1, 2); // type: icon
  head.writeUInt16LE(entries.length, 4);
  let offset = head.length;
  entries.forEach((e, i) => {
    const o = 6 + i * 16;
    head[o] = e.size >= 256 ? 0 : e.size;
    head[o + 1] = e.size >= 256 ? 0 : e.size;
    head.writeUInt16LE(1, o + 4);
    head.writeUInt16LE(32, o + 6);
    head.writeUInt32LE(e.data.length, o + 8);
    head.writeUInt32LE(offset, o + 12);
    offset += e.data.length;
  });
  return Buffer.concat([head, ...entries.map((e) => e.data)]);
}

// ---------------------------------------------------------------- main

fs.mkdirSync(OUT_DIR, { recursive: true });

const entries = SIZES.map((size) => {
  const rgba = render(size);
  return { size, data: size >= 128 ? encodePng(size, rgba) : encodeDib(size, rgba) };
});

const ico = buildIco(entries);
fs.writeFileSync(path.join(OUT_DIR, "app.ico"), ico);

const preview = render(256);
fs.writeFileSync(path.join(OUT_DIR, "app.png"), encodePng(256, preview));

console.log("app.ico " + ico.length + " bytes, sizes " + SIZES.join("/"));
