// Reads BootAnimRXDK geometry headers and writes www/geometry.json.
// Meshes match the primitive builders in scene_renderer.cpp.
const fs = require("fs");
const path = require("path");

const srcRoot = process.argv[2] || "D:/Git/BootAnimRXDK";
const outPath = process.argv[3] || path.join(__dirname, "..", "www", "geometry.json");
// Directory holding the boot animation headers that carry the wordmark table.
const brandRoot = process.argv[4] || process.env.BOOTANIM_BRAND_SRC || "";

function read(name) {
  return fs.readFileSync(path.join(srcRoot, name), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
}

function bodyOf(src, name) {
  const re = new RegExp("(?:^|\\n)\\s*(?:const\\s+)?(?:short|char|DWORD|unsigned\\s+int|SphereInst|CylinderInst|BoxInst|TorusInst|ConeInst|SurfOfRevInst|SphereVers|CylinderVers|BoxVers|TorusVers|ConeVers|SurfOfRevVers|PosAnimSeq|RotAnimSeq)\\s+" + name + "\\s*\\[[^\\]]*\\]\\s*=\\s*", "m");
  const m = re.exec(src);
  if (!m) throw new Error("missing array " + name);
  let i = m.index + m[0].length;
  while (src[i] !== "{") i++;
  let depth = 0;
  const start = i;
  for (; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") {
      depth--;
      if (depth === 0) return src.slice(start + 1, i);
    }
  }
  throw new Error("unclosed " + name);
}

function numbers(text) {
  const out = [];
  const re = /[-+]?(?:0[xX][0-9A-Fa-f]+|\d+\.\d+(?:[eE][-+]?\d+)?|\d+(?:[eE][-+]?\d+)?)[fF]?/g;
  let m;
  while ((m = re.exec(text))) {
    const raw = m[0];
    // Only a decimal literal can carry an f suffix; in hex an f is a digit.
    if (/^[-+]?0[xX]/.test(raw)) out.push(parseInt(raw, 16));
    else out.push(parseFloat(raw.replace(/[fF]$/, "")));
  }
  return out;
}

function splitBrace(body) {
  const parts = [];
  let depth = 0;
  let start = -1;
  for (let i = 0; i < body.length; i++) {
    if (body[i] === "{") {
      if (depth === 0) start = i + 1;
      depth++;
    } else if (body[i] === "}") {
      depth--;
      if (depth === 0 && start >= 0) {
        parts.push(body.slice(start, i));
        start = -1;
      }
    }
  }
  return parts;
}

function pad(arr, n) {
  const out = arr.slice(0, n);
  while (out.length < n) out.push(0);
  return out;
}

function decompressScene(bytes, n) {
  const src = pad(bytes, bytes.length + 8);
  const out = new Array(n);
  let base = 0;
  function asShort(v) {
    v &= 0xffff;
    return v & 0x8000 ? v - 65536 : v;
  }
  if (src[0] === 127) {
    out[0] = asShort(((src[1] & 0xff) << 8) | (src[2] & 0xff));
    base = 2;
  } else out[0] = src[0];
  for (let i = 1; i < n; i++) {
    const b = src[base + i];
    if (b === 127) {
      const v = asShort(((src[base + i + 1] & 0xff) << 8) | (src[base + i + 2] & 0xff));
      out[i] = out[i - 1] + v;
      base += 2;
    } else out[i] = out[i - 1] + b;
  }
  return out;
}

