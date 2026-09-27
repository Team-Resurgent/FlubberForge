// Port of blob.cpp, blob_bump.cpp and bloblet.cpp from BootAnimRXDK.
// The blob is a cube-mapped unit sphere whose vertices are pushed outwards each
// frame by up to 32 travelling bumps; eight of those bumps drag a bloblet out
// through the surface. Geometry, timing and the random sequence match the
// original so the shape reads the same as it does on hardware.

const BLOB_DIM = 32;
const BLOBLET_DIM = 8;
const MAX_BLOBBUMPS = 32;
const MAX_BLOBLETS = 8;
const BLOB_RADIUS = 2.3;
const LLI_RAND_MAX = 0x00010000;
const LLI_RAND_MASK = 0x0000ffff;
const OO_MAX_INTENSITY_DELTA = 1 / MAX_INTENSITY_DELTA;
const BLOB_SIM_DT = 1 / 60;
const BLOB_BASE_INTENSITY = 0.3;

// app.cpp blobLight. Ambient is black, so the scene's ambient term vanishes:
// primitive_set multiplies SceneAmbient by this, so the theme colour never
// reaches the screen no matter what it is set to.
const BLOB_LIGHT_AMBIENT = 0.0;
const BLOB_LIGHT_DIFFUSE = 0.13;
const BLOB_LIGHT_SPECULAR = 1.0;
const BLOB_LIGHT_ATTEN0 = 1.0;
const BLOB_LIGHT_ATTEN1 = 0.001;
const BLOB_LIGHT_ATTEN2 = 0.001;

// quick_rand.cpp: new_seed = ror(seed, 13) - (seed - 11), unsigned 32-bit.
class QuickRand {
  constructor(seed) {
    this.init(seed);
  }
  init(seed) {
    this.seed = (seed === undefined ? 0x76543210 : seed) >>> 0;
  }
  rand() {
    const s = this.seed >>> 0;
    const rotated = ((s >>> 13) | (s << 19)) >>> 0;
    const next = (rotated - (s - 11)) >>> 0;
    this.seed = next;
    return next;
  }
  rand01() {
    return (this.rand() & LLI_RAND_MASK) / LLI_RAND_MAX;
  }
  rand11() {
    return ((this.rand() & LLI_RAND_MASK) * 2) / LLI_RAND_MAX - 1;
  }
}

function tristripMesh(xQuads, yQuads, doubleFirst, doubleLast, start, vstride, hstride) {
  if (!vstride) vstride = xQuads + 1;
  if (!hstride) hstride = 1;
  if (xQuads > 14) {
    return tristripMesh(14, yQuads, doubleFirst, true, start, vstride, hstride)
      .concat(tristripMesh(xQuads - 14, yQuads, true, doubleLast, start + 14 * hstride, vstride, hstride));
  }
  const idx = [];
  if (doubleFirst) idx.push(start);
  idx.push(start);
  for (let i = 1; i <= xQuads; i++) {
    idx.push(start + i * hstride);
    idx.push(start + i * hstride);
  }
  for (let j = 0; j < yQuads; j++) {
    idx.push(start + j * vstride);
    for (let i = 0; i <= xQuads; i++) {
      idx.push(start + j * vstride + i * hstride);
      idx.push(start + (j + 1) * vstride + i * hstride);
    }
    if (j < yQuads - 1) idx.push(start + (j + 1) * vstride + xQuads * hstride);
  }
  if (doubleLast) idx.push(start + yQuads * vstride + xQuads * hstride);
  return idx;
}

// blob::generateUnitSphere
function unitSphere(resolution) {
  const subdiv = Math.max(1, (resolution / 2) | 0);
  const step = 2 / subdiv;
  const pos = [];
  for (let k = 0; k < 6; k++) {
    for (let j = 0; j <= subdiv; j++) {
      for (let i = 0; i <= subdiv; i++) {
        const fu = i === subdiv ? 1 : -1 + step * i;
        const fv = j === subdiv ? 1 : -1 + step * j;
        let p;
        if (k === 0) p = [-1, -fu, fv];
        else if (k === 1) p = [fv, -1, -fu];
        else if (k === 2) p = [-fu, fv, -1];
        else if (k === 3) p = [1, fu, fv];
        else if (k === 4) p = [fv, 1, fu];
        else p = [fu, fv, 1];
        const l = Math.hypot(p[0], p[1], p[2]) || 1;
        pos.push(p[0] / l, p[1] / l, p[2] / l);
      }
    }
  }
  const perFace = (subdiv + 1) * (subdiv + 1);
  let idx = [];
  for (let k = 0; k < 6; k++) {
    idx = idx.concat(tristripMesh(subdiv, subdiv, k > 0, k < 5, k * perFace));
  }
  return { pos, idx, subdiv, perFace, count: perFace * 6 };
}

