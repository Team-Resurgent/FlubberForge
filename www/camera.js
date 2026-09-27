// Timing matches BootAnimRXDK defines.h.
const DEMO_TOTAL_TIME = 8.0;
const FINAL_HOLD_TIME = 2.0;
const FINISH_TRANSITION_TIME = 0.8;
const FINISH_START_TIME = DEMO_TOTAL_TIME - FINAL_HOLD_TIME - FINISH_TRANSITION_TIME;
const FINISH_STOP_TIME = DEMO_TOTAL_TIME - FINAL_HOLD_TIME;
const BLOB_STATIC_END_TIME = 0.6;
const BLOB_ZERO_INTENSE_END_TIME = BLOB_STATIC_END_TIME + 0.5;
const MAX_INTENSITY_DELTA = FINISH_START_TIME - BLOB_ZERO_INTENSE_END_TIME;
const BLOB_PULSE_START = BLOB_STATIC_END_TIME;
const BLOB_PULSE_END = FINISH_STOP_TIME - 0.4;
const BLOB_PULSE_ELAPSED = BLOB_PULSE_END - BLOB_PULSE_START;
const SCENE_ANIM_LEN = 4.5;
const SCENE_ANIM_START_TIME = BLOB_STATIC_END_TIME + 0.25;
const PUSHOUT_START_TIME = 0.5;
const PUSHOUT_DELTA = 2.7;
const SHIELD_FADE_IN_START = BLOB_STATIC_END_TIME;
const SHIELD_FADE_IN_DELTA = 1.2;
const SHIELD_FADE_OUT_START = FINISH_START_TIME - 0.1;
const SHIELD_FADE_OUT_DELTA = FINISH_TRANSITION_TIME * 0.2;
const GLOW_FADE_CIRCLE_START = FINISH_START_TIME - 0.5;
const GLOW_FADE_SCREEN_START = GLOW_FADE_CIRCLE_START + 0.3;
const SLASH_GRADIENT_START = FINISH_START_TIME - 0.5;
const SLASH_GRADIENT_END = FINISH_STOP_TIME;
const TEXT_ANIM_START = DEMO_TOTAL_TIME - FINAL_HOLD_TIME - 0.1;
const TEXT_ANIM_LEN = 0.25;

// Camera paths and finish dive, ported from camera_controller.cpp.
// ucTime is a percent of FINISH_START_TIME. cameraMode 1 selects path 0.
// cameraMode 0 picks a path from the quick_rand seed.

