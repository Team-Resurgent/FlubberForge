// Feature extraction for comparing the ported synth against a reference
// recording. Reports per-chunk loudness, spectral centroid and the share of
// energy in each band, which is what tells us whether the balance is bassy or
// bright. Usage: node tools/spectral.js <file.wav> [chunkMs]

const fs = require("fs");

function readWav(file) {
  const buf = fs.readFileSync(file);
  if (buf.toString("ascii", 0, 4) !== "RIFF") throw new Error("not a RIFF file");
  let pos = 12;
  let fmt = null;
  let data = null;
  while (pos + 8 <= buf.length) {
    const id = buf.toString("ascii", pos, pos + 4);
    const size = buf.readUInt32LE(pos + 4);
    const body = pos + 8;
    if (id === "fmt ") {
      fmt = {
        format: buf.readUInt16LE(body),
        channels: buf.readUInt16LE(body + 2),
        rate: buf.readUInt32LE(body + 4),
        bits: buf.readUInt16LE(body + 14),
      };
    } else if (id === "data") {
      data = buf.subarray(body, body + size);
    }
    pos = body + size + (size & 1);
  }
  if (!fmt || !data) throw new Error("missing fmt or data chunk");
  if (fmt.bits !== 16) throw new Error("expected 16-bit PCM, got " + fmt.bits);
  const n = Math.floor(data.length / 2 / fmt.channels);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let acc = 0;
    for (let c = 0; c < fmt.channels; c++) acc += data.readInt16LE((i * fmt.channels + c) * 2);
    out[i] = acc / fmt.channels / 32768;
  }
  return { rate: fmt.rate, samples: out };
}

// Iterative radix-2 FFT, in place on separate real/imag arrays.
function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const ur = re[i + k];
        const ui = im[i + k];
        const vr = re[i + k + len / 2] * cr - im[i + k + len / 2] * ci;
        const vi = re[i + k + len / 2] * ci + im[i + k + len / 2] * cr;
        re[i + k] = ur + vr;
        im[i + k] = ui + vi;
        re[i + k + len / 2] = ur - vr;
        im[i + k + len / 2] = ui - vi;
        const ncr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = ncr;
      }
    }
  }
}

const BANDS = [
  ["sub 20-60", 20, 60],
  ["bass 60-160", 60, 160],
  ["lowmid 160-400", 160, 400],
  ["mid 400-1k", 400, 1000],
  ["hi 1k-4k", 1000, 4000],
  ["air 4k+", 4000, 20000],
];

function analyze(file, chunkMs) {
  const { rate, samples } = readWav(file);
  const chunk = Math.round((rate * chunkMs) / 1000);
  let size = 1;
  while (size < chunk) size <<= 1;

  const rows = [];
  for (let start = 0; start + chunk <= samples.length; start += chunk) {
    const re = new Float64Array(size);
    const im = new Float64Array(size);
    let sum = 0;
    for (let i = 0; i < chunk; i++) {
      const s = samples[start + i];
      sum += s * s;
      // Hann window, so the band split is not smeared by chunk edges.
      re[i] = s * 0.5 * (1 - Math.cos((2 * Math.PI * i) / (chunk - 1)));
    }
    fft(re, im);

    const bands = new Array(BANDS.length).fill(0);
    let total = 0;
    let weighted = 0;
    for (let k = 1; k < size / 2; k++) {
      const hz = (k * rate) / size;
      const mag = Math.sqrt(re[k] * re[k] + im[k] * im[k]);
      const p = mag * mag;
      total += p;
      weighted += p * hz;
      for (let b = 0; b < BANDS.length; b++) {
        if (hz >= BANDS[b][1] && hz < BANDS[b][2]) bands[b] += p;
      }
    }
    rows.push({
      t: start / rate,
      rms: Math.sqrt(sum / chunk),
      centroid: total > 0 ? weighted / total : 0,
      shares: bands.map((b) => (total > 0 ? b / total : 0)),
    });
  }
  return rows;
}

const file = process.argv[2];
const chunkMs = Number(process.argv[3] || 250);
if (!file) {
  console.error("usage: node tools/spectral.js <file.wav> [chunkMs]");
  process.exit(1);
}

const rows = analyze(file, chunkMs);
const pad = (s, n) => String(s).padStart(n);
console.log(file + "  (" + chunkMs + " ms chunks)");
console.log(
  pad("t", 6) + pad("dBFS", 8) + pad("centroid", 10) + BANDS.map((b) => pad(b[0], 16)).join("")
);
for (const r of rows) {
  const db = r.rms > 0 ? 20 * Math.log10(r.rms) : -99;
  console.log(
    pad(r.t.toFixed(2), 6) +
      pad(db.toFixed(1), 8) +
      pad(r.centroid.toFixed(0) + "Hz", 10) +
      r.shares.map((s) => pad((s * 100).toFixed(1) + "%", 16)).join("")
  );
}

const loud = rows.filter((r) => r.rms > 0.01);
if (loud.length) {
  const avg = BANDS.map((_, b) => loud.reduce((a, r) => a + r.shares[b], 0) / loud.length);
  const cen = loud.reduce((a, r) => a + r.centroid, 0) / loud.length;
  console.log("\nover " + loud.length + " audible chunks:");
  console.log("  mean centroid " + cen.toFixed(0) + " Hz");
  BANDS.forEach((b, i) => console.log("  " + b[0].padEnd(16) + (avg[i] * 100).toFixed(1) + "%"));
}