class Bloblet {
  constructor(sim) {
    this.sim = sim;
    this.fRadius = 0;
    this.fStartTime = 0;
    this.fTimeMultiple = 0;
    this.fMaxDist = 0;
    this.fWobble = 1;
    this.fWobbleDirection = 0;
    this.fCurDist = 0;
    this.bFarSide = false;
    this.vPosition = [0, 0, 0];
    this.vDirection = [0, 0, 1];
  }

  update(elapsed, dt) {
    this.fWobble = Math.min(2, Math.max(0.5, this.fWobble + this.fWobbleDirection * dt));
    if (this.fWobbleDirection > 0) {
      if (this.fWobble < 0.95 || this.fWobble > 1) this.fWobbleDirection -= (this.fWobble - 1) * dt * 1000;
    } else if (this.fWobble < 1 || this.fWobble > 1.05) {
      this.fWobbleDirection -= (this.fWobble - 1) * dt * 1000;
    }

    const timeProg = Math.max(0, (elapsed - BLOB_STATIC_END_TIME) * OO_MAX_INTENSITY_DELTA);
    let t = this.fTimeMultiple * (elapsed - this.fStartTime);
    t *= 1.4 * (1 + elapsed / 10);
    let s = Math.sin(t);
    let sm = Math.abs(s);
    sm = 1 - (1 - sm) * Math.sqrt(1 - sm);
    s = s > 0 ? sm : -sm;

    this.fCurDist = this.fMaxDist * s * timeProg;
    this.bFarSide = this.fCurDist < 0;
    this.vPosition = [
      this.sim.center[0] + this.vDirection[0] * this.fCurDist,
      this.sim.center[1] + this.vDirection[1] * this.fCurDist,
      this.sim.center[2] + this.vDirection[2] * this.fCurDist,
    ];
    return Math.abs(this.fCurDist) + this.fRadius < BLOB_RADIUS * 0.5;
  }
}

class BlobBump {
  constructor(sim) {
    this.sim = sim;
    this.fRadius = 0;
    this.fRadius2 = 0;
    this.fOORadius2 = 0;
    this.fMagnitude = 0;
    this.vPosition = [0, 0, 0];
    this.facesOfInterest = 0;
    this.vDirection = [0, 0, 1];
    this.fStartTime = 0;
    this.fTimeMul = 0;
    this.fMaxMagnitude = 0;
    this.bStillAttached = false;
    this.bloblet = null;
  }

  recalcFaces() {
    const d = this.vDirection;
    const r = this.fRadius;
    this.facesOfInterest =
      (d[0] - r < -0.57735 ? 0x01 : 0) +
      (d[1] - r < -0.57735 ? 0x02 : 0) +
      (d[2] - r < -0.57735 ? 0x04 : 0) +
      (d[0] + r > 0.57735 ? 0x08 : 0) +
      (d[1] + r > 0.57735 ? 0x10 : 0) +
      (d[2] + r > 0.57735 ? 0x20 : 0);
  }

  create(curTime, bloblet) {
    const rnd = this.sim.rand;
    if (curTime < 0) this.bloblet = null;

    let d = [rnd.rand11(), rnd.rand11(), rnd.rand11()];
    if (d[0] * d[0] + d[1] * d[1] + d[2] * d[2] < 0.001) d = [rnd.rand11(), rnd.rand11(), 1];
    const len = Math.hypot(d[0], d[1], d[2]) || 1;
    this.vDirection = [d[0] / len, d[1] / len, d[2] / len];
    this.vPosition = [0, 0, 0];

    const timeProg = Math.max(0, (curTime - BLOB_STATIC_END_TIME) * OO_MAX_INTENSITY_DELTA);
    const radMagRand = rnd.rand01();

    this.fRadius = radMagRand * 0.4 + 0.4;
    this.fRadius2 = this.fRadius * this.fRadius;
    this.fOORadius2 = 1 / this.fRadius2;
    this.fMagnitude = 0;
    this.recalcFaces();

    this.fStartTime = curTime + 0.4 * rnd.rand01();
    this.fMaxMagnitude = (1 - radMagRand) * 0.5 + 0.2;
    this.fMaxMagnitude *= 0.5 + 0.5 * timeProg;

    if (!this.bloblet) this.bloblet = bloblet || null;

    if (this.bloblet) {
      const b = this.bloblet;
      b.fRadius = (rnd.rand01() + 1) * 0.25 * BLOB_RADIUS * this.fRadius;
      b.vDirection = this.vDirection.slice();
      b.fMaxDist = BLOB_RADIUS * (5 + rnd.rand11() * 2);
      b.fMaxDist *= 0.6;
      b.fStartTime = curTime < -1 ? -rnd.rand01() * 0.3 : curTime;
      let period = 0.8 + 0.3 * rnd.rand01();
      period *= 1 / 0.6;
      b.fTimeMultiple = (2 * Math.PI) / period;
      b.fWobble = 1.2;
      b.fWobbleDirection = 0;
      this.bStillAttached = curTime - this.fStartTime < 0.4 * period;
      b.update(curTime, 0);
      this.update(curTime, 0, null);
      return true;
    }

    const sequenceLen = this.fMaxMagnitude * 0.3 + rnd.rand01() * 0.3;
    this.fTimeMul = Math.PI / sequenceLen;
    this.fTimeMul *= timeProg * 0.2 + 0.8;
    if (curTime < -1) this.fStartTime = (-rnd.rand01() * Math.PI) / this.fTimeMul;
    return false;
  }

