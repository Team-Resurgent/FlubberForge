// WebGL playback of the BootAnimRXDK meshes in geometry.json.
const official = { ready: false };

// The matrices are D3D row-vector, row-major. GLSL reads uniforms as column-major
// and multiplies as mat * vec, so uploading the rows unchanged gives the transpose
// the shader needs: uMvp * p == p * mvp.
function glMat(row) {
  return new Float32Array(row);
}

function gl3(row) {
  return new Float32Array(row.slice(0, 9));
}

function mul4(a, b) {
  const o = new Array(16).fill(0);
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 4; c++) {
      o[r * 4 + c] =
        a[r * 4] * b[c] +
        a[r * 4 + 1] * b[4 + c] +
        a[r * 4 + 2] * b[8 + c] +
        a[r * 4 + 3] * b[12 + c];
    }
  }
  return o;
}

function scaleMat(s) {
  return [s[0], 0, 0, 0, 0, s[1], 0, 0, 0, 0, s[2], 0, 0, 0, 0, 1];
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

function inv3(m) {
  const a = m[0], b = m[1], c = m[2];
  const d = m[4], e = m[5], f = m[6];
  const g = m[8], h = m[9], i = m[10];
  const A = e * i - f * h;
  const B = f * g - d * i;
  const C = d * h - e * g;
  const D = c * h - b * i;
  const E = a * i - c * g;
  const F = b * g - a * h;
  const G = b * f - c * e;
  const H = c * d - a * f;
  const I = a * e - b * d;
  const s = 1 / (a * A + b * B + c * C || 1);
  return [A * s, D * s, G * s, B * s, E * s, H * s, C * s, F * s, I * s];
}

function slerp(a, b, t) {
  let dp = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
  let bx = b[0], by = b[1], bz = b[2], bw = b[3];
  if (dp < 0) {
    dp = -dp;
    bx = -bx; by = -by; bz = -bz; bw = -bw;
  }
  if (dp > 0.9995) {
    return [
      a[0] * (1 - t) + bx * t,
      a[1] * (1 - t) + by * t,
      a[2] * (1 - t) + bz * t,
      a[3] * (1 - t) + bw * t,
    ];
  }
  const angle = Math.acos(Math.min(1, dp));
  const s = Math.sin(angle);
  const t0 = Math.sin(angle * (1 - t)) / s;
  const t1 = Math.sin(angle * t) / s;
  return [a[0] * t0 + bx * t1, a[1] * t0 + by * t1, a[2] * t0 + bz * t1, a[3] * t0 + bw * t1];
}

function sampleVec(list, seq, fpos) {
  if (fpos <= 0) return list[seq[0]];
  if (fpos >= 1) return list[seq[29]];
  const x = fpos * 28;
  const i = x | 0;
  const f = x - i;
  const a = list[seq[i]];
  const b = list[seq[Math.min(i + 1, 29)]];
  return [a[0] * (1 - f) + b[0] * f, a[1] * (1 - f) + b[1] * f, a[2] * (1 - f) + b[2] * f];
}

function sampleQuat(quats, seq, fpos) {
  if (fpos <= 0) return quats[seq[0]];
  if (fpos >= 1) return quats[seq[29]];
  const x = fpos * 28;
  const i = x | 0;
  return slerp(quats[seq[i]], quats[seq[Math.min(i + 1, 29)]], x - i);
}

function compile(gl, type, src) {
  const sh = gl.createShader(type);
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh));
  return sh;
}

function program(gl, vs, fs) {
  const p = gl.createProgram();
  gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, vs));
  gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
  return p;
}

function faceNormals(pos, idx) {
  const nrm = new Float32Array(pos.length);
  for (let i = 0; i < idx.length; i += 3) {
    const ia = idx[i] * 3;
    const ib = idx[i + 1] * 3;
    const ic = idx[i + 2] * 3;
    const ax = pos[ib] - pos[ia];
    const ay = pos[ib + 1] - pos[ia + 1];
    const az = pos[ib + 2] - pos[ia + 2];
    const bx = pos[ic] - pos[ia];
    const by = pos[ic + 1] - pos[ia + 1];
    const bz = pos[ic + 2] - pos[ia + 2];
    const nx = ay * bz - az * by;
    const ny = az * bx - ax * bz;
    const nz = ax * by - ay * bx;
    nrm[ia] += nx; nrm[ia + 1] += ny; nrm[ia + 2] += nz;
    nrm[ib] += nx; nrm[ib + 1] += ny; nrm[ib + 2] += nz;
    nrm[ic] += nx; nrm[ic + 1] += ny; nrm[ic + 2] += nz;
  }
  for (let i = 0; i < nrm.length; i += 3) {
    const l = Math.hypot(nrm[i], nrm[i + 1], nrm[i + 2]) || 1;
    nrm[i] /= l; nrm[i + 1] /= l; nrm[i + 2] /= l;
  }
  return nrm;
}

function triangleIndices(mesh) {
  const parts = mesh.parts || [{ mode: "triangles", idx: mesh.idx }];
  const out = [];
  for (const part of parts) {
    const ix = part.idx;
    if (part.mode === "fan") {
      for (let i = 1; i + 1 < ix.length; i++) out.push(ix[0], ix[i], ix[i + 1]);
    } else if (part.mode === "strip") {
      for (let i = 0; i + 2 < ix.length; i++) {
        if (ix[i] === ix[i + 1] || ix[i + 1] === ix[i + 2] || ix[i] === ix[i + 2]) continue;
        if (i & 1) out.push(ix[i + 1], ix[i], ix[i + 2]);
        else out.push(ix[i], ix[i + 1], ix[i + 2]);
      }
    } else out.push(...ix);
  }
  return out;
}

function uploadMesh(gl, mesh, withUv) {
  const pos = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, pos);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(mesh.pos), gl.STATIC_DRAW);
  const tris = triangleIndices(mesh);
  const normals = mesh.nrm && mesh.nrm.length === mesh.pos.length ? mesh.nrm : faceNormals(mesh.pos, tris);
  const nrm = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, nrm);
  gl.bufferData(gl.ARRAY_BUFFER, normals instanceof Float32Array ? normals : new Float32Array(normals), gl.STATIC_DRAW);
  let uv = null;
  if (withUv && mesh.uv) {
    uv = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, uv);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(mesh.uv), gl.STATIC_DRAW);
  }
  const parts = (mesh.parts || [{ mode: "triangles", idx: mesh.idx }]).map((part) => {
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, buf);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(part.idx), gl.STATIC_DRAW);
    return { mode: part.mode, buf, count: part.idx.length };
  });
  const lines = [];
  for (let i = 0; i < tris.length; i += 3) {
    lines.push(tris[i], tris[i + 1], tris[i + 1], tris[i + 2], tris[i + 2], tris[i]);
  }
  const line = gl.createBuffer();
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, line);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(lines), gl.STATIC_DRAW);
  return { pos, nrm, uv, parts, line, lines: lines.length };
}

