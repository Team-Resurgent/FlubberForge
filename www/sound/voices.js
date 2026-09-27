// Port of the device layer. On Xbox this drove sixteen DirectSound buffers with
// SetPitch, SetEG, SetFilter and mixbin volumes; Web Audio covers the same
// ground with a buffer source, a gain, a biquad and a panner per voice.

const SOUND_MAX_BUFFERS = 16;

// Patch indices, matching patches.h.
const PSIN1 = 0;
const PSAW1 = 1;
const PSQUARE = 2;
const PSAW2 = 3;
const PSAW3 = 4;
const PNOISE1 = 5;
const PGLOCK = 6;
const PBUBBLE = 7;
const PFM = 8;
const PTHUNEL16 = 9;
const PREVTHUN = 10;

// envelopes.cpp. Attack/hold/decay/release are DLS2 rate values and sustain is
// a level; the conversion to seconds below is an approximation, since the Xbox
// envelope hardware is not reproducible exactly here.
const SOUND_ENVELOPES = {
  env1a: { attack: 0x1, hold: 0x5, decay: 0x20, release: 0x0, sustain: 0x7f },
  env1m: { attack: 0x1, hold: 0x0, decay: 0x10, release: 0x0, sustain: 0x1f, pitch: 0x10, filter: 0x7f },
  env3a: { attack: 0x1, hold: 0x3, decay: 0x10, release: 0x20, sustain: 0x10 },
  env3m: { attack: 0x1, hold: 0x0, decay: 0x10, release: 0x0, sustain: 0x1f, pitch: 0x10, filter: 0x1f },
  openA: { attack: 0x0, hold: 0x0, decay: 0x0, release: 0x0, sustain: 0xff },
  openM: { attack: 0x0, hold: 0x0, decay: 0x0, release: 0x0, sustain: 0xff },
  sawEnv1a: { attack: 0x1, hold: 0x2, decay: 0x10, release: 0x0, sustain: 0x9f },
  sawEnv1m: { attack: 0x10, hold: 0x100, decay: 0x100, release: 0x80, sustain: 0xff, filter: -80 },
  sawEnv2a: { attack: 0x1, hold: 0x0, decay: 0x40, release: 0x0, sustain: 0x3f, pitch: 0x7f },
  sawEnv2m: { attack: 0x100, hold: 0x0, decay: 0x10, release: 0x0, sustain: 0x1f },
  noiseEnv1a: { attack: 0x1, hold: 0x3, decay: 0x10, release: 0x20, sustain: 0xff },
  noiseEnv1m: { attack: 0x100, hold: 0x0, decay: 0x30, release: 0xc0, sustain: 0xff },
};

// DSENVELOPEDESC documents delay, attack, hold, decay and release as a count of
// 512-sample blocks, and dev_init opens the buffers at 48 kHz, so one unit is
// 512/48000 of a second. A decay of 0x20 is therefore 341 ms, not a few tens.
const ENV_BLOCK_SECONDS = 512 / 48000;

function envSeconds(blocks) {
  if (!blocks) return 0;
  return Math.abs(blocks) * ENV_BLOCK_SECONDS;
}

// dwSustain is an 8-bit level where 255 is 100%.
function envLevel(sustain) {
  return Math.max(0, Math.min(1, sustain / 255));
}

// dwDecay is the time to fall all the way to zero, and the segment simply stops
// once it reaches the sustain level. So a high sustain reaches its target in a
// fraction of the nominal decay, and a sustain of 255 never decays at all.
function decaySeconds(env) {
  return envSeconds(env.decay) * (1 - envLevel(env.sustain));
}

// lFilterCutOff is +/-127 for +/-8 octaves of cutoff modulation, and
// lPitchScale is +/-127 for about +/-1 octave of pitch modulation.
const ENV_FILTER_OCTAVES = 8;
const ENV_PITCH_OCTAVES = 1;

