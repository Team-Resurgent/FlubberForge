// Dry-runs the sequencer against the converted data with a stub voice layer,
// so the opcode interpreter can be checked without an audio device.
const fs = require("fs");
const path = require("path");

const www = path.join(__dirname, "..", "www");
// eval keeps class and const declarations in its own scope, so hand the two
// symbols the harness needs back out explicitly.
const engineSrc = fs.readFileSync(path.join(www, "sound", "engine.js"), "utf8");
const { BootSoundEngine, SND_TICK_MS } = Function(
  engineSrc + "; return { BootSoundEngine, SND_TICK_MS };"
)();

const dataPath = path.join(www, "sound", "bootsound.json");
if (!fs.existsSync(dataPath)) {
  console.log("no bootsound.json - run tools/extract-sound.js first");
  process.exit(0);
}
const data = JSON.parse(fs.readFileSync(dataPath, "utf8"));

let ticks = 0;
const log = [];
const chanPatch = {};
const cutoffs = [];
const resos = new Set();
const counts = { noteOn: 0, noteOff: 0, slur: 0, patch: 0, filter: 0, volume: 0 };
const pitches = new Set();
const patches = new Set();
const stub = {
  noteOn: (c, p) => {
    counts.noteOn++;
    pitches.add(p >> 8);
    log.push({ tick: ticks, chan: c, note: p >> 8, frac: p & 0xff, patch: chanPatch[c] });
  },
  noteOff: (c) => {
    counts.noteOff++;
    log.push({ tick: ticks, chan: c, off: true, patch: chanPatch[c] });
  },
  slur: () => counts.slur++,
  setPatch: (c, p) => {
    counts.patch++;
    patches.add(p);
    chanPatch[c] = p;
  },
  setPan: () => {},
  setVolume: (c, v) => {
    counts.volume++;
    log.push({ tick: ticks, chan: c, vol: v, patch: chanPatch[c] });
  },
  setFilter: (c, cut, res) => {
    counts.filter++;
    cutoffs.push((cut << 16) >> 16);
    resos.add(res);
    log.push({ tick: ticks, chan: c, cut: (cut << 16) >> 16, patch: chanPatch[c] });
  },
  allOff: () => {},
  stop: () => {},
};

const engine = new BootSoundEngine(stub, data);
engine.start();
console.log("processes at start: " + engine.processes.length);

const limit = 8 / (SND_TICK_MS / 1000); // the 8 second animation
while (ticks < limit && engine.processes.length) {
  engine.tick();
  ticks++;
}

console.log("ticks run: " + ticks + " (" + (ticks * SND_TICK_MS) / 1000 + "s)");
console.log("live processes at end: " + engine.processes.length);
console.log("events: " + JSON.stringify(counts));
console.log("distinct notes: " + pitches.size + ", patches used: " + [...patches].sort((a, b) => a - b).join(","));

const cs = cutoffs.slice().sort((a, b) => a - b);
console.log(
  "filter cutoff (signed): min " + cs[0] + " max " + cs[cs.length - 1] +
    "  resonance values: " + [...resos].sort((a, b) => a - b).join(",")
);
const hz = (c) => Math.max(30, Math.min(20000, 8.176 * Math.pow(2, c / 1200))) | 0;
console.log("first 10 cutoffs (cents -> Hz): " + cutoffs.slice(0, 10).map((c) => c + "->" + hz(c)).join(", "));
const open = cutoffs.filter((c) => hz(c) >= 20000).length;
console.log("cutoffs pinned wide open: " + open + " / " + cutoffs.length);

const notes = [...pitches].sort((a, b) => a - b);
console.log("note range: " + notes[0] + " .. " + notes[notes.length - 1] + " -> " + notes.join(","));
const watch = Number(process.argv[2]);
if (!Number.isNaN(watch)) {
  console.log("\nchannel " + watch + " timeline:");
  for (const e of log.filter((x) => x.chan === watch)) {
    console.log(
      "  t=" + ((e.tick * SND_TICK_MS) / 1000).toFixed(2) + "s  " +
        (e.off
          ? "OFF"
          : e.vol !== undefined
          ? "VOL " + e.vol + " -> " + (-1 * (e.vol & 0xff) * 30 + 200) + "mB"
          : e.cut !== undefined
          ? "FILT " + e.cut + " -> " + hz(e.cut) + "Hz"
          : "ON  note" + e.note) +
        "  patch" + e.patch
    );
  }
}

console.log("first 16 note-ons:");
for (const e of log.slice(0, 16)) {
  const rate = Math.pow(2, ((e.note - 60) * Math.trunc(4096 / 12)) / 4096);
  console.log(
    "  t=" + ((e.tick * SND_TICK_MS) / 1000).toFixed(2) + "s ch" + e.chan + " patch" + e.patch +
      " note" + e.note + " rate " + rate.toFixed(3) +
      " sin128Hz " + (((48000 / 128) * rate) | 0)
  );
}