const VS = `
attribute vec3 aPos;
attribute vec3 aNrm;
attribute vec2 aUv;
uniform mat4 uMvp;
uniform mat4 uWorld;
uniform mat3 uNormal;
varying vec3 vN;
varying vec3 vW;
varying vec2 vUv;
void main() {
  vec4 w = uWorld * vec4(aPos, 1.0);
  vW = w.xyz;
  vN = normalize(uNormal * aNrm);
  vUv = aUv;
  gl_Position = uMvp * vec4(aPos, 1.0);
}`;

// scene_phong.vsh/.psh: point light with per-vertex 1/(a0+a1*d+a2*d^2) falloff,
// N.L diffuse plus (N.H)^32 specular, saturated, then scaled by the falloff and
// offset by ambient. The light position is the blob's weighted centre.
const FS_SCENE = `
precision mediump float;
varying vec3 vN;
varying vec3 vW;
uniform vec3 uCam;
uniform vec3 uLightPos;
uniform vec3 uAmbient;
uniform vec3 uDiffuse;
uniform vec3 uSpec;
uniform vec3 uAtten;
void main() {
  vec3 N = normalize(vN);
  vec3 V = normalize(uCam - vW);
  vec3 toLight = uLightPos - vW;
  float d = length(toLight);
  vec3 L = toLight / max(d, 0.0001);
  vec3 H = normalize(L + V);
  float falloff = 1.0 / (uAtten.x + uAtten.y * d + uAtten.z * d * d);
  float nd = clamp(dot(N, L), 0.0, 1.0);
  float nh = clamp(dot(N, H), 0.0, 1.0);
  float sp = pow(nh, 32.0);
  vec3 lit = clamp(uDiffuse * nd + uSpec * sp, 0.0, 1.0);
  gl_FragColor = vec4(falloff * lit + uAmbient, 1.0);
}`;

// vblob.vsh/.psh and vbloblet.vsh/.psh.
const VS_BLOB = `
attribute vec3 aUs;
attribute vec4 aNrm;
uniform mat4 uViewProj;
uniform vec3 uScaling;
uniform vec3 uOoScaling;
uniform vec3 uCenter;
uniform vec3 uEye;
varying vec3 vN;
varying vec3 vE;
void main() {
  vec3 ellipseN = normalize(aUs * uOoScaling);
  vec3 world = aUs * uScaling + uCenter + ellipseN * aNrm.w;
  vE = normalize(uEye - world);
  vN = normalize(aNrm.xyz * uOoScaling);
  gl_Position = uViewProj * vec4(world, 1.0);
}`;

const VS_BLOBLET = `
attribute vec3 aUs;
uniform mat4 uViewProj;
uniform vec3 uCenter;
uniform vec3 uDir;
uniform vec3 uPerp;
uniform vec3 uPmp;
uniform vec3 uEye;
varying vec3 vN;
varying vec3 vE;
void main() {
  vec3 world = uPerp * aUs + dot(aUs, uDir) * uPmp + uCenter;
  vN = aUs;
  vE = normalize(uEye - world);
  gl_Position = uViewProj * vec4(world, 1.0);
}`;

const FS_BLOB = `
precision mediump float;
varying vec3 vN;
varying vec3 vE;
uniform vec3 uColor;
uniform vec3 uAmbient;
uniform float uAlpha;
void main() {
  float r1 = clamp(dot(normalize(vN), normalize(vE)), 0.0, 1.0);
  float r0 = (1.0 - r1) * (1.0 - r1);
  gl_FragColor = vec4((1.0 - r0) * uColor + uAmbient, (1.0 - r0) * uAlpha);
}`;

// logo_renderer.cpp draws the trademark quads textured from tm_pixels: the glyph
// supplies the alpha mask and the theme colour comes in through TEXTUREFACTOR.
const FS_TM = `
precision mediump float;
varying vec2 vUv;
uniform sampler2D uTex;
uniform vec3 uColor;
uniform float uAlpha;
void main() {
  vec4 t = texture2D(uTex, vUv);
  gl_FragColor = vec4(t.rgb * uColor, t.a * uAlpha);
}`;

// shield.vsh/.psh: reflect the eye and both light vectors off the surface,
// raise the light reflections to the 32nd power for a tight highlight, tint by
// the Shield colour and scale the whole thing by the blob intensity. The panel
// itself is black, so it darkens whatever is behind it.
const VS_SHIELD = `
attribute vec3 aPos;
attribute vec3 aNrm;
uniform mat4 uWorld;
uniform mat4 uViewProj;
uniform vec3 uEye;
uniform vec3 uBlobLight;
uniform vec3 uMoodLight;
varying vec3 vBlobRef;
varying vec3 vMoodRef;
varying vec3 vEyeRef;
varying vec3 vNormal;
void main() {
  vec4 world = uWorld * vec4(aPos, 1.0);
  vec3 n = (uWorld * vec4(aNrm, 0.0)).xyz;
  vec3 toEye = world.xyz - uEye;
  vec3 toBlob = world.xyz - uBlobLight;
  vec3 toMood = world.xyz - uMoodLight;
  vEyeRef = toEye - 2.0 * dot(toEye, n) * n;
  vBlobRef = toBlob - 2.0 * dot(toBlob, n) * n;
  vMoodRef = toMood - 2.0 * dot(toMood, n) * n;
  vNormal = n;
  gl_Position = uViewProj * world;
}`;

const FS_SHIELD = `
precision mediump float;
varying vec3 vBlobRef;
varying vec3 vMoodRef;
varying vec3 vEyeRef;
varying vec3 vNormal;
uniform samplerCube uEnv;
uniform vec3 uSpecular;
uniform float uIntensity;
uniform float uAlpha;
void main() {
  vec3 n = normalize(vNormal);
  float b = clamp(dot(normalize(vBlobRef), n), 0.0, 1.0);
  float m = clamp(dot(normalize(vMoodRef), n), 0.0, 1.0);
  // Four squaring xmma pairs, so the exponent is 16 rather than the 32 the
  // shader comment claims.
  b = pow(b, 16.0);
  m = pow(m, 16.0);
  // "scale by const color for highlight with green fringe"
  vec3 hi = vec3(b) * vec3(0.2, 0.5, 0.2) + vec3(b);
  vec3 lit = clamp(clamp(hi, 0.0, 1.0) + vec3(m), 0.0, 1.0);
  // mad r0.rgb, r0_sat, c2, t0 - the highlights are tinted by the Shield colour
  // and added to the environment reflection.
  vec3 env = textureCube(uEnv, normalize(vEyeRef)).rgb;
  gl_FragColor = vec4((lit * uSpecular + env) * uIntensity, uAlpha);
}`;

const VS_HALO = `
attribute vec3 aPos;
attribute vec2 aUv;
uniform mat4 uViewProj;
varying vec2 vUv;
void main() {
  vUv = aUv;
  gl_Position = uViewProj * vec4(aPos, 1.0);
}`;

