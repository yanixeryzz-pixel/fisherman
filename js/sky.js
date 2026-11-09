import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { shared, UW_PARS, SKY_PARS, patchWorldMaterial } from './shaders.js';
import { mulberry32, range, noise2 } from './util.js';
import { PALETTE } from './config.js';

const SKY_FRAG = /* glsl */ `
${UW_PARS}
${SKY_PARS}
uniform float uPass;
varying vec3 vDir;
void main() {
  vec3 d = normalize(vDir);
  vec3 c = skyColor(d);
  float s = max(dot(d, uSunDir), 0.0);
  c += uSunColor * smoothstep(0.99955, 0.99985, s) * 18.0;
  // a faint painted band just above the horizon
  c += vec3(1.0, 0.85, 0.7) * 0.05 * smoothstep(0.0, 0.04, d.y) * (1.0 - smoothstep(0.04, 0.16, d.y));
  if (uCamUnder > 0.5 && uPass > 0.5) c = uFogColor * mix(0.5, 1.4, smoothstep(-0.8, 0.8, d.y));
  gl_FragColor = vec4(c, 1.0);
}`;

function cloudGeometry(rng) {
  const parts = [];
  const n = 4 + Math.floor(rng() * 4);
  for (let i = 0; i < n; i++) {
    const g = new THREE.IcosahedronGeometry(range(rng, 7, 13), 1);
    g.scale(1, 0.55, 0.8);
    g.translate((i - n / 2) * range(rng, 6, 9), range(rng, -1, 3), range(rng, -5, 5));
    g.deleteAttribute('uv');
    parts.push(g);
  }
  const geo = mergeGeometries(parts);
  const pos = geo.attributes.position;
  const col = new Float32Array(pos.count * 3);
  const top = new THREE.Color('#FFFFFF'), bottom = new THREE.Color('#FBE3D0');
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    c.copy(bottom).lerp(top, THREE.MathUtils.smoothstep(pos.getY(i), -4, 5));
    c.toArray(col, i * 3);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return geo;
}

function makeGull() {
  const mat = patchWorldMaterial(new THREE.MeshStandardMaterial({ color: PALETTE.foam, flatShading: true, roughness: 0.8, side: THREE.DoubleSide }), { caustics: false });
  const tipMat = patchWorldMaterial(new THREE.MeshStandardMaterial({ color: '#3B4F5E', flatShading: true, roughness: 0.8, side: THREE.DoubleSide }), { caustics: false });
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.OctahedronGeometry(0.22, 0), mat);
  body.scale.set(0.7, 0.6, 2.0);
  g.add(body);
  const wings = [];
  for (const s of [-1, 1]) {
    const pivot = new THREE.Group();
    const inner = new THREE.Mesh(new THREE.PlaneGeometry(0.55, 0.26).rotateX(-Math.PI / 2).translate(s * 0.28, 0, 0), mat);
    const outerPivot = new THREE.Group();
    outerPivot.position.x = s * 0.55;
    const outer = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.2).rotateX(-Math.PI / 2).translate(s * 0.25, 0, -0.03), tipMat);
    outerPivot.add(outer);
    pivot.add(inner, outerPivot);
    g.add(pivot);
    wings.push({ pivot, outerPivot, s });
  }
  g.userData.wings = wings;
  return g;
}

export class Sky {
  constructor(scene) {
    this.material = new THREE.ShaderMaterial({
      uniforms: shared({ uPass: { value: 1 } }),
      vertexShader: /* glsl */ `
        varying vec3 vDir;
        void main() {
          vDir = position;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: SKY_FRAG,
      side: THREE.BackSide,
      depthWrite: false,
    });
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(2500, 48, 24), this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -10;
    scene.add(this.mesh);

    const rng = mulberry32(4242);
    const cloudMat = patchWorldMaterial(
      new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 1, emissive: '#FFF1DE', emissiveIntensity: 0.85 }),
      { caustics: false },
    );
    this.clouds = new THREE.Group();
    for (let i = 0; i < 13; i++) {
      const m = new THREE.Mesh(cloudGeometry(rng), cloudMat);
      const a = range(rng, -Math.PI * 0.95, Math.PI * 0.95) - Math.PI / 2;
      const d = range(rng, 420, 900);
      m.position.set(Math.cos(a) * d, range(rng, 120, 230), Math.sin(a) * d);
      m.rotation.y = rng() * Math.PI;
      m.scale.setScalar(range(rng, 1.1, 2.2));
      this.clouds.add(m);
    }
    scene.add(this.clouds);

    // distant islands frame the horizon
    const islandMat = patchWorldMaterial(new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 1 }), { caustics: false });
    const sand = new THREE.Color(PALETTE.sand), leaf = new THREE.Color('#5BAF94'), c = new THREE.Color();
    [[-420, -720, 130, 38], [-170, -900, 90, 22], [380, -760, 170, 46], [640, -430, 95, 26]].forEach(([x, z, r, h], k) => {
      const g = new THREE.IcosahedronGeometry(1, 3);
      const pos = g.attributes.position;
      const col = new Float32Array(pos.count * 3);
      for (let i = 0; i < pos.count; i++) {
        const px = pos.getX(i), py = pos.getY(i), pz = pos.getZ(i);
        const n = 1 + 0.22 * noise2(px * 2.1 + k * 7, pz * 2.1 - k) + 0.12 * noise2(px * 5 + k, pz * 5);
        const y = Math.max(py, -0.02) * n;
        pos.setXYZ(i, px * n, y * (0.6 + 0.4 * Math.max(0, py)), pz * n);
        c.copy(sand).lerp(leaf, THREE.MathUtils.smoothstep(y, 0.06, 0.2));
        c.toArray(col, i * 3);
      }
      g.setAttribute('color', new THREE.BufferAttribute(col, 3));
      g.computeVertexNormals();
      const m = new THREE.Mesh(g, islandMat);
      m.scale.set(r, h, r * 0.6);
      m.rotation.y = k * 1.3;
      m.position.set(x, -1, z);
      scene.add(m);
    });

    this.gulls = [];
    for (let i = 0; i < 5; i++) {
      const g = makeGull();
      g.userData.orbit = { r: range(rng, 14, 32), h: range(rng, 11, 20), speed: range(rng, 0.12, 0.22) * (i % 2 ? 1 : -1), a: rng() * 6.28, cx: range(rng, -12, 12), cz: range(rng, 10, 30), seed: rng() * 10 };
      scene.add(g);
      this.gulls.push(g);
    }
  }

  update(dt, t, camera) {
    this.mesh.position.copy(camera.position);
    this.clouds.rotation.y += dt * 0.002;
    for (const g of this.gulls) {
      const o = g.userData.orbit;
      o.a += o.speed * dt;
      const x = o.cx + Math.cos(o.a) * o.r, z = o.cz + Math.sin(o.a) * o.r;
      const y = o.h + Math.sin(t * 0.4 + o.seed) * 1.5;
      g.position.set(x, y, z);
      const dir = Math.sign(o.speed);
      g.rotation.set(0, -o.a - (dir > 0 ? 0 : Math.PI), dir * 0.25);
      const flapping = Math.sin(t * 0.35 + o.seed) > -0.2;
      const flap = flapping ? Math.sin(t * 7 + o.seed * 3) : 0.12;
      for (const w of g.userData.wings) {
        w.pivot.rotation.z = w.s * flap * 0.5;
        w.outerPivot.rotation.z = w.s * flap * 0.35;
      }
    }
  }
}
