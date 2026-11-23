// Mushroom-village first-person world (three.js r180, VW-GAME-IF-v1.3 three.js branch).
// All geometry and textures are procedural (no external assets). Deterministic: no wall clock, seeded PRNG only.
import * as THREE from './lib/three.module.js';

// ---------------------------------------------------------------- constants (estimated from the clip; see README)
const TICK = 1 / 60;
const EYE_H = 0.70;            // camera height above ground (m)
const PITCH = 8.3 * Math.PI / 180; // slight upward look seen in the clip
const VFOV = 47;
const WALK_SPEED = 4.2;        // m/s forward
const BACK_SPEED = 1.8;        // m/s backward
const TURN_RATE = 90 * Math.PI / 180; // rad/s
const PLAYER_R = 0.25;
const ACT_RANGE = 4.6;

// main mushroom house
const H_WALL_T = 0.18;         // wall thickness
const DOOR_W = 1.08;           // door opening width (arc length)
const DOOR_H = 1.90;           // door opening height
const DOOR_OPEN_TIME = 1.6;    // s
const DOOR_OPEN_ANGLE = 92 * Math.PI / 180;
const START = { x: 1.47, z: 6.2, yaw: 4.3 * Math.PI / 180 };

function houseR(y) {           // outer radius profile of the main house stem
  const pts = [[0, 1.86], [0.6, 1.93], [1.3, 1.89], [2.0, 1.77], [2.6, 1.62], [3.25, 1.45]];
  if (y <= 0) return pts[0][1];
  for (let i = 1; i < pts.length; i++) if (y <= pts[i][0]) {
    const [y0, r0] = pts[i - 1], [y1, r1] = pts[i]; const u = (y - y0) / (y1 - y0);
    const s = u * u * (3 - 2 * u); return r0 + (r1 - r0) * (0.5 * u + 0.5 * s);
  }
  return pts[pts.length - 1][1];
}
const STEM_TOP = 3.25;

// ---------------------------------------------------------------- deterministic helpers
function mulberry32(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
function hash2(ix, iy, s) { let h = (ix * 374761393 + iy * 668265263 + s * 2147483647) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); h ^= h >>> 16; return (h >>> 0) / 4294967296; }
function vnoise(x, y, period, s) {
  const ix = Math.floor(x), iy = Math.floor(y); const fx = x - ix, fy = y - iy;
  const P = (v) => ((v % period) + period) % period;
  const a = hash2(P(ix), P(iy), s), b = hash2(P(ix + 1), P(iy), s), c = hash2(P(ix), P(iy + 1), s), d = hash2(P(ix + 1), P(iy + 1), s);
  const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
  return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
}
function fbm(u, v, base, oct, s) { // u,v in [0,1) tileable
  let f = 0, amp = 0.5, tot = 0, p = base;
  for (let o = 0; o < oct; o++) { f += amp * vnoise(u * p, v * p, p, s + o * 17); tot += amp; amp *= 0.5; p *= 2; }
  return f / tot;
}
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const lerp = (a, b, t) => a + (b - a) * t;

