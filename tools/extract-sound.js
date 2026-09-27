// Converts the BootAnimRXDK sound tree into www/sound/bootsound.json.
//
//   node tools/extract-sound.js [path-to-BootAnimRXDK/sound]
//
// It expands the event macros in event_functions.h against the sequence tables
// in sound_sequence.cpp, and applies the same byte transforms dev_init does to
// the three sampled instruments. Run it when the source sequence changes; the
// player falls back to its own cue when the output is absent.
const fs = require("fs");
const path = require("path");

const srcDir = process.argv[2] || "D:/Git/BootAnimRXDK/sound";
const outPath = path.join(__dirname, "..", "www", "sound", "bootsound.json");

function read(name) {
  return fs.readFileSync(path.join(srcDir, name), "utf8");
}

// ---------------------------------------------------------------- symbols

// Every plain `#define NAME value` in the given sources, for note names
// (cc0, cs0, ...), patch numbers and the F_* opcode values.
function collectDefines(sources) {
  const out = {};
  for (const src of sources) {
    for (const m of src.matchAll(/^\s*#define\s+(\w+)\s+(-?\w+)\s*$/gm)) {
      const value = m[2].startsWith("0x") ? parseInt(m[2], 16) : parseInt(m[2], 10);
      if (!Number.isNaN(value)) out[m[1]] = value;
    }
  }
  return out;
}

// The event macros are all of the form `#define name(args) BODY` or a bare
// `#define name BODY`, expanding to a comma separated list of words.
function collectMacros(src) {
  const out = {};
  for (const m of src.matchAll(/^\s*#define\s+(\w+)\(([^)]*)\)\s+(.+)$/gm)) {
    out[m[1]] = { params: m[2].split(",").map((s) => s.trim()), body: m[3].trim() };
  }
  for (const m of src.matchAll(/^\s*#define\s+(\w+)\s+(F_\w+)\s*$/gm)) {
    out[m[1]] = { params: [], body: m[2].trim() };
  }
  return out;
}

// ---------------------------------------------------------------- parsing

// Split on commas that sit outside parentheses, so `note(cc1, 20)` stays whole.
function splitTop(text) {
  const parts = [];
  let depth = 0;
  let cur = "";
  for (const ch of text) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === "," && depth === 0) {
      parts.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  if (cur.trim()) parts.push(cur);
  return parts.map((s) => s.trim()).filter(Boolean);
}

function resolve(token, defines) {
  let t = token.trim();
  // Macro substitution wraps arguments in parens, so peel them back off.
  while (/^\((.*)\)$/s.test(t) && splitTop(t.slice(1, -1)).length === 1) {
    t = t.slice(1, -1).trim();
  }
  if (t === "") return null;
  if (/^-?\d+$/.test(t)) return parseInt(t, 10);
  if (/^0x[0-9a-fA-F]+$/.test(t)) return parseInt(t, 16);
  if (t in defines) return defines[t];
  // Simple arithmetic shows up occasionally, e.g. `cc1 + 12`.
  const expr = t.replace(/\w+/g, (w) => (w in defines ? defines[w] : w));
  if (/^[-+*/(){}\d\s]+$/.test(expr)) {
    const v = Function('"use strict";return (' + expr + ")")();
    if (Number.isFinite(v)) return v;
  }
  throw new Error("cannot resolve token: " + t);
}

function expand(entry, defines, macros) {
  const call = entry.match(/^(\w+)\s*\((.*)\)$/s);
  if (call && macros[call[1]]) {
    const macro = macros[call[1]];
    const args = splitTop(call[2]);
    let body = macro.body;
    macro.params.forEach((p, i) => {
      body = body.replace(new RegExp("\\b" + p + "\\b", "g"), "(" + (args[i] || "0") + ")");
    });
    return splitTop(body).flatMap((tok) => expand(tok, defines, macros));
  }
  if (macros[entry] && macros[entry].params.length === 0) {
    return splitTop(macros[entry].body).flatMap((tok) => expand(tok, defines, macros));
  }
  const v = resolve(entry, defines);
  return v === null ? [] : [v & 0xffff];
}

function trackBodies(src) {
  const tracks = {};
  const re = /unsigned short \*sound_sequence::get(Boot\w|Tune\d)\(\)\s*\{\s*static unsigned short \w+\[\]\s*=\s*\{([\s\S]*?)\};/g;
  for (const m of src.matchAll(re)) tracks[m[1]] = m[2];
  return tracks;
}

// ---------------------------------------------------------------- samples

// The .X00 assets are C include files holding one 8-bit sample per hex literal,
// pulled into a byte array with #include inside the braces - not raw binary.
function loadBytes(file) {
  const text = fs.readFileSync(path.join(srcDir, "dsp", file), "utf8");
  const bytes = [];
  for (const m of text.matchAll(/0x([0-9a-fA-F]{1,2})/g)) bytes.push(parseInt(m[1], 16));
  return bytes;
}

// dev_init widens the 8-bit assets to 16-bit. Glock and bubble are unsigned, so
// they are flipped to signed first; ThunEl16 is shifted straight up.
function loadSample(file, count, flip) {
  const raw = loadBytes(file);
  if (raw.length < count) {
    throw new Error(file + ": expected at least " + count + " samples, parsed " + raw.length);
  }
  const out = new Array(count);
  for (let i = 0; i < count; i++) {
    out[i] = ((((flip ? raw[i] ^ 0x80 : raw[i]) << 8) << 16) >> 16);
  }
  return out;
}

// ---------------------------------------------------------------- main

const seqSrc = read("sound_sequence.cpp");
const evtSrc = read("event_functions.h");
const patSrc = read("patches.h");

const defines = collectDefines([seqSrc, evtSrc, patSrc]);
const macros = collectMacros(evtSrc);

const bodies = trackBodies(seqSrc);
const bootNames = ["Boot0", "Boot1", "Boot2", "Boot3", "Boot4", "Boot5", "Boot6", "Boot7", "Boot8", "Boot9", "BootA", "BootB"];
const tracks = bootNames.map((name) => {
  if (!(name in bodies)) throw new Error("missing sequence " + name);
  return splitTop(bodies[name]).flatMap((entry) => expand(entry, defines, macros));
});

const thun = loadSample("THUNEL16.X00", 0x5540, false);
const samples = {
  glock: loadSample("GLOCK.X00", 3768, true),
  bubble: loadSample("BUBBLE.X00", 6719, true),
  thunel16: thun,
  // dev_init reverses with j starting at 0x5540, one past the end, so the first
  // output sample reads out of bounds and thun[0] never appears.
  revthun: Array.from({ length: 0x5540 }, (_, i) => {
    const j = 0x5540 - i;
    return j < thun.length ? thun[j] : 0;
  }),
};

// The music entry of the sound_calls table carries the bitmap of channels it
// drives, which is what call_music walks.
const callRow = seqSrc.match(/CALL_MUSIC\s*,\s*(0x[0-9a-fA-F]+|\d+)/);
if (!callRow) throw new Error("no CALL_MUSIC row in sound_calls");
const trackMap = callRow[1].startsWith("0x") ? parseInt(callRow[1], 16) : parseInt(callRow[1], 10);

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify({ trackMap, tracks, samples }));
console.log(
  "tracks " + tracks.length +
  " words " + tracks.reduce((n, t) => n + t.length, 0) +
  " bytes " + fs.statSync(outPath).size
);
