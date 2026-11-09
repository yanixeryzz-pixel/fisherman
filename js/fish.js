import * as THREE from 'three';
import { SPECIES, GROUPS, WORLD } from './config.js';
import { shared, UW_PARS } from './shaders.js';
import { groundY } from './world.js';
import { mulberry32, range, clamp, smoothstep, damp } from './util.js';

// Body proportions are normalised to length 1 (head at +z, tail at -z); instances scale to species size.
const SHAPES = {
  slim: { H: 0.1, W: 0.06, skew: 1.3, round: 0.75, rear: 0.1, belly: 0.95, hump: 0, nose: 0.025, tail: 'fork', tailLen: 0.25, tailH: 0.13, dorsal: [0.42, 0.58, 0.07, 1], anal: [0.22, 0.34, 0.04], pect: 0.08, eye: 0.032, waveK: 6.5, amp: 1.0, pectFlap: 0.02, vertFlap: 0, puff: [0, 0, 0] },
  perch: { H: 0.17, W: 0.075, skew: 1.35, round: 0.7, rear: 0.1, belly: 0.9, hump: 0.025, nose: 0.03, tail: 'round', tailLen: 0.22, tailH: 0.13, dorsal: [0.3, 0.74, 0.11, 4], anal: [0.2, 0.36, 0.07], pect: 0.11, eye: 0.04, waveK: 5.5, amp: 0.9, pectFlap: 0.04, vertFlap: 0, puff: [0, 0, 0] },
  round: { H: 0.25, W: 0.22, skew: 1.15, round: 0.55, rear: 0.12, belly: 1.0, hump: 0, nose: 0.02, tail: 'round', tailLen: 0.16, tailH: 0.1, dorsal: [0.18, 0.3, 0.08, 1], anal: [0.18, 0.28, 0.065], pect: 0.12, eye: 0.05, waveK: 4.0, amp: 0.55, pectFlap: 0.07, vertFlap: 0.05, puff: [0.55, 0.6, 0.25] },
  disc: { H: 0.3, W: 0.058, skew: 1.25, round: 0.6, rear: 0.09, belly: 0.95, hump: 0.02, nose: 0.02, tail: 'lunate', tailLen: 0.2, tailH: 0.19, dorsal: [0.14, 0.8, 0.07, 1], anal: [0.14, 0.6, 0.065], pect: 0.12, eye: 0.042, waveK: 5.0, amp: 0.75, pectFlap: 0.05, vertFlap: 0, puff: [0, 0, 0] },
  mola: { H: 0.4, W: 0.085, skew: 1.0, round: 0.42, rear: 0.62, belly: 1.0, hump: 0, nose: 0.015, tail: 'clavus', tailLen: 0.1, tailH: 0.34, dorsal: [0.1, 0.3, 0.46, 1], anal: [0.1, 0.3, 0.46], pect: 0.07, eye: 0.04, waveK: 2.0, amp: 0.15, pectFlap: 0.03, vertFlap: 0.32, puff: [0, 0, 0] },
};

// The rear term keeps a peduncle (or the mola's truncated back) while the head still tapers.
const prof = (u, P) => {
  const base = Math.pow(Math.max(Math.sin(Math.PI * Math.pow(clamp(u, 0, 1), P.skew)), 0), P.round);
  return base + P.rear * (1 - u) * (1 - u) * (1 - base);
};