function makeTex(size, fn, repeat = [1, 1], srgb = true, hgt = size) {
  const data = new Uint8Array(size * hgt * 4);
  for (let j = 0; j < hgt; j++) for (let i = 0; i < size; i++) {
    const c = fn(i / size, j / hgt); const k = (j * size + i) * 4;
    data[k] = clamp(c[0] * 255, 0, 255); data[k + 1] = clamp(c[1] * 255, 0, 255); data[k + 2] = clamp(c[2] * 255, 0, 255); data[k + 3] = c.length > 3 ? clamp(c[3] * 255, 0, 255) : 255;
  }
  const t = new THREE.DataTexture(data, size, hgt, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(repeat[0], repeat[1]);
  t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter; t.generateMipmaps = true;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.needsUpdate = true; return t;
}
const mix3 = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
const hex3 = (h) => [((h >> 16) & 255) / 255, ((h >> 8) & 255) / 255, (h & 255) / 255];

// ---------------------------------------------------------------- textures
function buildTextures() {
  const T = {};
  T.stucco = makeTex(256, (u, v) => {
    const n = fbm(u, v, 3, 5, 1), m = fbm(u, v, 12, 3, 7), sp = fbm(u, v, 48, 2, 9);
    let c = mix3(hex3(0xdacdb6), hex3(0xa69882), clamp((n - 0.38) * 2.2, 0, 1));
    c = mix3(c, hex3(0x7d7466), clamp((m - 0.62) * 3.5, 0, 1) * 0.7); // grimy patches
    return mix3(c, hex3(0xb0a696), sp * 0.25);
  });
  T.wood = makeTex(256, (u, v) => {     // vertical planks
    const plank = Math.floor(u * 6); const pu = u * 6 - plank;
    const g = fbm(u * 1 + plank * 0.13, v, 2, 4, 3 + plank) * 0.6 + 0.4 * fbm(u * 8, v * 0.5, 8, 2, 11);
    let c = mix3(hex3(0x4a2617), hex3(0x2a130b), g);
    if (pu < 0.05 || pu > 0.95) c = mix3(c, [0.06, 0.03, 0.02], 0.7);
    return c;
  });
  T.frameWood = makeTex(128, (u, v) => {
    const g = fbm(u, v, 3, 4, 21) * 0.5 + 0.5 * fbm(u * 6, v, 6, 2, 22);
    return mix3(hex3(0xa07850), hex3(0x5a3a22), g);
  });
  T.bark = makeTex(256, (u, v) => {
    const s = fbm(u, v * 0.25, 8, 4, 31); const s2 = fbm(u, v, 24, 2, 33);
    const ridge = Math.abs(Math.sin((u * 18 + s * 3) * Math.PI));
    return mix3(hex3(0x2c1f17), hex3(0x5e4836), clamp(ridge * 0.7 + s2 * 0.4 - 0.1, 0, 1));
  });
  T.grass = makeTex(256, (u, v) => {
    const n = fbm(u, v, 6, 5, 41), m = fbm(u, v, 32, 2, 43);
    let c = mix3(hex3(0x22401a), hex3(0x4f6e26), clamp(n * 1.4 - 0.25, 0, 1));
    c = mix3(c, hex3(0x16290e), m * 0.5);
    const sunp = fbm(u, v, 3, 3, 47); return mix3(c, hex3(0x7a9a34), clamp((sunp - 0.58) * 5, 0, 1) * 0.4);
  });
  T.dirt = makeTex(256, (u, v) => {
    const n = fbm(u, v, 5, 5, 51), m = fbm(u, v, 30, 2, 53);
    const c = mix3(hex3(0xb08a55), hex3(0x7d5c36), clamp(n * 1.3 - 0.2, 0, 1));
    return mix3(c, hex3(0x5c4228), m * 0.3);
  });
  T.cap = makeTex(256, (u, v) => {       // u around, v from top (0) to rim (1)
    const n = fbm(u, v, 8, 4, 61); const st = fbm(u * 1, v * 0.2, 24, 2, 62);
    return mix3(hex3(0x84492a), hex3(0x3a1d0f), clamp(n * 0.7 + st * 0.6 - 0.2, 0, 1));
  });
  T.capUnder = makeTex(256, (u, v) => {
    const g = Math.abs(Math.sin(u * Math.PI * 90)) * 0.5 + fbm(u, v, 8, 3, 63) * 0.5;
    return mix3(hex3(0x5a3420), hex3(0x2c160b), g);
  });
  T.thatch = makeTex(256, (u, v) => {
    const s = fbm(u * 1, v, 48, 2, 71) * 0.6 + fbm(u, v, 6, 3, 72) * 0.4;
    return mix3(hex3(0x9d7a4a), hex3(0x5e4224), s);
  });
  T.interior = makeTex(256, (u, v) => {
    const n = fbm(u, v, 5, 5, 81), m = fbm(u * 2, v * 0.3, 20, 2, 83);
    return mix3(mix3(hex3(0x4e3a26), hex3(0x332416), n), hex3(0x261a10), m * 0.35);
  });
  T.floor = makeTex(256, (u, v) => {
    const n = fbm(u, v, 6, 4, 91);
    return mix3(hex3(0x6e5a3c), hex3(0x4a3a24), n);
  });
  T.leaf = makeTex(128, (u, v) => {     // u across leaf, v along
    const vein = Math.exp(-Math.pow((u - 0.5) * 40, 2));
    const side = Math.abs(Math.sin((v * 9 + Math.abs(u - 0.5) * 6) * Math.PI)) < 0.12 ? 0.25 : 0;
    const n = fbm(u, v, 4, 3, 101);
    let c = mix3(hex3(0x1f4a16), hex3(0x3f7a24), n);
    c = mix3(c, hex3(0x8cbf4a), vein * 0.8 + side * 0.4);
    return c;
  });
  T.blueStem = makeTex(128, (u, v) => {
    const n = fbm(u, v, 6, 4, 111); return mix3(hex3(0x2d4fb8), hex3(0x1b2f80), n);
  });
  T.glow = makeTex(128, (u, v) => {
    const d = Math.hypot(u - 0.5, v - 0.5) * 2; const c = mix3(hex3(0xfff3c4), hex3(0xf2b84a), clamp(d * d, 0, 1));
    return c;
  });
  { // red toadstool cap with white spots (lathe uv: u around, v along profile from underside centre to top)
    const sp = []; const r = mulberry32(4242);
    for (let k = 0; k < 30; k++) sp.push([r() * 3.0, 0.46 + r() * 0.48, 0.03 + r() * 0.035]);
    T.spots = makeTex(256, (u, v) => {
      if (v < 0.36) return mix3(hex3(0xe6d6c2), hex3(0xc8b49a), fbm(u, v, 16, 2, 5) * 0.6);
      let c = mix3(hex3(0xd2281e), hex3(0xa8160f), fbm(u, v, 8, 3, 6));
      if (v < 0.42) c = mix3(hex3(0xd8c8b4), c, (v - 0.36) / 0.06);
      const X = u * 3.0, Y = v * 0.75;
      const circ = (vv) => Math.pow(Math.max(0.05, Math.cos(clamp((vv - 0.42) / 0.58, 0, 1) * Math.PI / 2)), 0.7);
      for (const [sx, sy, sr] of sp) {
        let dx = Math.abs(X - sx); dx = Math.min(dx, 3.0 - dx); const dy = Y - sy * 0.75;
        const d = Math.hypot(dx * circ(v), dy) / (sr * (0.6 + 0.4 * circ(sy)));
        if (d < 1.15) c = mix3(hex3(0xfaf4ea), c, clamp((d - 0.85) / 0.3, 0, 1));
      }
      return c;
    });
  }
  T.outsideView = null;
  return T;
}

// ---------------------------------------------------------------- geometry helpers
function lathe(profile, seg = 48, phiStart = 0, phiLen = Math.PI * 2) {
  const g = new THREE.LatheGeometry(profile.map(([r, y]) => new THREE.Vector2(Math.max(r, 0.0001), y)), seg, phiStart, phiLen);
  return g;
}
// Cylindrical shell with holes. holeFn(phi, y) -> true where geometry is removed. rFn(y) radius. inward flips normals.
function shellGeometry(rFn, y0, y1, nPhi, nY, holeFn, inward, uvScale = [4, 2], shadeFn) {
  const pos = [], nrm = [], uv = [], col = [], idx = [];
  const grid = [];
  for (let j = 0; j <= nY; j++) {
    const y = y0 + (y1 - y0) * j / nY; const r = rFn(y);
    const dr = (rFn(y + 0.01) - rFn(y - 0.01)) / 0.02;
    for (let i = 0; i <= nPhi; i++) {
      const phi = (i / nPhi) * Math.PI * 2; const s = Math.sin(phi), c = Math.cos(phi);
      pos.push(r * s, y, r * c);
      let nx = s, ny = -dr, nz = c; const l = Math.hypot(nx, ny, nz); nx /= l; ny /= l; nz /= l;
      if (inward) { nx = -nx; ny = -ny; nz = -nz; }
      nrm.push(nx, ny, nz); uv.push(i / nPhi * uvScale[0], (y - y0) / (y1 - y0) * uvScale[1]);
      const sh = shadeFn ? shadeFn(phi, y) : 1; col.push(sh, sh, sh);
    }
  }
  const W = nPhi + 1;
  for (let j = 0; j < nY; j++) for (let i = 0; i < nPhi; i++) {
    const phi = ((i + 0.5) / nPhi) * Math.PI * 2; const y = y0 + (y1 - y0) * (j + 0.5) / nY;
    if (holeFn && holeFn(phi, y)) continue;
    const a = j * W + i, b = a + 1, c = a + W, d = c + 1;
    if (inward) idx.push(a, c, b, b, c, d); else idx.push(a, b, c, b, d, c);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx); return g;
}
function wrapPhi(p) { while (p > Math.PI) p -= 2 * Math.PI; while (p < -Math.PI) p += 2 * Math.PI; return p; }
// arch outline (door): returns points of the arch centre line for |u|<=w/2 , v in [0,h]
function archInside(u, v, w, h) {
  const hw = w / 2, sh = h - hw * 1.15; // straight part height
  if (v < 0 || v > h) return false;
  if (v <= sh) return Math.abs(u) < hw * (1 - 0.06 * (1 - v / sh));
  const ty = (v - sh) / (h - sh); return Math.abs(u) < hw * Math.sqrt(Math.max(0, 1 - ty * ty));
}
function archPath(w, h, n) { // polyline from bottom-left, over the top, to bottom-right (u,v)
  const hw = w / 2, sh = h - hw * 1.15; const pts = [];
  const nS = Math.floor(n * 0.28), nA = n - 2 * nS;
  for (let k = 0; k < nS; k++) { const v = k / nS * sh; pts.push([-hw * (1 - 0.06 * (1 - v / sh)), v]); }
  for (let k = 0; k <= nA; k++) { const a = Math.PI - k / nA * Math.PI; pts.push([hw * Math.cos(a), sh + (h - sh) * Math.sin(a)]); }
  for (let k = nS - 1; k >= 0; k--) { const v = k / nS * sh; pts.push([hw * (1 - 0.06 * (1 - v / sh)), v]); }
  return pts;
}
function leafGeometry(len, wid, bend, droop, segs = 10) {
  const pos = [], uv = [], idx = [];
  for (let k = 0; k <= segs; k++) {
    const t = k / segs; const w = wid * Math.pow(Math.sin(Math.PI * Math.min(1, t * 1.02 + 0.02)), 0.55) * (1 - 0.2 * t);
    const z = len * t; const y = bend * Math.sin(t * Math.PI * 0.9) - droop * t * t;
    const cup = 0.18 * w;
    pos.push(-w / 2, y + cup, z, 0, y, z, w / 2, y + cup, z);
    uv.push(0, t, 0.5, t, 1, t);
    if (k < segs) { const a = k * 3; idx.push(a, a + 3, a + 1, a + 1, a + 3, a + 4, a + 1, a + 4, a + 2, a + 2, a + 4, a + 5); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx); g.computeVertexNormals(); return g;
}
function blobGeometry(r, rnd, detail = 2, squash = 0.7, jitter = 0.18) {
  const g = new THREE.IcosahedronGeometry(r, detail); const p = g.attributes.position;
  const seed = Math.floor(rnd() * 1e6);
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const n = 1 + jitter * (hash2(Math.round(x * 7) + 99, Math.round(y * 7 + z * 13) + 99, seed) - 0.5) * 2;
    p.setXYZ(i, x * n, Math.max(y * n * squash, -0.15 * r), z * n);
  }
  g.computeVertexNormals(); return g;
}

// ---------------------------------------------------------------- world
export function createWorld() {
  const T = buildTextures();
  const scene = new THREE.Scene();
  scene.name = 'mushroom_village_scene';
  scene.background = new THREE.Color(0x9fcfe0);
  scene.fog = new THREE.Fog(0x557a6e, 6, 46);

  const M = {
    stucco: new THREE.MeshLambertMaterial({ map: T.stucco, color: 0xffffff }),
    door: new THREE.MeshLambertMaterial({ map: T.wood, color: 0xffffff, side: THREE.DoubleSide }),
    frame: new THREE.MeshLambertMaterial({ map: T.frameWood, color: 0xffffff }),
    frameDark: new THREE.MeshLambertMaterial({ map: T.frameWood, color: 0xb89a84 }),
    cap: new THREE.MeshLambertMaterial({ map: T.cap, color: 0xffffff }),
    capUnder: new THREE.MeshLambertMaterial({ map: T.capUnder, color: 0xffffff, side: THREE.DoubleSide }),
    bark: new THREE.MeshLambertMaterial({ map: T.bark, color: 0xffffff }),
    grass: new THREE.MeshLambertMaterial({ map: T.grass, color: 0xffffff, vertexColors: true }),
    dirt: new THREE.MeshLambertMaterial({ map: T.dirt, color: 0xffffff, vertexColors: true, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
    thatch: new THREE.MeshLambertMaterial({ map: T.thatch, color: 0xffffff }),
    interior: new THREE.MeshBasicMaterial({ map: T.interior, color: 0xd8d0c8, vertexColors: true }),
    interiorFloor: new THREE.MeshBasicMaterial({ map: T.floor, color: 0x56483a }),
    ceiling: new THREE.MeshBasicMaterial({ map: T.capUnder, color: 0x5a4a40, side: THREE.BackSide }),
    winFrameIn: new THREE.MeshBasicMaterial({ map: T.frameWood, color: 0x4a3a2c }),
    mullionIn: new THREE.MeshBasicMaterial({ color: 0x24170e }),
    glow: new THREE.MeshBasicMaterial({ map: T.glow, color: 0xffffff }),
    leaf: new THREE.MeshPhongMaterial({ map: T.leaf, color: 0xffffff, side: THREE.DoubleSide, specular: 0x2a3a22, shininess: 28 }),
    leafDark: new THREE.MeshPhongMaterial({ map: T.leaf, color: 0x7a9a70, side: THREE.DoubleSide, specular: 0x1e2a18, shininess: 24 }),
    bush: new THREE.MeshLambertMaterial({ color: 0x2f5a22, flatShading: true }),
    bushLight: new THREE.MeshLambertMaterial({ color: 0x4f7f2a, flatShading: true }),
    canopy: new THREE.MeshLambertMaterial({ color: 0x4f8a3a, flatShading: true }),
    redCap: new THREE.MeshLambertMaterial({ color: 0xc8231c }),
    spotCap: new THREE.MeshLambertMaterial({ map: T.spots, color: 0xffffff }),
    spot: new THREE.MeshLambertMaterial({ color: 0xf6efe6 }),
    stalk: new THREE.MeshLambertMaterial({ color: 0xd9c8b2 }),
    blueCap: new THREE.MeshLambertMaterial({ color: 0x2f7fe6, emissive: 0x0a2a60 }),
    blueStem: new THREE.MeshLambertMaterial({ map: T.blueStem, color: 0xffffff }),
    pinkCap: new THREE.MeshLambertMaterial({ color: 0xe070c0, emissive: 0x401030 }),
    tanCap: new THREE.MeshLambertMaterial({ color: 0xc7a878 }),
    orangeCap: new THREE.MeshLambertMaterial({ color: 0xc0703a }),
    darkWin: new THREE.MeshLambertMaterial({ color: 0x1c140e }),
    winTube: new THREE.MeshLambertMaterial({ map: T.frameWood, color: 0x5a4434 }),
  };

  const rnd = mulberry32(12345);
  const colliders = []; // {type:'circle', x,z,r, owner} | {type:'seg', ax,az,bx,bz, owner, dyn}

  // ---------------- sky dome (procedural canopy with sky gaps; more open towards +x / +z) + lights
  {
    T.sky = makeTex(1024, (u, v) => {
      // v: 0 = top row of data (bottom of sphere uv is v=0 -> data row 0); sphere uv v=0 at bottom
      const elev = (v - 0.5) * Math.PI; // -pi/2..pi/2
      const open = clamp(0.5 + 0.5 * Math.cos(2 * Math.PI * (u - 0.42)), 0, 1) * 0.9 + 0.1 * clamp(Math.cos(2 * Math.PI * (u - 0.25)), 0, 1);
      const haze = mix3(hex3(0x3e5e52), hex3(0x7aa498), open), sky = mix3(hex3(0xb8dde6), hex3(0x58b0e4), clamp(elev / 1.0, 0, 1));
      if (elev < 0) return mix3(haze, hex3(0x2a3e2a), clamp(-elev * 3, 0, 1));
      const wu = u + 0.02 * (fbm(u, v, 16, 2, 207) - 0.5), wv = v + 0.02 * (fbm(u, v, 16, 2, 208) - 0.5);
      const n = 0.65 * fbm(wu, wv, 20, 3, 201) + 0.35 * fbm(wu, wv, 96, 2, 205);
      const thr = lerp(0.82, 0.44, open) - 0.12 * clamp(elev - 0.6, 0, 1);
      const leaf = mix3(mix3(hex3(0x14281a), hex3(0x264a22), open), mix3(hex3(0x2e4e30), hex3(0x6a9a48), open), fbm(u, v, 64, 2, 203));
      let c = mix3(leaf, sky, clamp((n - thr) / 0.045 + 0.5, 0, 1));
      // low haze band (distant forest)
      const hb = clamp(1 - elev / lerp(0.35, 0.22, open), 0, 1);
      return mix3(c, haze, hb * hb);
    }, [1, 1], true, 512);
    T.sky.wrapT = THREE.ClampToEdgeWrapping; T.sky.repeat.set(1, 1);
    const g = new THREE.SphereGeometry(150, 48, 24);
    const sky = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ map: T.sky, side: THREE.BackSide, fog: false, depthWrite: false }));
    sky.name = 'sky_dome'; sky.renderOrder = -10; scene.add(sky);
  }
  const hemi = new THREE.HemisphereLight(0xc8e0e8, 0x2a3a1c, 1.05); scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffe8c0, 1.3); sun.position.set(-20, 30, 12); scene.add(sun);
  const amb = new THREE.AmbientLight(0x404838, 0.4); scene.add(amb);

  // ---------------- ground
  {
    const g = new THREE.PlaneGeometry(240, 240, 160, 160); g.rotateX(-Math.PI / 2);
    T.grass.repeat.set(60, 60);
    { // large-scale light: sun patches in the open (+x / +z) part, darker under the dense canopy behind the house
      const p = g.attributes.position, col = [];
      for (let i = 0; i < p.count; i++) {
        const x = p.getX(i), z = p.getZ(i);
        const ss = (e0, e1, t) => { const u = clamp((t - e0) / (e1 - e0), 0, 1); return u * u * (3 - 2 * u); };
        const open = clamp(0.3 + 0.06 * x + 0.025 * z + 0.4 * ss(-0.5, 2.5, x) * ss(3.0, 5.0, z) * (1 - ss(9, 14, z)), 0.2, 1);
        const sunp = fbm(((x / 23) % 1 + 1) % 1, ((z / 23) % 1 + 1) % 1, 4, 3, 301);
        const k = 0.6 + 0.35 * open; const sun = clamp((sunp - 0.47) * 3.5, 0, 1) * open;
        col.push(k + sun * 0.75, k + sun * 0.8, k * 0.85 + sun * 0.2);
      }
      g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    }
    const ground = new THREE.Mesh(g, M.grass); ground.name = 'forest_ground'; scene.add(ground);
  }
  // dirt path (ribbon along a curve)
  const pathCurve0 = null;
  const pathPts = [[-24, -11], [-13, -5.5], [-6.5, -1.6], [-3.4, 1.4], [-1.9, 3.6], [-0.4, 4.9], [2.5, 5.2], [6, 4.6], [10, 3.4], [15, 2.0], [24, 0], [34, -2]];
  const pathCurve = new THREE.CatmullRomCurve3(pathPts.map(([x, z]) => new THREE.Vector3(x, 0, z)));
  const pathSamples = pathCurve.getSpacedPoints(300).map((p) => [p.x, p.z]);
  const pathDist = (x, z) => { let d = 1e9; for (const [px, pz] of pathSamples) d = Math.min(d, Math.hypot(px - x, pz - z)); return d; };
  {
    const curve = pathCurve;
    const N = 200; const pos = [], uv = [], col = [], idx = [];
    for (let k = 0; k <= N; k++) {
      const t = k / N; const p = curve.getPointAt(t); const tg = curve.getTangentAt(t);
      const nx = -tg.z, nz = tg.x;
      const w = 1.25 + 0.35 * Math.sin(t * 23) + 0.2 * Math.sin(t * 57 + 1);
      for (const s of [-1.35, -1, 0, 1, 1.35]) {
        const ww = w * s + (Math.abs(s) > 1 ? 0.25 * Math.sin(t * 91 + s) : 0);
        pos.push(p.x + nx * ww, 0.015, p.z + nz * ww); uv.push(s * 0.6, t * 40);
        const sh = 0.75 + 0.45 * fbm((t * 7) % 1, (s + 2) / 4, 4, 3, 7); // dappled light
        const edge = Math.abs(s) > 1 ? 0.0 : 1.0;
        col.push(sh * lerp(0.55, 1, edge), sh * lerp(0.62, 1, edge), sh * lerp(0.35, 1, edge));
      }
      if (k < N) for (let s = 0; s < 4; s++) { const a = k * 5 + s; idx.push(a, a + 1, a + 5, a + 1, a + 6, a + 5); }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); g.setIndex(idx); g.setAttribute('normal', new THREE.Float32BufferAttribute(new Array(pos.length / 3).fill(0).flatMap(() => [0, 1, 0]), 3));
    const path = new THREE.Mesh(g, M.dirt); path.name = 'dirt_path'; scene.add(path);
  }

  // ---------------- main mushroom house
  const house = new THREE.Group(); house.name = 'mushroom_house'; scene.add(house);
  const windows = [ // phi from +z toward +x, y centre, radius, kind
    { id: 'house_window_front', phi: 54 * Math.PI / 180, y: 1.1, r: 0.35, kind: 'clear', tilt: 0.12, sx: 0.6 },
    { id: 'lit_window', phi: 185 * Math.PI / 180, y: 0.95, r: 0.30, kind: 'lit', tilt: 0, sx: 1 },
    { id: 'house_window_side', phi: 100 * Math.PI / 180, y: 1.0, r: 0.25, kind: 'clear', tilt: 0, sx: 0.85 },
    { id: 'house_window_left', phi: -80 * Math.PI / 180, y: 1.0, r: 0.24, kind: 'clear', tilt: 0, sx: 1 },
  ];
  const inR = (y) => houseR(y) - H_WALL_T;
  const IN_TOP = 1.95;
  function holeAt(phi, y, rr) {
    const p = wrapPhi(phi);
    if (archInside(p * rr, y, DOOR_W, DOOR_H)) return true;
    for (const w of windows) {
      const du = wrapPhi(p - w.phi) * rr, dv = y - w.y;
      const c = Math.cos(w.tilt), s = Math.sin(w.tilt);
      const a = (du * c + dv * s) / w.sx, b = (-du * s + dv * c);
      if (a * a + b * b < w.r * w.r * 0.9) return true;
    }
    return false;
  }
  {
    const outer = shellGeometry(houseR, 0, STEM_TOP, 240, 78, (phi, y) => holeAt(phi, y, houseR(y)), false, [4, 1.6]);
    const stem = new THREE.Mesh(outer, new THREE.MeshLambertMaterial({ map: T.stucco, vertexColors: true }));
    // darken the bottom a bit (grime) via vertex colours
    { const c = outer.attributes.color, p = outer.attributes.position; for (let i = 0; i < c.count; i++) { const y = p.getY(i); const k = 0.72 + 0.28 * clamp(y / 0.7, 0, 1) - 0.18 * clamp((y - 2.2) / 0.7, 0, 1); c.setXYZ(i, k, k, k); } }
    stem.name = 'house_stem'; house.add(stem);
    const shade = (phi, y) => {
      const p = wrapPhi(phi); let k = 0.3 + 0.16 * clamp(y / 1.1, 0, 1);
      const dl = Math.hypot(wrapPhi(p - Math.PI) * 1.6, (y - 0.95) * 1.2); k += 0.35 * Math.exp(-dl * dl / 0.5); // glow near lit window
      k *= 1 - 0.35 * clamp((y - 1.5) / 0.45, 0, 1);
      return k;
    };
    const inner = shellGeometry(inR, 0, IN_TOP, 240, 60, (phi, y) => holeAt(phi, y, inR(y)), true, [6, 1.5], shade);
    const innerMesh = new THREE.Mesh(inner, M.interior); innerMesh.name = 'house_interior_wall'; house.add(innerMesh);
    // ceiling dome
    const prof = []; for (let k = 0; k <= 12; k++) { const a = k / 12; prof.push([inR(IN_TOP) * Math.cos(a * Math.PI / 2) + 0.02, IN_TOP + 0.8 * Math.sin(a * Math.PI / 2)]); }
    const ceil = new THREE.Mesh(lathe(prof.reverse(), 48), new THREE.MeshBasicMaterial({ map: T.capUnder, color: 0x4a3a30, side: THREE.DoubleSide }));
    ceil.name = 'house_ceiling'; house.add(ceil);
    // ceiling lip (dark curved band where wall meets ceiling), open over the doorway
    const dA = Math.asin((DOOR_W / 2 + 0.05) / inR(1.6));
    const lipProf = [[inR(1.56) + 0.01, 1.56], [inR(1.62) - 0.07, 1.62], [inR(1.72) - 0.12, 1.72], [inR(1.85) - 0.08, 1.85], [inR(IN_TOP) - 0.02, IN_TOP]];
    const lip = new THREE.Mesh(lathe(lipProf, 64, dA, Math.PI * 2 - 2 * dA), new THREE.MeshBasicMaterial({ map: T.capUnder, color: 0x5a4636, side: THREE.DoubleSide }));
    lip.name = 'house_ceiling_lip'; house.add(lip);
    // top closure of the wall thickness
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.01, houseR(STEM_TOP), 48, 1), M.capUnder);
    ring.rotation.x = -Math.PI / 2; ring.position.y = STEM_TOP; house.add(ring);
    // floor
    const fl = new THREE.Mesh(new THREE.CircleGeometry(inR(0) + 0.05, 48), M.interiorFloor); fl.rotation.x = -Math.PI / 2; fl.position.y = 0.02; fl.name = 'house_floor'; house.add(fl);
    T.floor.repeat.set(2, 2);
    const rug = new THREE.Mesh(new THREE.CircleGeometry(0.75, 40), new THREE.MeshBasicMaterial({ color: 0x6a5842 })); rug.rotation.x = -Math.PI / 2; rug.position.set(0, 0.03, 0.75); rug.scale.set(1.0, 0.6, 1); house.add(rug);
    // cap
    const capProf = [[0, 3.1], [1.4, 3.12], [2.15, 3.0], [2.62, 2.8], [2.84, 2.84], [2.92, 3.12], [2.74, 3.6], [2.25, 4.02], [1.45, 4.32], [0.6, 4.45], [0, 4.47]];
    const capG = lathe(capProf, 64);
    { // uv v from top
      const uvA = capG.attributes.uv; for (let i = 0; i < uvA.count; i++) uvA.setY(i, 1 - uvA.getY(i));
    }
    T.cap.repeat.set(3, 1);
    const cap = new THREE.Mesh(capG, M.cap); cap.name = 'house_cap'; house.add(cap);
    // door frame: thick wooden horseshoe of plank blocks, each extruded with a bevel then bent onto the curved wall
    {
      const FW = 0.27, NP = 48, D = 0.28;
      const inner = archPath(DOOR_W - 0.05, DOOR_H - 0.03, NP);
      const outerP = archPath(DOOR_W - 0.05 + 2 * FW, DOOR_H - 0.03 + FW, NP);
      const frameGroup = new THREE.Group(); frameGroup.name = 'house_door_frame'; house.add(frameGroup);
      const frameMat = new THREE.MeshLambertMaterial({ map: T.frameWood, vertexColors: true });
      // block boundaries (indices into the paths)
      const cuts = [0]; let acc = 0;
      for (let k = 1; k < inner.length; k++) { acc += Math.hypot(inner[k][0] - inner[k - 1][0], inner[k][1] - inner[k - 1][1]); if (acc > 0.27 && inner.length - 1 - k > 1) { cuts.push(k); acc = 0; } }
      cuts.push(inner.length - 1);
      for (let c = 0; c < cuts.length - 1; c++) {
        const i0 = cuts[c], i1 = cuts[c + 1];
        const sh = new THREE.Shape();
        const o0 = outerP[i0], n0 = inner[i0];
        sh.moveTo(i0 === 0 ? o0[0] : o0[0], i0 === 0 ? 0 : o0[1]);
        for (let k = i0; k <= i1; k++) sh.lineTo(outerP[k][0], k === inner.length - 1 ? 0 : outerP[k][1]);
        for (let k = i1; k >= i0; k--) sh.lineTo(inner[k][0], (k === inner.length - 1 || k === 0) ? 0 : inner[k][1]);
        const g = new THREE.ExtrudeGeometry(sh, { depth: D, bevelEnabled: true, bevelThickness: 0.03, bevelSize: 0.028, bevelOffset: -0.028, bevelSegments: 2, curveSegments: 2 });
        const p = g.attributes.position; const col = [];
        const kk = 0.8 + 0.32 * hash2(c, 5, 9);
        for (let i = 0; i < p.count; i++) {
          const x = p.getX(i), y = Math.max(0, p.getY(i)), z = p.getZ(i);
          const zs = Math.sqrt(Math.max(0, houseR(y) ** 2 - x * x));
          p.setXYZ(i, x, y, zs + 0.07 - D + z);
          const front = z > D - 0.005 ? 1 : 0.45;
          col.push(kk * front, kk * 0.96 * front, kk * 0.92 * front);
        }
        g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
        g.computeVertexNormals();
        const blk = new THREE.Mesh(g, frameMat); frameGroup.add(blk);
      }
      // dark backing so the seams read as gaps
      const back = new THREE.Shape();
      back.moveTo(outerP[0][0], 0); for (const [u, v] of outerP) back.lineTo(u, v); back.lineTo(outerP[outerP.length - 1][0], 0);
      for (let k = inner.length - 1; k >= 0; k--) back.lineTo(inner[k][0], inner[k][1]);
      const bg = new THREE.ShapeGeometry(back, 4); const bp = bg.attributes.position;
      for (let i = 0; i < bp.count; i++) { const x = bp.getX(i), y = Math.max(0, bp.getY(i)); bp.setXYZ(i, x, y, Math.sqrt(Math.max(0, houseR(y) ** 2 - x * x)) + 0.004); }
      bg.computeVertexNormals();
      frameGroup.add(new THREE.Mesh(bg, new THREE.MeshLambertMaterial({ color: 0x1e140c })));
    }
    // threshold step
    // windows
    for (const w of windows) {
      const g = new THREE.Group(); g.name = w.id;
      const rO = houseR(w.y), rI = inR(w.y);
      g.position.set(0, w.y, 0); g.rotation.y = w.phi; house.add(g);
      const holder = new THREE.Group(); holder.rotation.z = w.tilt; holder.position.z = (rO + rI) / 2; g.add(holder);
      holder.scale.set(w.sx, 1, 1);
      const depth = rO - rI + 0.12;
      const tube = new THREE.Mesh(new THREE.CylinderGeometry(w.r + 0.02, w.r + 0.02, depth, 32, 1, true), w.kind === 'lit' ? M.winFrameIn : M.winTube);
      tube.rotation.x = Math.PI / 2; tube.material = tube.material.clone(); tube.material.side = THREE.DoubleSide; holder.add(tube);
      const torO = new THREE.Mesh(new THREE.TorusGeometry(w.r + 0.04, 0.09, 10, 36), M.frame); torO.position.z = depth / 2; torO.scale.z = 0.7; holder.add(torO);
      const torI = new THREE.Mesh(new THREE.TorusGeometry(w.r + 0.04, 0.09, 10, 36), M.winFrameIn); torI.position.z = -depth / 2; torI.scale.z = 0.7; holder.add(torI);
      const mz = w.kind === 'lit' ? -depth / 2 + 0.05 : 0;
      const mA = new THREE.Mesh(new THREE.BoxGeometry(w.r * 2, 0.05, 0.05), M.mullionIn); mA.position.z = mz; holder.add(mA);
      const mB = new THREE.Mesh(new THREE.BoxGeometry(0.05, w.r * 2, 0.05), M.mullionIn); mB.position.z = mz; holder.add(mB);
      if (w.kind === 'lit') {
        const pane = new THREE.Mesh(new THREE.CircleGeometry(w.r + 0.02, 32), M.glow); pane.position.z = -depth / 2 + 0.03; pane.rotation.y = Math.PI; holder.add(pane);
        const back = new THREE.Mesh(new THREE.CircleGeometry(w.r + 0.02, 32), M.darkWin); back.position.z = depth / 2 - 0.02; holder.add(back);
      }
    }
  }
  // door leaves
  const leaves = [];
  {
    const hw = DOOR_W / 2; const sh = DOOR_H - hw * 1.15;
    for (const side of [-1, 1]) {
      const shape = new THREE.Shape(); // leaf from hinge (x=0) towards centre (x = -side*hw)
      const pts = [];
      const N = 16;
      pts.push([0, 0]); pts.push([0, sh]);
      for (let k = 0; k <= N; k++) { const a = k / N * Math.PI / 2; pts.push([hw - hw * Math.cos(a) , sh + (DOOR_H - sh) * Math.sin(a)]); }
      pts.push([hw, 0]);
      shape.moveTo(pts[0][0], pts[0][1]); for (let k = 1; k < pts.length; k++) shape.lineTo(pts[k][0], pts[k][1]);
      const g = new THREE.ExtrudeGeometry(shape, { depth: 0.07, bevelEnabled: false });
      g.translate(0, 0, -0.035);
      // planar UVs
      const p = g.attributes.position, uvA = g.attributes.uv; for (let i = 0; i < p.count; i++) uvA.setXY(i, p.getX(i) / DOOR_W * 0.9, p.getY(i) / DOOR_H);
      if (side === 1) g.scale(-1, 1, 1);
      if (side === 1) g.computeVertexNormals();
      const pivot = new THREE.Group(); pivot.name = side < 0 ? 'house_door_left' : 'house_door_right';
      const zH = Math.sqrt(houseR(0.8) ** 2 - hw * hw) - 0.12;
      pivot.position.set(side * hw, 0.0, zH); house.add(pivot);
      const m = new THREE.Mesh(g, M.door); m.position.x = 0; pivot.add(m);
      // iron bands + knob
      if (false) for (const yb of [0.4, 1.25]) { const band = new THREE.Mesh(new THREE.BoxGeometry(hw * 0.8, 0.05, 0.09), new THREE.MeshLambertMaterial({ color: 0x2a2420 })); band.position.set(-side * hw * 0.45, yb, 0); pivot.add(band); }
      
      leaves.push({ side, pivot, hw, zH });
    }
  }

  // ---------------- other houses and props
  function amanita(x, z, s, name, tilt = 0, rot = 0) {
    const g = new THREE.Group(); g.position.set(x, 0, z); g.scale.setScalar(s); g.rotation.set(tilt, rot, 0); if (name) g.name = name;
    const stalk = new THREE.Mesh(lathe([[0.16, 0], [0.13, 0.15], [0.1, 0.5], [0.09, 0.85], [0.1, 0.92], [0.0, 0.93]], 16), M.stalk); g.add(stalk);
    const capP = [[0.0, 0.82], [0.2, 0.83], [0.32, 0.84], [0.44, 0.855], [0.49, 0.88], [0.51, 0.93], [0.49, 0.99], [0.44, 1.06], [0.36, 1.13], [0.25, 1.18], [0.12, 1.21], [0.0, 1.22]];
    const cap = new THREE.Mesh(lathe(capP, 40), M.spotCap); cap.rotation.y = hash2(Math.round(x * 10), Math.round(z * 10), 5) * 6.28; g.add(cap);
    const ring = new THREE.Mesh(lathe([[0.1, 0.62], [0.16, 0.58], [0.15, 0.6], [0.1, 0.66]], 14), M.stalk); g.add(ring);
    scene.add(g); colliders.push({ type: 'circle', x, z, r: 0.12 * s, owner: name || '' });
    return g;
  }
  function smallShroom(x, z, s, capMat, name) {
    const g = new THREE.Group(); g.position.set(x, 0, z); g.scale.setScalar(s); if (name) g.name = name;
    g.add(new THREE.Mesh(lathe([[0.07, 0], [0.05, 0.3], [0.05, 0.55], [0, 0.56]], 10), M.stalk));
    g.add(new THREE.Mesh(lathe([[0, 0.48], [0.3, 0.5], [0.34, 0.55], [0.22, 0.66], [0, 0.7]], 18), capMat));
    scene.add(g); return g;
  }
  // thatched-cap house (left, behind)
  {
    const g = new THREE.Group(); g.name = 'thatched_mushroom_house'; g.position.set(-9.0, 0, -3.0); g.rotation.y = 1.0; g.scale.setScalar(1.0); scene.add(g);
    const prof = []; for (let k = 0; k <= 12; k++) { const y = k / 12 * 1.9; prof.push([1.35 + 0.18 * Math.sin(y / 1.9 * Math.PI) - 0.25 * (y / 1.9) ** 2, y]); }
    prof.push([0, 1.9]);
    g.add(new THREE.Mesh(lathe(prof, 40), M.stucco));
    const capP = [[0, 1.75], [1.8, 1.78], [2.08, 1.84], [2.0, 2.02], [1.5, 2.45], [0.9, 2.9], [0.35, 3.25], [0.1, 3.42], [0, 3.46]];
    const cg = lathe(capP, 48); T.thatch.repeat.set(4, 1);
    g.add(new THREE.Mesh(cg, M.thatch));
    // window
    const w = new THREE.Group(); w.position.set(0, 1.05, 1.4); g.add(w);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.26, 0.07, 8, 24), M.frame); ring.scale.y = 1.25; w.add(ring);
    const dark = new THREE.Mesh(new THREE.CircleGeometry(0.26, 24), M.darkWin); dark.scale.y = 1.25; dark.position.z = -0.02; w.add(dark);
    const door = new THREE.Mesh(new THREE.BoxGeometry(0.8, 1.4, 0.1), M.door); door.position.set(0.9, 0.6, 1.2); door.rotation.y = 0.65; g.add(door);
    // green leaves draped on the cap rim
    for (let k = 0; k < 11; k++) { const a = k / 11 * Math.PI * 2 + 0.3; const lf = new THREE.Mesh(leafGeometry(0.95, 0.75, 0.12, 0.75, 8), M.leaf); lf.position.set(Math.sin(a) * 1.55, 2.02, Math.cos(a) * 1.55); lf.rotation.order = 'YXZ'; lf.rotation.y = a; lf.rotation.x = 0.15; g.add(lf); } // leaf frill draped over the eave
    colliders.push({ type: 'circle', x: -9.0, z: -3.0, r: 1.55, owner: 'thatched_mushroom_house' });
  }
  // blue mushroom house with red spotted cap (left of start)
  {
    const g = new THREE.Group(); g.name = 'blue_mushroom_house'; g.position.set(-2.6, 0, 6.0); g.rotation.y = 1.9; g.scale.setScalar(0.56); scene.add(g);
    const prof = []; for (let k = 0; k <= 10; k++) { const y = k / 10 * 1.2; prof.push([0.95 + 0.12 * Math.sin(y / 1.2 * Math.PI) - 0.25 * (y / 1.2) ** 2, y]); } prof.push([0, 1.2]);
    g.add(new THREE.Mesh(lathe(prof, 32), M.blueStem));
    const capP = [[0, 1.05], [1.35, 1.1], [1.5, 1.22], [1.35, 1.55], [0.9, 1.88], [0, 2.02]];
    g.add(new THREE.Mesh(lathe(capP, 40), M.spotCap));
    const r2 = mulberry32(777);
    const w = new THREE.Mesh(new THREE.CircleGeometry(0.2, 20), M.glow); w.position.set(0, 0.6, 1.07); g.add(w);
    const wr = new THREE.Mesh(new THREE.TorusGeometry(0.21, 0.04, 6, 20), M.frame); wr.position.copy(w.position); g.add(wr);
    const d = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.75, 0.08), M.door); d.position.set(0.55, 0.37, 0.88); d.rotation.y = 0.55; g.add(d);
    colliders.push({ type: 'circle', x: -2.6, z: 6.0, r: 0.6, owner: 'blue_mushroom_house' });
  }
  { // a second small blue house (seen when leaving the main house)
    const g = new THREE.Group(); g.name = 'blue_mushroom_house_2'; g.position.set(-8.0, 0, 11.0); g.rotation.y = 2.2; g.scale.setScalar(0.8); scene.add(g);
    const prof = []; for (let k = 0; k <= 10; k++) { const y = k / 10 * 1.2; prof.push([0.95 + 0.12 * Math.sin(y / 1.2 * Math.PI) - 0.25 * (y / 1.2) ** 2, y]); } prof.push([0, 1.2]);
    g.add(new THREE.Mesh(lathe(prof, 32), M.blueStem));
    g.add(new THREE.Mesh(lathe([[0, 1.05], [1.35, 1.1], [1.5, 1.22], [1.35, 1.55], [0.9, 1.88], [0, 2.02]], 40), M.spotCap));
    const r2 = mulberry32(778);
    const w = new THREE.Mesh(new THREE.CircleGeometry(0.2, 20), M.glow); w.position.set(0, 0.6, 1.07); g.add(w);
    const wr = new THREE.Mesh(new THREE.TorusGeometry(0.21, 0.04, 6, 20), M.frame); wr.position.copy(w.position); g.add(wr);
    colliders.push({ type: 'circle', x: -8.0, z: 11.0, r: 0.95, owner: 'blue_mushroom_house_2' });
  }
  // blue mushrooms group near the start
  {
    const g = new THREE.Group(); g.name = 'blue_mushrooms'; scene.add(g);
    for (const [x, z, s, h] of [[-4.4, 3.3, 1.45, 1.25], [-3.9, 2.6, 1.1, 0.85]]) {
      const m = new THREE.Group(); m.position.set(x, 0, z);
      m.add(new THREE.Mesh(lathe([[0.13 * s, 0], [0.1 * s, h * 0.5], [0.09 * s, h], [0, h + 0.01]], 12), M.stalk));
      m.add(new THREE.Mesh(lathe([[0, h - 0.06], [0.42 * s, h - 0.05], [0.55 * s, h + 0.02], [0.52 * s, h + 0.1 * s], [0.4 * s, h + 0.22 * s], [0.22 * s, h + 0.3 * s], [0, h + 0.33 * s]], 28), M.blueCap));
      g.add(m); colliders.push({ type: 'circle', x, z, r: 0.12, owner: 'blue_mushrooms' });
    }
    const t1 = new THREE.Group(); t1.position.set(-5.4, 0, 1.9); t1.scale.setScalar(1.3);
    t1.add(new THREE.Mesh(lathe([[0.08, 0], [0.06, 1.0], [0, 1.01]], 10), M.stalk));
    t1.add(new THREE.Mesh(lathe([[0, 0.92], [0.45, 0.95], [0.48, 1.0], [0.3, 1.14], [0, 1.2]], 20), M.orangeCap)); g.add(t1);
  }
  // red amanita mushrooms (several)
  amanita(-4.2, 0.7, 1.05, 'red_mushroom_near_house');
  smallShroom(-4.7, 1.0, 0.5, M.blueCap); smallShroom(-4.25, 1.15, 0.5, M.pinkCap);
  amanita(5.2, 6.4, 1.5, 'red_mushroom_by_path');
  amanita(5.8, 6.1, 0.8, ''); amanita(6.0, 6.6, 0.6, '');
  amanita(9.5, 2.0, 0.9, ''); amanita(4.5, 2.8, 1.1, '', 0.0); amanita(10.6, 7.6, 0.9, '');
  amanita(2.8, 9.0, 1.0, ''); amanita(-1.5, 9.5, 0.8, '');
  for (const [x, z, s, m] of [[11, 6.0, 0.6, M.blueCap], [11.4, 5.6, 0.5, M.pinkCap], [12.2, 6.5, 0.6, M.tanCap], [8.8, 8.2, 0.6, M.blueCap], [13.5, 1.8, 0.55, M.blueCap], [7.5, 3.2, 0.5, M.pinkCap], [3.4, 9.5, 0.5, M.blueCap], [-2.5, 6.6, 0.5, M.pinkCap], [-2.2, 6.9, 0.45, M.blueCap]]) smallShroom(x, z, s, m);
  // little far mushroom house along the path
  {
    const g = new THREE.Group(); g.name = 'far_mushroom_house'; g.position.set(17.0, 0, 3.0); scene.add(g);
    g.add(new THREE.Mesh(lathe([[0.75, 0], [0.82, 0.4], [0.7, 0.9], [0, 0.9]], 24), M.stucco));
    const capP = [[0, 0.8], [1.15, 0.85], [1.2, 0.95], [0.85, 1.3], [0, 1.45]]; g.add(new THREE.Mesh(lathe(capP, 28), M.spotCap));
    const d = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.5, 0.05), M.door); d.position.set(-0.7, 0.25, 0); d.rotation.y = -Math.PI / 2; g.add(d);
    amanita(15.6, 1.6, 0.9, ''); amanita(15.3, 2.1, 0.7, '');
    colliders.push({ type: 'circle', x: 17.0, z: 3.0, r: 0.9, owner: 'far_mushroom_house' });
  }
  // big tan mushroom caps (background giants)
  for (const [x, z, s, n] of [[4.0, 9.8, 1.6, 'tan_giant_mushroom'], [-6.2, 9.5, 1.4, ''], [-2.6, -9, 1.6, ''], [20, 8, 2, '']]) {
    const g = new THREE.Group(); g.position.set(x, 0, z); g.scale.setScalar(s); if (n) g.name = n;
    g.add(new THREE.Mesh(lathe([[0.25, 0], [0.18, 0.6], [0.16, 1.5], [0, 1.5]], 14), M.stalk));
    g.add(new THREE.Mesh(lathe([[0, 1.35], [1.0, 1.38], [1.15, 1.48], [0.8, 1.75], [0, 1.9]], 32), M.tanCap));
    scene.add(g); colliders.push({ type: 'circle', x, z, r: 0.25 * s, owner: n });
  }
  // trees
  function tree(x, z, r, h, name) {
    const prof = []; for (let k = 0; k <= 14; k++) { const y = (k / 14) ** 1.6 * h; prof.push([r * (0.8 + 0.9 * Math.exp(-y / (r * 1.2))) * (1 - 0.25 * y / h), y]); }
    const g = lathe(prof, 20); const m = new THREE.Mesh(g, M.bark); m.position.set(x, 0, z); if (name) m.name = name;
    T.bark.repeat.set(3, 4);
    scene.add(m); colliders.push({ type: 'circle', x, z, r: r * 1.5, owner: name || '' });
    // roots
    for (let k = 0; k < 5; k++) { const a = k / 5 * Math.PI * 2 + x; const rt = new THREE.Mesh(new THREE.ConeGeometry(r * 0.45, r * 2.6, 6), M.bark); rt.position.set(x + Math.sin(a) * r * 1.3, r * 0.25, z + Math.cos(a) * r * 1.3); rt.rotation.set(Math.cos(a) * 1.25, 0, -Math.sin(a) * 1.25); scene.add(rt); }
    // canopy blobs
    for (let k = 0; k < 0; k++) { const a = k * 1.9 + x; const b = new THREE.Mesh(blobGeometry(3.2 + rnd() * 2, rnd, 1, 0.55, 0.3), M.canopy); b.position.set(x + Math.sin(a) * 3.5, h - 1 + rnd() * 3, z + Math.cos(a) * 3.5); scene.add(b); }
    return m;
  }
  tree(0.4, 9.8, 1.45, 24, 'big_tree_trunk');
  tree(-2.5, -8.0, 1.0, 22, 'tree_behind_house');
  tree(10.2, 6.6, 1.15, 22, 'tree_by_path');
  tree(-7.0, -7.6, 1.35, 24, '');
  tree(-4.6, -11, 0.7, 20, ''); tree(3.6, -10.5, 0.9, 22, ''); tree(-11, -9, 0.9, 22, '');
  tree(11.5, 9.0, 1.0, 22, ''); tree(8.5, 15, 0.9, 22, ''); tree(-9.5, 13, 1.0, 22, '');
  const far = [[-8, -12.5], [6.5, -14], [-14, -6.5], [10, -7.5], [-1, -16], [14, -12], [-9, -18], [3, -20], [-18, -14], [16, -3], [8, -22], [-20, 2], [24, 0], [26, 8], [30, -6], [20, -10], [-18, -2], [-22, 6], [-16, 18], [5, 26], [14, 22], [-5, 24], [0, -22], [12, -18], [-12, -20], [32, 4], [28, 14], [20, 16], [-26, -10], [6, -26], [-30, 0], [22, -20]];
  for (const [x, z] of far) tree(x, z, 0.8 + rnd() * 0.6, 24, '');
  function plant(x, z, size) {
    const g = new THREE.Group(); g.position.set(x, 0, z);
    const n = 7 + Math.floor(rnd() * 5);
    for (let k = 0; k < n; k++) {
      let L = size * (1.0 + rnd() * 0.5);
      const dh = Math.hypot(x, z); if (dh < 7) L = Math.min(L, Math.max(0.2, dh - 2.1)); // never poke through the house wall
      const lf = new THREE.Mesh(leafGeometry(L, L * 0.75, L * 0.45, L * 0.55, 10), rnd() < 0.55 ? M.leafDark : M.leaf);
      lf.rotation.order = 'YXZ'; lf.rotation.y = k / n * Math.PI * 2 + rnd() * 0.5; lf.rotation.x = -0.35 - rnd() * 0.5; lf.position.y = 0.05;
      g.add(lf);
    }
    const core = new THREE.Mesh(blobGeometry(size * 0.45, rnd, 1, 0.8, 0.2), M.bush); g.add(core);
    scene.add(g); return g;
  }
  // bushes and big leaves
  const bushes = [[2.6, 1.6, 0.45], [-1.3, 2.45, 0.45], [3.0, 0.6, 0.6], [-2.7, 1.2, 0.55], [0.6, 2.6, 0.35], [3.4, 6.5, 1.0], [4.2, 0.6, 1.3], [4.0, -2.2, 1.5], [3.0, -3.2, 1.9], [4.6, -0.2, 1.6], [1.8, -4.3, 1.4], [-2.0, 7.8, 0.6], [5.4, 9.0, 1.0], [8.0, 9.5, 1.5], [12, 9.5, 1.8], [10.5, 0.2, 1.2], [6.5, -1.2, 1.4], [-5.5, 3.6, 1.0], [-1.5, 11.8, 1.3], [2.5, 12.5, 1.6], [-6, -7, 1.6], [14.5, 8.5, 1.3]];
  for (const [x, z, r] of bushes) plant(x, z, r);
  const leafSpots = [[-1.2, 3.0], [-0.9, 4.2], [1.4, 4.6], [3.4, 0.0], [-2.6, 2.0], [4.0, 3.6], [5.5, 4.0], [2.0, 8.5], [-2.8, 8.4], [6.6, 8.6], [9.0, 7.0], [12.4, 4.2], [8.2, 1.6], [-6.0, 1.5], [-3.6, -3.2], [3.0, -3.5]];
  for (const [x, z] of leafSpots) {
    if (pathDist(x, z) < 1.9) continue;
    const n = 4 + Math.floor(rnd() * 4);
    for (let k = 0; k < n; k++) {
      const lf = new THREE.Mesh(leafGeometry(0.5 + rnd() * 0.5, 0.4 + rnd() * 0.25, 0.25 + rnd() * 0.2, 0.3 + rnd() * 0.3), rnd() < 0.5 ? M.leaf : M.leafDark);
      lf.position.set(x + (rnd() - 0.5) * 0.4, 0.02, z + (rnd() - 0.5) * 0.4); lf.rotation.y = rnd() * Math.PI * 2; lf.rotation.x = -0.2 - rnd() * 0.3; scene.add(lf);
    }
  }
  // giant arching leaves (big plants along the path)
  for (const [x, z, ry, L] of [[3.9, -0.6, 2.2, 3.2], [3.4, -2.4, 1.6, 2.8], [4.4, 2.2, -0.3, 3.4], [10.5, 3.0, -1.2, 4.2], [10.0, 7.2, -2.2, 3.4], [4.5, 11.5, 0.5, 3.5], [-3.8, 10.2, -0.5, 3.0], [2.4, -6, 0.3, 3.5]]) {
    const st = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.06, L * 0.6, 6), M.bushLight); st.position.set(x, L * 0.3, z); st.rotation.z = 0.15; scene.add(st);
    const lf = new THREE.Mesh(leafGeometry(L, L * 0.45, L * 0.35, L * 0.8, 14), M.leaf); lf.position.set(x, L * 0.55, z); lf.rotation.y = ry; scene.add(lf);
  }
  // ferns/grass tufts
  for (let k = 0; k < 90; k++) {
    const a = rnd() * Math.PI * 2, d = 3.2 + rnd() * 14; const x = Math.sin(a) * d, z = Math.cos(a) * d;
    if (pathDist(x, z) < 2.4 || Math.hypot(x, z) < 2.3) continue;
    const lf = new THREE.Mesh(leafGeometry(0.4 + rnd() * 0.3, 0.12, 0.2, 0.15, 6), M.leafDark); lf.position.set(x, 0, z); lf.rotation.y = rnd() * 6.28; lf.rotation.x = -0.6; scene.add(lf);
  }

  // ---------------- player + camera
  const player = new THREE.Group(); player.name = 'player'; scene.add(player);
  const body = new THREE.Mesh(new THREE.CylinderGeometry(PLAYER_R * 0.9, PLAYER_R * 0.9, EYE_H + 0.12, 16), new THREE.MeshLambertMaterial({ color: 0x3a5a8a }));
  body.position.y = (EYE_H + 0.12) / 2; body.name = 'player_body'; player.add(body); // camera sits inside: back faces are culled
  const camera = new THREE.PerspectiveCamera(VFOV, 854 / 480, 0.04, 400); camera.name = 'player_camera';
  camera.position.set(0, EYE_H, 0); camera.rotation.x = PITCH; player.add(camera);

  // ---------------- in-scene HUD (mirrors the on-screen controls of the clip; not a manifest object, not under the player)
  const hud = new THREE.Group(); hud.name = 'hud_overlay'; scene.add(hud);
  const HUD = {};
  {
    const rr = (x, y, bx, by, r) => { const qx = Math.abs(x) - bx + r, qy = Math.abs(y) - by + r; return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r; };
    const arrow = (x, y) => { // up arrow glyph, returns coverage 0..1 (x,y in -1..1)
      const stem = Math.abs(x) < 0.07 && y > -0.45 && y < 0.25 ? 1 : 0;
      const head = (y > 0.05 && y < 0.45 && Math.abs(Math.abs(x) - (0.45 - y)) < 0.08) ? 1 : 0;
      return Math.max(stem, head);
    };
    const keyTex = (hi) => makeTex(64, (u, v) => {
      const x = u * 2 - 1, y = v * 2 - 1; const d = rr(x, y, 0.92, 0.92, 0.3);
      if (d > 0.04) return [0, 0, 0, 0];
      const border = Math.abs(d + 0.04) < 0.06; const a = arrow(x, y);
      if (hi) { if (border || a) return [1, 1, 1, 1]; return [0.1, 0.2, 0.36, 0.95]; }
      if (border) return [0.85, 0.88, 0.9, 0.24]; if (a) return [0.85, 0.88, 0.9, 0.2]; return [0.05, 0.06, 0.06, 0.08];
    }, [1, 1], true);
    const chevTex = makeTex(64, (u, v) => { // '>' double-stroke chevron
      const x = u * 2 - 1, y = v * 2 - 1;
      const c1 = Math.abs(x - (0.05 - Math.abs(y) * 0.55)) < 0.16 && Math.abs(y) < 0.82;
      const c2 = Math.abs(x - (0.45 - Math.abs(y) * 0.55)) < 0.1 && Math.abs(y) < 0.82;
      return c1 || c2 ? [0.82, 0.92, 1.0, 0.95] : [0, 0, 0, 0];
    }, [1, 1], true);
    const font = { A: ['010', '101', '111', '101', '101'], C: ['011', '100', '100', '100', '011'], T: ['111', '010', '010', '010', '010'] };
    const actTex = makeTex(64, (u, v) => {
      const x = u * 2 - 1, y = (v * 2 - 1) * 2; const d = rr(x, y, 0.95, 0.95, 0.35);
      if (d > 0.03 || Math.abs(y) > 1.0) return [0, 0, 0, 0];
      if (Math.abs(d + 0.05) < 0.07) return [1, 1, 1, 1];
      const gx = Math.floor((u - 0.2) / 0.6 * 11), gy = Math.floor((v - 0.36) / 0.28 * 5);
      if (gx >= 0 && gx < 11 && gy >= 0 && gy < 5 && gx % 4 < 3) { const g = font[['A', 'C', 'T'][Math.floor(gx / 4)]]; if (g[4 - gy][gx % 4] === '1') return [1, 1, 1, 1]; }
      return [0.1, 0.2, 0.36, 0.95];
    }, [1, 1], true);
    const mat = (t) => new THREE.MeshBasicMaterial({ map: t, transparent: true, depthTest: false, depthWrite: false, fog: false, toneMapped: false });
    const D = 0.3, hH = D * Math.tan(VFOV * Math.PI / 360), hW = hH * (854 / 480);
    const at = (nx, ny) => [(nx - 0.5) * 2 * hW, (0.5 - ny) * 2 * hH, -D];
    const kw = 0.0406 * 2 * hW, kh = 0.071 * 2 * hH;
    const kn = mat(keyTex(false)), kh_ = mat(keyTex(true));
    const mk = (m, w, h, pos, rot) => { const o = new THREE.Mesh(new THREE.PlaneGeometry(w, h), m); o.position.set(...pos); o.rotation.z = rot; o.renderOrder = 1000; hud.add(o); return o; };
    const keys = { up: [0.1156, 0.842, 0], down: [0.1156, 0.923, Math.PI], left: [0.07, 0.923, Math.PI / 2], right: [0.161, 0.923, -Math.PI / 2] };
    for (const [k, [nx, ny, rot]] of Object.entries(keys)) { HUD[k] = mk(kn, kw, kh, at(nx, ny), rot); HUD[k + 'Hi'] = mk(kh_, kw, kh, at(nx, ny), rot); HUD[k + 'Hi'].visible = false; }
    const cm = mat(chevTex); const cw = 0.032 * 2 * hW, ch = 0.085 * 2 * hH;
    HUD.chevR = mk(cm, cw, ch, at(0.98, 0.5), 0); HUD.chevL = mk(cm, cw, ch, at(0.02, 0.5), Math.PI);
    const handTex = makeTex(64, (u, v) => { // simple white glove/hand cursor
      const x = u * 2 - 1, y = v * 2 - 1;
      const cap = (ax, ay, bx, by, r) => { const ex = bx - ax, ey = by - ay; const t = clamp(((x - ax) * ex + (y - ay) * ey) / (ex * ex + ey * ey), 0, 1); return Math.hypot(x - ax - ex * t, y - ay - ey * t) - r; };
      let d = rr(x + 0.05, y + 0.25, 0.42, 0.38, 0.2);
      for (const [fx, top] of [[-0.38, 0.45], [-0.12, 0.7], [0.14, 0.72], [0.38, 0.5]]) d = Math.min(d, cap(fx, 0.0, fx, top, 0.11));
      d = Math.min(d, cap(-0.45, -0.35, -0.85, 0.05, 0.11));
      if (d > 0.05) return [0, 0, 0, 0];
      return d > -0.04 ? [0.15, 0.15, 0.15, 0.9] : [0.97, 0.97, 0.97, 1];
    }, [1, 1], true);
    HUD.hand = mk(mat(handTex), 0.025 * 2 * hW, 0.045 * 2 * hH, at(0.5, 0.5), 0);
    HUD.act = mk(mat(actTex), 0.048 * 2 * hW, 0.09 * 2 * hH, at(0.316, 0.93), 0);
  }
  const _hs = new THREE.Vector3();
  function syncHud() {
    player.updateMatrixWorld(true); camera.matrixWorld.decompose(hud.position, hud.quaternion, _hs);
    const up = S.move > 0, down = S.move < 0;
    HUD.up.visible = !up; HUD.upHi.visible = up; HUD.down.visible = !down; HUD.downHi.visible = down;
    HUD.leftHi.visible = false; HUD.rightHi.visible = false;
    HUD.chevL.visible = S.turn < 0 || (S.t - S.turnEnd < 0.15 && S.lastTurn < 0); HUD.chevR.visible = S.turn > 0 || (S.t - S.turnEnd < 0.15 && S.lastTurn > 0);
    HUD.act.visible = S.t - S.lastActT < 0.4;
    HUD.hand.visible = S.t - S.lastDoorActT < 0.75;
  }

  // ---------------- house wall colliders (segments)
  const R0 = houseR(0.5), RI = inR(0.5);
  const doorHalfAng = (DOOR_W / 2) / R0, doorHalfAngI = (DOOR_W / 2) / RI;
  function arcSegs(r, a0, a1, n, owner) {
    for (let k = 0; k < n; k++) {
      const p0 = a0 + (a1 - a0) * k / n, p1 = a0 + (a1 - a0) * (k + 1) / n;
      colliders.push({ type: 'seg', ax: r * Math.sin(p0), az: r * Math.cos(p0), bx: r * Math.sin(p1), bz: r * Math.cos(p1), owner });
    }
  }
  arcSegs(R0 + 0.02, doorHalfAng, 2 * Math.PI - doorHalfAng, 64, 'mushroom_house');
  arcSegs(RI - 0.02, doorHalfAngI, 2 * Math.PI - doorHalfAngI, 64, 'mushroom_house');
  for (const s of [-1, 1]) colliders.push({ type: 'seg', ax: s * DOOR_W / 2, az: Math.sqrt(R0 * R0 - DOOR_W * DOOR_W / 4), bx: s * DOOR_W / 2, bz: Math.sqrt(RI * RI - DOOR_W * DOOR_W / 4), owner: 'mushroom_house' });
  const leafColliders = leaves.map((lv) => { const c = { type: 'seg', ax: 0, az: 0, bx: 0, bz: 0, owner: lv.pivot.name, dyn: true }; colliders.push(c); return c; });

  // ---------------- simulation state
  const S = {};
  const removed = new Set();
  const objectsById = {};
  scene.traverse((o) => { if (o.name) objectsById[o.name] = o; });

  function applyDoor() {
    const e = S.doorT <= 0 ? 0 : S.doorT >= 1 ? 1 : S.doorT * S.doorT * S.doorT; // slow start, accelerating swing
    const ang = e * DOOR_OPEN_ANGLE;
    leaves.forEach((lv, i) => {
      lv.pivot.rotation.y = lv.side < 0 ? ang : -ang;
      const c = leafColliders[i];
      const dx = -lv.side * lv.hw; // leaf direction in local before rotation: from hinge toward centre
      const a = lv.pivot.rotation.y;
      c.ax = lv.pivot.position.x; c.az = lv.pivot.position.z;
      c.bx = c.ax + dx * Math.cos(a); c.bz = c.az - dx * Math.sin(a);
      c.off = removed.has(lv.pivot.name);
    });
  }
  function reset(seed = 0) {
    S.seed = seed | 0; S.t = 0; S.tick = 0;
    S.x = START.x; S.z = START.z; S.yaw = START.yaw;
    S.move = 0; S.turn = 0; S.v = 0; S.w = 0;
    S.doorT = 0; S.doorDir = 0; S.events = []; S.lastAct = null; S.lastActT = -1e9; S.lastDoorActT = -1e9; S.turnEnd = -1e9; S.lastTurn = 0;
    for (const id of Array.from(removed)) { const o = objectsById[id]; if (o && o.userData._parent) o.userData._parent.add(o); }
    removed.clear(); for (const c of colliders) c.off = false;
    applyDoor(); syncPlayer(); syncHud();
    return state();
  }
  const fogDark = new THREE.Color(0x4a7066), fogLight = new THREE.Color(0x92bcc2);
  function syncPlayer() {
    player.position.set(S.x, 0, S.z); player.rotation.set(0, S.yaw, 0);
    // view-dependent haze: the dense forest behind the house is dark teal, the open glade along the path is light blue
    const fx = -Math.sin(S.yaw), fz = -Math.cos(S.yaw);
    const open = clamp(0.5 + 0.75 * (fx * 0.85 + fz * 0.53), 0, 1);
    scene.fog.color.copy(fogDark).lerp(fogLight, open); scene.fog.near = lerp(6, 7, open); scene.fog.far = lerp(44, 40, open);
    // simple view-dependent exposure: the open glade reads brighter, as in the clip
    hemi.intensity = lerp(1.05, 1.4, open); sun.intensity = lerp(1.3, 1.8, open);
  }

  function collide() {
    { const d = Math.hypot(S.x, S.z); if (d > 45) { S.x *= 45 / d; S.z *= 45 / d; } } // edge of the forest clearing
    for (let it = 0; it < 4; it++) {
      for (const c of colliders) {
        if (c.off) continue;
        if (c.type === 'circle') {
          const dx = S.x - c.x, dz = S.z - c.z; const d = Math.hypot(dx, dz); const m = c.r + PLAYER_R;
          if (d < m && d > 1e-9) { S.x = c.x + dx / d * m; S.z = c.z + dz / d * m; }
        } else {
          const ex = c.bx - c.ax, ez = c.bz - c.az; const L2 = ex * ex + ez * ez || 1e-9;
          const u = clamp(((S.x - c.ax) * ex + (S.z - c.az) * ez) / L2, 0, 1);
          const px = c.ax + ex * u, pz = c.az + ez * u; const dx = S.x - px, dz = S.z - pz; const d = Math.hypot(dx, dz);
          if (d < PLAYER_R && d > 1e-9) { S.x = px + dx / d * PLAYER_R; S.z = pz + dz / d * PLAYER_R; }
        }
      }
    }
  }
  function frontInteractable() {
    // door: centre of the doorway
    if (removed.has('house_door_left') && removed.has('house_door_right')) return null;
    const fx = -Math.sin(S.yaw), fz = -Math.cos(S.yaw);
    const dzc = Math.sqrt(R0 * R0 - 0.1) - 0.15; const tx = 0 - S.x, tz = dzc - S.z; const d = Math.hypot(tx, tz);
    if (d > ACT_RANGE || d < 1e-6) return null;
    const cosA = (tx * fx + tz * fz) / d; if (cosA < (d < 1.3 ? 0.1 : Math.cos(40 * Math.PI / 180))) return null; // very close: a wide cone
    return 'front_door';
  }
  function act(name, args = {}) { actInner(name, args); syncHud(); }
  function actInner(name, args = {}) {
    if (name === 'move') S.move = clamp(Number(args.value) || 0, -1, 1);
    else if (name === 'turn') { const v = clamp(Number(args.value) || 0, -1, 1); if (v === 0 && S.turn !== 0) { S.turnEnd = S.t; S.lastTurn = S.turn; } S.turn = v; }
    else if (name === 'act') {
      const tgt = frontInteractable(); S.events.push({ t: S.t, type: 'act', target: tgt }); S.lastActT = S.t;
      if (tgt === 'front_door') S.lastDoorActT = S.t;
      if (tgt === 'front_door' && S.doorDir === 0) { S.doorDir = S.doorT >= 1 ? -1 : 1; S.events.push({ t: S.t, type: S.doorDir > 0 ? 'door_opening' : 'door_closing' }); }
    } else if (name === 'remove') {
      const id = String(args.object || ''); const o = objectsById[id];
      if (o && o.parent && !removed.has(id)) {
        o.userData._parent = o.parent; o.parent.remove(o); removed.add(id);
        for (const c of colliders) if (c.owner === id) c.off = true;
        S.events.push({ t: S.t, type: 'removed', object: id });
      }
    }
  }
  function step(dt = TICK) {
    const n = Math.max(1, Math.round(dt / TICK));
    for (let k = 0; k < n; k++) tick(dt / n);
  }
  function tick(dt) {
    // smooth velocity response (approx. 70 ms)
    const a = 1 - Math.exp(-dt / 0.07);
    const tv = S.move >= 0 ? S.move * WALK_SPEED : S.move * BACK_SPEED;
    S.v += (tv - S.v) * a; S.w += (S.turn * TURN_RATE - S.w) * a;
    if (Math.abs(S.v) < 1e-5 && S.move === 0) S.v = 0; if (Math.abs(S.w) < 1e-5 && S.turn === 0) S.w = 0;
    S.yaw -= S.w * dt;
    const fx = -Math.sin(S.yaw), fz = -Math.cos(S.yaw);
    const sub = 3; for (let i = 0; i < sub; i++) { S.x += fx * S.v * dt / sub; S.z += fz * S.v * dt / sub; collide(); }
    if (S.doorDir !== 0) {
      S.doorT += S.doorDir * dt / DOOR_OPEN_TIME;
      if (S.doorT >= 1) { S.doorT = 1; S.doorDir = 0; S.events.push({ t: S.t, type: 'door_open' }); }
      if (S.doorT <= 0) { S.doorT = 0; S.doorDir = 0; S.events.push({ t: S.t, type: 'door_closed' }); }
      applyDoor();
      // a moving leaf pushes the player out of the way
      collide();
    }
    S.t += dt; S.tick++;
    syncPlayer(); syncHud();
  }
  function insideHouse() { return Math.hypot(S.x, S.z) < RI; }
  function state() {
    return {
      t: Math.round(S.t * 1e6) / 1e6,
      objects: [
        { id: 'player', attributes: { inside_house: insideHouse(), yaw_deg: Math.round(S.yaw * 180 / Math.PI * 1000) / 1000 } },
        { id: 'house_door_left', attributes: { open_fraction: Math.round(S.doorT * 1e4) / 1e4 } },
        { id: 'house_door_right', attributes: { open_fraction: Math.round(S.doorT * 1e4) / 1e4 } },
      ],
      ui: [
        { id: 'key_up', label: 'up-arrow key indicator', visible: true, text: S.move > 0 ? 'on' : 'off' },
        { id: 'key_down', label: 'down-arrow key indicator', visible: true, text: S.move < 0 ? 'on' : 'off' },
        { id: 'turn_hint', label: 'turn chevron', visible: S.turn !== 0, text: S.turn < 0 ? '<' : S.turn > 0 ? '>' : '' },
        { id: 'interact_hint', label: 'hand cursor when a door is in front', visible: frontInteractable() !== null, text: '' },
      ],
      attachments: [],
      events: S.events.slice(-20),
    };
  }
  reset(0);
  return { reset, act, step, state, scene, camera };
}
