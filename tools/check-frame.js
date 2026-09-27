const fs = require("fs");
const vm = require("vm");
const g = require("../www/geometry.json");
const ctx = { console, Math, Object, parseInt, Number };
vm.createContext(ctx);
vm.runInContext(fs.readFileSync("www/camera.js", "utf8"), ctx);
const cam = ctx.buildCamera(0);
const t = 2.06;
const shot = ctx.sampleCamera(cam, t);
const view = ctx.lookAtMatrix(shot.pos, shot.look, ctx.v3(0, 0, 1));

function mul(m, x, y, z) {
  return {
    x: x * m._11 + y * m._21 + z * m._31 + m._41,
    y: x * m._12 + y * m._22 + z * m._32 + m._42,
    z: x * m._13 + y * m._23 + z * m._33 + m._43,
  };
}

function meshBox(pos) {
  let min = [1e9, 1e9, 1e9];
  let max = [-1e9, -1e9, -1e9];
  for (let i = 0; i < pos.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      min[k] = Math.min(min[k], pos[i + k]);
      max[k] = Math.max(max[k], pos[i + k]);
    }
  }
  return { min, max };
}

function xform(m, s, x, y, z) {
  const sx = x * s[0];
  const sy = y * s[1];
  const sz = z * s[2];
  return [
    sx * m[0] + sy * m[4] + sz * m[8] + m[12],
    sx * m[1] + sy * m[5] + sz * m[9] + m[13],
    sx * m[2] + sy * m[6] + sz * m[10] + m[14],
  ];
}

const boxes = g.meshes.map((m) => meshBox(m.pos));
let cross = 0;
let behind = 0;
let far = 0;
const samples = [];
g.instances.forEach((inst, n) => {
  const b = boxes[inst.mesh];
  let zmin = 1e9;
  let zmax = -1e9;
  for (const x of [b.min[0], b.max[0]]) {
    for (const y of [b.min[1], b.max[1]]) {
      for (const z of [b.min[2], b.max[2]]) {
        const w = xform(inst.m, inst.s, x, y, z);
        const v = mul(view, w[0], w[1], w[2]);
        zmin = Math.min(zmin, v.z);
        zmax = Math.max(zmax, v.z);
      }
    }
  }
  if (zmin < 0.4 && zmax > 0.4) cross++;
  else if (zmax < 0.4) behind++;
  else far++;
  if (n < 8 || inst.s[2] > 100) {
    samples.push({ n, mesh: inst.mesh, s: inst.s.map((v) => +v.toFixed(2)), zmin: +zmin.toFixed(1), zmax: +zmax.toFixed(1) });
  }
});

let longEdge = 0;
let longMesh = -1;
g.meshes.forEach((m, mi) => {
  const p = m.pos;
  for (let i = 0; i < m.idx.length; i += 3) {
    const a = m.idx[i] * 3;
    const b = m.idx[i + 1] * 3;
    const c = m.idx[i + 2] * 3;
    const e = Math.hypot(p[a] - p[b], p[a + 1] - p[b + 1], p[a + 2] - p[b + 2]);
    if (e > longEdge) {
      longEdge = e;
      longMesh = mi;
    }
  }
});

function axisDist(inst) {
  const a = xform(inst.m, inst.s, 0, 0, 0);
  const b = xform(inst.m, inst.s, 0, 0, 1);
  const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const ap = [shot.pos.x - a[0], shot.pos.y - a[1], shot.pos.z - a[2]];
  const ab2 = ab[0] * ab[0] + ab[1] * ab[1] + ab[2] * ab[2] || 1;
  let u = (ap[0] * ab[0] + ap[1] * ab[1] + ap[2] * ab[2]) / ab2;
  u = Math.max(0, Math.min(1, u));
  const q = [a[0] + ab[0] * u, a[1] + ab[1] * u, a[2] + ab[2] * u];
  const d = Math.hypot(shot.pos.x - q[0], shot.pos.y - q[1], shot.pos.z - q[2]);
  return { d: +d.toFixed(2), rad: +inst.s[0].toFixed(2), u: +u.toFixed(2), len: +Math.sqrt(ab2).toFixed(1) };
}
const nearCyl = [];
g.instances.forEach((inst, n) => {
  if (inst.s[2] < 20) return;
  const hit = axisDist(inst);
  if (hit.d < hit.rad * 4) nearCyl.push({ n, ...hit });
});

