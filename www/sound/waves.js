// Port of the table generation in device::dev_init. These four waveforms are
// pure arithmetic, so they need no asset - the engine can build them at load.
// The sampled instruments (glock, bubble, thunder) are not here; they come from
// the optional data file, and the patches that use them stay silent without it.

const SOUND_SEED = 1003;

// The CRT LCG device::rand uses, reproduced exactly so the noise table matches.
function soundRandSeq(count, seed) {
  const out = new Uint16Array(count);
  let hold = seed | 0;
  for (let i = 0; i < count; i++) {
    hold = (Math.imul(hold, 214013) + 2531011) | 0;
    out[i] = (hold >> 16) & 0x7fff;
  }
  return out;
}

// dev_init stores these through `unsigned short`, so negative samples wrap.
// Keeping them as Int16 preserves the value the DSP actually reads back.
function toInt16(x) {
  return (x | 0) << 16 >> 16;
}

function buildSoundWaves() {
  const sin128 = new Int16Array(128);
  for (let i = 0; i < 128; i++) {
    sin128[i] = toInt16(32767 * Math.sin((2.0 * Math.PI * i) / 128.0));
  }

  const saw128 = new Int16Array(128);
  for (let i = 0; i < 128; i++) {
    saw128[i] = toInt16(32767 * ((i - 64) / 128.0));
  }

  const noise8192 = soundRandSeq(8192, SOUND_SEED);
  const noise = new Int16Array(8192);
  for (let i = 0; i < 8192; i++) noise[i] = toInt16(noise8192[i]);

  // A 4:2 carrier-to-modulator FM sweep, with the modulation index ramped by a
  // triangle over the table so the timbre opens and closes across one pass.
  const FMc = 4.0;
  const FMm = 2.0;
  const fm = new Int16Array(32768);
  let j = 0;
  for (let i = 0; i < 32768; i++) {
    if (i < 16384) j++;
    else j--;
    const dtmp = (j / 16384.0) * Math.sin((FMm * 2.0 * Math.PI * i) / 128.0);
    fm[i] = toInt16(32767 * Math.sin(dtmp + (FMc * 2.0 * Math.PI * i) / 128.0));
  }

  return { sin128, saw128, noise, fm };
}