const FS_HALO = `
precision mediump float;
varying vec2 vUv;
uniform sampler2D uTex;
uniform vec3 uColor;
uniform float uAlpha;
void main() {
  vec4 t = texture2D(uTex, vUv);
  gl_FragColor = vec4(t.rgb * uColor, t.a) * vec4(1.0, 1.0, 1.0, uAlpha);
}`;

const FS_LOGO = `
precision mediump float;
varying vec3 vN;
varying vec3 vW;
varying vec2 vUv;
uniform vec3 uCam;
uniform vec3 uA;
uniform vec3 uB;
uniform vec3 uC;
uniform vec3 uD;
uniform float uMode;
uniform float uAlpha;
void main() {
  float v = clamp(vUv.y, 0.0, 1.0);
  vec3 g = mix(uA, uB, smoothstep(0.0, 0.35, v));
  g = mix(g, uC, smoothstep(0.35, 0.7, v));
  g = mix(g, uD, smoothstep(0.7, 1.0, v));
  vec3 N = normalize(vN);
  float nd = max(dot(N, normalize(uCam - vW)), 0.0);
  vec3 color = g;
  if (uMode < 0.5) color = mix(uA, uB, v);
  else if (uMode < 1.5) color = mix(uA, uB, pow(nd, 0.65));
  gl_FragColor = vec4(color, uAlpha);
}`;

const VS_FLAT = `
attribute vec2 aPos;
varying vec2 vUv;
void main() {
  vUv = aPos * 0.5 + 0.5;
  gl_Position = vec4(aPos, 0.0, 1.0);
}`;

// logo_renderer.cpp textures the end-screen background rather than shading it:
// the lip and surfaceTop get a vertical CreateGradientTexture and the surface
// gets a radial CreateHighlightTextureGradient, all with D3DTADDRESS_BORDER and
// a border colour of SlashBackgroundStart. The mesh UVs run well outside [0,1],
// so the gradient only shows near the logo and everything else is flat.
const FS_SLASHTEX = `
precision mediump float;
varying vec2 vUv;
uniform sampler2D uTex;
uniform vec3 uBorder;
void main() {
  if (vUv.x < 0.0 || vUv.x > 1.0 || vUv.y < 0.0 || vUv.y > 1.0) {
    gl_FragColor = vec4(uBorder, 1.0);
  } else {
    gl_FragColor = vec4(texture2D(uTex, vUv).rgb, 1.0);
  }
}`;

// mslogo.cpp draws the wordmark as a screen-space quad textured with the 100x17
// intensity bitmap. ColorFromIntensity ramps from SlashBackgroundStart to the
// Brand colour, itself scaled by cr so the brightest texel lands near 0xCC.
const VS_BRAND = `
attribute vec2 aPos;
attribute vec2 aUv;
varying vec2 vUv;
void main() {
  vUv = aUv;
  gl_Position = vec4(aPos, 0.0, 1.0);
}`;

const FS_BRAND = `
precision mediump float;
varying vec2 vUv;
uniform sampler2D uTex;
uniform vec3 uBack;
uniform vec3 uBrand;
uniform float uAlpha;
void main() {
  float f = texture2D(uTex, vUv).a;
  float cr = (204.0 * f + 0.5) / 255.0;
  vec3 c = uBack + f * (uBrand * cr - uBack);
  gl_FragColor = vec4(c, uAlpha);
}`;

const FS_FOG = `
precision mediump float;
varying vec2 vUv;
uniform vec2 uOrigin;
uniform vec3 uC1;
uniform vec3 uC2;
uniform vec3 uC3;
uniform float uI;
uniform float uGlow;
void main() {
  vec2 p = vUv - uOrigin;
  float d = length(p);
  vec3 c = uC1 * uI * exp(-d * 3.2) + uC2 * uGlow * exp(-d * 1.6) + uC3 * uGlow * exp(-d * 5.0);
  gl_FragColor = vec4(c, 1.0);
}`;

function bindMesh(gl, prog, gpu, withUv) {
  const pos = gl.getAttribLocation(prog, "aPos");
  const nrm = gl.getAttribLocation(prog, "aNrm");
  const uv = gl.getAttribLocation(prog, "aUv");
  gl.bindBuffer(gl.ARRAY_BUFFER, gpu.pos);
  gl.enableVertexAttribArray(pos);
  gl.vertexAttribPointer(pos, 3, gl.FLOAT, false, 0, 0);
  if (nrm >= 0) {
    gl.bindBuffer(gl.ARRAY_BUFFER, gpu.nrm);
    gl.enableVertexAttribArray(nrm);
    gl.vertexAttribPointer(nrm, 3, gl.FLOAT, false, 0, 0);
  }
  if (uv >= 0) {
    if (withUv && gpu.uv) {
      gl.bindBuffer(gl.ARRAY_BUFFER, gpu.uv);
      gl.enableVertexAttribArray(uv);
      gl.vertexAttribPointer(uv, 2, gl.FLOAT, false, 0, 0);
    } else {
      gl.disableVertexAttribArray(uv);
      gl.vertexAttrib2f(uv, 0.5, 0.5);
    }
  }
}

function viewRows(pos, look, up) {
  const m = lookAtMatrix(pos, look, up || v3(0, 0, 1));
  return [m._11, m._12, m._13, 0, m._21, m._22, m._23, 0, m._31, m._32, m._33, 0, m._41, m._42, m._43, 1];
}

function projRows(aspectHW, fovY, nearIn, farIn) {
  const ct = 1 / Math.tan((fovY || Math.PI / 4) * 0.5);
  const w = aspectHW * ct;
  const h = ct;
  const near = nearIn || 0.4;
  const far = farIn || 800;
  const Q = far / (far - near);
  // Map the D3D clip range (z from 0 to w) into WebGL's clip range (z from -w to w).
  return [w, 0, 0, 0, 0, h, 0, 0, 0, 0, 2 * Q - 1, 1, 0, 0, -2 * Q * near, 0];
}

function slashRows(slash) {
  return [
    slash.x.x, slash.x.y, slash.x.z, 0,
    slash.y.x, slash.y.y, slash.y.z, 0,
    slash.z.x, slash.z.y, slash.z.z, 0,
    slash.t.x, slash.t.y, slash.t.z, 1,
  ];
}

function rgb(value) {
  const c = rgbOf(value);
  return [c.r / 255, c.g / 255, c.b / 255];
}

function uploadRgb(gl, w, h, px) {
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, px);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return tex;
}

// tex_gen.cpp CreateGradientTexture: a flat ramp down the rows.
function makeGradientTexture(gl, w, h, start, end) {
  const s = rgb(start).map((c) => c * 255);
  const e = rgb(end).map((c) => c * 255);
  const px = new Uint8Array(w * h * 4);
  const del = 1 / (h - 1);
  for (let r = 0; r < h; r++) {
    const t = del * r;
    for (let x = 0; x < w; x++) {
      const o = (r * w + x) * 4;
      for (let k = 0; k < 3; k++) px[o + k] = Math.trunc(s[k] * (1 - t) + e[k] * t);
      px[o + 3] = 255;
    }
  }
  return uploadRgb(gl, w, h, px);
}

