// Port of Shield.cpp. Three Shields and five ZShields orbit the blob. Each is a
// piece of a sphere shell - "a piece bounded by lat and long lines where the
// center is on the equator", as Shield.h puts it - built at two radii with a
// capped rim, dark and translucent, picking up specular glints from the blob
// and mood lights.

const SHIELD_ROTATION_RATE = 2.0;
const SHIELD_WIDTH = 8;
const SHIELD_HEIGHT = 6;
const SHIELD_INSIDE_RADIUS = 13.1;
const SHIELD_OUTSIDE_RADIUS = 14.0;
const SHIELD_VERT_DIM = 0.9;
const SHIELD_HORIZ_DIM = 1.2;
const SHIELD_HORIZ_RADIANS = 1.2;
const MAX_SHIELDS = 3;
const MAX_ZSHIELDS = 5;
const MOOD_LIGHT_POS = [0, -40, 30];

function shieldMul(a, b) {
  const o = new Array(16).fill(0);
  for (let r = 0; r < 4; r++)
    for (let c = 0; c < 4; c++)
      o[r * 4 + c] =
        a[r * 4] * b[c] + a[r * 4 + 1] * b[4 + c] + a[r * 4 + 2] * b[8 + c] + a[r * 4 + 3] * b[12 + c];
  return o;
}

function yRotation(r) {
  const s = Math.sin(r);
  const c = Math.cos(r);
  return [c, 0, s, 0, 0, 1, 0, 0, -s, 0, c, 0, 0, 0, 0, 1];
}

