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
  bootSoundData: null,
};

// Optional: present only after tools/extract-sound.js has been run.
loadBootSound("sound/").then((data) => {
  state.bootSoundData = data;
});

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

// Audio is an original score wired to the animation's own timeline rather than
// a loop playing alongside it: the chamber drone tracks blob intensity, each of
// the twelve blob pulses fires a thump at its own time, and the shield fade-in
// and finish dive get their own swells. Load a file with the Audio button to
// play that instead of the synth.

function pinkNoise(ctx) {
  const len = Math.floor(ctx.sampleRate * 2);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  let b0 = 0;
  let b1 = 0;
  let b2 = 0;
  for (let i = 0; i < len; i++) {
    const w = Math.random() * 2 - 1;
    // White noise reads as hiss under the drone; this rolls it towards pink.
    b0 = 0.99765 * b0 + w * 0.0990460;
    b1 = 0.96300 * b1 + w * 0.2965164;
    b2 = 0.57555 * b2 + w * 1.0526913;
    d[i] = (b0 + b1 + b2 + w * 0.1848) * 0.2;
  }
  return buf;
}

function soundEvents(pulses) {
  const ev = pulses.map((p) => ({ t: p.x, kind: "thump", amp: clamp(p.z, 0.1, 1) }));
  ev.push({ t: SHIELD_FADE_IN_START, kind: "swell", amp: 0.35, dur: SHIELD_FADE_IN_DELTA });
  ev.push({ t: FINISH_START_TIME, kind: "sweep", amp: 0.5, dur: FINISH_TRANSITION_TIME });
  ev.push({ t: TEXT_ANIM_START, kind: "chime", amp: 0.5 });
  return ev.sort((a, b) => a.t - b.t);
}

function fireThump(a, amp) {
  const now = a.ctx.currentTime;
  const osc = a.ctx.createOscillator();
  osc.type = "sine";
  osc.frequency.setValueAtTime(130, now);
  osc.frequency.exponentialRampToValueAtTime(40, now + 0.3);
  const g = a.ctx.createGain();
  g.gain.setValueAtTime(0.0001, now);
  g.gain.exponentialRampToValueAtTime(0.5 * amp, now + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, now + 0.5);
  osc.connect(g);
  g.connect(a.master);
  osc.start(now);
  osc.stop(now + 0.55);
}

function fireNoise(a, amp, dur, f0, f1, q) {
  const now = a.ctx.currentTime;
  const src = a.ctx.createBufferSource();
  src.buffer = a.noise;
  src.loop = true;
  const bp = a.ctx.createBiquadFilter();
  bp.type = "bandpass";
  bp.Q.value = q;
  bp.frequency.setValueAtTime(f0, now);
  bp.frequency.exponentialRampToValueAtTime(f1, now + dur);
  const g = a.ctx.createGain();
  g.gain.setValueAtTime(0.0001, now);
  g.gain.exponentialRampToValueAtTime(amp, now + dur * 0.45);
  g.gain.exponentialRampToValueAtTime(0.0001, now + dur);
  src.connect(bp);
  bp.connect(g);
  g.connect(a.master);
  src.start(now);
  src.stop(now + dur + 0.05);
}

function fireChime(a, amp) {
  const now = a.ctx.currentTime;
  // A soft open fifth with an octave on top, swelling rather than struck.
  for (const [mul, level, delay] of [[1, 1, 0], [1.5, 0.6, 0.04], [2, 0.42, 0.08]]) {
    const osc = a.ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.value = 294 * mul;
    const g = a.ctx.createGain();
    const at = now + delay;
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(amp * level * 0.32, at + 0.12);
    g.gain.exponentialRampToValueAtTime(0.0001, at + 1.7);
    osc.connect(g);
    g.connect(a.master);
    osc.start(at);
    osc.stop(at + 1.8);
  }
}

function fireEvent(a, e) {
  if (e.kind === "thump") fireThump(a, e.amp);
  else if (e.kind === "swell") fireNoise(a, e.amp, e.dur, 220, 900, 1.1);
  else if (e.kind === "sweep") fireNoise(a, e.amp, e.dur, 400, 3200, 0.8);
  else if (e.kind === "chime") fireChime(a, e.amp);
}