// tex_gen.cpp CreateHighlightTextureGradient: a radial falloff from end at the
// centre to start at the inscribed circle, and flat start outside it. The
// source's pixel loop runs `for (x=0; x < y; ...)`, so it only ever fills the
// triangle below the diagonal and leaves the rest of the allocation untouched;
// this fills the whole square.
function makeHighlightTexture(gl, size, power, linearW, cosW, start, end) {
  const s = rgb(start).map((c) => c * 255);
  const e = rgb(end).map((c) => c * 255);
  const cosTable = new Uint8Array(256);
  for (let i = 0; i < 256; i++) {
    let c = Math.cos(i / 256);
    for (let k = power; k; --k) c *= c;
    cosTable[i] = Math.trunc(255 * (c * cosW + ((256 - i) / 256) * linearW)) & 0xff;
  }
  const px = new Uint8Array(size * size * 4);
  const ooRadius = 1 / (size / 2);
  const cntr = (size - 1) / 2;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const o = (y * size + x) * 4;
      const dist = Math.sqrt((x - cntr) * (x - cntr) + (y - cntr) * (y - cntr)) * ooRadius;
      px[o + 3] = 255;
      if (dist >= 1) {
        for (let k = 0; k < 3; k++) px[o + k] = Math.trunc(s[k]);
        continue;
      }
      const f = cosTable[Math.trunc(dist * 256)] / 255;
      for (let k = 0; k < 3; k++) px[o + k] = Math.trunc(s[k] + (e[k] - s[k]) * f);
    }
  }
  return uploadRgb(gl, size, size, px);
}

// The theme panel can change these colours at runtime, so the textures are
// rebuilt only when the colour pair they were baked from changes.
function slashTextures(gl, theme) {
  const key = [theme.slashBackgroundStart, theme.slashBackgroundEnd, theme.slashLipGradientStart, theme.slashLipGradientEnd].join(",");
  if (official.slashTexKey === key) return official.slashTex;
  official.slashTexKey = key;
  official.slashTex = {
    surface: makeHighlightTexture(gl, 256, 6, 0.5, 0.5, theme.slashBackgroundStart, theme.slashBackgroundEnd),
    surfaceTop: makeGradientTexture(gl, 16, 128, theme.slashBackgroundStart, theme.slashBackgroundEnd),
    lip: makeGradientTexture(gl, 16, 128, theme.slashLipGradientStart, theme.slashLipGradientEnd),
  };
  return official.slashTex;
}

// primitive_set::render: theme colour times the blob light colour times the
// blob intensity. The blob light's ambient is black, so ambient drops out.
function drawScene(gl, data, theme, shot, view, proj, energy, fpos) {
  const prog = official.sceneProg;
  gl.useProgram(prog);
  gl.uniform3f(gl.getUniformLocation(prog, "uCam"), shot.pos.x, shot.pos.y, shot.pos.z);
  const intense = Math.max(0, energy.blob) * (theme.sceneIntensity || 1);
  const dif = rgb(theme.sceneDiffuse).map((c) => c * BLOB_LIGHT_DIFFUSE * intense);
  const spe = rgb(theme.sceneSpecular).map((c) => c * BLOB_LIGHT_SPECULAR * intense);
  const ooIntensity = intense > 0 ? 1 / intense : 0;
  gl.uniform3fv(
    gl.getUniformLocation(prog, "uAmbient"),
    rgb(theme.sceneAmbient).map((c) => c * BLOB_LIGHT_AMBIENT)
  );
  gl.uniform3fv(gl.getUniformLocation(prog, "uDiffuse"), dif);
  gl.uniform3fv(gl.getUniformLocation(prog, "uSpec"), spe);
  gl.uniform3fv(gl.getUniformLocation(prog, "uAtten"), [
    BLOB_LIGHT_ATTEN0,
    BLOB_LIGHT_ATTEN1 * ooIntensity,
    BLOB_LIGHT_ATTEN2 * ooIntensity,
  ]);
  const lightLoc = gl.getUniformLocation(prog, "uLightPos");
  for (const inst of data.instances) {
    const world = worldOf(data, inst, fpos);
    gl.uniform3fv(lightLoc, official.blob.sim.lightFor([world[12], world[13], world[14]]));
    drawMesh(gl, prog, official.gpu[inst.mesh], world, view, proj, theme.sceneWireframe);
  }
}

// tex_gen.cpp CreateStaticReflectionCubeMap: the scene geometry, frozen at the
// end of its animation, rendered from the origin into the six faces. The shield
// shader adds this in as a mirror reflection, which is what stops the panels
// reading as flat black.
function makeReflectionCubeMap(gl, data, theme) {
  const size = 256;
  const faces = [
    [gl.TEXTURE_CUBE_MAP_POSITIVE_X, [1, 0, 0], [0, 1, 0]],
    [gl.TEXTURE_CUBE_MAP_NEGATIVE_X, [-1, 0, 0], [0, 1, 0]],
    [gl.TEXTURE_CUBE_MAP_POSITIVE_Y, [0, 1, 0], [0, 0, -1]],
    [gl.TEXTURE_CUBE_MAP_NEGATIVE_Y, [0, -1, 0], [0, 0, 1]],
    [gl.TEXTURE_CUBE_MAP_POSITIVE_Z, [0, 0, 1], [0, 1, 0]],
    [gl.TEXTURE_CUBE_MAP_NEGATIVE_Z, [0, 0, -1], [0, 1, 0]],
  ];
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_CUBE_MAP, tex);
  for (const f of faces) gl.texImage2D(f[0], 0, gl.RGBA, size, size, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

  const fb = gl.createFramebuffer();
  const depth = gl.createRenderbuffer();
  gl.bindRenderbuffer(gl.RENDERBUFFER, depth);
  gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT16, size, size);
  gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
  gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, depth);

  const at = SCENE_ANIM_START_TIME + SCENE_ANIM_LEN;
  const energy = intensityAt(at, state.pulses);
  const shot = { pos: v3(0, 0, 0), look: v3(0, 0, 0) };
  const proj = projRows(1, Math.PI / 2, 0.1, 400);
  gl.viewport(0, 0, size, size);
  gl.enable(gl.DEPTH_TEST);
  gl.disable(gl.BLEND);
  for (const f of faces) {
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, f[0], tex, 0);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    shot.look = v3(f[1][0], f[1][1], f[1][2]);
    const up = v3(f[2][0], f[2][1], f[2][2]);
    drawScene(gl, data, theme, shot, viewRows(shot.pos, shot.look, up), proj, energy, 1, null, null);
  }

  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.deleteFramebuffer(fb);
  gl.deleteRenderbuffer(depth);
  return tex;
}

