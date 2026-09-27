// Canvas playback of the official BootAnimRXDK meshes.
// Timing, camera splines, and theme colors follow the original.

const TAU = Math.PI * 2;

function clamp(v, a, b) {
  return Math.max(a, Math.min(b, v));
}

function smoothstep(t) {
  const u = clamp(t, 0, 1);
  return u * u * (3 - 2 * u);
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function makePulses(rng) {
  const pulses = [];
  for (let i = 0; i < 12; i++) {
    let x = (i + 1) / 13 + rng.rand11() * 0.03;
    x = 1 - (0.5 * x * x + 0.5 * x);
    let y = Math.max(0.1, (1.2 - x) * (1.2 - x) * (rng.rand01() + 2) * 0.05);
    let z = (x + 0.5) * (rng.rand01() + 1) * 0.2;
    x = x * BLOB_PULSE_ELAPSED + BLOB_PULSE_START;
    x = Math.max(x, BLOB_PULSE_START + y);
    pulses.push({ x, y, z });
  }
  pulses[11].x = BLOB_PULSE_START + pulses[11].y;
  pulses[11].z *= 3;
  return pulses;
}

function sumPulses(pulses, et) {
  let sum = 0;
  for (const p of pulses) {
    const fdt = Math.abs(et - p.x);
    if (fdt > p.y) continue;
    const c = Math.cos((fdt * 0.5 * Math.PI) / p.y);
    sum += p.z * c;
  }
  return sum;
}

function intensityAt(t, pulses) {
  let base = 0;
  if (t >= BLOB_ZERO_INTENSE_END_TIME) {
    const u = (t - BLOB_ZERO_INTENSE_END_TIME) / MAX_INTENSITY_DELTA;
    const s = 0.5 * u * u + 0.5 * u;
    base = s;
  }
  const pulse = t < DEMO_TOTAL_TIME ? sumPulses(pulses, t) : 0;
  return { base, pulse, blob: base + pulse };
}

const appRand = new QuickRand(0x76543210);

const state = {
  theme: cloneTheme(DEFAULT_THEME),
  time: 0,
  playing: true,
  loop: true,
  sound: false,
  // app.cpp draws the pulse randoms first, then the shields', from one generator.
  pulseRand: appRand,
  pulses: makePulses(appRand),
  camera: null,
  cameraKey: -1,
  lastStamp: 0,
  audio: null,
  isolate: -1,
};

function setIsolate(n) {
  const count = official.ready ? official.data.instances.length : 0;
  if (!Number.isFinite(n) || n < 0) state.isolate = -1;
  else if (!count) state.isolate = n | 0;
  else state.isolate = Math.max(0, Math.min(count - 1, n | 0));
  const input = document.getElementById("prim");
  if (input && document.activeElement !== input) input.value = String(state.isolate);
  const label = document.getElementById("prim-label");
  if (!label) return;
  if (state.isolate < 0 || !official.ready) label.textContent = "all";
  else {
    const inst = official.data.instances[state.isolate];
    label.textContent = (inst.kind || "mesh") + " " + state.isolate;
  }
}

function rebuildCamera() {
  let mode = state.theme.cameraMode | 0;
  if (mode <= 0) mode = 1;
  const path = (mode - 1) % CAMERA_PATHS.length;
  if (state.cameraKey !== path) {
    state.camera = buildCamera(path);
    state.cameraKey = path;
  }
}

function frame(width, height, t, theme) {
  drawOfficial(width, height, t, theme);
}

function updateSound(t, intensity) {
  const audio = state.audio;
  if (!audio) return;
  const now = audio.ctx.currentTime;
  const gain = clamp(intensity, 0, 1.4) * 0.07;
  audio.master.gain.setTargetAtTime(t >= DEMO_TOTAL_TIME ? 0 : gain, now, 0.08);
  audio.osc.frequency.setTargetAtTime(46 + intensity * 36, now, 0.08);
  audio.filter.frequency.setTargetAtTime(180 + intensity * 900, now, 0.08);
}

function ensureSound() {
  if (state.audio) {
    if (state.audio.ctx.state === "suspended") state.audio.ctx.resume();
    return;
  }
  const ctx = new AudioContext();
  const master = ctx.createGain();
  master.gain.value = 0;
  master.connect(ctx.destination);
  const osc = ctx.createOscillator();
  osc.type = "sawtooth";
  osc.frequency.value = 55;
  const filter = ctx.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.value = 240;
  osc.connect(filter);
  filter.connect(master);
  osc.start();
  state.audio = { ctx, master, osc, filter };
}

function stopSound() {
  if (!state.audio) return;
  state.audio.master.gain.setTargetAtTime(0, state.audio.ctx.currentTime, 0.05);
}

function resize() {
  const canvas = document.getElementById("view");
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.floor(canvas.clientWidth * dpr);
  canvas.height = Math.floor(canvas.clientHeight * dpr);
}

function tick(stamp) {
  if (!state.lastStamp) state.lastStamp = stamp;
  const dt = Math.min(0.05, (stamp - state.lastStamp) / 1000);
  state.lastStamp = stamp;
  if (state.playing) {
    state.time += dt;
    if (state.time >= DEMO_TOTAL_TIME) {
      if (state.loop) state.time = 0;
      else {
        state.time = DEMO_TOTAL_TIME;
        state.playing = false;
        stopSound();
      }
    }
  }
  const canvas = document.getElementById("view");
  if (official.ready) frame(canvas.width, canvas.height, state.time, state.theme);
  const scrub = document.getElementById("scrub");
  if (document.activeElement !== scrub) scrub.value = String(state.time);
  document.getElementById("clock").textContent = state.time.toFixed(2) + "s";
  if (official.ready) setIsolate(state.isolate);
  requestAnimationFrame(tick);
}

function syncThemeControls() {
  for (const field of THEME_FIELDS) {
    const el = document.getElementById("f-" + field.key);
    if (!el) continue;
    if (field.kind === "bool") el.checked = !!state.theme[field.key];
    else if (field.kind === "color") el.value = cssHex(state.theme[field.key]);
    else el.value = String(state.theme[field.key]);
  }
}

function readThemeControls() {
  for (const field of THEME_FIELDS) {
    const el = document.getElementById("f-" + field.key);
    if (!el) continue;
    if (field.kind === "bool") state.theme[field.key] = el.checked;
    else if (field.kind === "color") state.theme[field.key] = parseInt(el.value.slice(1), 16);
    else state.theme[field.key] = parseInt(el.value, 10) || 0;
  }
  state.cameraKey = -1;
}

function buildPanel() {
  const root = document.getElementById("fields");
  let group = "";
  for (const field of THEME_FIELDS) {
    if (field.group !== group) {
      const h = document.createElement("h2");
      h.textContent = field.group;
      root.appendChild(h);
      group = field.group;
    }
    const row = document.createElement("label");
    row.className = "row";
    const name = document.createElement("span");
    name.textContent = field.ini;
    row.appendChild(name);
    let input;
    if (field.kind === "bool") {
      input = document.createElement("input");
      input.type = "checkbox";
    } else if (field.kind === "color") {
      input = document.createElement("input");
      input.type = "color";
    } else {
      input = document.createElement("input");
      input.type = "number";
      input.min = String(field.min);
      input.max = String(field.max);
    }
    input.id = "f-" + field.key;
    input.addEventListener("input", readThemeControls);
    row.appendChild(input);
    root.appendChild(row);
  }
  syncThemeControls();
}

function applyIniText(text) {
  state.theme = parseIni(text);
  state.cameraKey = -1;
  syncThemeControls();
}
window.applyIniText = applyIniText;

function wireUi() {
  document.getElementById("play").addEventListener("click", () => {
    state.playing = !state.playing;
    document.getElementById("play").textContent = state.playing ? "Pause" : "Play";
    if (state.playing && state.time >= DEMO_TOTAL_TIME) state.time = 0;
  });
  document.getElementById("restart").addEventListener("click", () => {
    state.time = 0;
    state.playing = true;
    document.getElementById("play").textContent = "Pause";
  });
  document.getElementById("loop").addEventListener("change", (e) => {
    state.loop = e.target.checked;
  });
  document.getElementById("sound").addEventListener("change", (e) => {
    state.sound = e.target.checked;
    if (state.sound) ensureSound();
    else stopSound();
  });
  const scrub = document.getElementById("scrub");
  scrub.max = String(DEMO_TOTAL_TIME);
  scrub.addEventListener("input", () => {
    state.time = parseFloat(scrub.value);
    state.playing = false;
    document.getElementById("play").textContent = "Play";
  });
  document.getElementById("ini").addEventListener("change", async (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    applyIniText(await file.text());
  });
  document.getElementById("save").addEventListener("click", () => {
    const blob = new Blob([themeToIni(state.theme)], { type: "text/plain" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "bootanim.ini";
    a.click();
    URL.revokeObjectURL(a.href);
  });
  document.getElementById("reset").addEventListener("click", () => {
    state.theme = cloneTheme(DEFAULT_THEME);
    state.cameraKey = -1;
    syncThemeControls();
  });
  function stepPrimitive(delta) {
    const count = official.data ? official.data.instances.length : 0;
    if (!count) return;
    const cur = state.isolate < 0 ? -1 : state.isolate;
    let next = cur + delta;
    if (next < -1) next = count - 1;
    if (next >= count) next = -1;
    setIsolate(next);
  }
  document.getElementById("prim-prev").addEventListener("click", () => stepPrimitive(-1));
  document.getElementById("prim-next").addEventListener("click", () => stepPrimitive(1));
  document.getElementById("prim").addEventListener("change", (e) => {
    const n = parseInt(e.target.value, 10);
    setIsolate(Number.isFinite(n) ? n : -1);
  });
  window.addEventListener("keydown", (e) => {
    if (e.target && (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA")) return;
    if (e.code === "Space") {
      e.preventDefault();
      document.getElementById("play").click();
    } else if (e.code === "KeyR") {
      document.getElementById("restart").click();
    } else if (e.code === "BracketLeft") {
      stepPrimitive(-1);
    } else if (e.code === "BracketRight") {
      stepPrimitive(1);
    }
  });
  window.addEventListener("resize", resize);
}

window.addEventListener("error", (e) => {
  const banner = document.createElement("div");
  banner.textContent = e.message;
  banner.style.cssText = "position:fixed;left:8px;top:8px;right:320px;padding:8px;background:#5a1010;color:#fff;z-index:9";
  document.body.appendChild(banner);
});

buildPanel();
wireUi();
resize();

const bootParams = new URLSearchParams(location.search);
if (bootParams.has("prim")) setIsolate(parseInt(bootParams.get("prim"), 10));
if (bootParams.has("t")) {
  state.time = parseFloat(bootParams.get("t")) || 0;
  state.playing = bootParams.get("play") !== "0";
  document.getElementById("play").textContent = state.playing ? "Pause" : "Play";
}

loadOfficial(document.getElementById("view")).then(() => {
  requestAnimationFrame(tick);
}).catch((err) => {
  const banner = document.createElement("div");
  banner.textContent = err.message;
  banner.style.cssText = "position:fixed;left:8px;top:8px;right:320px;padding:8px;background:#5a1010;color:#fff;z-index:9";
  document.body.appendChild(banner);
});