function decompressLogo(bytes, n) {
  const src = pad(bytes, bytes.length + 8);
  const out = new Array(n);
  let base = 0;
  out[0] = src[0] & 0xffff;
  for (let i = 1; i < n; i++) {
    const b = src[base + i];
    if (b === 126) {
      const v = ((src[base + i + 1] & 0xff) << 8) | (src[base + i + 2] & 0xff);
      out[i] = (out[i - 1] + v) & 0xffff;
      base += 2;
    } else out[i] = (out[i - 1] + b) & 0xffff;
  }
  return out;
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

function fanRange(start, count) {
  const idx = [];
  for (let i = 0; i < count; i++) idx.push(start + i);
  return idx;
}

function meshSphere(nSegs) {
  const nSlices = (nSegs / 2) | 0;
  const dTheta = (Math.PI * 2) / nSegs;
  const dPhi = Math.PI / (nSlices - 1);
  const pos = [];
  const nrm = [];
  for (let i = 0; i < nSlices; i++) {
    const phi = dPhi * i;
    const sp = Math.sin(phi);
    const cp = Math.cos(phi);
    for (let j = 0; j < nSegs; j++) {
      const th = dTheta * j;
      const x = cp;
      const y = Math.cos(th) * sp;
      const z = Math.sin(th) * sp;
      pos.push(x, y, z);
      nrm.push(x, y, z);
    }
  }
  const idx = [];
  let wCur = 0;
  for (let i = 0; i < nSlices - 1; i++) {
    const wStart = wCur;
    for (let j = 0; j < nSegs + 1; j++) {
      idx.push(wCur + nSegs, wCur);
      if (j < nSegs - 1) wCur++;
      else wCur = wStart;
    }
    wCur += nSegs;
  }
  return pack(pos, nrm, [{ mode: "strip", idx }]);
}

function meshCylinder(nHeight, nSides) {
  const pos = [];
  const nrm = [];
  for (let i = nSides - 1; i >= 0; i--) {
    const th = ((Math.PI * 2) / nSides) * i;
    pos.push(Math.cos(th), Math.sin(th), 1);
    nrm.push(0, 0, 1);
  }
  for (let i = 0; i < nSides; i++) {
    const th = ((Math.PI * 2) / nSides) * i;
    pos.push(Math.cos(th), Math.sin(th), 0);
    nrm.push(0, 0, -1);
  }
  const side = pos.length / 3;
  for (let i = 0; i <= nHeight; i++) {
    const z = i / nHeight;
    for (let j = 0; j <= nSides; j++) {
      const th = ((Math.PI * 2) / nSides) * j;
      const x = Math.cos(th);
      const y = Math.sin(th);
      pos.push(x, y, z);
      nrm.push(x, y, 0);
    }
  }
  return pack(pos, nrm, [
    { mode: "fan", idx: fanRange(0, nSides) },
    { mode: "fan", idx: fanRange(nSides, nSides) },
    { mode: "strip", idx: tristripMesh(nSides, nHeight, false, false, side, 0, 0) },
  ]);
}

function meshCone(rad1, rad2, height, nHeight, nSides) {
  const pos = [];
  const nrm = [];
  for (let i = nSides - 1; i >= 0; i--) {
    const th = ((Math.PI * 2) / nSides) * i;
    pos.push(Math.cos(th) * rad2, Math.sin(th) * rad2, height);
    nrm.push(0, 0, 1);
  }
  for (let i = 0; i < nSides; i++) {
    const th = ((Math.PI * 2) / nSides) * i;
    pos.push(Math.cos(th) * rad1, Math.sin(th) * rad1, 0);
    nrm.push(0, 0, -1);
  }
  const side = pos.length / 3;
  const slope = rad1 - rad2;
  const len = Math.hypot(slope, height) || 1;
  for (let i = 0; i <= nHeight; i++) {
    const u = i / nHeight;
    const rad = rad1 + (rad2 - rad1) * u;
    const z = height * u;
    for (let j = 0; j <= nSides; j++) {
      const th = ((Math.PI * 2) / nSides) * j;
      const c = Math.cos(th);
      const s = Math.sin(th);
      pos.push(c * rad, s * rad, z);
      nrm.push((c * height) / len, (s * height) / len, slope / len);
    }
  }
  return pack(pos, nrm, [
    { mode: "fan", idx: fanRange(0, nSides) },
    { mode: "fan", idx: fanRange(nSides, nSides) },
    { mode: "strip", idx: tristripMesh(nSides, nHeight, false, false, side, 0, 0) },
  ]);
}

function meshBox() {
  const faces = [
    { n: [1, 0, 0], p: [[0.5, -0.5, 0.5], [0.5, 0.5, 0.5], [0.5, 0.5, -0.5], [0.5, -0.5, -0.5]] },
    { n: [0, 1, 0], p: [[0.5, 0.5, 0.5], [-0.5, 0.5, 0.5], [-0.5, 0.5, -0.5], [0.5, 0.5, -0.5]] },
    { n: [0, -1, 0], p: [[-0.5, 0.5, 0.5], [-0.5, -0.5, 0.5], [-0.5, -0.5, -0.5], [-0.5, 0.5, -0.5]] },
    { n: [0, -1, 0], p: [[-0.5, -0.5, 0.5], [0.5, -0.5, 0.5], [0.5, -0.5, -0.5], [-0.5, -0.5, -0.5]] },
    { n: [0, 0, 1], p: [[-0.5, 0.5, 0.5], [0.5, 0.5, 0.5], [0.5, -0.5, 0.5], [-0.5, -0.5, 0.5]] },
    { n: [0, 0, -1], p: [[-0.5, -0.5, -0.5], [0.5, -0.5, -0.5], [0.5, 0.5, -0.5], [-0.5, 0.5, -0.5]] },
  ];
  const pos = [];
  const nrm = [];
  const idx = [];
  faces.forEach((f, i) => {
    for (const p of f.p) {
      pos.push(p[0], p[1], p[2]);
      nrm.push(f.n[0], f.n[1], f.n[2]);
    }
    const b = i * 4;
    idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
  });
  return pack(pos, nrm, idx);
}

function meshTorus(ratio, nSegs, nSides) {
  const pos = [];
  const nrm = [];
  const idx = [];
  const dPhi = (Math.PI * 2) / nSides;
  const dTheta = (Math.PI * 2) / nSegs;
  for (let i = 0; i < nSides; i++) {
    const phi = dPhi * i;
    const sp = Math.sin(phi);
    const cp = Math.cos(phi);
    const rad = 1 + cp * ratio;
    const z = sp * ratio;
    for (let j = 0; j < nSegs; j++) {
      const th = dTheta * j;
      const ct = Math.cos(th);
      const st = Math.sin(th);
      pos.push(ct * rad, st * rad, z);
      const sx = -st;
      const sy = ct;
      const tx = ct * -sp;
      const ty = st * -sp;
      const tz = cp;
      let nx = sy * tz - 0 * ty;
      let ny = 0 * tx - sx * tz;
      let nz = sx * ty - sy * tx;
      const nl = Math.hypot(nx, ny, nz) || 1;
      nrm.push(nx / nl, ny / nl, nz / nl);
    }
  }
  let wLo = 0;
  let wHi = nSegs;
  for (let i = 0; i < nSides; i++) {
    const startLo = wLo;
    const startHi = wHi;
    for (let j = 0; j < nSegs + 1; j++) {
      idx.push(wLo, wHi);
      if (j < nSegs - 1) {
        wLo++;
        wHi++;
      } else {
        wLo = startLo;
        wHi = startHi;
      }
    }
    wLo += nSegs;
    if (i + 1 < nSides - 1) wHi += nSegs;
    else wHi = 0;
  }
  return pack(pos, nrm, [{ mode: "strip", idx }]);
}

function quatFromAxis(axis, angle) {
  const s = Math.sin(angle * 0.5);
  const c = Math.cos(angle * 0.5);
  return { x: axis[0] * s, y: axis[1] * s, z: axis[2] * s, w: c };
}

function rotRH(q) {
  return [
    q.w * q.w + q.x * q.x - q.y * q.y - q.z * q.z,
    2 * q.x * q.y + 2 * q.w * q.z,
    2 * q.x * q.z - 2 * q.w * q.y,
    2 * q.x * q.y - 2 * q.w * q.z,
    q.w * q.w - q.x * q.x + q.y * q.y - q.z * q.z,
    2 * q.y * q.z + 2 * q.w * q.x,
    2 * q.x * q.z + 2 * q.w * q.y,
    2 * q.y * q.z - 2 * q.w * q.x,
    q.w * q.w - q.x * q.x - q.y * q.y + q.z * q.z,
  ];
}

function meshSurf(pts, axis, pivot, nSegs) {
  const flags = pts.map((p) => p[3]);
  const verts = [];
  const vertFlags = [];
  const segNorms = [];
  for (let i = 0; i < pts.length; i++) {
    verts.push(pts[i].slice(0, 3));
    if (!(flags[i] & 1)) {
      vertFlags.push(0);
      segNorms.push([0, 0, 0]);
      verts.push(pts[i].slice(0, 3));
      vertFlags.push(1);
    } else vertFlags.push(2);
    const next = (i + 1) % pts.length;
    const seg = [pts[next][0] - pts[i][0], pts[next][1] - pts[i][1], pts[next][2] - pts[i][2]];
    const toPt = [pts[next][0] - pivot[0], pts[next][1] - pivot[1], pts[next][2] - pivot[2]];
    const tang = cross(axis, toPt);
    segNorms.push(norm(cross(tang, seg)));
  }
  const nPoly = verts.length;
  const vertNorms = [];
  for (let i = 0; i < nPoly; i++) {
    if (vertFlags[i] === 0) vertNorms.push(segNorms[(i + nPoly - 1) % nPoly]);
    else if (vertFlags[i] === 1) vertNorms.push(segNorms[i]);
    else vertNorms.push(norm(add(segNorms[(i + nPoly - 1) % nPoly], segNorms[i])));
  }
  const pos = [];
  const nrm = [];
  const idx = [];
  const dTheta = (Math.PI * 2) / nSegs;
  for (let i = 0; i <= nSegs; i++) {
    const q = quatFromAxis(axis, dTheta * i);
    const r = rotRH(q);
    for (let j = 0; j < nPoly; j++) {
      const p = [verts[j][0] - pivot[0], verts[j][1] - pivot[1], verts[j][2] - pivot[2]];
      const wp = mul3(r, p);
      pos.push(wp[0] + pivot[0], wp[1] + pivot[1], wp[2] + pivot[2]);
      nrm.push(...norm(mul3(r, vertNorms[j])));
    }
  }
  let wLeft = 0;
  let wRight = nPoly;
  for (let i = 0; i < nSegs; i++) {
    const startRight = wRight;
    const startLeft = wLeft;
    for (let j = 0; j < nPoly + 1; j++) {
      idx.push(wRight, wLeft);
      if (j < nPoly - 1) {
        wRight++;
        wLeft++;
      } else {
        wRight = startRight;
        wLeft = startLeft;
      }
    }
    wLeft = wRight;
    wRight += nPoly;
  }
  return pack(pos, nrm, [{ mode: "strip", idx }]);
}

function cross(a, b) {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}
function add(a, b) {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}
function norm(a) {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
}
function mul3(m, v) {
  return [
    v[0] * m[0] + v[1] * m[3] + v[2] * m[6],
    v[0] * m[1] + v[1] * m[4] + v[2] * m[7],
    v[0] * m[2] + v[1] * m[5] + v[2] * m[8],
  ];
}

function pack(pos, nrm, parts) {
  if (Array.isArray(parts) && (parts.length === 0 || typeof parts[0] === "number")) {
    parts = [{ mode: "triangles", idx: parts }];
  }
  return { pos, nrm, parts };
}

const OO = [0.004131, 0.008252, 0.004421];
const DELTA = [-27.844984, -0.228729, 0.497086];
function place(tx, ty, tz) {
  return [tx * OO[0] + DELTA[0], ty * OO[1] + DELTA[1], tz * OO[2] + DELTA[2]];
}

function quatOf(raw, signs, i) {
  const x = raw[i * 3] / 32750;
  const y = raw[i * 3 + 1] / 32750;
  const z = raw[i * 3 + 2] / 32750;
  let w = Math.sqrt(Math.max(0, 1 - x * x - y * y - z * z));
  const bit = (signs[i >> 5] >>> (i & 31)) & 1;
  if (!bit) w = -w;
  return [x, y, z, w];
}

function matLH(q) {
  const x = q[0], y = q[1], z = q[2], w = q[3];
  return [
    w * w + x * x - y * y - z * z, 2 * x * y - 2 * w * z, 2 * x * z + 2 * w * y, 0,
    2 * x * y + 2 * w * z, w * w - x * x + y * y - z * z, 2 * y * z - 2 * w * x, 0,
    2 * x * z - 2 * w * y, 2 * y * z + 2 * w * x, w * w - x * x - y * y + z * z, 0,
    0, 0, 0, 1,
  ];
}

function identAt(p) {
  return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, p[0], p[1], p[2], 1];
}