const meshStats = g.meshes.map((m, mi) => {
  const p = m.pos;
  let emax = 0;
  let span = 0;
  let min = [1e9, 1e9, 1e9];
  let max = [-1e9, -1e9, -1e9];
  for (let i = 0; i < p.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      min[k] = Math.min(min[k], p[i + k]);
      max[k] = Math.max(max[k], p[i + k]);
    }
  }
  span = Math.hypot(max[0] - min[0], max[1] - min[1], max[2] - min[2]);
  for (let i = 0; i < m.idx.length; i += 3) {
    const a = m.idx[i] * 3;
    const b = m.idx[i + 1] * 3;
    const e = Math.hypot(p[a] - p[b], p[a + 1] - p[b + 1], p[a + 2] - p[b + 2]);
    if (e > emax) emax = e;
  }
  return { mi, v: p.length / 3, tris: m.idx.length / 3, emax: +emax.toFixed(3), span: +span.toFixed(3), ratio: +(emax / (span || 1)).toFixed(2) };
});

function mul4(a, b) {
  const o = new Array(16).fill(0);
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 4; c++) {
      o[r * 4 + c] = a[r * 4] * b[c] + a[r * 4 + 1] * b[4 + c] + a[r * 4 + 2] * b[8 + c] + a[r * 4 + 3] * b[12 + c];
    }
  }
  return o;
}
function matFromQuat(q) {
  const x = q[0], y = q[1], z = q[2], w = q[3];
  return [
    w * w + x * x - y * y - z * z, 2 * x * y - 2 * w * z, 2 * x * z + 2 * w * y, 0,
    2 * x * y + 2 * w * z, w * w - x * x + y * y - z * z, 2 * y * z - 2 * w * x, 0,
    2 * x * z - 2 * w * y, 2 * y * z + 2 * w * x, w * w - x * x - y * y + z * z, 0,
    0, 0, 0, 1,
  ];
}
const fpos = (t - ctx.SCENE_ANIM_START_TIME) / ctx.SCENE_ANIM_LEN;
function sampleQuat(seq) {
  const x = Math.max(0, Math.min(0.999, fpos)) * 28;
  const i = x | 0;
  return g.quats[seq[i]];
}
const q0 = sampleQuat(g.quatSeq[0]);
const qn = Math.hypot(q0[0], q0[1], q0[2], q0[3]);
const inst = g.instances[0];
let basis = mul4(inst.m, matFromQuat(sampleQuat(g.quatSeq[inst.rot])));
const world = mul4([inst.s[0], 0, 0, 0, 0, inst.s[1], 0, 0, 0, 0, inst.s[2], 0, 0, 0, 0, 1], basis);
const p = g.meshes[0].pos;
let wmin = [1e9, 1e9, 1e9], wmax = [-1e9, -1e9, -1e9];
for (let i = 0; i < p.length; i += 3) {
  const x = p[i], y = p[i + 1], z = p[i + 2];
  const wx = x * world[0] + y * world[4] + z * world[8] + world[12];
  const wy = x * world[1] + y * world[5] + z * world[9] + world[13];
  const wz = x * world[2] + y * world[6] + z * world[10] + world[14];
  wmin = [Math.min(wmin[0], wx), Math.min(wmin[1], wy), Math.min(wmin[2], wz)];
  wmax = [Math.max(wmax[0], wx), Math.max(wmax[1], wy), Math.max(wmax[2], wz)];
}
const sphere0 = {
  fpos, q0, qn, quatIndex: g.quatSeq[0].slice(0, 6),
  span: wmax.map((v, i) => +(v - wmin[i]).toFixed(2)),
  center: wmin.map((v, i) => +((v + wmax[i]) * 0.5).toFixed(2)),
};

console.log(JSON.stringify({
  cam: shot.pos,
  look: shot.look,
  dist: Math.hypot(shot.pos.x, shot.pos.y, shot.pos.z),
  instances: g.instances.length,
  crossNear: cross,
  behind,
  inFront: far,
  longestLocalEdge: longEdge,
  longMesh,
  nearCyl,
  meshStats,
  sphere0,
  samples,
}, null, 2));