  update(elapsed, dt, spare) {
    if (this.bloblet) {
      const b = this.bloblet;
      const mag = (Math.abs(b.fCurDist) + b.fRadius) / BLOB_RADIUS;
      this.fMagnitude = Math.min(2, Math.max(0, mag - 1));
      if (this.bStillAttached) {
        if (this.fMagnitude > 0.8) {
          this.bStillAttached = false;
          this.fMaxMagnitude = this.fMagnitude;
          const sequenceLen = 0.3 * this.fMagnitude;
          this.fTimeMul = (2 * Math.PI) / sequenceLen;
          this.fStartTime = elapsed - 0.25 * sequenceLen;
          b.fWobble = Math.max(0.6, Math.min(0.8, this.fMagnitude - 0.5));
          b.fWobbleDirection = 0;
        } else {
          const dot =
            this.vDirection[0] * b.vDirection[0] +
            this.vDirection[1] * b.vDirection[1] +
            this.vDirection[2] * b.vDirection[2];
          if (dot < 0 !== b.bFarSide) {
            this.vDirection = [-this.vDirection[0], -this.vDirection[1], -this.vDirection[2]];
            this.vPosition = this.vDirection.slice();
            this.recalcFaces();
          }
          return false;
        }
      }
      if (!this.bStillAttached && mag < 0.9) this.bStillAttached = true;
    }

    const t = (elapsed - this.fStartTime) * this.fTimeMul;
    if (t > Math.PI) {
      if (!this.bloblet) return this.create(elapsed, spare);
      this.fMagnitude = 0;
      return false;
    }
    if (t < 0) return false;

    this.fMagnitude = this.fMaxMagnitude * Math.sin(t);
    this.vPosition = this.vDirection.slice();
    this.recalcFaces();
    return false;
  }
}

class BlobSim {
  constructor() {
    this.rand = new QuickRand();
    this.center = [0, 0, 0];
    this.scale = [1, 1, 1];
    this.bumps = [];
    this.bloblets = [];
    for (let i = 0; i < MAX_BLOBBUMPS; i++) this.bumps.push(new BlobBump(this));
    for (let i = 0; i < MAX_BLOBLETS; i++) this.bloblets.push(new Bloblet(this));
    this.numBumps = 0;
    this.numBloblets = 0;
    this.sphere = unitSphere(BLOB_DIM);
    this.bloblet = unitSphere(BLOBLET_DIM);
    // normal.xyz + displacement in w, one per blob vertex.
    this.changing = new Float32Array(this.sphere.count * 4);
    this.time = 0;
    this.restart();
  }

  restart() {
    this.rand.init();
    this.numBloblets = 0;
    this.numBumps = 0;
    while (this.numBumps < MAX_BLOBBUMPS) {
      const spare = this.numBloblets < MAX_BLOBLETS ? this.bloblets[this.numBloblets] : null;
      if (this.bumps[this.numBumps++].create(-0.3, spare)) this.numBloblets++;
    }
    this.zeroChanging();
    this.time = 0;
  }

  // blob::zeroChangingVertices
  zeroChanging() {
    const us = this.sphere.pos;
    const out = this.changing;
    for (let i = 0, v = 0; i < out.length; i += 4, v += 3) {
      out[i] = us[v];
      out[i + 1] = us[v + 1];
      out[i + 2] = us[v + 2];
      out[i + 3] = 1;
    }
  }