const sceneSrc = read("scene_geometry.h");
const logoSrc = read("logo_geometry.h");
const textSrc = read("text_geometry.h");

const numQuats = numbers(sceneSrc.match(/short\s+numQuats\s*=\s*(\d+)/)[0]).pop();
const numPos = numbers(sceneSrc.match(/short\s+numPos\s*=\s*(\d+)/)[0]).pop();
const quatRaw = numbers(bodyOf(sceneSrc, "theQuats"));
const signs = numbers(bodyOf(sceneSrc, "theQuatSigns"));
const quats = [];
for (let i = 0; i < numQuats; i++) quats.push(quatOf(quatRaw, signs, i));

const posRaw = numbers(bodyOf(sceneSrc, "thePos"));
const positions = [];
for (let i = 0; i < numPos; i++) {
  positions.push([
    posRaw[i * 3] * 0.002755 - 0.159046,
    posRaw[i * 3 + 1] * 0.002755 - 0.741611,
    posRaw[i * 3 + 2] * 0.00244 + 2.155624,
  ]);
}

function seqs(name, count) {
  return splitBrace(bodyOf(sceneSrc, name)).slice(0, count).map((part) => decompressScene(pad(numbers(part), 40), 30));
}
const quatSeq = seqs("theRotAnimSeq", 29);
const posSeq = seqs("thePosAnimSeq", 32);

