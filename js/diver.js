import * as THREE from 'three';
import { PALETTE } from './config.js';
import { patchWorldMaterial } from './shaders.js';
import { damp, lerp } from './util.js';

const JOINTS = ['pelvis', 'spine', 'neck', 'shoulderL', 'elbowL', 'handL', 'shoulderR', 'elbowR', 'handR', 'hipL', 'kneeL', 'ankleL', 'hipR', 'kneeR', 'ankleR'];
const STATES = ['stand', 'walk', 'dive', 'swim', 'hover', 'dash', 'tread', 'climb', 'victory'];
const PI = Math.PI;
const pos0 = (v) => Math.max(0, v);

// Procedural key poses; each returns joint Euler angles (x,y,z). Missing joints rest at 0.
// Arms hang along -y: shoulder.x < 0 swings the arm forward, -PI raises it overhead.
const POSES = {
  stand: (t) => {
    const b = Math.sin(t * 1.7);
    return {
      spine: [0.03 * b, 0, 0], neck: [0.04 * Math.sin(t * 0.5), 0.3 * Math.sin(t * 0.27), 0],
      shoulderL: [0.06, 0, 0.16 + 0.02 * b], shoulderR: [0.06, 0, -0.16 - 0.02 * b],
      elbowL: [-0.28, 0, 0], elbowR: [-0.28, 0, 0],
      hipL: [0, 0, 0.05], hipR: [0, 0, -0.05], kneeL: [0.05, 0, 0], kneeR: [0.05, 0, 0],
      ankleL: [-0.05, 0, 0], ankleR: [-0.05, 0, 0], bob: 0.006 * b,
    };
  },
  walk: (t, ph) => {
    const s = Math.sin(ph);
    return {
      spine: [0.07, 0.07 * s, 0], neck: [-0.04, -0.05 * s, 0],
      shoulderL: [0.45 * s, 0, 0.14], shoulderR: [-0.45 * s, 0, -0.14],
      elbowL: [-0.45, 0, 0], elbowR: [-0.45, 0, 0],
      hipL: [-0.5 * s, 0, 0.05], hipR: [0.5 * s, 0, -0.05],
      kneeL: [0.2 + 0.45 * pos0(Math.sin(ph + 1.2)), 0, 0], kneeR: [0.2 + 0.45 * pos0(Math.sin(ph + 1.2 + PI)), 0, 0],
      ankleL: [-0.3 * pos0(Math.sin(ph + 1.2)), 0, 0], ankleR: [-0.3 * pos0(Math.sin(ph + 1.2 + PI)), 0, 0],
      bob: 0.04 * Math.abs(Math.cos(ph)),
    };
  },
  dive: () => ({
    spine: [-0.05, 0, 0], neck: [0.15, 0, 0],
    shoulderL: [-2.95, 0, 0.1], shoulderR: [-2.95, 0, -0.1], elbowL: [-0.05, 0, 0], elbowR: [-0.05, 0, 0],
    hipL: [0.05, 0, 0.02], hipR: [0.05, 0, -0.02], kneeL: [0.05, 0, 0], kneeR: [0.05, 0, 0],
    ankleL: [1.35, 0, 0], ankleR: [1.35, 0, 0],
  }),
  swim: (t, ph, p) => {
    const k = Math.sin(ph), i = 0.6 + 0.6 * p.intensity;
    return {
      spine: [0.04 * Math.sin(ph + 0.5), 0, 0], neck: [-0.95, 0, 0],
      shoulderL: [0.25, 0, 0.32], shoulderR: [0.25, 0, -0.32], elbowL: [-0.35, 0, 0], elbowR: [-0.35, 0, 0],
      hipL: [0.3 * k * i - 0.1, 0, 0.05], hipR: [-0.3 * k * i - 0.1, 0, -0.05],
      kneeL: [0.25 + 0.3 * i * pos0(Math.sin(ph + 1.0)), 0, 0], kneeR: [0.25 + 0.3 * i * pos0(Math.sin(ph + 1.0 + PI)), 0, 0],
      ankleL: [1.35 + 0.35 * i * Math.sin(ph - 1.2), 0, 0], ankleR: [1.35 + 0.35 * i * Math.sin(ph - 1.2 + PI), 0, 0],
    };
  },
  dash: (t, ph) => {
    const k = Math.sin(ph * 1.4);
    return {
      spine: [0.05 * Math.sin(ph * 1.4 + 0.5), 0, 0], neck: [-1.0, 0, 0],
      shoulderL: [0.1, 0, 0.12], shoulderR: [0.1, 0, -0.12], elbowL: [-0.1, 0, 0], elbowR: [-0.1, 0, 0],
      hipL: [0.55 * k - 0.1, 0, 0.03], hipR: [-0.55 * k - 0.1, 0, -0.03],
      kneeL: [0.3 + 0.5 * pos0(Math.sin(ph * 1.4 + 1.0)), 0, 0], kneeR: [0.3 + 0.5 * pos0(Math.sin(ph * 1.4 + 1.0 + PI)), 0, 0],
      ankleL: [1.4 + 0.5 * Math.sin(ph * 1.4 - 1.2), 0, 0], ankleR: [1.4 + 0.5 * Math.sin(ph * 1.4 - 1.2 + PI), 0, 0],
    };
  },
  hover: (t, ph) => {
    const s = Math.sin(ph);
    return {
      spine: [0.08, 0, 0], neck: [-0.35, 0, 0],
      shoulderL: [-0.55 + 0.15 * s, 0.25 * s, 0.55], shoulderR: [-0.55 - 0.15 * s, -0.25 * s, -0.55],
      elbowL: [-0.9, 0, 0], elbowR: [-0.9, 0, 0],
      hipL: [0.15 * Math.sin(ph * 0.8) - 0.15, 0, 0.08], hipR: [-0.15 * Math.sin(ph * 0.8) - 0.15, 0, -0.08],
      kneeL: [0.45, 0, 0], kneeR: [0.45, 0, 0],
      ankleL: [1.1 + 0.2 * Math.sin(ph * 0.8 - 1), 0, 0], ankleR: [1.1 - 0.2 * Math.sin(ph * 0.8 - 1), 0, 0],
    };
  },
  tread: (t, ph) => {
    const s = Math.sin(ph);
    return {
      spine: [0.1, 0, 0], neck: [-0.15, 0, 0],
      shoulderL: [-0.35, 0.35 * Math.sin(ph * 0.7), 0.95], shoulderR: [-0.35, -0.35 * Math.sin(ph * 0.7), -0.95],
      elbowL: [-0.5, 0, 0], elbowR: [-0.5, 0, 0],
      hipL: [-0.6 + 0.35 * s, 0, 0.25], hipR: [-0.6 - 0.35 * s, 0, -0.25],
      kneeL: [1.0 + 0.4 * Math.sin(ph + 1.3), 0, 0], kneeR: [1.0 - 0.4 * Math.sin(ph + 1.3), 0, 0],
      ankleL: [0.9, 0, 0], ankleR: [0.9, 0, 0],
    };
  },
  climb: (t, ph) => {
    const s = Math.sin(ph);
    return {
      spine: [0.12, 0, 0], neck: [-0.2, 0, 0],
      shoulderL: [-2.5 + 0.45 * s, 0, 0.2], shoulderR: [-2.5 - 0.45 * s, 0, -0.2],
      elbowL: [-0.7 - 0.3 * s, 0, 0], elbowR: [-0.7 + 0.3 * s, 0, 0],
      hipL: [-0.9 + 0.5 * s, 0, 0.05], hipR: [-0.9 - 0.5 * s, 0, -0.05],
      kneeL: [1.3 - 0.5 * s, 0, 0], kneeR: [1.3 + 0.5 * s, 0, 0], ankleL: [0.3, 0, 0], ankleR: [0.3, 0, 0],
    };
  },
  victory: (t) => {
    const b = Math.sin(t * 5);
    return {
      spine: [-0.08, 0, 0], neck: [-0.3, 0, 0],
      shoulderL: [-2.9, 0, 0.35], shoulderR: [-3.0, 0, -0.3], elbowL: [-0.3 - 0.1 * b, 0, 0], elbowR: [-0.25, 0, 0],
      hipL: [0, 0, 0.08], hipR: [0, 0, -0.08], kneeL: [0.1 + 0.15 * pos0(b), 0, 0], kneeR: [0.1 + 0.15 * pos0(b), 0, 0],
      bob: 0.05 * pos0(b),
    };
  },
};