function makeBrandTexture(gl, brand) {
  const px = new Uint8Array(brand.w * brand.h);
  for (let i = 0; i < px.length; i++) px[i] = Math.round((brand.px[i] / 15) * 255);
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.ALPHA, brand.w, brand.h, 0, gl.ALPHA, gl.UNSIGNED_BYTE, px);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return tex;
}

// InitVB sizes the quad off the viewport height against a 480-line reference
// and pins it at 0.83 of the way down.
function drawBrand(gl, width, height, theme, alpha) {
  const b = official.data.brand;
  const halfW = (b.w / 2 / 480) * height;
  const x0 = width / 2 - halfW;
  const x1 = width / 2 + halfW;
  const y0 = height * 0.83;
  const y1 = y0 + (b.h / 480) * height;
  const nx = (x) => (x / width) * 2 - 1;
  const ny = (y) => 1 - (y / height) * 2;
  const v = new Float32Array([
    nx(x0), ny(y1), 0, 1,
    nx(x1), ny(y1), 1, 1,
    nx(x0), ny(y0), 0, 0,
    nx(x1), ny(y0), 1, 0,
  ]);
  const prog = official.brandProg;
  gl.useProgram(prog);
  gl.bindBuffer(gl.ARRAY_BUFFER, official.brandQuad);
  gl.bufferData(gl.ARRAY_BUFFER, v, gl.DYNAMIC_DRAW);
  const aPos = gl.getAttribLocation(prog, "aPos");
  const aUv = gl.getAttribLocation(prog, "aUv");
  gl.enableVertexAttribArray(aPos);
  gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 16, 0);
  gl.enableVertexAttribArray(aUv);
  gl.vertexAttribPointer(aUv, 2, gl.FLOAT, false, 16, 8);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, official.brandTex);
  gl.uniform1i(gl.getUniformLocation(prog, "uTex"), 0);
  gl.uniform3fv(gl.getUniformLocation(prog, "uBack"), rgb(theme.slashBackgroundStart));
  gl.uniform3fv(gl.getUniformLocation(prog, "uBrand"), rgb(theme.brand));
  gl.uniform1f(gl.getUniformLocation(prog, "uAlpha"), alpha);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  gl.disable(gl.DEPTH_TEST);
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  gl.enable(gl.DEPTH_TEST);
  gl.disable(gl.BLEND);
}

function makeTmTexture(gl, argb) {
  const px = new Uint8Array(16 * 16 * 4);
  for (let i = 0; i < 256; i++) {
    const v = argb[i] >>> 0;
    px[i * 4] = (v >>> 16) & 0xff;
    px[i * 4 + 1] = (v >>> 8) & 0xff;
    px[i * 4 + 2] = v & 0xff;
    px[i * 4 + 3] = (v >>> 24) & 0xff;
  }
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 16, 16, 0, gl.RGBA, gl.UNSIGNED_BYTE, px);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return tex;
}

function makeShieldGpu(gl, rand) {
  const mgr = new ShieldManager(rand);
  const upload = (mesh) => {
    const pos = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, pos);
    gl.bufferData(gl.ARRAY_BUFFER, mesh.pos, gl.STATIC_DRAW);
    const nrm = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, nrm);
    gl.bufferData(gl.ARRAY_BUFFER, mesh.nrm, gl.STATIC_DRAW);
    const idx = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, idx);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(mesh.idx), gl.STATIC_DRAW);
    const line = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, line);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(mesh.lines), gl.STATIC_DRAW);
    return { pos, nrm, idx, count: mesh.idx.length, line, lineCount: mesh.lines.length };
  };
  return { mgr, panel: upload(mgr.panel), zPanels: mgr.zShields.map((z) => upload(z.mesh)) };
}

// shield_manager::render
function drawShields(gl, t, theme, shot, view, proj, energy) {
  const shields = official.shields;
  const mgr = shields.mgr;
  mgr.seek(t);
  const alpha = shieldShading(t);
  if (alpha <= 0.002) return;

  const prog = official.shieldProg;
  gl.useProgram(prog);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  gl.depthMask(false);
  // The panel is a closed shell, so the default D3DCULL_CCW is what keeps the
  // inner face from washing out the outer one.
  gl.enable(gl.CULL_FACE);
  gl.frontFace(gl.CW);
  gl.cullFace(gl.BACK);
  gl.uniformMatrix4fv(gl.getUniformLocation(prog, "uViewProj"), false, glMat(mul4(view, proj)));
  gl.uniform3f(gl.getUniformLocation(prog, "uEye"), shot.pos.x, shot.pos.y, shot.pos.z);
  gl.uniform3fv(gl.getUniformLocation(prog, "uBlobLight"), [0, 0, 0]);
  gl.uniform3fv(gl.getUniformLocation(prog, "uMoodLight"), MOOD_LIGHT_POS);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_CUBE_MAP, official.envCube);
  gl.uniform1i(gl.getUniformLocation(prog, "uEnv"), 0);
  gl.uniform3fv(gl.getUniformLocation(prog, "uSpecular"), rgb(theme.shield));
  gl.uniform1f(gl.getUniformLocation(prog, "uIntensity"), shieldIntensity(t, energy.blob));
  gl.uniform1f(gl.getUniformLocation(prog, "uAlpha"), alpha);
  const worldLoc = gl.getUniformLocation(prog, "uWorld");
  const aPos = gl.getAttribLocation(prog, "aPos");
  const aNrm = gl.getAttribLocation(prog, "aNrm");
  const wire = theme.shieldWireframe;
  if (wire) gl.disable(gl.CULL_FACE);
  const bind = (gpu) => {
    gl.bindBuffer(gl.ARRAY_BUFFER, gpu.pos);
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 3, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, gpu.nrm);
    gl.enableVertexAttribArray(aNrm);
    gl.vertexAttribPointer(aNrm, 3, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, wire ? gpu.line : gpu.idx);
  };
  const draw = (gpu) => {
    if (wire) gl.drawElements(gl.LINES, gpu.lineCount, gl.UNSIGNED_SHORT, 0);
    else gl.drawElements(gl.TRIANGLE_STRIP, gpu.count, gl.UNSIGNED_SHORT, 0);
  };

  // Far side first, then the near side, so the translucent panels layer right.
  const look = vsub(shot.look, shot.pos);
  const blobDot = mgr.center[0] * look.x + mgr.center[1] * look.y + mgr.center[2] * look.z;
  bind(shields.panel);
  for (const pass of [true, false]) {
    for (const s of mgr.shields) {
      const d = s.center[0] * look.x + s.center[1] * look.y + s.center[2] * look.z;
      if (pass ? d < blobDot : d >= blobDot) continue;
      gl.uniformMatrix4fv(worldLoc, false, glMat(s.matrix));
      draw(shields.panel);
    }
  }
  // ZShields are drawn on the near pass only, unsorted, as in the source.
  mgr.zShields.forEach((z, i) => {
    const gpu = shields.zPanels[i];
    bind(gpu);
    gl.uniformMatrix4fv(worldLoc, false, glMat(z.matrix));
    draw(gpu);
  });

  gl.depthMask(true);
  gl.disable(gl.BLEND);
  gl.disable(gl.CULL_FACE);
}