function buildBody(P) {
  const R = 14, S = 8;
  const pos = [], part = [], idx = [];
  const yOff = (u) => P.hump * Math.sin(Math.PI * u);
  for (let i = 0; i <= R; i++) {
    const u = i / R, p = prof(u, P);
    for (let j = 0; j < S; j++) {
      const a = (j / S) * Math.PI * 2 + Math.PI / S;
      const sy = Math.sin(a);
      pos.push(Math.cos(a) * P.W * p, sy * P.H * p * (sy < 0 ? P.belly : 1) + yOff(u), -0.5 + u);
      part.push(0);
    }
  }
  for (let i = 0; i < R; i++) {
    for (let j = 0; j < S; j++) {
      const a = i * S + j, b = i * S + ((j + 1) % S), c = (i + 1) * S + j, d = (i + 1) * S + ((j + 1) % S);
      idx.push(a, c, b, b, c, d);
    }
  }
  const tc = pos.length / 3;
  pos.push(0, yOff(0), -0.505);
  part.push(0);
  for (let j = 0; j < S; j++) idx.push(tc, j, (j + 1) % S);
  const nc = pos.length / 3;
  pos.push(0, yOff(1) - P.H * 0.06, 0.5 + P.nose);
  part.push(0);
  for (let j = 0; j < S; j++) idx.push(nc, R * S + ((j + 1) % S), R * S + j);
  const ue = 0.84, pe = prof(ue, P), ze = -0.5 + ue;
  for (const side of [-1, 1]) {
    const cx = side * P.W * pe * 0.86, cy = P.H * pe * 0.28 + yOff(ue), r = P.eye;
    const v0 = pos.length / 3;
    for (const q of [[side * r * 0.7, 0, 0], [0, r, 0], [0, -r, 0], [0, 0, r], [0, 0, -r]]) {
      pos.push(cx + q[0], cy + q[1], ze + q[2]);
      part.push(2);
    }
    idx.push(v0, v0 + 1, v0 + 3, v0, v0 + 3, v0 + 2, v0, v0 + 2, v0 + 4, v0, v0 + 4, v0 + 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aPart', new THREE.Float32BufferAttribute(part, 1));
  g.setIndex(idx);
  g.computeVertexNormals();
  g.computeBoundingSphere();
  return g;
}

function buildFins(P) {
  const pos = [], fin = [], idx = [];
  const add = (x, y, z, w, side, vert) => {
    pos.push(x, y, z);
    fin.push(w, side, vert);
    return pos.length / 3 - 1;
  };
  const tri = (a, b, c) => idx.push(a, b, c);
  const yOff = (u) => P.hump * Math.sin(Math.PI * u);
  const top = (u) => yOff(u) + P.H * prof(u, P) * 0.97;
  const bot = (u) => yOff(u) - P.H * prof(u, P) * P.belly * 0.97;
  const z0 = -0.5, hb = P.H * prof(0, P) * 0.85 + 0.01, y0 = yOff(0);
  if (P.tail === 'fork' || P.tail === 'lunate') {
    const notch = P.tail === 'fork' ? 0.5 : 0.72;
    const b1 = add(0, y0 + hb, z0 + 0.02, 0.1, 0, 0), b2 = add(0, y0 - hb, z0 + 0.02, 0.1, 0, 0);
    const t1 = add(0, y0 + P.tailH, z0 - P.tailLen, 1, 0, 0), t2 = add(0, y0 - P.tailH, z0 - P.tailLen, 1, 0, 0);
    const n = add(0, y0, z0 - P.tailLen * notch, 0.7, 0, 0);
    tri(b1, t1, n); tri(b1, n, b2); tri(b2, n, t2);
  } else if (P.tail === 'round') {
    const c = add(0, y0, z0 + 0.03, 0.05, 0, 0);
    let prev = -1;
    for (let k = 0; k <= 6; k++) {
      const a = -1.15 + (2.3 * k) / 6;
      const v = add(0, y0 + Math.sin(a) * P.tailH, z0 - Math.cos(a) * P.tailLen, 1, 0, 0);
      if (prev >= 0) tri(c, prev, v);
      prev = v;
    }
  } else {
    let pi = -1, po = -1;
    for (let k = 0; k <= 9; k++) {
      const a = -1.25 + (2.5 * k) / 9;
      const scallop = 0.7 + 0.3 * Math.abs(Math.sin(k * 1.9));
      const vi = add(0, y0 + Math.sin(a) * P.tailH * 0.9, z0 + 0.04, 0.05, 0, 1);
      const vo = add(0, y0 + Math.sin(a) * P.tailH * 1.06, z0 - P.tailLen * scallop * Math.cos(a * 0.6), 1, 0, 1);
      if (pi >= 0) { tri(pi, po, vi); tri(po, vo, vi); }
      pi = vi; po = vo;
    }
  }
  const vfin = (u0, u1, h, spikes, sign, vert) => {
    const K = Math.max(4, spikes * 2);
    let pb = -1, pt = -1;
    for (let k = 0; k <= K; k++) {
      const s = k / K, u = u0 + (u1 - u0) * s, z = -0.5 + u;
      const y = sign > 0 ? top(u) : bot(u);
      let hh = h * Math.pow(Math.sin(Math.PI * s), 0.6);
      if (spikes > 1) hh *= k % 2 === 0 ? 0.55 : 1.0;
      const vb = add(0, y - sign * 0.01, z, 0, 0, vert);
      const vt = add(0, y + sign * hh, z - hh * 0.35, 1, 0, vert);
      if (pb >= 0) { tri(pb, pt, vb); tri(pt, vt, vb); }
      pb = vb; pt = vt;
    }
  };
  const vf = P.vertFlap ? 1 : 0;
  vfin(P.dorsal[0], P.dorsal[1], P.dorsal[2], P.dorsal[3], 1, vf);
  vfin(P.anal[0], P.anal[1], P.anal[2], 1, -1, vf);
  const up = 0.66, pp = prof(up, P), zp = -0.5 + up;
  for (const side of [-1, 1]) {
    const bx = side * P.W * pp * 0.92, by = yOff(up) - P.H * pp * 0.25;
    const a = add(bx, by + P.pect * 0.25, zp, 0, side, 0);
    const b = add(bx, by - P.pect * 0.2, zp - P.pect * 0.15, 0, side, 0);
    const c = add(bx + side * P.pect * 0.85, by - P.pect * 0.1, zp - P.pect * 0.95, 1, side, 0);
    const d = add(bx + side * P.pect * 0.55, by + P.pect * 0.35, zp - P.pect * 1.05, 1, side, 0);
    tri(a, b, c); tri(a, c, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aFin', new THREE.Float32BufferAttribute(fin, 3));
  g.setIndex(idx);
  g.computeBoundingSphere();
  return g;
}

const VERT = /* glsl */ `
uniform float uTime;
uniform float uWaveK;
uniform float uAmp;
uniform float uPectFlap;
uniform float uVertFlap;
uniform vec3 uPuffAxis;
#ifdef HELD
  uniform vec4 uHeld;
#else
  attribute vec4 aFish;
#endif
#ifdef FIN
  attribute vec3 aFin;
  varying float vFinW;
#else
  attribute float aPart;
  varying float vPart;
#endif
varying vec3 vWorld;
varying vec3 vLocal;
varying float vHi;
void main() {
  #ifdef HELD
    vec4 fish = uHeld;
  #else
    vec4 fish = aFish;
  #endif
  vec3 p = position * (1.0 + fish.w * uPuffAxis);
  // travelling body wave, growing toward the tail
  float u = clamp(0.5 - position.z, 0.0, 1.3);
  float env = 0.12 + u * u * 0.95;
  p.x += sin(fish.x + position.z * uWaveK) * env * uAmp * fish.y * 0.12;
  #ifdef FIN
    p.x += aFin.y * sin(fish.x * 1.3 + 0.7) * aFin.x * uPectFlap * (0.6 + 0.4 * fish.y);
    p.x += aFin.z * sin(fish.x + 1.2) * aFin.x * uVertFlap * (0.5 + 0.5 * fish.y);
    vFinW = aFin.x;
  #else
    vPart = aPart;
  #endif
  vLocal = position;
  vec4 wp = vec4(p, 1.0);
  #ifdef USE_INSTANCING
    wp = instanceMatrix * wp;
  #endif
  wp = modelMatrix * wp;
  vWorld = wp.xyz;
  vHi = fish.z;
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;

const FRAG = /* glsl */ `
uniform vec3 uBack;
uniform vec3 uBelly;
uniform vec3 uAccent;
uniform vec3 uFinCol;
uniform vec3 uHiCol;
uniform float uPattern;
uniform float uPatFreq;
uniform float uShine;
uniform float uGlow;
uniform float uBodyH;
${UW_PARS}
#ifdef FIN
  varying float vFinW;
#else
  varying float vPart;
#endif
varying vec3 vWorld;
varying vec3 vLocal;
varying float vHi;
float fh(vec2 p) { return fract(sin(dot(p, vec2(41.3, 289.1))) * 43758.5453); }
void main() {
  vec3 n = normalize(cross(dFdx(vWorld), dFdy(vWorld)));
  vec3 V = normalize(cameraPosition - vWorld);
  if (dot(n, V) < 0.0) n = -n;
  #ifdef FIN
    vec3 base = mix(uFinCol * 0.9, uFinCol * 1.1 + 0.03, vFinW);
    base *= 0.8 + 0.2 * sin(vLocal.y * 90.0 + vLocal.z * 40.0);
    float alpha = mix(0.9, 0.4, vFinW);
  #else
    float h = clamp(vLocal.y / uBodyH, -1.0, 1.0);
    vec3 base = mix(uBelly, uBack, smoothstep(-0.25, 0.55, h));
    if (uPattern > 0.5 && uPattern < 1.5) {
      float b = abs(fract(vLocal.z * uPatFreq + 0.25) - 0.5);
      base = mix(base, uAccent, smoothstep(0.17, 0.12, b) * smoothstep(-0.7, -0.2, h));
    } else if (uPattern > 1.5 && uPattern < 2.5) {
      vec2 sp = vec2(vLocal.z, vLocal.y + vLocal.x * 0.5) * uPatFreq;
      vec2 id = floor(sp);
      vec2 f = fract(sp) - 0.5 - (vec2(fh(id + 3.1), fh(id + 7.7)) - 0.5) * 0.4;
      float r = 0.16 + 0.12 * fh(id);
      base = mix(base, uAccent, smoothstep(r, r - 0.06, length(f)) * smoothstep(-0.3, 0.2, h) * 0.85);
    } else if (uPattern > 2.5) {
      float l = smoothstep(0.1, 0.0, abs(h - 0.05 + 0.04 * sin(vLocal.z * 12.0)) - 0.06);
      base = mix(base, uAccent, l);
    }
    if (vPart > 1.5) base = vec3(0.015, 0.02, 0.03);
    float alpha = 1.0;
  #endif
  float ndl = dot(n, uSunDir);
  float diff = clamp(ndl * 0.65 + 0.35, 0.0, 1.0);
  vec3 amb = mix(uAmbGround, uAmbSky, n.y * 0.5 + 0.5);
  vec3 lit = base * (uSunColor * diff * 0.42 + amb * 0.75);
  vec3 H = normalize(uSunDir + V);
  float sp = pow(max(dot(n, H), 0.0), 40.0);
  #ifdef FIN
    lit += uSunColor * base * pow(max(dot(-V, uSunDir), 0.0), 3.0) * 0.45;
  #else
    float sc = 0.5 + 0.5 * sin(vLocal.z * 160.0) * sin(vLocal.y * 160.0 + vLocal.z * 80.0);
    lit += uSunColor * sp * uShine * (0.25 + 0.75 * sc) * 0.6;
    if (vPart > 1.5) lit += uSunColor * pow(max(dot(n, H), 0.0), 90.0) * 2.0;
  #endif
  float depth = uWaterLevel - vWorld.y;
  if (depth > 0.0) {
    lit += base * uSunColor * uwCaustics(vWorld.xz, uTime) * clamp(n.y, 0.0, 1.0) * 0.35 * exp(-depth * 0.075);
    lit = uwAbsorbCol(lit, depth);
  }
  float fr = pow(1.0 - clamp(dot(n, V), 0.0, 1.0), 2.5);
  lit += uFogColor * fr * 0.35;
  lit += base * uLampColor * uwLamp(vWorld, n);
  lit += uHiCol * vHi * (0.15 + fr * 2.2) * (0.75 + 0.25 * sin(uTime * 8.0));
  lit += uAccent * uGlow * (0.25 + fr * 0.9) * (0.8 + 0.2 * sin(uTime * 2.0 + vLocal.z * 8.0));
  lit = uwFog(lit, vWorld);
  gl_FragColor = vec4(lit, alpha);
}`;

function fishMaterial(def, P, { fin = false, held = false } = {}) {
  const c = (hex) => new THREE.Color(hex);
  const uniforms = shared({
    uWaveK: { value: P.waveK },
    uAmp: { value: P.amp },
    uPectFlap: { value: P.pectFlap },
    uVertFlap: { value: P.vertFlap },
    uPuffAxis: { value: new THREE.Vector3(...P.puff) },
    uBack: { value: c(def.colors.back) },
    uBelly: { value: c(def.colors.belly) },
    uAccent: { value: c(def.colors.accent) },
    uFinCol: { value: c(def.colors.fin) },
    uHiCol: { value: c('#FFC870').multiplyScalar(1.6) },
    uPattern: { value: def.pattern },
    uPatFreq: { value: def.patFreq },
    uShine: { value: def.shine },
    uGlow: { value: def.glow },
    uBodyH: { value: P.H },
  });
  if (held) uniforms.uHeld = { value: new THREE.Vector4(0, 1.5, 0, 0) };
  const defines = {};
  if (fin) defines.FIN = '';
  if (held) defines.HELD = '';
  return new THREE.ShaderMaterial({
    uniforms,
    defines,
    vertexShader: VERT,
    fragmentShader: FRAG,
    side: THREE.DoubleSide,
    transparent: fin,
    depthWrite: !fin,
  });
}

const UPV = new THREE.Vector3(0, 1, 0);
const ZERO = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();
const _d = new THREE.Vector3();
const _sep = new THREE.Vector3();
const _ali = new THREE.Vector3();
const _coh = new THREE.Vector3();
const ZAXIS = new THREE.Vector3(0, 0, 1);
const B = WORLD.bounds;

export class FishSystem {
  constructor(scene) {
    this.rng = mulberry32(2024);
    this.species = {};
    this.fish = [];
    this.groups = [];
    this.highlight = null;
    this.geoms = {};
    const rng = this.rng;
    for (const gdef of GROUPS) {
      const def = SPECIES[gdef.sp];
      if (!this.species[def.id]) this.species[def.id] = { def, fish: [] };
      for (const [hx, hz] of gdef.homes) {
        const group = { def, home: new THREE.Vector3(hx, 0, hz), radius: gdef.radius, target: new THREE.Vector3(), center: new THREE.Vector3(), timer: 0, members: [] };
        this.retarget(group);
        const n = Math.round(range(rng, gdef.size[0], gdef.size[1]));
        for (let i = 0; i < n; i++) {
          const f = {
            def, group, sp: this.species[def.id],
            pos: group.target.clone().add(new THREE.Vector3(range(rng, -2, 2), range(rng, -0.6, 0.6), range(rng, -2, 2))),
            vel: new THREE.Vector3(range(rng, -1, 1), 0, range(rng, -1, 1)).multiplyScalar(def.speed * 0.5),
            fwd: new THREE.Vector3(0, 0, 1),
            quat: new THREE.Quaternion(),
            offset: new THREE.Vector3(range(rng, -1, 1), range(rng, -0.4, 0.4), range(rng, -1, 1)).multiplyScalar(n > 1 ? 1.4 : 0),
            size: def.size * range(rng, 0.82, 1.22),
            phase: rng() * 10, amp: 1, bank: 0, puff: 0, hi: 0,
            awareness: 0, state: 'swim', fleeT: 0, alive: true, respawnT: 0,
          };
          f.pos.y = Math.max(f.pos.y, groundY(f.pos.x, f.pos.z) + 0.6);
          f.fwd.copy(f.vel).normalize();
          group.members.push(f);
          this.species[def.id].fish.push(f);
          this.fish.push(f);
        }
        this.groups.push(group);
      }
    }
    for (const id in this.species) {
      const s = this.species[id];
      const P = SHAPES[s.def.shape];
      s.P = P;
      const bodyGeo = buildBody(P), finGeo = buildFins(P);
      this.geoms[id] = { body: bodyGeo, fins: finGeo };
      const count = s.fish.length;
      s.aFish = new THREE.InstancedBufferAttribute(new Float32Array(count * 4), 4);
      s.aFish.setUsage(THREE.DynamicDrawUsage);
      bodyGeo.setAttribute('aFish', s.aFish);
      finGeo.setAttribute('aFish', s.aFish);
      s.body = new THREE.InstancedMesh(bodyGeo, fishMaterial(s.def, P), count);
      s.fins = new THREE.InstancedMesh(finGeo, fishMaterial(s.def, P, { fin: true }), count);
      s.body.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      s.fins.instanceMatrix = s.body.instanceMatrix;
      for (const m of [s.body, s.fins]) {
        m.frustumCulled = false;
        scene.add(m);
      }
      s.body.castShadow = true;
    }
    this.flush();
  }

  retarget(g) {
    const rng = this.rng;
    const a = rng() * Math.PI * 2, r = Math.sqrt(rng()) * g.radius;
    const x = clamp(g.home.x + Math.cos(a) * r, B.xMin + 4, B.xMax - 4);
    const z = clamp(g.home.z + Math.sin(a) * r, B.zMin + 4, 20);
    const gy = groundY(x, z);
    const y = Math.min(gy + range(rng, g.def.alt[0], g.def.alt[1]), -1.0 - g.def.size * 0.5);
    g.target.set(x, Math.max(y, gy + 0.5), z);
    g.timer = range(rng, 6, 14);
  }

  update(dt, t, player) {
    for (const g of this.groups) {
      g.center.set(0, 0, 0);
      let n = 0;
      for (const f of g.members) if (f.alive) { g.center.add(f.pos); n++; }
      if (n) g.center.divideScalar(n);
      g.timer -= dt;
      if (g.timer <= 0 || (n && g.center.distanceToSquared(g.target) < 4)) this.retarget(g);
    }
    for (const f of this.fish) {
      if (!f.alive) {
        f.respawnT -= dt;
        if (f.respawnT <= 0 && f.group.home.distanceTo(player.pos) > 22) this.respawn(f);
        continue;
      }
      this.steer(f, dt, player);
      f.hi = damp(f.hi, f === this.highlight ? 1 : 0, 10, dt);
    }
    this.flush();
  }

  steer(f, dt, P) {
    const def = f.def, g = f.group;
    const acc = _a.set(0, 0, 0);
    _b.copy(g.target).add(f.offset).sub(f.pos);
    const dT = _b.length();
    if (dT > 1e-3) acc.addScaledVector(_b, Math.min(1, dT / 3) / dT);
    if (g.members.length > 1) {
      let n = 0;
      _sep.set(0, 0, 0); _ali.set(0, 0, 0); _coh.set(0, 0, 0);
      const sepR = def.size * 2.2;
      for (const o of g.members) {
        if (o === f || !o.alive) continue;
        _c.subVectors(f.pos, o.pos);
        const d2 = _c.lengthSq();
        if (d2 < 25) {
          n++;
          _coh.add(o.pos);
          _ali.add(o.vel);
          if (d2 < sepR * sepR) _sep.addScaledVector(_c, 1 / (d2 + 0.01));
        }
      }
      if (n) {
        _coh.divideScalar(n).sub(f.pos);
        acc.addScaledVector(_coh, 0.35);
        acc.addScaledVector(_ali.divideScalar(n), 0.25);
        acc.addScaledVector(_sep, 0.3 * def.size);
      }
    }
    // seabed (with look-ahead), surface and bounds
    const ahead = groundY(f.pos.x + f.vel.x * 0.8, f.pos.z + f.vel.z * 0.8);
    const gy = Math.max(groundY(f.pos.x, f.pos.z), ahead);
    const minY = gy + 0.35 + def.size * 0.3;
    if (f.pos.y < minY + 0.8) acc.y += (minY + 0.8 - f.pos.y) * 2.5;
    const maxY = -0.7 - def.size * 0.4;
    if (f.pos.y > maxY) acc.y -= (f.pos.y - maxY) * 3;
    if (f.pos.x < B.xMin + 3) acc.x += 2;
    if (f.pos.x > B.xMax - 3) acc.x -= 2;
    if (f.pos.z < B.zMin + 3) acc.z += 2;
    if (f.pos.z > 24) acc.z -= 2;

    // awareness: the fish sees ahead much better than behind, and hears speed
    if (P.inWater) {
      _c.subVectors(P.pos, f.pos);
      const d = _c.length();
      const R = def.perception * (P.lampOn ? 1.15 : 1);
      if (d < R) {
        _c.divideScalar(d || 1);
        const facing = f.fwd.dot(_c);
        const vis = 0.2 + 0.8 * smoothstep(-0.45, 0.3, facing);
        const loud = 0.3 + P.speedNorm * 1.25 + P.burst;
        const prox = 1 - d / R;
        f.awareness += def.alertRate * vis * loud * prox * prox * 2.4 * dt;
        if (f.awareness > 0.45) acc.addScaledVector(_c, -f.awareness * 1.6);
      }
    }
    f.awareness = Math.max(0, f.awareness - 0.12 * dt);
    if (f.awareness >= 1 && f.state !== 'flee') this.startle(f, P.pos);
    if (f.state === 'flee') {
      _d.subVectors(f.pos, P.pos).normalize();
      _d.y *= 0.4;
      acc.addScaledVector(_d, 5);
      f.fleeT -= dt;
      if (f.fleeT <= 0) {
        f.state = 'swim';
        f.awareness = 0.4;
      }
    }

    const fleeing = f.state === 'flee';
    let maxSp = fleeing ? def.panic : def.speed * (f.awareness > 0.5 ? 1.3 : 1) * (dT > 6 ? 1.25 : 1);
    if (def.puff) maxSp *= 1 - f.puff * 0.6;
    f.vel.addScaledVector(acc, dt * (fleeing ? 9 : 2.4));
    let sp = f.vel.length();
    if (sp > maxSp) f.vel.multiplyScalar(maxSp / sp);
    else if (sp < def.speed * 0.3 && sp > 1e-4) f.vel.multiplyScalar((def.speed * 0.3) / sp);
    sp = f.vel.length();
    f.vel.y = clamp(f.vel.y, -sp * 0.5, sp * 0.5);
    f.pos.addScaledVector(f.vel, dt);
    const floor = groundY(f.pos.x, f.pos.z) + 0.25;
    if (f.pos.y < floor) f.pos.y = floor;

    if (sp > 1e-3) {
      _d.copy(f.vel).divideScalar(sp);
      _d.y = clamp(_d.y, -0.55, 0.55);
      _d.normalize();
      const cross = f.fwd.x * _d.z - f.fwd.z * _d.x;
      f.bank = damp(f.bank, clamp((-cross / Math.max(dt, 1e-3)) * 0.06, -0.6, 0.6), 5, dt);
      f.fwd.lerp(_d, 1 - Math.exp(-(fleeing ? 12 : 5) * dt)).normalize();
    }
    _m.lookAt(f.fwd, ZERO, UPV);
    f.quat.setFromRotationMatrix(_m).multiply(_q.setFromAxisAngle(ZAXIS, f.bank));

    const sNorm = sp / def.speed;
    f.amp = damp(f.amp, clamp(0.55 + sNorm * 0.6, 0.5, 1.9), 4, dt);
    f.phase += dt * def.tail * (0.55 + sNorm * 0.75);
    const puffTarget = def.puff && (fleeing || f.awareness > 0.8) ? 1 : 0;
    f.puff = damp(f.puff, puffTarget, puffTarget > f.puff ? 6 : 0.5, dt);
  }

  startle(f, from) {
    if (!f.alive) return;
    f.state = 'flee';
    f.fleeT = range(this.rng, 2.2, 3.4);
    f.awareness = 1;
    _d.subVectors(f.pos, from).normalize();
    f.vel.addScaledVector(_d, f.def.panic * 0.6);
    for (const o of f.group.members) {
      if (o !== f && o.alive && o.state !== 'flee' && o.pos.distanceToSquared(f.pos) < 49) o.awareness += 0.6;
    }
  }

  // splash, dash or a missed grab scares everything nearby
  noise(pos, radius, amount) {
    const r2 = radius * radius;
    for (const f of this.fish) {
      if (!f.alive) continue;
      const d2 = f.pos.distanceToSquared(pos);
      if (d2 < r2) f.awareness += amount * (1 - Math.sqrt(d2) / radius);
    }
  }

  findTarget(eye, dir, origin, reach, minCos) {
    let best = null, bestScore = Infinity;
    for (const f of this.fish) {
      if (!f.alive) continue;
      _c.subVectors(f.pos, eye);
      const dist = _c.length();
      const cos = _c.dot(dir) / (dist || 1);
      if (cos < minCos) continue;
      const dh = f.pos.distanceTo(origin) - f.size * 0.4;
      if (dh > reach) continue;
      const score = (1 - cos) * 10 + dh * 0.4;
      if (score < bestScore) { bestScore = score; best = f; }
    }
    return best;
  }

  capture(f) {
    f.alive = false;
    f.state = 'caught';
    f.respawnT = range(this.rng, 25, 45);
    if (this.highlight === f) this.highlight = null;
    return { def: f.def, size: f.size };
  }

  respawn(f) {
    const g = f.group;
    f.pos.copy(g.target).add(new THREE.Vector3(range(this.rng, -2, 2), 0, range(this.rng, -2, 2)));
    f.pos.y = Math.max(f.pos.y, groundY(f.pos.x, f.pos.z) + 0.6);
    f.alive = true;
    f.state = 'swim';
    f.awareness = 0;
    f.puff = 0;
  }

  flush() {
    for (const id in this.species) {
      const s = this.species[id];
      s.fish.forEach((f, i) => {
        const k = f.alive ? f.size : 0;
        s.body.setMatrixAt(i, _m.compose(f.pos, f.quat, _s.set(k, k, k)));
        s.aFish.setXYZW(i, f.phase, f.amp, f.hi, f.puff);
      });
      s.body.instanceMatrix.needsUpdate = true;
      s.aFish.needsUpdate = true;
    }
  }

  // A standalone fish used for the "in hand" and trophy poses; it thrashes via uHeld.
  makeHeld(id) {
    const s = this.species[id];
    const geo = this.geoms[id];
    const strip = (g) => {
      const out = new THREE.BufferGeometry();
      for (const k of ['position', 'aPart', 'aFin']) if (g.attributes[k]) out.setAttribute(k, g.attributes[k]);
      out.setIndex(g.index);
      out.boundingSphere = g.boundingSphere;
      return out;
    };
    const body = new THREE.Mesh(strip(geo.body), fishMaterial(s.def, s.P, { held: true }));
    const fins = new THREE.Mesh(strip(geo.fins), fishMaterial(s.def, s.P, { fin: true, held: true }));
    fins.material.uniforms.uHeld = body.material.uniforms.uHeld;
    body.castShadow = true;
    const group = new THREE.Group();
    group.add(body, fins);
    group.userData.uHeld = body.material.uniforms.uHeld;
    group.userData.def = s.def;
    return group;
  }
}