function multiOctaves(scale, octaves) {
  return ((scale || 0) / 127) * octaves;
}

// Hundredths of a dB, the unit DirectSound uses for mixbin volumes.
function mbToGain(mB) {
  return Math.pow(10, mB / 2000);
}

// device::dev_init. Buffers alternate a 6 dB lean left and right, except 3 and
// 5, which sit nearly centred and also feed the effects send.
function mixBinsFor(i) {
  if (i === 3 || i === 5) return { left: 0, right: -100, send: 0 };
  return i % 2 ? { left: -600, right: 0, send: null } : { left: 0, right: -600, send: null };
}

// A short decaying tail for the effects send. dev_init never programs the
// hardware effect, so this is chosen to sit under the mix rather than ported.
function makeSendReverb(ctx, destination) {
  const convolver = ctx.createConvolver();
  const seconds = 1.6;
  const len = Math.floor(ctx.sampleRate * seconds);
  const ir = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let c = 0; c < 2; c++) {
    const data = ir.getChannelData(c);
    for (let i = 0; i < len; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.5);
    }
  }
  convolver.buffer = ir;
  const wet = ctx.createGain();
  wet.gain.value = 0.35;
  convolver.connect(wet);
  wet.connect(destination);
  return convolver;
}

class SoundVoices {
  constructor(ctx, destination, waves, samples) {
    this.ctx = ctx;
    this.waves = waves;
    // patches.cpp. Loop flags and lengths come straight from the patch table.
    this.patches = [
      { wave: "sin128", loop: true, amp: "env1a", multi: "env1m" },
      { wave: "saw128", loop: true, amp: "sawEnv1a", multi: "sawEnv1m" },
      { wave: "saw128", loop: true, amp: "env3a", multi: "env3m" },
      { wave: "saw128", loop: true, amp: "sawEnv2a", multi: "sawEnv2m" },
      { wave: "saw128", loop: true, amp: "env3a", multi: "env3m" },
      { wave: "noise", loop: true, amp: "noiseEnv1a", multi: "noiseEnv1m" },
      { wave: "glock", loop: false, amp: "openA", multi: "openM" },
      { wave: "bubble", loop: true, amp: "openA", multi: "openM" },
      { wave: "fm", loop: false, amp: "openA", multi: "openM" },
      { wave: "thunel16", loop: false, amp: "openA", multi: "openM" },
      { wave: "revthun", loop: false, amp: "openA", multi: "openM" },
    ];
    this.buffers = {};
    this.buildBuffers(waves, samples || {});

    // dev_init routes buffers 3 and 5 through DSMIXBIN_FXSEND_0. The Xbox
    // effects processor is never configured by the boot sound, so the tail
    // itself is a judgement call rather than a port.
    this.send = ctx.createGain();
    this.send.gain.value = 1;
    this.send.connect(makeSendReverb(ctx, destination));

    this.channels = [];
    for (let i = 0; i < SOUND_MAX_BUFFERS; i++) {
      const gain = ctx.createGain();
      gain.gain.value = 0;
      const filter = ctx.createBiquadFilter();
      filter.type = "lowpass";
      filter.frequency.value = 20000;
      filter.Q.value = 0.0001;

      const bins = mixBinsFor(i);
      const left = ctx.createGain();
      const right = ctx.createGain();
      left.gain.value = mbToGain(bins.left);
      right.gain.value = mbToGain(bins.right);
      const merger = ctx.createChannelMerger(2);
      filter.connect(gain);
      gain.connect(left).connect(merger, 0, 0);
      gain.connect(right).connect(merger, 0, 1);
      merger.connect(destination);
      if (bins.send !== null) {
        const tap = ctx.createGain();
        tap.gain.value = mbToGain(bins.send);
        gain.connect(tap).connect(this.send);
      }

      this.channels.push({ gain, filter, left, right, src: null, patch: 0, volume: 0 });
    }
  }