function makeBlobGpu(gl) {
  const sim = new BlobSim();
  const buf = (target, data, usage) => {
    const b = gl.createBuffer();
    gl.bindBuffer(target, b);
    gl.bufferData(target, data, usage);
    return b;
  };
  const halo = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, halo);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 256, 256, 0, gl.RGBA, gl.UNSIGNED_BYTE, glowTexels(256));
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  // BlobWireframe needs the strips as edges, since WebGL has no fill mode.
  const bodyLines = stripToLines(sim.sphere.idx);
  const dropLines = stripToLines(sim.bloblet.idx);
  return {
    sim,
    us: buf(gl.ARRAY_BUFFER, new Float32Array(sim.sphere.pos), gl.STATIC_DRAW),
    idx: buf(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(sim.sphere.idx), gl.STATIC_DRAW),
    count: sim.sphere.idx.length,
    line: buf(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(bodyLines), gl.STATIC_DRAW),
    lineCount: bodyLines.length,
    changing: buf(gl.ARRAY_BUFFER, sim.changing, gl.DYNAMIC_DRAW),
    dropUs: buf(gl.ARRAY_BUFFER, new Float32Array(sim.bloblet.pos), gl.STATIC_DRAW),
    dropIdx: buf(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(sim.bloblet.idx), gl.STATIC_DRAW),
    dropCount: sim.bloblet.idx.length,
    dropLine: buf(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(dropLines), gl.STATIC_DRAW),
    dropLineCount: dropLines.length,
    halo,
    quad: gl.createBuffer(),
  };
}

// blob::render, minus the shadow pass the web player does not have.
function drawBlob(gl, t, theme, shot, view, proj, energy) {
  const blob = official.blob;
  const sim = blob.sim;
  sim.seek(t);

  const curRad = BLOB_RADIUS * (1 + 1.3 * Math.sqrt(Math.max(0, energy.pulse)));
  const viewProj = glMat(mul4(view, proj));
  const eye = [shot.pos.x, shot.pos.y, shot.pos.z];
  const glow = rgb(theme.blobGlow);
  const base = rgb(theme.blobColor);
  // blob::render sets D3DRS_FILLMODE once up front, so the flag covers the
  // halo quad and the bloblets as well as the body.
  const wire = theme.blobWireframe;

  // Camera-facing halo quad, additive.
  const ctw = camToWorld(shot.pos, shot.look);
  const fRad = curRad * 5.2;
  const verts = [];
  const corner = (sx, sy, u, v) => {
    verts.push(
      (ctw.x[0] * sx + ctw.y[0] * sy) * fRad + sim.center[0],
      (ctw.x[1] * sx + ctw.y[1] * sy) * fRad + sim.center[1],
      (ctw.x[2] * sx + ctw.y[2] * sy) * fRad + sim.center[2],
      u,
      v
    );
  };
  corner(-1, 1, 0, 1);
  corner(1, 1, 1, 1);
  corner(1, -1, 1, 0);
  corner(-1, -1, 0, 0);
  gl.bindBuffer(gl.ARRAY_BUFFER, blob.quad);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(verts), gl.DYNAMIC_DRAW);

  gl.enable(gl.BLEND);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
  gl.depthMask(false);
  let prog = official.haloProg;
  gl.useProgram(prog);
  gl.uniformMatrix4fv(gl.getUniformLocation(prog, "uViewProj"), false, viewProj);
  gl.uniform3fv(gl.getUniformLocation(prog, "uColor"), glow);
  gl.uniform1f(gl.getUniformLocation(prog, "uAlpha"), Math.min(1, Math.max(0, energy.blob)));
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, blob.halo);
  gl.uniform1i(gl.getUniformLocation(prog, "uTex"), 0);
  let loc = gl.getAttribLocation(prog, "aPos");
  let locUv = gl.getAttribLocation(prog, "aUv");
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 3, gl.FLOAT, false, 20, 0);
  gl.enableVertexAttribArray(locUv);
  gl.vertexAttribPointer(locUv, 2, gl.FLOAT, false, 20, 12);
  gl.drawArrays(wire ? gl.LINE_LOOP : gl.TRIANGLE_FAN, 0, 4);
  gl.disableVertexAttribArray(locUv);
  gl.depthMask(true);
  gl.disable(gl.BLEND);

  // The blob body.
  const scaling = [curRad * sim.scale[0], curRad * sim.scale[1], curRad * sim.scale[2]];
  const ooScaling = [1 / scaling[0], 1 / scaling[1], 1 / scaling[2]];
  let colorIntensity = BLOB_BASE_INTENSITY + 4 * (1.2 * energy.base + 0.8 * energy.pulse);
  colorIntensity *= Math.min(1, t * 4);

  prog = official.blobProg;
  gl.useProgram(prog);
  gl.uniformMatrix4fv(gl.getUniformLocation(prog, "uViewProj"), false, viewProj);
  gl.uniform3fv(gl.getUniformLocation(prog, "uScaling"), scaling);
  gl.uniform3fv(gl.getUniformLocation(prog, "uOoScaling"), ooScaling);
  gl.uniform3fv(gl.getUniformLocation(prog, "uCenter"), sim.center);
  gl.uniform3fv(gl.getUniformLocation(prog, "uEye"), eye);
  gl.uniform3fv(gl.getUniformLocation(prog, "uColor"), base.map((c) => c * colorIntensity));
  gl.uniform3fv(gl.getUniformLocation(prog, "uAmbient"), [0, 0, 0]);
  gl.uniform1f(gl.getUniformLocation(prog, "uAlpha"), 1);
  const aUs = gl.getAttribLocation(prog, "aUs");
  const aNrm = gl.getAttribLocation(prog, "aNrm");
  gl.bindBuffer(gl.ARRAY_BUFFER, blob.us);
  gl.enableVertexAttribArray(aUs);
  gl.vertexAttribPointer(aUs, 3, gl.FLOAT, false, 0, 0);
  gl.bindBuffer(gl.ARRAY_BUFFER, blob.changing);
  gl.bufferData(gl.ARRAY_BUFFER, sim.changing, gl.DYNAMIC_DRAW);
  gl.enableVertexAttribArray(aNrm);
  gl.vertexAttribPointer(aNrm, 4, gl.FLOAT, false, 0, 0);
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, wire ? blob.line : blob.idx);
  gl.drawElements(
    wire ? gl.LINES : gl.TRIANGLE_STRIP,
    wire ? blob.lineCount : blob.count,
    gl.UNSIGNED_SHORT,
    0
  );
  gl.disableVertexAttribArray(aNrm);

  // The bloblets.
  if (sim.numBloblets) {
    prog = official.blobletProg;
    gl.useProgram(prog);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.uniformMatrix4fv(gl.getUniformLocation(prog, "uViewProj"), false, viewProj);
    gl.uniform3fv(gl.getUniformLocation(prog, "uEye"), eye);
    gl.uniform3fv(gl.getUniformLocation(prog, "uColor"), base.map((c) => c * 0.3 * energy.blob));
    gl.uniform3fv(gl.getUniformLocation(prog, "uAmbient"), base.map((c) => c * 0.2));
    gl.uniform1f(gl.getUniformLocation(prog, "uAlpha"), 0.3 * energy.blob * 2);
    const dUs = gl.getAttribLocation(prog, "aUs");
    gl.bindBuffer(gl.ARRAY_BUFFER, blob.dropUs);
    gl.enableVertexAttribArray(dUs);
    gl.vertexAttribPointer(dUs, 3, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, wire ? blob.dropLine : blob.dropIdx);
    for (let i = 0; i < sim.numBloblets; i++) {
      const drop = sim.bloblets[i];
      const perp = drop.fRadius / Math.sqrt(drop.fWobble);
      const pmp = drop.fRadius * drop.fWobble - perp;
      gl.uniform3fv(gl.getUniformLocation(prog, "uCenter"), drop.vPosition);
      gl.uniform3fv(gl.getUniformLocation(prog, "uDir"), drop.vDirection);
      gl.uniform3fv(gl.getUniformLocation(prog, "uPerp"), [perp, perp, perp]);
      gl.uniform3fv(gl.getUniformLocation(prog, "uPmp"), [
        pmp * drop.vDirection[0],
        pmp * drop.vDirection[1],
        pmp * drop.vDirection[2],
      ]);
      gl.drawElements(
        wire ? gl.LINES : gl.TRIANGLE_STRIP,
        wire ? blob.dropLineCount : blob.dropCount,
        gl.UNSIGNED_SHORT,
        0
      );
    }
    gl.disable(gl.BLEND);
  }
}