  // blob::prepareChangingVertices
  prepareChanging() {
    const us = this.sphere.pos;
    const out = this.changing;
    const perFace = this.sphere.perFace;
    let v = 0;
    for (let face = 0; face < 6; face++) {
      const boi = [];
      for (let i = 0; i < this.numBumps; i++) {
        if (this.bumps[i].facesOfInterest & (1 << face)) boi.push(this.bumps[i]);
      }
      for (let i = 0; i < perFace; i++, v++) {
        const nx = us[v * 3];
        const ny = us[v * 3 + 1];
        const nz = us[v * 3 + 2];
        let ax = nx;
        let ay = ny;
        let az = nz;
        let aw = 0;
        for (let j = boi.length - 1; j >= 0; j--) {
          const bump = boi[j];
          const dx = nx - bump.vPosition[0];
          const dy = ny - bump.vPosition[1];
          const dz = nz - bump.vPosition[2];
          const dist2 = dx * dx + dy * dy + dz * dz;
          if (dist2 >= bump.fRadius2) continue;
          const dist2mo = dist2 * bump.fOORadius2 - 1;
          const displacement = BLOB_RADIUS * bump.fMagnitude * dist2mo * dist2mo;
          const perturb = -4 * bump.fMagnitude * bump.fOORadius2 * dist2mo;
          let lx = nx + dx * perturb;
          let ly = ny + dy * perturb;
          let lz = nz + dz * perturb;
          const l = Math.hypot(lx, ly, lz) || 1;
          ax += lx / l;
          ay += ly / l;
          az += lz / l;
          aw += displacement;
        }
        const o = v * 4;
        out[o] = ax;
        out[o + 1] = ay;
        out[o + 2] = az;
        out[o + 3] = aw;
      }
    }
  }

  // blob::advanceTime
  advance(elapsed, dt) {
    if (elapsed < BLOB_STATIC_END_TIME) return;
    for (let i = 0; i < this.numBloblets; i++) this.bloblets[i].update(elapsed, dt);
    for (let i = 0; i < this.numBumps; i++) {
      const spare = this.numBloblets < MAX_BLOBLETS ? this.bloblets[this.numBloblets] : null;
      if (this.bumps[i].update(elapsed, dt, spare)) this.numBloblets++;
    }
    this.prepareChanging();
  }

  // Deterministic fixed-step catch-up so scrubbing lands on the same shape.
  seek(target) {
    if (target < this.time) this.restart();
    let guard = 0;
    while (this.time + BLOB_SIM_DT <= target && guard++ < 4000) {
      this.time += BLOB_SIM_DT;
      this.advance(this.time, BLOB_SIM_DT);
    }
  }

  // blob::getLightForPosition
  lightFor(position, intensity) {
    let totalWeight = 0;
    const av = [0, 0, 0];
    const add = (p) => {
      const dx = position[0] - p[0];
      const dy = position[1] - p[1];
      const dz = position[2] - p[2];
      const dist2 = Math.max(1e-6, dx * dx + dy * dy + dz * dz);
      const w = 1 / dist2;
      av[0] += p[0] * w;
      av[1] += p[1] * w;
      av[2] += p[2] * w;
      totalWeight += w;
      return w;
    };
    add(this.center);
    for (let i = 0; i < this.numBloblets; i++) add(this.bloblets[i].vPosition);
    const oo = 1 / totalWeight;
    return [av[0] * oo, av[1] * oo, av[2] * oo];
  }
}

// tex_gen::CreateGlowTexture(256, 256, 0xffffffff, 0, 12345) at mip 0.
function glowTexels(size) {
  const data = new Uint8Array(size * size * 4);
  let scale = 1;
  let tmp = 4096 / size;
  while (tmp !== 1) {
    scale++;
    tmp >>= 1;
  }
  const cntr = ((size - 1) / 2) | 0;
  const limit = 4096 * 4096;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const sx = (x - cntr) << scale;
      const sy = (y - cntr) << scale;
      const dist2 = sx * sx + sy * sy;
      const term = dist2 <= limit ? limit - dist2 : 0;
      // rcl ebx,8 then sbb ebx,0: a 33-bit rotate through carry, carry starting clear.
      const shifted = (term & 0x1ff0000) * 256;
      const carry = shifted >= 4294967296 ? 1 : 0;
      const e = ((shifted % 4294967296) - carry) >>> 0;
      const h = (e >>> 24) & 0xff;
      let v = h * h;
      v = Math.floor((v * v) / 65536);
      v = Math.floor((v * v) / 65536) & 0xff00;
      const b = v >> 8;
      const o = (y * size + x) * 4;
      data[o] = b;
      data[o + 1] = b;
      data[o + 2] = b;
      data[o + 3] = b;
    }
  }
  return data;
}
