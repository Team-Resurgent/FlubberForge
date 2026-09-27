// Renders the ported engine to a WAV without a browser, so its spectral
// balance can be measured against a reference recording. The sequencer and the
// wave tables are the real ones; the voice chain mirrors what voices.js builds
// in Web Audio (looping buffer -> ADSR gain -> resonant lowpass).
// Usage: node tools/render-offline.js [out.wav] [seconds]

const fs = require("fs");
const path = require("path");

const www = path.join(__dirname, "..", "www");
const grab = (file, names) =>
  Function(fs.readFileSync(path.join(www, "sound", file), "utf8") + "; return {" + names + "};")();

const { buildSoundWaves } = grab("waves.js", "buildSoundWaves");
const { BootSoundEngine, SND_TICK_MS } = grab("engine.js", "BootSoundEngine, SND_TICK_MS");
const { SOUND_ENVELOPES, envSeconds, envLevel, decaySeconds, SoundVoices } = grab(
  "voices.js",
  "SOUND_ENVELOPES, envSeconds, envLevel, decaySeconds, SoundVoices"
);

const RATE = 48000;
const outFile = process.argv[2] || path.join(__dirname, "..", "analysis", "engine.wav");
const seconds = Number(process.argv[3] || 9.5);

const dataPath = path.join(www, "sound", "bootsound.json");
const data = JSON.parse(fs.readFileSync(dataPath, "utf8"));
const waves = buildSoundWaves();

const tables = {
  sin128: waves.sin128,
  saw128: waves.saw128,
  noise: waves.noise,
  fm: waves.fm,
};
for (const k of Object.keys(data.samples || {})) tables[k] = Int16Array.from(data.samples[k]);

// patches.cpp, same order and loop flags as voices.js.
const PATCHES = [
  { wave: "sin128", loop: true, amp: "env1a" },
  { wave: "saw128", loop: true, amp: "sawEnv1a" },
  { wave: "saw128", loop: true, amp: "env3a" },
  { wave: "saw128", loop: true, amp: "sawEnv2a" },
  { wave: "saw128", loop: true, amp: "env3a" },
  { wave: "noise", loop: true, amp: "noiseEnv1a" },
  { wave: "glock", loop: false, amp: "openA" },
  { wave: "bubble", loop: true, amp: "openA" },
  { wave: "fm", loop: false, amp: "openA" },
  { wave: "thunel16", loop: false, amp: "openA" },
  { wave: "revthun", loop: false, amp: "openA" },
];

function levelFor(opLevel) {
  const mB = -1 * (opLevel & 0xff) * 30 + 200;
  const clamped = Math.max(-10000, Math.min(0, mB));
  return Math.pow(10, (clamped - 600) / 2000);
}

function cutoffHz(cutoff) {
  const cents = (cutoff << 16) >> 16;
  return Math.max(30, Math.min(20000, 8.176 * Math.pow(2, cents / 1200)));
}

// vp_filter always passes dwQCoefficient 0, which the filter table maps to Q=1.
function resQ() {
  return 1;
}

class Channel {
  constructor() {
    this.patch = 0;
    this.volume = 0;
    this.rate = 1;
    this.phase = 0;
    this.table = null;
    this.loop = false;
    this.env = null;
    this.stage = "off";
    this.level = 0;
    this.stageLeft = 0;
    this.peak = 1;
    this.cut = 20000;
    this.q = 0.707;
    this.z1 = 0;
    this.z2 = 0;
    this.coef = null;
  }

  updateFilter() {
    // RBJ lowpass, recomputed when the sequence moves the cutoff.
    const w0 = (2 * Math.PI * this.cut) / RATE;
    const alpha = Math.sin(w0) / (2 * this.q);
    const cw = Math.cos(w0);
    const b1 = 1 - cw;
    const b0 = b1 / 2;
    const a0 = 1 + alpha;
    this.coef = {
      b0: b0 / a0,
      b1: b1 / a0,
      b2: b0 / a0,
      a1: (-2 * cw) / a0,
      a2: (1 - alpha) / a0,
    };
  }
}

const chanEnergy = new Float64Array(16);
const patchEnergy = {};
const channels = [];
for (let i = 0; i < 16; i++) {
  const c = new Channel();
  c.index = i;
  c.updateFilter();
  channels.push(c);
}

function startStage(c, stage) {
  const e = c.env;
  c.stage = stage;
  if (stage === "attack") c.stageLeft = envSeconds(e.attack) * RATE;
  else if (stage === "hold") c.stageLeft = envSeconds(e.hold) * RATE;
  else if (stage === "decay") c.stageLeft = decaySeconds(e) * RATE;
  else if (stage === "release") c.stageLeft = envSeconds(e.release) * RATE;
}