const meshes = [];
function addMesh(mesh) {
  meshes.push(mesh);
  return meshes.length - 1;
}

const sphereVers = splitBrace(bodyOf(sceneSrc, "theSphereVers")).map((p) => numbers(p)[0] | 0);
const sphereMesh = sphereVers.map((n) => addMesh(meshSphere(n)));
const cylVers = splitBrace(bodyOf(sceneSrc, "theCylinderVers")).map((p) => numbers(p));
const cylMesh = cylVers.map((v) => addMesh(meshCylinder(v[0] | 0, v[1] | 0)));
const coneVers = splitBrace(bodyOf(sceneSrc, "theConeVers")).map((p) => numbers(p));
const coneMesh = coneVers.map((v) => addMesh(meshCone(v[0], v[1], v[2], v[3] | 0, v[4] | 0)));
const boxMesh = addMesh(meshBox());
const torusVers = splitBrace(bodyOf(sceneSrc, "theTorusVers")).map((p) => numbers(p));
const torusMesh = torusVers.map((v) => addMesh(meshTorus(v[0], v[1] | 0, v[2] | 0)));

function parseSurf(part) {
  const inner = part.indexOf("{");
  const ptsBody = [];
  let depth = 0;
  let end = inner;
  for (let i = inner; i < part.length; i++) {
    if (part[i] === "{") depth++;
    else if (part[i] === "}") {
      depth--;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }
  const ptNums = numbers(part.slice(inner + 1, end));
  const rest = numbers(part.slice(end + 1));
  const nPts = rest[7] | 0;
  const pts = [];
  for (let i = 0; i < nPts; i++) pts.push(ptNums.slice(i * 4, i * 4 + 4));
  return { pts, axis: rest.slice(0, 3), pivot: rest.slice(3, 6), nSegs: rest[6] | 0 };
}
const surfVers = splitBrace(bodyOf(sceneSrc, "theSurfOfRevVers")).map(parseSurf);
const surfMesh = surfVers.map((v) => addMesh(meshSurf(v.pts, v.axis, v.pivot, v.nSegs)));

const instances = [];
function pushInst(kind, mesh, scale, quatIndex, tx, ty, tz, posAnim, rotAnim) {
  const p = place(tx, ty, tz);
  const m = quatIndex == null ? identAt(p) : matLH(quats[quatIndex]);
  m[12] = p[0];
  m[13] = p[1];
  m[14] = p[2];
  instances.push({ kind, mesh, s: scale, m, pos: posAnim, rot: rotAnim });
}

for (const part of splitBrace(bodyOf(sceneSrc, "theSphereInsts"))) {
  const n = numbers(part);
  pushInst("sphere", sphereMesh[n[3] | 0], [n[6], n[6], n[6]], null, n[0], n[1], n[2], n[4], n[5]);
}
for (const part of splitBrace(bodyOf(sceneSrc, "theCylinderInsts"))) {
  const n = numbers(part);
  pushInst("cylinder", cylMesh[n[4] | 0], [n[7], n[7], n[8] * 2], n[0] | 0, n[1], n[2], n[3], n[5], n[6]);
}
for (const part of splitBrace(bodyOf(sceneSrc, "theBoxInsts"))) {
  const n = numbers(part);
  pushInst("box", boxMesh, [n[9], n[7], n[8]], n[0] | 0, n[1], n[2], n[3], n[5], n[6]);
}
for (const part of splitBrace(bodyOf(sceneSrc, "theTorusInsts"))) {
  const n = numbers(part);
  pushInst("torus", torusMesh[n[4] | 0], [n[7], n[7], n[7]], n[0] | 0, n[1], n[2], n[3], n[5], n[6]);
}
for (const part of splitBrace(bodyOf(sceneSrc, "theConeInsts"))) {
  const n = numbers(part);
  pushInst("cone", coneMesh[n[4] | 0], [1, 1, 1], n[0] | 0, n[1], n[2], n[3], n[5], n[6]);
}
for (const part of splitBrace(bodyOf(sceneSrc, "theSurfOfRevInsts"))) {
  const n = numbers(part);
  pushInst("surf", surfMesh[n[4] | 0], [1, 1, 1], n[0] | 0, n[1], n[2], n[3], n[5], n[6]);
}

function logoMesh(src, vertName, indexName, countName, indexCountName, withUv) {
  const vc = numbers(src.match(new RegExp(countName + "\\s*=\\s*\\d+"))[0]).pop();
  const ic = numbers(src.match(new RegExp(indexCountName + "\\s*=\\s*\\d+"))[0]).pop();
  const raw = numbers(bodyOf(src, vertName));
  const pos = [];
  const uv = [];
  const scale = withUv ? 0.009876 : 0.002508;
  const delta = withUv ? 161.715363 : 41.065369;
  const stride = withUv ? 5 : 3;
  for (let i = 0; i < vc; i++) {
    pos.push(raw[i * stride] * scale + delta, raw[i * stride + 1] * scale + delta, raw[i * stride + 2] * scale + delta);
    if (withUv) uv.push(raw[i * stride + 3] * 0.000058 + 0.947661, raw[i * stride + 4] * 0.000058 + 0.947661);
  }
  const idx = decompressLogo(numbers(bodyOf(src, indexName)), ic);
  return { pos, uv, idx };
}

const logo = {
  lip: logoMesh(logoSrc, "verts_xboxlogolip_0C", "indices_xboxlogolip_0C", "vertex_count_xboxlogolip_0", "index_count_xboxlogolip_0", true),
  surface: logoMesh(logoSrc, "verts_xboxlogosurface_0C", "indices_xboxlogosurface_0C", "vertex_count_xboxlogosurface_0", "index_count_xboxlogosurface_0", true),
  surfaceTop: logoMesh(logoSrc, "verts_xboxlogosurfacetop_0C", "indices_xboxlogosurfacetop_0C", "vertex_count_xboxlogosurfacetop_0", "index_count_xboxlogosurfacetop_0", true),
  interior: logoMesh(logoSrc, "verts_xboxlogointerior_0C", "indices_xboxlogointerior_0C", "vertex_count_xboxlogointerior_0", "index_count_xboxlogointerior_0", true),
  tmSlash: logoMesh(logoSrc, "verts_tm_slash_0C", "indices_tm_slash_0C", "vertex_count_tm_slash_0", "index_count_tm_slash_0", true),
  tmWord: logoMesh(logoSrc, "verts_tm_wordmark_0C", "indices_tm_wordmark_0C", "vertex_count_tm_wordmark_0", "index_count_tm_wordmark_0", true),
  text: logoMesh(textSrc, "verts_text_0C", "indices_text_0C", "vertex_count_text_0", "index_count_text_0", false),
};

// The trademark quads are textured with this 16x16 A8R8G8B8 glyph, not coloured flat.
const tm = numbers(bodyOf(read("tm_pixels.h"), "tm_pixels")).slice(0, 256);

// The wordmark is a 100x17 run-length bitmap of 4-bit intensities, decoded by
// InitMonoTexture. Forks carry it under different header names, so find the one
// that actually declares the table rather than hardcoding a filename.
function findBrandHeader(dir) {
  if (!dir) {
    throw new Error("pass the wordmark header directory as argv[4] or BOOTANIM_BRAND_SRC");
  }
  for (const name of fs.readdirSync(dir)) {
    if (!name.toLowerCase().endsWith(".h")) continue;
    const text = fs.readFileSync(path.join(dir, name), "utf8");
    if (text.includes("MSText[]")) return text;
  }
  throw new Error("no header declaring MSText[] under " + dir);
}

const brand = (() => {
  const src = findBrandHeader(brandRoot);
  const at = src.indexOf("UCHAR MSText[]");
  if (at < 0) throw new Error("missing MSText");
  const bytes = (src.slice(at, src.indexOf("};", at)).match(/0x[0-9a-fA-F]+/g) || []).map((x) => parseInt(x, 16));
  const px = [];
  let i = 0;
  while (i < bytes.length) {
    // IMAGE_RUN1 is one byte: fOne:1, Size:3, Intensity:4.
    // IMAGE_RUN2 is two: fOne:1, fTwo:1, Size:10, Intensity:4.
    let size;
    let intensity;
    if (bytes[i] & 1) {
      size = (bytes[i] >> 1) & 7;
      intensity = (bytes[i] >> 4) & 15;
      i += 1;
    } else {
      const w = bytes[i] | (bytes[i + 1] << 8);
      if (!((w >> 1) & 1)) throw new Error("bad run at " + i);
      size = (w >> 2) & 0x3ff;
      intensity = (w >> 12) & 15;
      i += 2;
    }
    for (let k = 0; k < size; k++) px.push(intensity);
  }
  if (px.length !== 100 * 17) throw new Error("brand decoded to " + px.length);
  return { w: 100, h: 17, px };
})();

const out = { meshes, instances, quats, quatSeq, positions, posSeq, logo, tm, brand, textAnim: [[-0.229403, -267.650421, -103.040421], [-0.229403, -141.053757, -54.439625]] };
fs.writeFileSync(outPath, JSON.stringify(out));
const stat = fs.statSync(outPath);
console.log("meshes", meshes.length, "instances", instances.length, "bytes", stat.size);
console.log("logo interior", logo.interior.pos.length / 3, "idx", logo.interior.idx.length);