const CAMERA_PATHS = [
  // Top, pan down, pull out.
  [
    [0, 11.4, -32.1, 33.0, 0, 0, 0],
    [20, 13.4, -37.7, 25.6, 0, 0, 0],
    [40, 15.6, -43.9, 8.8, 0, 0, 0],
    [60, 16.0, -45.0, -12.8, 0, 0, 0],
    [90, 18.2, -51.2, -29.6, 0, 0, 0],
  ],
  [
    [0, -55.4, 19.7, -31.5, 0, 0, 0],
    [30, -55.4, 19.7, -31.5, 0, 0, 0],
    [45, -39.5, -0.6, -7.8, 0, 0, 0],
    [60, -4.3, -35.5, 16.6, 0, 0, 0],
    [70, 31.1, -32.6, 17.6, 0, 0, 0],
    [80, 57.7, -7.2, 3.3, 0, 0, 0],
    [95, 70.9, 1.8, 3.1, 0, 0, 0],
  ],
  [
    [0, 34.7, 25.9, 12.3, 0, 0, 0],
    [25, 42.3, 9.3, 12.3, 0, 0, 0],
    [50, 42.4, -8.8, 12.3, 0, 0, 0],
    [75, 34.4, -26.3, 12.3, 0, 0, 0],
    [95, 30.7, -48.1, 14.3, 0, 0, 0],
  ],
  [
    [0, -50.1, -0.3, -51.5, 0, 0, 0],
    [25, -50.1, -0.3, -51.5, 0, 0, 0],
    [75, -50.1, -0.3, -51.5, 0, 0, 0],
    [95, -62.2, -0.4, -12.0, 0, 0, 0],
  ],
  [
    [0, 3.2, -17.4, 13.0, -1.9, 7.8, -15.3],
    [20, 2.1, -12.1, 6.15, -1.9, 7.8, -15.3],
    [40, 1.0, -6.8, -0.7, -1.9, 7.8, -15.3],
    [55, -7.2, -3.6, -7.5, -1.9, 7.8, -15.3],
    [70, -18.5, 14.1, -18.4, -1.9, 7.8, -15.3],
    [85, -16.2, 29.2, -23.1, -5.1, 8.4, -10.3],
    [95, -10.6, 49.3, -21.2, -5.1, 8.4, -10.3],
  ],
  [
    [0, -1.5, 2.8, -14.0, 0, -1.3, 0],
    [20, -3.8, 16.9, -22.8, 0, -1.3, 0],
    [45, 20.7, 27.6, -21.6, 0, -1.3, 0],
    [75, 18.1, 46.8, -27.0, 0, -1.3, 0],
    [95, 28.9, 75.1, -36.7, 0, -1.3, 0],
  ],
  [
    [0, 15.2, -3.3, -15.9, 0, 0, 0],
    [20, 26.2, -5.7, -20.5, 0, 0, 0],
    [45, 40.2, -8.7, -23.6, 0, 0, 0],
    [65, 61.2, -13.3, -3.6, 0, 0, 0],
    [85, 84.4, -4.8, 11.7, 0, 0, 0],
    [95, 120.4, -8.8, 14.7, 0, 0, 0],
  ],
  [
    [0, -20.5, 48.8, 12.0, 0, 0, -18.6],
    [35, -10.4, 24.6, -2.4, 0, 0, -18.6],
    [70, -10.4, 24.6, -2.4, 0, 0, -18.6],
    [85, -16.5, 39.3, 4.2, -0.3, 0.1, -5.3],
    [95, -26.3, 75.4, -4.6, -0.3, 0.1, -0.5],
  ],
  [
    [0, -92.5, -10.1, 20.9, 0, 0, 0],
    [15, -88.0, 30.4, 20.9, 0, 0, 0],
    [30, -64.7, 67.0, 20.9, 0, 0, 0],
    [45, -22.6, 90.3, 20.9, 0, 0, 0],
    [60, 21.7, 90.5, 20.9, 0, 0, 0],
    [72, 65.4, 66.2, 20.9, 0, 0, 0],
    [85, 97.5, 23.7, 16.1, 0, 0, 0],
    [95, 110.8, -6.1, 0, 0, 0, 0],
  ],
  [
    [0, 62.3, -28.5, -20.2, 0, 0, 0],
    [30, 62.3, -28.5, -20.2, 0, 0, 0],
    [50, 55.2, -25.3, -10.1, 0, 0, 0],
    [75, 56.7, -12.9, 0, 0, 0, 0],
    [95, 73.9, -13.0, 0, 0, 0, 0],
  ],
  [
    [0, 50.4, 33.2, 25.3, 0, 0, 0],
    [30, 50.4, 33.2, 25.3, 0, 0, 0],
    [45, 55.7, 9.3, 15.9, 0, 0, 0],
    [65, 39.1, -35.8, 3.3, 0, 0, 0],
    [90, 7.1, -53.7, 0, 0, 0, 0],
    [95, -16.8, -78.0, 0, 0, 0, 0],
  ],
  [
    [0, -51.7, -2.4, -32.4, 0, 0, 12],
    [25, -51.7, -2.4, -32.4, 0, 0, 12],
    [40, -54.4, -2.6, -23.3, 0, 0, 10],
    [50, -53.2, 6.7, -14.3, 0, 0, 7],
    [60, -41.8, 21.2, -9.3, 0, 0, 4.5],
    [70, -27.1, 34.2, -9.3, 0, 0, 2],
    [80, -6.9, 47.5, -9.3, 0, 0, 1],
    [88, 11.3, 52.3, -9.2, 0, 0, 0.5],
    [95, 24.2, 62.8, -9.0, 0, 0, 0],
  ],
  [
    [0, -2.6, -85.0, 17.7, 0, 0, 0],
    [20, 48.1, -70.1, 17.7, 0, 0, 0],
    [40, 80.1, -28.6, 17.7, 0, 0, 0],
    [60, 81.4, 24.8, 17.7, 0, 0, 0],
    [80, 56.5, 63.6, 17.7, 0, 0, 0],
    [95, 27.9, 86.5, 8.2, 0, 0, 0],
  ],
  [
    [0, 47.3, -76.6, -10.0, 0, 0, 0],
    [25, 11.5, -89.3, -10.0, 0, 0, 0],
    [50, -35.7, -82.6, -10.0, 0, 0, 0],
    [75, -71.9, -54.2, -10.0, 0, 0, 0],
    [95, -89.5, -9.6, -10.0, 0, 0, 0],
  ],
  [
    [0, -11.2, -42.9, 17.0, 0, 0, 0],
    [20, 2.6, -46.9, 7.0, 0, 0, 0],
    [40, 24.3, -40.5, -4.2, 0, 0, 0],
    [60, 38.7, -24.8, -9.0, 0, 0, 0],
    [80, 44.3, -12.1, -7.0, 0, 0, 0],
    [95, 52.4, 6.3, 2.0, 0, 0, 0],
  ],
];