function zRotation(r) {
  const s = Math.sin(r);
  const c = Math.cos(r);
  return [c, s, 0, 0, -s, c, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
}

// math::SetRotationFromRHQuat
function rhQuatMatrix(q) {
  const x = q[0], y = q[1], z = q[2], w = q[3];
  return [
    w * w + x * x - y * y - z * z, 2 * x * y + 2 * w * z, 2 * x * z - 2 * w * y, 0,
    2 * x * y - 2 * w * z, w * w - x * x + y * y - z * z, 2 * y * z + 2 * w * x, 0,
    2 * x * z + 2 * w * y, 2 * y * z - 2 * w * x, w * w - x * x - y * y + z * z, 0,
    0, 0, 0, 1,
  ];
}

// D3DFILL_WIREFRAME has no WebGL equivalent, so the strip is expanded into the
// edges of the triangles it describes. Degenerate taps collapse and drop out.
function stripToLines(idx) {
  const seen = new Set();
  const lines = [];
  const edge = (a, b) => {
    if (a === b) return;
    const key = a < b ? a * 65536 + b : b * 65536 + a;
    if (seen.has(key)) return;
    seen.add(key);
    lines.push(a, b);
  };
  for (let i = 0; i + 2 < idx.length; i++) {
    const a = idx[i];
    const b = idx[i + 1];
    const c = idx[i + 2];
    if (a === b || b === c || a === c) continue;
    edge(a, b);
    edge(b, c);
    edge(c, a);
  }
  return lines;
}

// The vertex layout both builders share: an outer face, then a ring of rim
// vertices, then an inner face. dirOf gives the unit direction for a grid
// corner and sideOf the rim normal for border run `border`.
function shieldPanelMesh(dirOf, sideOf, insideRadius, outsideRadius) {
  const width = SHIELD_WIDTH;
  const height = SHIELD_HEIGHT;
  const perFace = (height + 1) * (width + 1);
  const sideCount = 2 * 2 * (height + 1) + 2 * 2 * (width + 1);
  const total = 2 * perFace + sideCount;

  const pos = new Float32Array(total * 3);
  const nrm = new Float32Array(total * 3);
  const put = (at, dir, radius, n) => {
    pos[at * 3] = dir[0] * radius;
    pos[at * 3 + 1] = dir[1] * radius;
    pos[at * 3 + 2] = dir[2] * radius;
    nrm[at * 3] = n[0];
    nrm[at * 3 + 1] = n[1];
    nrm[at * 3 + 2] = n[2];
  };

  let outer = 0;
  let inner = perFace + sideCount;
  for (let j = 0; j <= height; j++) {
    for (let i = 0; i <= width; i++) {
      const n = dirOf(i, j);
      put(outer++, n, outsideRadius, n);
      put(inner++, n, insideRadius, [-n[0], -n[1], -n[2]]);
    }
  }

  let e = perFace;
  const edge = (i, j, border) => {
    const n = dirOf(i, j);
    const s = sideOf(i, j, border);
    put(e++, n, outsideRadius, s);
    put(e++, n, insideRadius, s);
  };
  for (let j = 0; j <= height; j++) edge(0, j, 0);
  for (let i = 0; i <= width; i++) edge(i, height, 1);
  for (let j = height; j >= 0; j--) edge(width, j, 2);
  for (let i = width; i >= 0; i--) edge(i, 0, 3);

  const idx = tristripMesh(width, height, false, true, 0).concat(
    tristripMesh(width, height, true, true, perFace + sideCount + width, 0, -1)
  );
  let vertexIndex = perFace;
  for (let i = 0; i < 4; i++) {
    idx.push(vertexIndex);
    const length = i & 1 ? width : height;
    for (let j = 0; j <= length; j++) {
      idx.push(vertexIndex);
      idx.push(vertexIndex + 1);
      vertexIndex += 2;
    }
    if (i < 3) idx.push(vertexIndex - 1);
  }
  return { pos, nrm, idx, lines: stripToLines(idx), count: total };
}

// ShieldMgr::create: a flat grid at x=1, normalised onto the sphere.
function makeShieldMesh() {
  const left = -0.5 * SHIELD_HORIZ_DIM;
  const bottom = -0.5 * SHIELD_VERT_DIM;
  const hStep = SHIELD_HORIZ_DIM / SHIELD_WIDTH;
  const vStep = SHIELD_VERT_DIM / SHIELD_HEIGHT;
  const dirOf = (i, j) => {
    const v = [1, left + hStep * i, bottom + vStep * j];
    const l = Math.hypot(v[0], v[1], v[2]);
    return [v[0] / l, v[1] / l, v[2] / l];
  };
  const sides = [[0, -1, 0], [0, 0, 1], [0, 1, 0], [0, 0, -1]];
  return shieldPanelMesh(dirOf, (i, j, border) => sides[border], SHIELD_INSIDE_RADIUS, SHIELD_OUTSIDE_RADIUS);
}

// ZShield::restart: real spherical angles, so the band wraps the vertical axis.
// The rim loops reuse the sin/cos left over from the previous run, which is why
// the normals below mix the current angle with the opposite edge's.
function makeZShieldMesh(startRadian, endRadian, outsideRadius) {
  const insideRadius = outsideRadius - 0.5;
  const left = -0.5 * SHIELD_HORIZ_RADIANS;
  const hStep = SHIELD_HORIZ_RADIANS / SHIELD_WIDTH;
  const vStep = (endRadian - startRadian) / SHIELD_HEIGHT;
  const angles = (i, j) => [startRadian + vStep * j, left + hStep * i];
  const dirOf = (i, j) => {
    const [fj, fi] = angles(i, j);
    return [Math.cos(fj) * Math.cos(fi), Math.cos(fj) * Math.sin(fi), Math.sin(fj)];
  };
  const sideOf = (i, j, border) => {
    const [fj, fi] = angles(i, j);
    const vs = Math.sin(fj);
    const vc = Math.cos(fj);
    const hs = Math.sin(fi);
    const hc = Math.cos(fi);
    if (border === 0) return [hs, -hc, 0];
    if (border === 1) return [-vs * hc, -vs * hs, vc];
    if (border === 2) return [-hs, hc, 0];
    return [vs * hc, vs * hs, -vc];
  };
  return shieldPanelMesh(dirOf, sideOf, insideRadius, outsideRadius);
}

class ShieldManager {
  constructor(rand) {
    this.rand = rand;
    this.center = [0, 0, 1];
    this.midRadius = (SHIELD_INSIDE_RADIUS + SHIELD_OUTSIDE_RADIUS) * 0.5;
    this.radiusScale = 1 - (1.2 * (SHIELD_OUTSIDE_RADIUS - SHIELD_INSIDE_RADIUS)) / SHIELD_OUTSIDE_RADIUS;
    this.panel = makeShieldMesh();
    this.shields = [];
    this.zShields = [];
    this.time = 0;
    this.restart();
  }

  // ShieldMgr::restartShields
  restart() {
    this.shields = [];
    let scale = 1;
    for (let i = 0; i < MAX_SHIELDS; i++) {
      const s = this.newShield();
      s.radiusScale = scale;
      s.objectCenter = [this.midRadius * scale, 0, 0];
      this.advanceShield(s, 0);
      this.shields.push(s);
      scale *= this.radiusScale;
    }

    this.zShields = [];
    let minRad = -0.45 * Math.PI;
    const step = (0.9 * Math.PI) / MAX_ZSHIELDS;
    for (let i = 0; i < MAX_ZSHIELDS; i++) {
      const midRad = minRad + step;
      const z = {
        mesh: makeZShieldMesh(minRad, midRad, scale * this.midRadius),
        theta: 0,
        speed: 0,
        matrix: null,
      };
      this.advanceZShield(z, 0);
      this.zShields.push(z);
      minRad = midRad;
    }
    this.time = 0;
  }

  // Shield::restart
  newShield() {
    const crossing = this.rand.rand01() * 2.09 * Math.PI;
    const arc = Math.PI * 1.2;
    let flipped = false;
    const rz = this.rand.rand01() * 2 * Math.PI;
    let ry = this.rand.rand01() * arc * 2 - arc * 0.5;
    if (ry > arc * 0.5) {
      ry += Math.PI - arc;
      flipped = true;
    }
    const startRotation = shieldMul(yRotation(ry), zRotation(rz));
    return {
      startRotation,
      rotationDir: [startRotation[8], startRotation[9], startRotation[10]],
      thetaZero: flipped ? rz + Math.PI - crossing : -rz - crossing,
      speed: 0,
      radiusScale: 1,
      objectCenter: [0, 0, 0],
      matrix: null,
      center: [0, 0, 0],
    };
  }

  // Shield::advanceTime. START_PUSHOUT_RADIUS is zero, so pushout_radius drops
  // out and the offset is a flat 2.0.
  advanceShield(s, dt) {
    s.speed += dt * 0.8;
    s.thetaZero = dt * SHIELD_ROTATION_RATE * s.speed + s.thetaZero;
    const half = s.thetaZero * 0.5;
    const sn = Math.sin(half);
    const q = [s.rotationDir[0] * sn, s.rotationDir[1] * sn, s.rotationDir[2] * sn, Math.cos(half)];
    const m = shieldMul(s.startRotation, rhQuatMatrix(q));
    for (let k = 0; k < 3; k++) {
      m[k] *= s.radiusScale;
      m[4 + k] *= s.radiusScale;
      m[8 + k] *= s.radiusScale;
    }
    m[12] = this.center[0] + m[0] * 2;
    m[13] = this.center[1] + m[1] * 2;
    m[14] = this.center[2] + m[2] * 2;
    s.matrix = m;
    const c = s.objectCenter;
    s.center = [
      c[0] * m[0] + c[1] * m[4] + c[2] * m[8] + m[12],
      c[0] * m[1] + c[1] * m[5] + c[2] * m[9] + m[13],
      c[0] * m[2] + c[1] * m[6] + c[2] * m[10] + m[14],
    ];
  }

  // ZShield::advanceTime
  advanceZShield(z, dt) {
    z.speed += dt * 0.8;
    z.theta += z.speed * dt;
    const m = zRotation(z.theta);
    m[12] += m[0] * 2;
    m[13] += m[1] * 2;
    m[14] += m[2] * 2;
    z.matrix = m;
  }

  seek(target) {
    if (target < this.time) this.restart();
    let guard = 0;
    while (this.time + BLOB_SIM_DT <= target && guard++ < 4000) {
      this.time += BLOB_SIM_DT;
      for (const s of this.shields) this.advanceShield(s, BLOB_SIM_DT);
      for (const z of this.zShields) this.advanceZShield(z, BLOB_SIM_DT);
    }
  }
}

// ShieldMgr::render alpha ramp and blob-light scaling.
function shieldShading(t) {
  let shading = 0.75;
  if (t < SHIELD_FADE_IN_START + SHIELD_FADE_IN_DELTA) {
    shading *= (t - SHIELD_FADE_IN_START) / SHIELD_FADE_IN_DELTA;
  } else if (t > SHIELD_FADE_OUT_START) {
    shading *= (SHIELD_FADE_OUT_START + SHIELD_FADE_OUT_DELTA - t) / SHIELD_FADE_OUT_DELTA;
  }
  return Math.min(1, Math.max(0, shading));
}

function shieldIntensity(t, blobIntensity) {
  const scale = Math.min(1, Math.max(0, (t - PUSHOUT_START_TIME) / PUSHOUT_DELTA));
  // This lands in c1, a register combiner constant, which is fixed point in
  // [0,1] - the hardware cannot hold the 2x the source multiplies in.
  return Math.min(1, blobIntensity * 2 * scale * scale);
}