  // Int16 tables become mono 48 kHz buffers, the format dev_init asked for.
  makeBuffer(data) {
    const buf = this.ctx.createBuffer(1, data.length, 48000);
    const out = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) out[i] = data[i] / 32768;
    return buf;
  }

  buildBuffers(waves, samples) {
    this.buffers.sin128 = this.makeBuffer(waves.sin128);
    this.buffers.saw128 = this.makeBuffer(waves.saw128);
    this.buffers.noise = this.makeBuffer(waves.noise);
    this.buffers.fm = this.makeBuffer(waves.fm);
    // Sampled instruments only exist when the optional data file is present.
    for (const name of ["glock", "bubble", "thunel16", "revthun"]) {
      if (samples[name]) this.buffers[name] = this.makeBuffer(samples[name]);
    }
  }

  // device::note_on_dsp. The pitch word is note<<8 plus a fractional byte, and
  // DirectSound counts 4096 units to the octave.
  static pitchUnits(value16) {
    const semis = ((value16 >> 8) & 0xff) - 60;
    return semis * Math.trunc(4096 / 12) + Math.trunc(((value16 & 0xff) * 341) / 255);
  }

  noteOn(chan, value16) {
    const ch = this.channels[chan];
    if (!ch) return;
    const patch = this.patches[ch.patch];
    const buffer = patch && this.buffers[patch.wave];
    if (!buffer) return; // a sampled patch with no data loaded
    this.stop(chan);

    const now = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    src.loop = patch.loop;
    src.playbackRate.value = Math.pow(2, SoundVoices.pitchUnits(value16) / 4096);
    src.connect(ch.filter);

    const amp = SOUND_ENVELOPES[patch.amp] || SOUND_ENVELOPES.openA;
    const peak = this.levelFor(ch.volume);
    const a = envSeconds(amp.attack);
    const h = envSeconds(amp.hold);
    const d = decaySeconds(amp);
    const g = ch.gain.gain;
    g.cancelScheduledValues(now);
    g.setValueAtTime(0.0001, now);
    g.linearRampToValueAtTime(peak, now + Math.max(0.001, a));
    g.setValueAtTime(peak, now + a + h);
    g.exponentialRampToValueAtTime(
      Math.max(0.0001, peak * envLevel(amp.sustain)),
      now + a + h + Math.max(0.001, d)
    );

    this.applyMultiEnvelope(ch, patch, now);

    src.start(now);
    ch.src = src;
  }

  // The second SetEG call in patch_dsp. The multi-function envelope follows the
  // same shape as the amplitude one but drives filter cutoff and pitch instead
  // of level, which is what gives the swept patches their character.
  applyMultiEnvelope(ch, patch, now) {
    const multi = SOUND_ENVELOPES[patch && patch.multi];
    ch.baseCut = ch.baseCut === undefined ? 20000 : ch.baseCut;
    const f = ch.filter.frequency;
    f.cancelScheduledValues(now);
    if (!multi || !multi.filter) {
      f.setValueAtTime(ch.baseCut, now);
      return;
    }
    const depth = multiOctaves(multi.filter, ENV_FILTER_OCTAVES);
    const clamp = (hz) => Math.max(30, Math.min(20000, hz));
    const peakHz = clamp(ch.baseCut * Math.pow(2, depth));
    const susHz = clamp(ch.baseCut * Math.pow(2, depth * envLevel(multi.sustain)));
    const a = Math.max(0.001, envSeconds(multi.attack));
    const h = envSeconds(multi.hold);
    const d = Math.max(0.001, decaySeconds(multi));
    f.setValueAtTime(clamp(ch.baseCut), now);
    f.linearRampToValueAtTime(peakHz, now + a);
    f.setValueAtTime(peakHz, now + a + h);
    f.exponentialRampToValueAtTime(susHz, now + a + h + d);
  }

  // device::slur_dsp retunes without restarting the envelope.
  slur(chan, value16) {
    const ch = this.channels[chan];
    if (!ch || !ch.src) return;
    ch.src.playbackRate.setValueAtTime(
      Math.pow(2, SoundVoices.pitchUnits(value16) / 4096),
      this.ctx.currentTime
    );
  }

  // device::note_off_dsp stops with DSBSTOPEX_ENVELOPE, so the release runs.
  noteOff(chan) {
    const ch = this.channels[chan];
    if (!ch || !ch.src) return;
    const patch = this.patches[ch.patch];
    const amp = SOUND_ENVELOPES[(patch && patch.amp) || "openA"];
    const now = this.ctx.currentTime;
    const rel = Math.max(0.005, envSeconds(amp.release));
    ch.gain.gain.cancelScheduledValues(now);
    ch.gain.gain.setValueAtTime(Math.max(0.0001, ch.gain.gain.value), now);
    ch.gain.gain.exponentialRampToValueAtTime(0.0001, now + rel);
    const src = ch.src;
    ch.src = null;
    try {
      src.stop(now + rel + 0.01);
    } catch (err) {
      /* already stopped */
    }
  }

  stop(chan) {
    const ch = this.channels[chan];
    if (!ch || !ch.src) return;
    try {
      ch.src.stop();
    } catch (err) {
      /* already stopped */
    }
    ch.src = null;
  }

  setPatch(chan, patch) {
    const ch = this.channels[chan];
    if (ch) ch.patch = patch;
  }

  // device::pan_dsp is a no-op on Xbox; the lean comes from the mixbins set up
  // in dev_init, which is already baked into the panner above.
  // device::pan_dsp is a no-op on Xbox: the sequence's pan events update the
  // track state but never reach the hardware, since placement comes entirely
  // from the mixbin volumes set up in dev_init.
  setPan() {}

  // device::volume_dsp: SetVolume((-op_level * 30) + 200), in hundredths of dB.
  // device::volume_dsp, in hundredths of a dB, clamped to the DirectSound range
  // and carrying the 6 dB of headroom every 2D buffer gets by default.
  levelFor(opLevel) {
    const mB = -1 * (opLevel & 0xff) * 30 + 200;
    const clamped = Math.max(-10000, Math.min(0, mB));
    return Math.pow(10, (clamped - 600) / 2000);
  }

  setVolume(chan, opLevel) {
    const ch = this.channels[chan];
    if (!ch) return;
    ch.volume = opLevel;
    const now = this.ctx.currentTime;
    if (ch.src) ch.gain.gain.setTargetAtTime(this.levelFor(opLevel), now, 0.01);
  }

  // device::vp_filter feeds a DLS2 filter; cutoff arrives in absolute pitch
  // cents, which is the DLS2 convention of cents above 8.176 Hz.
  setFilter(chan, cutoff, res) {
    const ch = this.channels[chan];
    if (!ch) return;
    // filtercutoff is signed: the sequence sweeps it from about -29000 to
    // +32767, and the negative half is what closes the filter down onto the
    // bass. Masking it to unsigned pins the lowpass wide open.
    const cents = (cutoff << 16) >> 16;
    const hz = 8.176 * Math.pow(2, cents / 1200);
    // Held as the base the multi-function envelope modulates around, so a
    // sweep already in flight is not stamped over mid-note.
    ch.baseCut = Math.max(30, Math.min(20000, hz));
    ch.filter.frequency.setTargetAtTime(ch.baseCut, this.ctx.currentTime, 0.01);
    // Resonance is not a Q: DSFILTERDESC takes Q from dwQCoefficient, a 0-7
    // index where 0 means Q = 1, and vp_filter always passes 0. filterres is
    // the second DLS2 coefficient of the pair, not a peak height.
    ch.filter.Q.value = 1;
  }

  allOff() {
    for (let i = 0; i < this.channels.length; i++) this.stop(i);
  }
}