function camToWorld(pos, look) {
  const z = vnorm(vsub(look, pos));
  let x = vcross(z, v3(0, 0, 1));
  if (vlen(x) < 1e-5) x = v3(1, 0, 0);
  x = vnorm(x);
  const y = vcross(x, z);
  return { x: [x.x, x.y, x.z], y: [y.x, y.y, y.z], z: [z.x, z.y, z.z] };
}

async function loadOfficial(canvas) {
  const gl = canvas.getContext("webgl", { antialias: true, alpha: false });
  if (!gl) throw new Error("WebGL is not available");
  const response = await fetch("geometry.json");
  if (!response.ok) throw new Error("geometry.json failed to load");
  const data = await response.json();
  const gpu = data.meshes.map((m) => uploadMesh(gl, m, false));
  gpu.logo = {};
  for (const key of Object.keys(data.logo)) gpu.logo[key] = uploadMesh(gl, data.logo[key], !!data.logo[key].uv);
  const quad = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, quad);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  official.gl = gl;
  official.data = data;
  official.gpu = gpu;
  official.quad = quad;
  official.sceneProg = program(gl, VS, FS_SCENE);
  official.logoProg = program(gl, VS, FS_LOGO);
  official.slashProg = program(gl, VS, FS_SLASHTEX);
  official.brandProg = program(gl, VS_BRAND, FS_BRAND);
  official.brandTex = makeBrandTexture(gl, data.brand);
  official.brandQuad = gl.createBuffer();
  official.fogProg = program(gl, VS_FLAT, FS_FOG);
  official.blobProg = program(gl, VS_BLOB, FS_BLOB);
  official.blobletProg = program(gl, VS_BLOBLET, FS_BLOB);
  official.haloProg = program(gl, VS_HALO, FS_HALO);
  official.tmProg = program(gl, VS, FS_TM);
  official.tmTex = makeTmTexture(gl, data.tm);
  official.blob = makeBlobGpu(gl);
  official.shieldProg = program(gl, VS_SHIELD, FS_SHIELD);
  official.shields = makeShieldGpu(gl, state.pulseRand);
  // Baked once at startup, as in app init, so later theme edits do not change it.
  official.envCube = makeReflectionCubeMap(gl, data, state.theme);
  official.ready = true;
}

function worldOf(data, inst, fpos) {
  let basis = inst.m;
  if (inst.rot >= 0 || inst.pos >= 0) {
    basis = inst.m.slice();
    if (inst.rot >= 0) basis = mul4(inst.m, matFromQuat(sampleQuat(data.quats, data.quatSeq[inst.rot], fpos)));
    if (inst.pos >= 0) {
      const p = sampleVec(data.positions, data.posSeq[inst.pos], fpos);
      basis = basis.slice();
      basis[12] += p[0];
      basis[13] += p[1];
      basis[14] += p[2];
    }
  }
  return mul4(scaleMat(inst.s), basis);
}

function drawMesh(gl, prog, gpu, world, view, proj, wire) {
  const mvp = mul4(mul4(world, view), proj);
  gl.uniformMatrix4fv(gl.getUniformLocation(prog, "uMvp"), false, glMat(mvp));
  gl.uniformMatrix4fv(gl.getUniformLocation(prog, "uWorld"), false, glMat(world));
  gl.uniformMatrix3fv(gl.getUniformLocation(prog, "uNormal"), false, gl3(inv3(world)));
  bindMesh(gl, prog, gpu, !!gpu.uv);
  if (wire) {
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, gpu.line);
    gl.drawElements(gl.LINES, gpu.lines, gl.UNSIGNED_SHORT, 0);
    return;
  }
  const modeOf = { triangles: gl.TRIANGLES, strip: gl.TRIANGLE_STRIP, fan: gl.TRIANGLE_FAN };
  for (const part of gpu.parts) {
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, part.buf);
    gl.drawElements(modeOf[part.mode], part.count, gl.UNSIGNED_SHORT, 0);
  }
}

// The title's bright layer tracks getBlobIntensity, so it breathes with the
// blob rather than on its own timer. Quantised so a frame that barely moves the
// intensity does not trigger a restyle.
let titleGlow = -1;

function setTitleGlow(intensity) {
  const v = Math.round(Math.min(1, Math.max(0, intensity)) * 50) / 50;
  if (v === titleGlow) return;
  titleGlow = v;
  document.documentElement.style.setProperty("--flubber", String(v));
}

