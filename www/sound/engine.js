// Port of sound_os, call_functions, process_functions and event_functions.
// The Xbox ran sos_main from a thread every 5 ms with system_clock_music
// ticking once per pass; this drives the same loop from the animation clock so
// the music stays locked to the visuals when you scrub.

const SND_MAX_TRACKS = 16;
const SND_MAX_PROCESSES = 30;
const SND_MAX_LOOP = 4;
const SND_TICK_MS = 5;

const SND_LEVEL_MUSIC = 0;
const SND_LEVEL_EFFECT = 1;

// event_functions.h
const F_REST = 0;
const F_NOTE = 1;
const F_JUMPTO = 2;
const F_LOOP = 3;
const F_ENDLOOP = 4;
const F_PATCH = 5;
const F_PAN = 6;
const F_MUX = 7;
const F_DEMUX = 8;
const F_VOLUME = 9;
const F_XPOSE = 10;
const F_XSET = 11;
const F_SLUR = 12;
const F_RING = 13;
const F_CLOCKSET = 14;
const F_END = 15;
const F_FILTERINC = 16;
const F_FILTERSET = 17;

function newTrackInfo() {
  return {
    patch: 0,
    pan: 0,
    volume: 127,
    pitch: 0,
    transpose: 0,
    filtercutoff: 0,
    filterres: 0,
    loopCounter: new Uint16Array(SND_MAX_LOOP),
    loopAddr: new Int32Array(SND_MAX_LOOP),
    loopLevel: 0,
  };
}

class BootSoundEngine {
  constructor(voices, data) {
    this.voices = voices;
    this.data = data;
    this.tracks = data.tracks.map((t) => Uint16Array.from(t));
    this.trackStatus = [];
    for (let i = 0; i < 2 * SND_MAX_TRACKS; i++) this.trackStatus.push(newTrackInfo());
    this.channelLevel = new Uint8Array(SND_MAX_TRACKS);
    this.processes = [];
    this.clock = 0;
    this.ended = false;
  }

  // call_functions::init_track_status
  initTrackStatus(level, channel) {
    const ti = this.trackStatus[level * SND_MAX_TRACKS + channel];
    ti.patch = 0;
    ti.loopLevel = 0;
    ti.transpose = 0;
    ti.filtercutoff = 0;
    ti.volume = 127;
    ti.pan = 0;
    return ti;
  }

  // call_functions::call_music, walking the track map bit by bit.
  start() {
    this.processes.length = 0;
    this.clock = 0;
    this.ended = false;
    this.voices.allOff();
    let ptr = 0;
    for (let i = 0, mask = 1; i < SND_MAX_TRACKS; i++, mask <<= 1) {
      if (!(this.data.trackMap & mask)) continue;
      const track = this.tracks[ptr++];
      if (!track) continue;
      this.initTrackStatus(SND_LEVEL_MUSIC, i);
      if (this.processes.length >= SND_MAX_PROCESSES) break;
      this.processes.push({
        track,
        ip: 0,
        timer: 0,
        prevTimer: this.clock,
        fn: track[0],
        level: SND_LEVEL_MUSIC,
        chan: i,
        dead: false,
      });
      if (this.channelLevel[i] < SND_LEVEL_EFFECT) this.channelLevel[i] = SND_LEVEL_MUSIC;
    }
  }

  stop() {
    this.processes.length = 0;
    this.voices.allOff();
  }

  // sound_os::sos_main, one pass of the process queue. A process dispatches at
  // most one event per pass even when its timer is already overdue, so events
  // that carry no duration still cost a tick each - that is what paces the
  // patch and filter changes between notes.
  tick() {
    // system_clock_music is a short, and the timer maths leans on it wrapping.
    this.clock = ((this.clock + 1) << 16) >> 16;
    for (const p of this.processes) {
      p.timer = (p.timer + p.prevTimer - this.clock) | 0;
      p.prevTimer = this.clock;
      if (p.timer >= 0) continue;
      const ti = this.trackStatus[p.level * SND_MAX_TRACKS + p.chan];
      if (this.dispatch(p, ti) === 0) {
        // f_end leaves the process in the queue and breaks the walk, which
        // parks every track ordered after it too.
        this.ended = true;
        break;
      }
    }
  }

