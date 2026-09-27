const fs = require("fs");
const vm = require("vm");
const g = require("../www/geometry.json");
const ctx = { console, Math, Object, parseInt, Number };
vm.createContext(ctx);
vm.runInContext(fs.readFileSync("www/camera.js", "utf8") + "\nthis.sampleCamera=sampleCamera; this.buildCamera=buildCamera; this.lookAtMatrix=lookAtMatrix; this.v3=v3;", ctx);

const t = 2.06;
const fpos = (t - 0.85) / 4.5;
function slerp(a, b, u) {
  let dp = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
  let bx = b[0], by = b[1], bz = b[2], bw = b[3];
  if (dp < 0) { dp = -dp; bx = -bx; by = -by; bz = -bz; bw = -bw; }
  if (dp > 0.9995) return [a[0] * (1 - u) + bx * u, a[1] * (1 - u) + by * u, a[2] * (1 - u) + bz * u, a[3] * (1 - u) + bw * u];
  const angle = Math.acos(Math.min(1, dp));
  const s = Math.sin(angle);
  const t0 = Math.sin(angle * (1 - u)) / s;
  const t1 = Math.sin(angle * u) / s;
  return [a[0] * t0 + bx * t1, a[1] * t0 + by * t1, a[2] * t0 + bz * t1, a[3] * t0 + bw * t1];
}
function sampleQuat(seq) {
  if (fpos <= 0) return g.quats[seq[0]];
  const x = fpos * 28;
  const i = x | 0;
  return slerp(g.quats[seq[i]], g.quats[seq[Math.min(i + 1, 29)]], x - i);
}
function sampleVec(seq) {
  if (fpos <= 0) return g.positions[seq[0]];
  const x = fpos * 28;
  const i = x | 0;
  const u = x - i;
  const a = g.positions[seq[i]];
  const b = g.positions[seq[Math.min(i + 1, 29)]];
  return [a[0] * (1 - u) + b[0] * u, a[1] * (1 - u) + b[1] * u, a[2] * (1 - u) + b[2] * u];
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
function mul4(a, b) {
  const o = new Array(16).fill(0);
  for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++)
    o[r * 4 + c] = a[r * 4] * b[c] + a[r * 4 + 1] * b[4 + c] + a[r * 4 + 2] * b[8 + c] + a[r * 4 + 3] * b[12 + c];
  return o;
}
const shot = ctx.sampleCamera(ctx.buildCamera(0), t);
const view = ctx.lookAtMatrix(shot.pos, shot.look, ctx.v3(0, 0, 1));
const rows = [];
g.instances.forEach((inst, n) => {
  if (inst.mesh > 1) return;
  let basis = inst.m;
  if (inst.rot >= 0) basis = mul4(inst.m, matFromQuat(sampleQuat(g.quatSeq[inst.rot])));
  if (inst.pos >= 0) {
    const p = sampleVec(g.posSeq[inst.pos]);
    basis = basis.slice();
    basis[12] += p[0]; basis[13] += p[1]; basis[14] += p[2];
  }
  const world = mul4([inst.s[0], 0, 0, 0, 0, inst.s[1], 0, 0, 0, 0, inst.s[2], 0, 0, 0, 0, 1], basis);
  const c = [world[12], world[13], world[14]];
  const vz = c[0] * view._13 + c[1] * view._23 + c[2] * view._33 + view._43;
  const vx = c[0] * view._11 + c[1] * view._21 + c[2] * view._31 + view._41;
  const vy = c[0] * view._12 + c[1] * view._22 + c[2] * view._32 + view._42;
  rows.push({ n, s: +inst.s[0].toFixed(2), rot: inst.rot, pos: inst.pos, c: c.map((v) => +v.toFixed(1)), vz: +vz.toFixed(1), ndc: vz > 0.4 ? [+(vx / vz).toFixed(2), +(vy / vz).toFixed(2)] : null });
});
let nearest = 1e9;
let nearBox = null;
g.instances.forEach((inst, n) => {
  if (inst.mesh !== 11) return;
  let basis = inst.m.slice();
  if (inst.rot >= 0) basis = mul4(inst.m, matFromQuat(sampleQuat(g.quatSeq[inst.rot])));
  if (inst.pos >= 0) {
    const p = sampleVec(g.posSeq[inst.pos]);
    basis = basis.slice();
    basis[12] += p[0]; basis[13] += p[1]; basis[14] += p[2];
  }
  const world = mul4([inst.s[0], 0, 0, 0, 0, inst.s[1], 0, 0, 0, 0, inst.s[2], 0, 0, 0, 0, 1], basis);
  const pos = g.meshes[11].pos;
  for (let i = 0; i < pos.length; i += 3) {
    const x = pos[i], y = pos[i + 1], z = pos[i + 2];
    const wx = x * world[0] + y * world[4] + z * world[8] + world[12];
    const wy = x * world[1] + y * world[5] + z * world[9] + world[13];
    const wz = x * world[2] + y * world[6] + z * world[10] + world[14];
    const d = Math.hypot(wx - shot.pos.x, wy - shot.pos.y, wz - shot.pos.z);
    if (d < nearest) { nearest = d; nearBox = n; }
  }
});
console.log(JSON.stringify({ fpos, cam: shot.pos, spheres: rows.length, nearestBox: +nearest.toFixed(2), nearBox }, null, 2));