function drawOfficial(width, height, t, theme) {
  if (!official.ready) return;
  const gl = official.gl;
  const data = official.data;
  rebuildCamera();
  const fpos = (t - SCENE_ANIM_START_TIME) / SCENE_ANIM_LEN;
  const shot = sampleCamera(state.camera, Math.min(t, DEMO_TOTAL_TIME));
  const view = viewRows(shot.pos, shot.look);
  const proj = projRows(height / width);
  const energy = intensityAt(t, state.pulses);
  const showGeom = shot.renderGeom && t < FINISH_STOP_TIME;
  setTitleGlow(energy.blob);

  gl.viewport(0, 0, width, height);
  gl.clearColor(0, 0, 0, 1);
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  gl.enable(gl.DEPTH_TEST);
  gl.disable(gl.CULL_FACE);
  gl.disable(gl.BLEND);

  official.blob.sim.seek(t);

  if (showGeom && theme.sceneRender) {
    drawScene(gl, data, theme, shot, view, proj, energy, fpos);
  }

  if (showGeom && theme.blobRender) {
    drawBlob(gl, t, theme, shot, view, proj, energy);
  }

  if (showGeom && theme.shieldRender) {
    drawShields(gl, t, theme, shot, view, proj, energy);
  }

  const fogOn = theme.plasmaRender && ((showGeom && (energy.blob > 0 || t < BLOB_STATIC_END_TIME)) || t < BLOB_STATIC_END_TIME);
  if (fogOn) {
  const clip = mul4(view, proj);
  const ow = clip[15] || 1;
  const ox = (clip[12] / ow) * 0.5 + 0.5;
  const oy = (clip[13] / ow) * 0.5 + 0.5;
    let glow = 0;
    if (t < BLOB_STATIC_END_TIME) {
      const u = t < 0.12 ? t / 0.12 : 1 - (t - 0.12) / BLOB_STATIC_END_TIME;
      glow = Math.max(0, Math.min(1, u));
    } else glow = 0.75 * Math.max(0, Math.min(1, (t - GLOW_FADE_SCREEN_START) / 0.25));
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);
    gl.depthMask(false);
    const prog = official.fogProg;
    gl.useProgram(prog);
    gl.bindBuffer(gl.ARRAY_BUFFER, official.quad);
    const loc = gl.getAttribLocation(prog, "aPos");
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    gl.uniform2f(gl.getUniformLocation(prog, "uOrigin"), ox, oy);
    gl.uniform3fv(gl.getUniformLocation(prog, "uC1"), rgb(theme.plasma1));
    gl.uniform3fv(gl.getUniformLocation(prog, "uC2"), rgb(theme.plasma2));
    gl.uniform3fv(gl.getUniformLocation(prog, "uC3"), rgb(theme.plasma3));
    gl.uniform1f(gl.getUniformLocation(prog, "uI"), Math.max(0, energy.blob * 0.7 - 0.1));
    gl.uniform1f(gl.getUniformLocation(prog, "uGlow"), glow);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.depthMask(true);
    gl.disable(gl.BLEND);
  }

  if ((shot.renderSlash || t >= FINISH_START_TIME) && state.camera.slash) {
    const slash = slashRows(state.camera.slash);
    const span = SLASH_GRADIENT_END - SLASH_GRADIENT_START;
    const fmag = -1 + 2 * ((t - SLASH_GRADIENT_START) / span);
    const w3 = Math.max(0, Math.min(1, fmag));
    const stage = [1, 2, 3, 4].map((i) => {
      const a = theme["slashInnerStage1Gradient" + i];
      const b = theme["slashInnerStage2Gradient" + i];
      const mixed = mixHex(a, b, w3);
      return rgb(mixed);
    });
    const tex = slashTextures(gl, theme);
    const bg = official.slashProg;
    gl.useProgram(bg);
    gl.activeTexture(gl.TEXTURE0);
    gl.uniform1i(gl.getUniformLocation(bg, "uTex"), 0);
    gl.uniform3fv(gl.getUniformLocation(bg, "uBorder"), rgb(theme.slashBackgroundStart));
    for (const name of ["lip", "surface", "surfaceTop"]) {
      gl.bindTexture(gl.TEXTURE_2D, tex[name]);
      drawMesh(gl, bg, official.gpu.logo[name], slash, view, proj, false);
    }

    const prog = official.logoProg;
    gl.useProgram(prog);
    gl.uniform3f(gl.getUniformLocation(prog, "uCam"), shot.pos.x, shot.pos.y, shot.pos.z);
    gl.uniform1f(gl.getUniformLocation(prog, "uAlpha"), 1);
    gl.uniform1f(gl.getUniformLocation(prog, "uMode"), 2);
    gl.uniform3fv(gl.getUniformLocation(prog, "uA"), stage[0]);
    gl.uniform3fv(gl.getUniformLocation(prog, "uB"), stage[1]);
    gl.uniform3fv(gl.getUniformLocation(prog, "uC"), stage[2]);
    gl.uniform3fv(gl.getUniformLocation(prog, "uD"), stage[3]);
    drawMesh(gl, prog, official.gpu.logo.interior, slash, view, proj, false);
    const textU = Math.max(0, Math.min(1, (t - TEXT_ANIM_START) / TEXT_ANIM_LEN));
    if (textU > 0) {
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      const keys = official.data.textAnim;
      const a = keys[0];
      const b = keys[1];
      const p = [a[0] * (1 - textU) + b[0] * textU, a[1] * (1 - textU) + b[1] * textU, a[2] * (1 - textU) + b[2] * textU];
      const flip = [1, 0, 0, 0, 0, 0, 1, 0, 0, -1, 0, 0, 0, 0, 0, 1];
      const trans = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, p[0], p[1], p[2], 1];
      const textWorld = mul4(mul4(flip, trans), slash);
      gl.uniform1f(gl.getUniformLocation(prog, "uMode"), 1);
      gl.uniform1f(gl.getUniformLocation(prog, "uAlpha"), textU);
      if (theme.xboxRender) {
        const col = rgb(theme.xbox);
        gl.uniform3fv(gl.getUniformLocation(prog, "uA"), col);
        gl.uniform3fv(gl.getUniformLocation(prog, "uB"), col);
        drawMesh(gl, prog, official.gpu.logo.text, textWorld, view, proj, false);
      }
      if (theme.tradeMarkRender) {
        const tm = official.tmProg;
        gl.useProgram(tm);
        gl.disable(gl.DEPTH_TEST);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, official.tmTex);
        gl.uniform1i(gl.getUniformLocation(tm, "uTex"), 0);
        gl.uniform3fv(gl.getUniformLocation(tm, "uColor"), rgb(theme.tradeMark));
        gl.uniform1f(gl.getUniformLocation(tm, "uAlpha"), textU);
        drawMesh(gl, tm, official.gpu.logo.tmSlash, slash, view, proj, false);
        drawMesh(gl, tm, official.gpu.logo.tmWord, slash, view, proj, false);
        gl.enable(gl.DEPTH_TEST);
        gl.useProgram(prog);
      }
      gl.disable(gl.BLEND);
    }
  }

  if (theme.brandRender && t > FINISH_STOP_TIME) {
    drawBrand(gl, width, height, theme, Math.max(0, Math.min(1, (t - FINISH_STOP_TIME) / 0.45)));
  }
  if (state.sound) updateSound(t, energy.blob);
}