const voices = {
  noteOn(chan, value16) {
    const c = channels[chan];
    const p = PATCHES[c.patch];
    const table = p && tables[p.wave];
    if (!table) return;
    c.table = table;
    c.loop = p.loop;
    c.env = SOUND_ENVELOPES[p.amp] || SOUND_ENVELOPES.openA;
    c.rate = Math.pow(2, SoundVoices.pitchUnits(value16) / 4096);
    c.phase = 0;
    c.peak = levelFor(c.volume);
    c.level = 0;
    startStage(c, "attack");
  },
  slur(chan, value16) {
    channels[chan].rate = Math.pow(2, SoundVoices.pitchUnits(value16) / 4096);
  },
  noteOff(chan) {
    const c = channels[chan];
    if (c.stage === "off") return;
    startStage(c, "release");
  },
  setPatch(chan, pat) {
    channels[chan].patch = pat;
    channels[chan].volume = 0;
  },
  setPan() {},
  setVolume(chan, v) {
    const c = channels[chan];
    c.volume = v;
    c.peak = levelFor(v);
  },
  setFilter(chan, cut, res) {
    const c = channels[chan];
    c.cut = cutoffHz(cut);
    c.q = resQ(res);
    c.updateFilter();
  },
  allOff() {
    for (const c of channels) c.stage = "off";
  },
  stop() {},
};

const engine = new BootSoundEngine(voices, data);
engine.start();

const total = Math.round(seconds * RATE);
const out = new Float32Array(total);
const perTick = Math.round((RATE * SND_TICK_MS) / 1000);

let written = 0;
while (written < total) {
  engine.tick();
  const n = Math.min(perTick, total - written);
  for (const c of channels) {
    if (c.stage === "off" || !c.table) continue;
    const e = c.env;
    const sus = envLevel(e.sustain);
    for (let i = 0; i < n; i++) {
      // Envelope.
      if (c.stage === "attack") {
        c.level = c.stageLeft > 0 ? c.level + (c.peak - c.level) / Math.max(1, c.stageLeft) : c.peak;
        if (--c.stageLeft <= 0) startStage(c, "hold");
      } else if (c.stage === "hold") {
        c.level = c.peak;
        if (--c.stageLeft <= 0) startStage(c, "decay");
      } else if (c.stage === "decay") {
        const target = c.peak * sus;
        c.level = c.stageLeft > 0 ? c.level + (target - c.level) / Math.max(1, c.stageLeft) : target;
        if (--c.stageLeft <= 0) c.stage = "sustain";
      } else if (c.stage === "sustain") {
        c.level = c.peak * sus;
      } else if (c.stage === "release") {
        c.level = c.stageLeft > 0 ? c.level - c.level / Math.max(1, c.stageLeft) : 0;
        if (--c.stageLeft <= 0) {
          c.stage = "off";
          c.level = 0;
        }
      }

      // Linear-interpolated table read.
      let s = 0;
      const len = c.table.length;
      if (c.phase < len || c.loop) {
        const idx = c.loop ? c.phase % len : c.phase;
        const i0 = Math.floor(idx);
        const i1 = c.loop ? (i0 + 1) % len : Math.min(i0 + 1, len - 1);
        const f = idx - i0;
        s = ((c.table[i0] * (1 - f) + c.table[i1] * f) / 32768) * c.level;
      }
      c.phase += c.rate;
      if (c.loop) c.phase %= len;

      // Biquad.
      const k = c.coef;
      const y = k.b0 * s + c.z1;
      c.z1 = k.b1 * s - k.a1 * y + c.z2;
      c.z2 = k.b2 * s - k.a2 * y;
      out[written + i] += y;
      chanEnergy[c.index] += y * y;
      patchEnergy[c.patch] = (patchEnergy[c.patch] || 0) + y * y;
    }
  }
  written += n;
}

let peak = 0;
for (let i = 0; i < total; i++) peak = Math.max(peak, Math.abs(out[i]));
console.log("peak before normalise: " + peak.toFixed(3));

const totalEnergy = chanEnergy.reduce((a, b) => a + b, 0) || 1;
console.log("energy share by channel:");
chanEnergy.forEach((e, i) => {
  if (e / totalEnergy > 0.005) console.log("  ch" + i + "  " + ((e / totalEnergy) * 100).toFixed(1) + "%");
});
const names = ["sin", "saw1", "square", "saw2", "saw3", "noise", "glock", "bubble", "fm", "thun", "revthun"];
console.log("energy share by patch:");
Object.keys(patchEnergy)
  .sort((a, b) => patchEnergy[b] - patchEnergy[a])
  .forEach((p) => {
    const pct = (patchEnergy[p] / totalEnergy) * 100;
    if (pct > 0.5) console.log("  " + p + " " + (names[p] || "?") + "  " + pct.toFixed(1) + "%");
  });

const pcm = Buffer.alloc(total * 2);
for (let i = 0; i < total; i++) {
  const v = Math.max(-1, Math.min(1, out[i]));
  pcm.writeInt16LE((v * 32767) | 0, i * 2);
}

const header = Buffer.alloc(44);
header.write("RIFF", 0);
header.writeUInt32LE(36 + pcm.length, 4);
header.write("WAVE", 8);
header.write("fmt ", 12);
header.writeUInt32LE(16, 16);
header.writeUInt16LE(1, 20);
header.writeUInt16LE(1, 22);
header.writeUInt32LE(RATE, 24);
header.writeUInt32LE(RATE * 2, 28);
header.writeUInt16LE(2, 32);
header.writeUInt16LE(16, 34);
header.write("data", 36);
header.writeUInt32LE(pcm.length, 40);

fs.mkdirSync(path.dirname(outFile), { recursive: true });
fs.writeFileSync(outFile, Buffer.concat([header, pcm]));
console.log("wrote " + outFile + " (" + seconds + "s)");