// The engine expects sos_main once per 5 ms tick, so the animation clock is
// converted into a tick count and the sequencer is stepped up to it. Seeking
// backwards restarts the sequence, since the queue has no way to rewind.
function driveBootSound(a, t) {
  const want = Math.max(0, Math.floor(t / (SND_TICK_MS / 1000)));
  if (want < a.engineTicks || t <= 0) {
    a.engine.start();
    a.engineTicks = 0;
  }
  let budget = 4000;
  while (a.engineTicks < want && budget-- > 0) {
    a.engine.tick();
    a.engineTicks++;
  }
}

function updateSound(t, intensity) {
  const a = state.audio;
  if (!a) return;
  const now = a.ctx.currentTime;
  a.master.gain.setTargetAtTime(1, now, 0.05);

  if (a.engine) {
    driveBootSound(a, t);
    return;
  }

  const fade = t >= FINISH_STOP_TIME ? 0 : 1;
  a.drone.gain.setTargetAtTime(clamp(intensity, 0, 1.4) * 0.05 * fade, now, 0.08);
  a.droneFilter.frequency.setTargetAtTime(180 + intensity * 900, now, 0.08);

  const prev = a.lastT;
  a.lastT = t;
  // A jump means a scrub or a loop, so skip rather than dumping every missed
  // event into the same frame.
  if (prev === null || t < prev || t - prev > 0.25) return;
  for (const e of a.events) {
    if (e.t > prev && e.t <= t) fireEvent(a, e);
  }
}

function ensureSound() {
  if (state.audio) {
    if (state.audio.ctx.state === "suspended") state.audio.ctx.resume();
    return state.audio;
  }
  const ctx = new AudioContext();
  const master = ctx.createGain();
  master.gain.value = 0;
  master.connect(ctx.destination);

  const drone = ctx.createGain();
  drone.gain.value = 0;
  const droneFilter = ctx.createBiquadFilter();
  droneFilter.type = "lowpass";
  droneFilter.frequency.value = 240;
  droneFilter.connect(drone);
  drone.connect(master);
  // Two saws a few cents apart plus a sub, so the chamber has some movement.
  for (const detune of [-7, 7]) {
    const osc = ctx.createOscillator();
    osc.type = "sawtooth";
    osc.frequency.value = 55;
    osc.detune.value = detune;
    osc.connect(droneFilter);
    osc.start();
  }
  const sub = ctx.createOscillator();
  sub.type = "sine";
  sub.frequency.value = 27.5;
  sub.connect(droneFilter);
  sub.start();

  state.audio = {
    ctx,
    master,
    drone,
    droneFilter,
    noise: pinkNoise(ctx),
    events: soundEvents(state.pulses),
    lastT: null,
    engine: null,
    engineTicks: 0,
  };

  // When the converted sequence is present, the real engine replaces the
  // fallback cue entirely.
  if (state.bootSoundData) {
    const voices = new SoundVoices(ctx, master, buildSoundWaves(), state.bootSoundData.samples);
    state.audio.engine = new BootSoundEngine(voices, state.bootSoundData);
    state.audio.engine.start();
  }
  return state.audio;
}

function stopSound() {
  const a = state.audio;
  if (!a) return;
  a.master.gain.setTargetAtTime(0, a.ctx.currentTime, 0.05);
  a.lastT = null;
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
  syncDoodadHint();
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
  syncDoodadHint();
}

// Presets swap the palette only, so the picker sits above the groups rather
// than inside one.
function buildPresetPicker() {
  const row = document.createElement("label");
  row.className = "row";
  const name = document.createElement("span");
  name.textContent = "Preset";
  row.appendChild(name);
  const sel = document.createElement("select");
  sel.id = "f-preset";
  for (const preset of THEME_PRESETS) {
    const opt = document.createElement("option");
    opt.value = preset.name;
    opt.textContent = preset.name;
    sel.appendChild(opt);
  }
  sel.addEventListener("change", () => {
    applyPreset(state.theme, sel.value);
    state.cameraKey = -1;
    syncThemeControls();
  });
  row.appendChild(sel);
  return row;
}