  dispatch(p, ti) {
    const a = p.track;
    switch (p.fn) {
      case F_NOTE:
      case F_SLUR: {
        const slur = p.fn === F_SLUR;
        let ptr = p.ip + 1;
        let delay = a[ptr++] & 0xff;
        let duration;
        if (delay & 0x80) {
          duration = a[ptr] & 0xff;
          delay &= 0x7f;
        } else {
          duration = a[ptr++];
        }
        p.fn = a[ptr];
        p.ip = ptr;
        p.timer += duration;
        ti.pitch = ((delay << 8) + ti.transpose) & 0xffff;
        if (this.channelLevel[p.chan] > p.level) return 1;
        if (slur) this.voices.slur(p.chan, ti.pitch);
        else this.voices.noteOn(p.chan, ti.pitch);
        return 1;
      }
      case F_REST: {
        let ptr = p.ip + 1;
        const dur = a[ptr++];
        p.fn = a[ptr];
        p.ip = ptr;
        p.timer += dur;
        if (this.channelLevel[p.chan] > p.level) return 1;
        this.voices.noteOff(p.chan);
        return 1;
      }
      case F_RING: {
        let ptr = p.ip + 1;
        const dur = a[ptr++];
        p.fn = a[ptr];
        p.ip = ptr;
        p.timer += dur;
        return 1;
      }
      case F_LOOP: {
        ti.loopCounter[ti.loopLevel] = a[p.ip + 1];
        ti.loopAddr[ti.loopLevel++] = p.ip + 2;
        p.ip = p.ip + 2;
        p.fn = a[p.ip];
        return 1;
      }
      case F_ENDLOOP: {
        const lvl = ti.loopLevel - 1;
        if (lvl < 0) {
          p.ip += 1;
        } else if (--ti.loopCounter[lvl] !== 0) {
          p.ip = ti.loopAddr[lvl];
        } else {
          p.ip += 1;
          ti.loopLevel--;
        }
        p.fn = a[p.ip];
        return 1;
      }
      case F_PATCH: {
        let ptr = p.ip + 1;
        const pat = a[ptr++];
        p.fn = a[ptr];
        p.ip = ptr;
        ti.patch = pat;
        ti.pan = 0;
        ti.volume = 0;
        if (this.channelLevel[p.chan] > p.level) return 1;
        this.voices.setPatch(p.chan, pat);
        return 1;
      }
      case F_PAN: {
        let ptr = p.ip + 1;
        const pan = a[ptr++] & 0xff;
        p.fn = a[ptr];
        p.ip = ptr;
        ti.pan = pan;
        if (this.channelLevel[p.chan] > p.level) return 1;
        this.voices.setPan(p.chan, pan);
        return 1;
      }
      case F_VOLUME: {
        const v = (ti.volume + a[p.ip + 1]) & 0xff;
        p.ip += 2;
        p.fn = a[p.ip];
        ti.volume = v;
        if (this.channelLevel[p.chan] > p.level) return 1;
        this.voices.setVolume(p.chan, v);
        return 1;
      }
      case F_XPOSE: {
        ti.transpose = (ti.transpose + a[p.ip + 1]) & 0xffff;
        p.ip += 2;
        p.fn = a[p.ip];
        return 1;
      }
      case F_XSET: {
        ti.transpose = a[p.ip + 1];
        p.ip += 2;
        p.fn = a[p.ip];
        return 1;
      }
      case F_CLOCKSET: {
        p.ip += 2;
        p.fn = a[p.ip];
        return 1;
      }
      case F_FILTERINC:
      case F_FILTERSET: {
        // Keep the cutoff signed; it is a cents value that goes well below
        // zero when the sequence closes the filter.
        const cut = (a[p.ip + 1] << 16) >> 16;
        ti.filtercutoff = ((p.fn === F_FILTERINC ? ti.filtercutoff + cut : cut) << 16) >> 16;
        ti.filterres = a[p.ip + 2];
        p.ip += 3;
        p.fn = a[p.ip];
        this.voices.setFilter(p.chan, ti.filtercutoff, ti.filterres);
        return 1;
      }
      case F_END:
      default:
        this.voices.noteOff(p.chan);
        return 0;
    }
  }
}

// Loads the converted data. Absent file just means no authentic track.
async function loadBootSound(base) {
  try {
    const res = await fetch((base || "sound/") + "bootsound.json");
    if (!res.ok) return null;
    const json = await res.json();
    if (!json.tracks || !json.tracks.length) return null;
    const samples = {};
    for (const k of Object.keys(json.samples || {})) samples[k] = Int16Array.from(json.samples[k]);
    return { trackMap: json.trackMap, tracks: json.tracks, samples };
  } catch (err) {
    return null;
  }
}