const FINISH_Y = [95.0, 30.548, -70.819, -150.298, -220.64, -243.021, -261.441, -287.773];
const FINISH_Z = [0.0, 0.322, 1.821, 2.323, -11.926, -39.973, -60.774, -90.795];

function v3(x, y, z) {
  return { x, y, z };
}

function vadd(a, b) {
  return v3(a.x + b.x, a.y + b.y, a.z + b.z);
}

function vsub(a, b) {
  return v3(a.x - b.x, a.y - b.y, a.z - b.z);
}

function vscale(a, s) {
  return v3(a.x * s, a.y * s, a.z * s);
}

function vlen(a) {
  return Math.hypot(a.x, a.y, a.z);
}

function vnorm(a) {
  const l = vlen(a) || 1;
  return vscale(a, 1 / l);
}

function vcross(a, b) {
  return v3(a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x);
}

function vdot(a, b) {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

function makeNode(row) {
  return {
    fTime: FINISH_START_TIME * row[0] * 0.01,
    pos: v3(row[1], row[2], row[3]),
    look: v3(row[4], row[5], row[6]),
    vel: v3(0, 0, 0),
    lookW: v3(0, 0, 0),
    tension: 0,
    bias: 0,
  };
}

function buildCamera(pathIndex) {
  const path = CAMERA_PATHS[((pathIndex % CAMERA_PATHS.length) + CAMERA_PATHS.length) % CAMERA_PATHS.length];
  const variable = path.map(makeNode);
  const finish = [];
  for (let j = 0; j < 8; j++) {
    finish.push({
      fTime: FINISH_START_TIME + FINISH_TRANSITION_TIME * (j / 7),
      pos: v3(0, 0, 0),
      look: v3(0, 0, 0),
      vel: v3(0, 0, 0),
      lookW: v3(0, 0, 0),
      tension: 0,
      bias: 0,
    });
  }

  const plast = variable[variable.length - 1];
  const p0 = finish[0];
  p0.pos = v3(plast.pos.x, plast.pos.y, plast.pos.z);
  let vel = v3(0, 0, 0);
  if (variable.length >= 2) {
    const prev = variable[variable.length - 2];
    const dt = plast.fTime - prev.fTime || 0.001;
    vel = vscale(vsub(plast.pos, prev.pos), 1 / dt);
  }
  p0.pos = vadd(p0.pos, vscale(vel, (p0.fTime - plast.fTime) * 0.7));
  const velAdjLen = vlen(p0.pos) || 1;
  const slashDir = vscale(p0.pos, 1 / velAdjLen);
  const slashStart = -95;
  const slashEnd = 132.14;
  const slashYOffset = Math.max(100 - slashStart, velAdjLen * 1.2 - slashStart);
  p0.pos = vscale(slashDir, slashYOffset + slashStart);

  const yDir = vscale(slashDir, -1);
  let xDir = vnorm(vcross(yDir, v3(0, 0, 1)));
  if (vlen(xDir) < 1e-4) xDir = v3(1, 0, 0);
  const zDir = vcross(xDir, yDir);
  const slashCenter = vscale(yDir, -slashEnd - slashYOffset);

  function xformDir(p) {
    return vadd(vscale(xDir, p.x), vadd(vscale(yDir, p.y), vscale(zDir, p.z)));
  }

  const yBasis = slashEnd;
  for (let j = 1; j < 8; j++) {
    const local = v3(0, FINISH_Y[j] + yBasis, FINISH_Z[j]);
    finish[j].pos = vadd(xformDir(local), slashCenter);
  }

  const finalLook = vadd(xformDir(v3(0, slashEnd, 25)), slashCenter);
  const nodes = variable.concat(finish);
  const n = nodes.length;
  for (let j = 0; j < n; j++) {
    const cur = nodes[j];
    cur.vel = v3(0, 0, 0);
    cur.lookW = v3(0, 0, 0);
    if (j) {
      const delta = vsub(cur.pos, nodes[j - 1].pos);
      const w = (1 - cur.tension) * (1 + cur.bias) * 0.5;
      cur.vel = vadd(cur.vel, vscale(delta, w));
      const dl = vsub(cur.look, nodes[j - 1].look);
      cur.lookW = vadd(cur.lookW, vscale(dl, w));
    }
    if (j < n - 1) {
      const delta = vsub(nodes[j + 1].pos, cur.pos);
      const w = (1 - cur.tension) * (1 - cur.bias) * 0.5;
      cur.vel = vadd(cur.vel, vscale(delta, w));
      const dl = vsub(nodes[j + 1].look, cur.look);
      cur.lookW = vadd(cur.lookW, vscale(dl, w));
    }
  }

  const lookStart = finish[2].fTime;
  const lookDelta = 1 / (finish[5].fTime - lookStart);
  const slashT = vscale(yDir, -slashYOffset);
  return {
    nodes,
    variableCount: variable.length,
    finalLook,
    lookStart,
    lookDelta,
    slash: { x: xDir, y: yDir, z: zDir, t: slashT },
  };
}

function sampleCamera(cam, t) {
  const nodes = cam.nodes;
  const n = nodes.length;
  if (t > FINISH_STOP_TIME) {
    return {
      pos: nodes[n - 1].pos,
      look: cam.finalLook,
      renderSlash: true,
      renderGeom: false,
    };
  }

  let i = 1;
  for (; i < n; i++) {
    if (nodes[i].fTime > t) break;
  }
  if (i >= n) {
    return { pos: nodes[n - 1].pos, look: cam.finalLook, renderSlash: true, renderGeom: false };
  }

  const prev = nodes[i - 1];
  const next = nodes[i];
  const dtc = Math.max(0.001, next.fTime - prev.fTime);
  const dtp = Math.max(0.001, i >= 2 ? prev.fTime - nodes[i - 2].fTime : dtc);
  const uts = Math.min(1, Math.max(0, (t - prev.fTime) / dtc));
  const frac = -2 * uts * uts * uts + 3 * uts * uts;
  const s = (t - prev.fTime) / ((1 - frac) * dtp + frac * dtc);
  const ss = s * s;
  const sss = ss * s;
  const cA = 2 * sss - 3 * ss + 1;
  const cB = sss - 2 * ss + s;
  const cC = sss - ss;
  const cD = -2 * sss + 3 * ss;

  const pos = v3(
    cA * prev.pos.x + cB * prev.vel.x + cC * next.vel.x + cD * next.pos.x,
    cA * prev.pos.y + cB * prev.vel.y + cC * next.vel.y + cD * next.pos.y,
    cA * prev.pos.z + cB * prev.vel.z + cC * next.vel.z + cD * next.pos.z
  );
  let look = v3(
    cA * prev.look.x + cB * prev.lookW.x + cC * next.lookW.x + cD * next.look.x,
    cA * prev.look.y + cB * prev.lookW.y + cC * next.lookW.y + cD * next.look.y,
    cA * prev.look.z + cB * prev.lookW.z + cC * next.lookW.z + cD * next.look.z
  );

  const sl = Math.max(0, Math.min(1, (t - cam.lookStart) * cam.lookDelta));
  const interp = 0.5 * (1 - Math.cos(sl * Math.PI));
  look = vadd(vscale(look, 1 - interp), vscale(cam.finalLook, interp));

  return {
    pos,
    look,
    renderSlash: i > cam.variableCount - 1,
    renderGeom: i < n - 1,
  };
}

function lookAtMatrix(cam, look, up) {
  let zAxis = vnorm(vsub(look, cam));
  let xAxis = vnorm(vcross(zAxis, up));
  if (vlen(vcross(zAxis, up)) < 1e-5) xAxis = v3(1, 0, 0);
  const yAxis = vcross(xAxis, zAxis);
  const m = {
    _11: xAxis.x, _12: yAxis.x, _13: zAxis.x,
    _21: xAxis.y, _22: yAxis.y, _23: zAxis.y,
    _31: xAxis.z, _32: yAxis.z, _33: zAxis.z,
    _41: 0, _42: 0, _43: 0,
  };
  const inv = v3(-cam.x, -cam.y, -cam.z);
  m._41 = inv.x * m._11 + inv.y * m._21 + inv.z * m._31;
  m._42 = inv.x * m._12 + inv.y * m._22 + inv.z * m._32;
  m._43 = inv.x * m._13 + inv.y * m._23 + inv.z * m._33;
  return m;
}

function projectionScale(fovY, aspectHW) {
  const ct = 1 / Math.tan(fovY * 0.5);
  return { w: aspectHW * ct, h: ct };
}