function buildPanel() {
  const root = document.getElementById("fields");
  const head = document.createElement("h2");
  head.textContent = "Theme";
  root.appendChild(head);
  root.appendChild(buildPresetPicker());
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
    if (field.key === "enableDoodad") root.appendChild(buildDoodadHint());
  }
  syncThemeControls();
}

// The placement controls only exist while paused, so spell them out rather than
// leaving them to be discovered.
function buildDoodadHint() {
  const box = document.createElement("div");
  box.id = "doodad-hint";
  box.className = "hint";
  const note = document.createElement("p");
  note.textContent = "Pause to place the look-at point.";
  box.appendChild(note);
  const rows = [
    ["Drag", "orbit camera"],
    ["Right-drag", "move target"],
    ["Alt + right-drag", "raise / lower"],
    ["Wheel", "zoom"],
    ["N", "log path node"],
  ];
  for (const [key, what] of rows) {
    const line = document.createElement("p");
    const k = document.createElement("kbd");
    k.textContent = key;
    line.appendChild(k);
    line.appendChild(document.createTextNode(" " + what));
    box.appendChild(line);
  }
  return box;
}

function syncDoodadHint() {
  const box = document.getElementById("doodad-hint");
  if (box) box.style.display = state.theme.enableDoodad ? "block" : "none";
}

function applyIniText(text) {
  state.theme = parseIni(text);
  state.cameraKey = -1;
  syncThemeControls();
}
window.applyIniText = applyIniText;

// Mouse stand-in for the gamepad in placement mode: drag orbits the camera,
// right-drag slides the look-at across the ground plane, and shift swaps the
// vertical axis onto world Z, the way app.cpp splits the two sticks.
function wireDoodadMouse(canvas) {
  let drag = null;

  const active = () => state.theme.enableDoodad && !state.playing && state.free;

  canvas.addEventListener("contextmenu", (e) => {
    if (active()) e.preventDefault();
  });

  canvas.addEventListener("pointerdown", (e) => {
    if (!active()) return;
    drag = { x: e.clientX, y: e.clientY, move: e.button === 2 || e.shiftKey };
    canvas.setPointerCapture(e.pointerId);
    e.preventDefault();
  });

  canvas.addEventListener("pointermove", (e) => {
    if (!drag || !active()) return;
    const dx = e.clientX - drag.x;
    const dy = e.clientY - drag.y;
    drag.x = e.clientX;
    drag.y = e.clientY;
    const free = state.free;
    if (drag.move) {
      // Scaled by the camera distance, as doodad_rad does on hardware.
      const k = free.rad * 0.0016;
      const ax = doodadAxes(free.theta);
      if (e.altKey) {
        free.look.z -= dy * k;
      } else {
        free.look.x += (-ax.right.x * dx + ax.fwd.x * dy) * k;
        free.look.y += (-ax.right.y * dx + ax.fwd.y * dy) * k;
      }
    } else {
      free.theta -= dx * 0.006;
      free.phi = Math.max(-Math.PI / 2 + 0.01, Math.min(Math.PI / 2 - 0.01, free.phi + dy * 0.006));
    }
  });

  const end = (e) => {
    if (!drag) return;
    drag = null;
    if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
  };
  canvas.addEventListener("pointerup", end);
  canvas.addEventListener("pointercancel", end);

  canvas.addEventListener(
    "wheel",
    (e) => {
      if (!active()) return;
      e.preventDefault();
      state.free.rad = Math.max(1, state.free.rad * Math.exp(e.deltaY * 0.001));
    },
    { passive: false }
  );

  // camera_controller::buttonPressed traced the framed shot out as a path row.
  window.addEventListener("keydown", (e) => {
    if (e.key !== "n" && e.key !== "N") return;
    if (!active()) return;
    const shot = freeCamShot({ look: null, pos: null }, state.free);
    const f = (v) => (v >= 0 ? "+" : "") + v.toFixed(1) + "f";
    console.log(
      " { 0, +00, +00, " +
        [shot.pos.x, shot.pos.y, shot.pos.z, shot.look.x, shot.look.y, shot.look.z]
          .map(f)
          .join(",") +
        " },"
    );
  });
}

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
  wireDoodadMouse(document.getElementById("view"));

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