function mat(hex, opts = {}) {
  return patchWorldMaterial(new THREE.MeshStandardMaterial({ color: hex, flatShading: true, roughness: 0.6, metalness: 0, ...opts }), { caustics: true });
}

function limb(r, len) {
  const g = new THREE.CapsuleGeometry(r, len, 2, 8);
  g.translate(0, -len / 2, 0);
  return g;
}

function finGeometry() {
  const s = new THREE.Shape();
  s.moveTo(-0.06, 0);
  s.lineTo(0.06, 0);
  s.lineTo(0.135, 0.44);
  s.quadraticCurveTo(0.0, 0.5, -0.135, 0.44);
  s.lineTo(-0.06, 0);
  const g = new THREE.ExtrudeGeometry(s, { depth: 0.018, bevelEnabled: false, curveSegments: 4 });
  g.rotateX(PI / 2);
  g.translate(0, -0.03, 0.06);
  const a = new THREE.Color(PALETTE.turquoise), b = new THREE.Color('#1B6F8A');
  const pos = g.attributes.position;
  const col = new Float32Array(pos.count * 3);
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    c.copy(a).lerp(b, THREE.MathUtils.smoothstep(pos.getZ(i), 0.15, 0.55));
    c.toArray(col, i * 3);
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}

export class Diver {
  constructor() {
    this.root = new THREE.Group();
    this.model = new THREE.Group();
    this.root.add(this.model);
    this.j = {};
    this.fpHide = [];
    const M = {
      suit: mat(PALETTE.deep, { roughness: 0.55 }),
      accent: mat(PALETTE.turquoise, { roughness: 0.5 }),
      tank: mat(PALETTE.coral, { roughness: 0.35, metalness: 0.15 }),
      metal: mat('#D4DADC', { roughness: 0.3, metalness: 0.7 }),
      glass: mat('#0B2A3E', { roughness: 0.08, metalness: 0.5 }),
      frame: mat(PALETTE.sun, { roughness: 0.45 }),
      glove: mat(PALETTE.sand, { roughness: 0.75 }),
      hose: mat('#10283C', { roughness: 0.6 }),
      fin: patchWorldMaterial(new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.5, side: THREE.DoubleSide }), { caustics: true }),
    };
    const add = (parent, geo, material, x = 0, y = 0, z = 0, fp = false) => {
      const m = new THREE.Mesh(geo, material);
      m.position.set(x, y, z);
      m.castShadow = true;
      parent.add(m);
      if (fp) this.fpHide.push(m);
      return m;
    };
    const joint = (name, parent, x, y, z) => {
      const g = new THREE.Group();
      g.position.set(x, y, z);
      parent.add(g);
      this.j[name] = g;
      return g;
    };

    const pelvis = joint('pelvis', this.model, 0, 0, 0);
    add(pelvis, new THREE.CapsuleGeometry(0.12, 0.12, 2, 8).rotateZ(PI / 2).scale(1, 1, 0.85), M.suit, 0, 0, 0, true);
    const spine = joint('spine', pelvis, 0, 0.06, 0);
    add(spine, new THREE.CapsuleGeometry(0.15, 0.28, 3, 10).scale(1.22, 1, 0.85), M.suit, 0, 0.24, 0, true);
    add(spine, new THREE.TorusGeometry(0.168, 0.022, 5, 16).rotateX(PI / 2).scale(1.18, 1, 0.86), M.accent, 0, 0.34, 0, true);
    add(spine, new THREE.TorusGeometry(0.16, 0.026, 5, 16).rotateX(PI / 2).scale(1.18, 1, 0.86), M.hose, 0, 0.03, 0, true);
    add(spine, new THREE.BoxGeometry(0.07, 0.05, 0.03), M.frame, 0, 0.03, 0.14, true);
    add(spine, new THREE.CylinderGeometry(0.1, 0.1, 0.48, 10), M.tank, 0, 0.27, -0.2, true);
    add(spine, new THREE.SphereGeometry(0.1, 10, 5, 0, PI * 2, 0, PI / 2), M.tank, 0, 0.51, -0.2, true);
    add(spine, new THREE.CylinderGeometry(0.102, 0.102, 0.05, 10), M.metal, 0, 0.12, -0.2, true);
    add(spine, new THREE.CylinderGeometry(0.025, 0.025, 0.08, 6), M.metal, 0, 0.62, -0.2, true);
    const hose = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0, 0.63, -0.2), new THREE.Vector3(-0.12, 0.64, -0.12), new THREE.Vector3(-0.17, 0.56, 0.02), new THREE.Vector3(-0.07, 0.52, 0.11),
    ]);
    add(spine, new THREE.TubeGeometry(hose, 14, 0.016, 5, false), M.hose, 0, 0, 0, true);

    const neck = joint('neck', spine, 0, 0.47, 0);
    add(neck, new THREE.IcosahedronGeometry(0.115, 1), M.suit, 0, 0.12, 0, true);
    add(neck, new THREE.BoxGeometry(0.17, 0.09, 0.05), M.frame, 0, 0.13, 0.09, true);
    add(neck, new THREE.BoxGeometry(0.145, 0.068, 0.02), M.glass, 0, 0.13, 0.113, true);
    add(neck, new THREE.TorusGeometry(0.118, 0.012, 4, 14).rotateX(PI / 2), M.frame, 0, 0.13, 0, true);
    add(neck, new THREE.CylinderGeometry(0.028, 0.03, 0.05, 8).rotateX(PI / 2), M.metal, 0, 0.05, 0.11, true);

    for (const [side, sx] of [['L', 1], ['R', -1]]) {
      const sh = joint('shoulder' + side, spine, 0.21 * sx, 0.42, 0);
      add(sh, limb(0.052, 0.2), M.suit);
      add(sh, new THREE.TorusGeometry(0.055, 0.012, 4, 10).rotateX(PI / 2), M.accent, 0, -0.06, 0);
      const el = joint('elbow' + side, sh, 0, -0.29, 0);
      add(el, limb(0.046, 0.18), M.suit);
      const hand = joint('hand' + side, el, 0, -0.25, 0);
      add(hand, new THREE.IcosahedronGeometry(0.055, 1).scale(0.85, 1.25, 0.6), M.glove, 0, -0.04, 0);
      const hip = joint('hip' + side, pelvis, 0.095 * sx, -0.06, 0);
      add(hip, limb(0.072, 0.28), M.suit);
      add(hip, new THREE.TorusGeometry(0.074, 0.012, 4, 10).rotateX(PI / 2), M.accent, 0, -0.12, 0);
      const knee = joint('knee' + side, hip, 0, -0.42, 0);
      add(knee, limb(0.06, 0.27), M.suit);
      const ankle = joint('ankle' + side, knee, 0, -0.4, 0);
      add(ankle, new THREE.BoxGeometry(0.1, 0.08, 0.19), M.suit, 0, -0.03, 0.04);
      add(ankle, finGeometry(), M.fin);
    }
    this.socket = new THREE.Group();
    this.socket.position.set(0, -0.09, 0.03);
    this.j.handR.add(this.socket);

    this.w = Object.fromEntries(STATES.map((s) => [s, s === 'stand' ? 1 : 0]));
    this.ov = { reach: 0, hold: 0, stow: 0 };
    this.out = Object.fromEntries(JOINTS.map((k) => [k, [0, 0, 0]]));
    this.t = 0;
    this.phase = 0;
    this.held = null;
  }

  setFirstPerson(fp) {
    for (const m of this.fpHide) m.visible = !fp;
  }

  attachHeld(obj, scale) {
    this.detachHeld();
    this.held = obj;
    obj.scale.setScalar(scale);
    // hold the fish by the middle, belly toward the camera
    obj.rotation.set(0, PI / 2, PI / 2);
    obj.position.set(0, 0, 0);
    this.socket.add(obj);
  }

  detachHeld() {
    if (this.held) this.socket.remove(this.held);
    const h = this.held;
    this.held = null;
    return h;
  }

  // p: { state, speed, intensity, tilt (0 upright … 1 horizontal), reach (0..1), hold, stow, struggle }
  update(dt, p) {
    this.t += dt;
    const f = {
      walk: 0.5 + p.speed * 2.6, swim: 4.2 + p.speed * 1.4, dash: 6, tread: 3.2 + p.speed * 2, climb: 5.5, hover: 2.0,
    }[p.state] ?? 2.0;
    this.phase += dt * f;
    let sum = 0;
    for (const s of STATES) {
      this.w[s] = damp(this.w[s], s === p.state ? 1 : 0, s === 'dash' || p.state === 'dash' ? 10 : 6, dt);
      sum += this.w[s];
    }
    const out = this.out;
    for (const k of JOINTS) out[k][0] = out[k][1] = out[k][2] = 0;
    let bob = 0;
    for (const s of STATES) {
      const w = this.w[s] / sum;
      if (w < 0.001) continue;
      const pose = POSES[s](this.t, this.phase, p);
      for (const k in pose) {
        if (k === 'bob') { bob += pose.bob * w; continue; }
        const o = out[k], v = pose[k];
        o[0] += v[0] * w; o[1] += v[1] * w; o[2] += v[2] * w;
      }
    }
    // right-arm overlays: hold the catch, reach for a fish, stow into the bag
    this.ov.reach = damp(this.ov.reach, p.reach, 14, dt);
    this.ov.hold = damp(this.ov.hold, p.hold ? 1 : 0, 8, dt);
    this.ov.stow = damp(this.ov.stow, p.stow ? 1 : 0, 12, dt);
    const tilt = p.tilt ?? 0;
    const jig = p.struggle ? Math.sin(this.t * 31) * 0.08 + Math.sin(this.t * 13) * 0.06 : 0;
    const blend = (k, v, w) => {
      const o = out[k];
      o[0] = lerp(o[0], v[0], w); o[1] = lerp(o[1], v[1], w); o[2] = lerp(o[2], v[2], w);
    };
    const victory = this.w.victory;
    const holdW = this.ov.hold * (1 - victory);
    blend('shoulderR', [lerp(-1.25, -2.35, tilt) + jig, 0, -0.35], holdW);
    blend('elbowR', [-1.05 + jig, 0, 0], holdW);
    blend('handR', [0, 0.4, 0], holdW);
    blend('shoulderR', [lerp(-1.55, -2.85, tilt), 0, -0.08], this.ov.reach);
    blend('elbowR', [-0.05, 0, 0], this.ov.reach);
    blend('handR', [0.25, 0, 0], this.ov.reach);
    blend('shoulderR', [0.5, 0, -0.45], this.ov.stow);
    blend('elbowR', [-1.3, 0, 0], this.ov.stow);
    for (const k of JOINTS) this.j[k].rotation.set(out[k][0], out[k][1], out[k][2]);
    this.model.position.y = bob;
  }

  headWorld(out) {
    return this.j.neck.localToWorld(out.set(0, 0.13, 0.06));
  }

  handWorld(out) {
    return this.j.handR.localToWorld(out.set(0, -0.08, 0.03));
  }
}
