import * as THREE from 'three';
import { shared, UW_PARS, SUN_DIR } from './shaders.js';
import { waveHeight } from './water.js';
import { mulberry32, range } from './util.js';

const BUBBLE_VS = /* glsl */ `
attribute float aSize;
uniform float uScale;
varying vec3 vWorld;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorld = wp.xyz;
  vec4 mv = viewMatrix * wp;
  gl_Position = projectionMatrix * mv;
  gl_PointSize = aSize > 0.0 ? aSize * uScale / max(-mv.z, 0.1) : 0.0;
}`;

const BUBBLE_FS = /* glsl */ `
${UW_PARS}
varying vec3 vWorld;
void main() {
  vec2 p = gl_PointCoord * 2.0 - 1.0;
  float d = length(p);
  if (d > 1.0) discard;
  float rim = smoothstep(0.55, 0.92, d) * (1.0 - smoothstep(0.92, 1.0, d));
  float hl = smoothstep(0.42, 0.0, length(p - vec2(-0.35, -0.35)));
  vec3 col = mix(vec3(0.7, 0.95, 1.0), vec3(1.0), hl) * (0.55 + uSunColor * 0.3);
  col = uwFog(col, vWorld);
  float a = (rim * 0.75 + hl * 0.9 + 0.05) * (1.0 - smoothstep(25.0, 45.0, length(vWorld - cameraPosition)));
  gl_FragColor = vec4(col, a);
}`;

const PLANKTON_VS = /* glsl */ `
attribute float aSeed;
uniform float uTime;
uniform float uBox;
uniform float uScale;
uniform float uWaterLevel;
varying float vA;
varying float vSeed;
varying vec3 vWorld;
void main() {
  vec3 p = position + vec3(sin(uTime * 0.21 + aSeed * 12.0) * 0.6, uTime * 0.05 + sin(uTime * 0.3 + aSeed * 7.0) * 0.3, cos(uTime * 0.17 + aSeed * 9.0) * 0.6);
  vec3 c = cameraPosition;
  p = mod(p - c + uBox * 0.5, uBox) - uBox * 0.5 + c;
  vec3 rel = (p - c) / uBox;
  float edge = 1.0 - smoothstep(0.32, 0.5, max(max(abs(rel.x), abs(rel.y)), abs(rel.z)));
  vA = edge * step(p.y, uWaterLevel - 0.15);
  vSeed = aSeed;
  vWorld = p;
  vec4 mv = viewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = (0.02 + aSeed * 0.03) * uScale / max(-mv.z, 0.2);
}`;

const PLANKTON_FS = /* glsl */ `
${UW_PARS}
varying float vA;
varying float vSeed;
varying vec3 vWorld;
void main() {
  vec2 p = gl_PointCoord * 2.0 - 1.0;
  float d = dot(p, p);
  if (d > 1.0 || vA <= 0.0) discard;
  float depth = uWaterLevel - vWorld.y;
  vec3 col = mix(vec3(1.0, 0.92, 0.75) * 0.7, vec3(0.3, 1.0, 0.86) * 1.8, smoothstep(10.0, 24.0, depth));
  float tw = 0.6 + 0.4 * sin(uTime * (1.0 + vSeed * 3.0) + vSeed * 40.0);
  float a = (1.0 - d) * vA * tw * 0.6 * exp(-uFogDensity * length(vWorld - cameraPosition) * 0.8);
  gl_FragColor = vec4(col, a);
}`;

const SPARK_VS = /* glsl */ `
attribute float aSize;
attribute vec4 aColor;
uniform float uScale;
varying vec4 vColor;
void main() {
  vColor = aColor;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = aSize > 0.0 ? aSize * uScale / max(-mv.z, 0.1) : 0.0;
}`;

const SPARK_FS = /* glsl */ `
varying vec4 vColor;
void main() {
  vec2 p = gl_PointCoord * 2.0 - 1.0;
  float d = length(p);
  if (d > 1.0) discard;
  float core = smoothstep(1.0, 0.0, d);
  float star = max(smoothstep(0.18, 0.0, abs(p.x)) , smoothstep(0.18, 0.0, abs(p.y))) * (1.0 - d);
  gl_FragColor = vec4(vColor.rgb, vColor.a * (core * core + star * 0.6));
}`;

const RAY_VS = /* glsl */ `
attribute float aSeed;
varying vec2 vUv;
varying vec3 vWorld;
varying float vSeed;
void main() {
  vUv = uv;
  vSeed = aSeed;
  vec4 wp = modelMatrix * instanceMatrix * vec4(position, 1.0);
  vWorld = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;

const RAY_FS = /* glsl */ `
${UW_PARS}
uniform float uVis;
varying vec2 vUv;
varying vec3 vWorld;
varying float vSeed;
void main() {
  float across = pow(sin(3.14159 * vUv.x), 3.0);
  float along = smoothstep(0.0, 0.75, vUv.y) * (1.0 - 0.85 * smoothstep(0.82, 1.0, vUv.y));
  float flick = 0.55 + 0.45 * sin(uTime * 0.6 + vSeed * 31.0 + vUv.x * 2.0) * sin(uTime * 0.37 + vSeed * 17.0);
  float dist = length(vWorld - cameraPosition);
  float a = across * along * flick * smoothstep(3.0, 7.0, dist) * (1.0 - smoothstep(16.0, 28.0, dist)) * uVis * 0.13;
  vec3 col = mix(vec3(0.7, 1.0, 0.95), vec3(1.0, 0.95, 0.82), vUv.y) * uSunColor * 0.6;
  gl_FragColor = vec4(col, a);
}`;

const BEAM_VS = /* glsl */ `
varying float vT;
varying vec3 vN;
varying vec3 vView;
void main() {
  vT = position.z / 10.0;
  vN = normalize(normalMatrix * normal);
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vView = -mv.xyz;
  gl_Position = projectionMatrix * mv;
}`;

const BEAM_FS = /* glsl */ `
uniform float uBeam;
uniform vec3 uBeamCol;
varying float vT;
varying vec3 vN;
varying vec3 vView;
void main() {
  float f = abs(dot(normalize(vN), normalize(vView)));
  float a = pow(1.0 - clamp(vT, 0.0, 1.0), 1.6) * pow(f, 2.0) * uBeam * 0.22;
  gl_FragColor = vec4(uBeamCol, a);
}`;

export class FX {
  constructor(scene) {
    this.scene = scene;
    this.rng = mulberry32(99);
    this.pointScale = { value: 800 };
    this.t = 0;
    this._bubbles();
    this._plankton();
    this._sparks();
    this._rays();
    this._beam();
  }

  setViewport(heightPx, fovDeg) {
    this.pointScale.value = heightPx / (2 * Math.tan(THREE.MathUtils.degToRad(fovDeg) / 2));
  }

  _bubbles() {
    const N = (this.bN = 420);
    this.b = { pos: new Float32Array(N * 3), vel: new Float32Array(N * 3), size: new Float32Array(N), ph: new Float32Array(N) };
    this.bNext = 0;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.b.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aSize', new THREE.BufferAttribute(this.b.size, 1).setUsage(THREE.DynamicDrawUsage));
    const m = new THREE.ShaderMaterial({ uniforms: shared({ uScale: this.pointScale }), vertexShader: BUBBLE_VS, fragmentShader: BUBBLE_FS, transparent: true, depthWrite: false });
    this.bubbles = new THREE.Points(g, m);
    this.bubbles.frustumCulled = false;
    this.scene.add(this.bubbles);
  }

  bubble(x, y, z, size, vx = 0, vy = 0, vz = 0) {
    const i = this.bNext;
    this.bNext = (i + 1) % this.bN;
    this.b.pos.set([x, y, z], i * 3);
    this.b.vel.set([vx, vy, vz], i * 3);
    this.b.size[i] = size;
    this.b.ph[i] = this.rng() * 6.28;
  }

  burst(p, count, spread = 0.15, sMin = 0.012, sMax = 0.05, v = 0.4) {
    const r = this.rng;
    for (let i = 0; i < count; i++) {
      this.bubble(p.x + range(r, -spread, spread), p.y + range(r, -spread, spread), p.z + range(r, -spread, spread), range(r, sMin, sMax), range(r, -v, v), range(r, 0, v), range(r, -v, v));
    }
  }

  _plankton() {
    const N = 1600, box = 34;
    const pos = new Float32Array(N * 3), seed = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      pos.set([range(this.rng, -box / 2, box / 2), range(this.rng, -box / 2, box / 2), range(this.rng, -box / 2, box / 2)], i * 3);
      seed[i] = this.rng();
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
    const m = new THREE.ShaderMaterial({
      uniforms: shared({ uBox: { value: box }, uScale: this.pointScale }),
      vertexShader: PLANKTON_VS, fragmentShader: PLANKTON_FS, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    this.plankton = new THREE.Points(g, m);
    this.plankton.frustumCulled = false;
    this.scene.add(this.plankton);
  }

  _sparks() {
    const N = (this.sN = 360);
    this.s = { pos: new Float32Array(N * 3), vel: new Float32Array(N * 3), size: new Float32Array(N), col: new Float32Array(N * 4), life: new Float32Array(N), max: new Float32Array(N), grav: new Float32Array(N) };
    this.sNext = 0;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.s.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aSize', new THREE.BufferAttribute(this.s.size, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aColor', new THREE.BufferAttribute(this.s.col, 4).setUsage(THREE.DynamicDrawUsage));
    const m = new THREE.ShaderMaterial({ uniforms: { uScale: this.pointScale }, vertexShader: SPARK_VS, fragmentShader: SPARK_FS, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    this.sparks = new THREE.Points(g, m);
    this.sparks.frustumCulled = false;
    this.scene.add(this.sparks);
  }

  spark(p, v, size, color, life, grav) {
    const i = this.sNext;
    this.sNext = (i + 1) % this.sN;
    const s = this.s;
    s.pos.set([p.x, p.y, p.z], i * 3);
    s.vel.set([v.x, v.y, v.z], i * 3);
    s.size[i] = size;
    s.col.set([color.r, color.g, color.b, 1], i * 4);
    s.life[i] = s.max[i] = life;
    s.grav[i] = grav;
  }

  splash(p, strength = 1) {
    const r = this.rng;
    const white = new THREE.Color(1.6, 1.7, 1.7);
    const v = new THREE.Vector3();
    for (let i = 0; i < 70 * strength; i++) {
      const a = r() * 6.28, sp = range(r, 0.8, 3.2) * strength;
      v.set(Math.cos(a) * sp * 0.6, range(r, 2, 5.5) * strength, Math.sin(a) * sp * 0.6);
      this.spark({ x: p.x + Math.cos(a) * 0.3, y: 0.05, z: p.z + Math.sin(a) * 0.3 }, v, range(r, 0.04, 0.11), white, range(r, 0.6, 1.2), 9.8);
    }
    this.burst({ x: p.x, y: -0.8, z: p.z }, 40 * strength, 0.6, 0.015, 0.07, 0.8);
  }

  sparkle(p, color) {
    const r = this.rng;
    const v = new THREE.Vector3();
    const c = new THREE.Color(color).multiplyScalar(2.2);
    for (let i = 0; i < 26; i++) {
      v.set(range(r, -1, 1), range(r, -0.4, 1.2), range(r, -1, 1)).multiplyScalar(range(r, 0.4, 1.4));
      this.spark(p, v, range(r, 0.05, 0.12), c, range(r, 0.5, 1.1), -0.4);
    }
  }

  _rays() {
    const N = 16;
    const geo = new THREE.PlaneGeometry(1, 1);
    geo.translate(0, -0.5, 0);
    const seeds = new Float32Array(N);
    for (let i = 0; i < N; i++) seeds[i] = this.rng();
    geo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seeds, 1));
    this.rayMat = new THREE.ShaderMaterial({ uniforms: shared({ uVis: { value: 0 } }), vertexShader: RAY_VS, fragmentShader: RAY_FS, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
    this.rays = new THREE.InstancedMesh(geo, this.rayMat, N);
    this.rays.frustumCulled = false;
    this.rayData = Array.from({ length: N }, () => ({ x: 1e9, z: 1e9, w: 1, len: 20 }));
    this.scene.add(this.rays);
    this.rayDir = new THREE.Vector3(-SUN_DIR.x * 0.45, -1, -SUN_DIR.z * 0.45).normalize();
  }

  _beam() {
    const g = new THREE.CylinderGeometry(0.06, 2.4, 10, 20, 1, true);
    g.translate(0, -5, 0);
    g.rotateX(-Math.PI / 2);
    this.beamMat = new THREE.ShaderMaterial({
      uniforms: { uBeam: { value: 0 }, uBeamCol: { value: new THREE.Color('#FFF1D6') } },
      vertexShader: BEAM_VS, fragmentShader: BEAM_FS, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    });
    this.beam = new THREE.Mesh(g, this.beamMat);
    this.beam.frustumCulled = false;
    this.scene.add(this.beam);
  }

  setBeam(origin, dir, strength, length) {
    this.beam.position.copy(origin);
    this.beam.lookAt(origin.x + dir.x, origin.y + dir.y, origin.z + dir.z);
    this.beam.scale.set(length / 10, length / 10, length / 10);
    this.beamMat.uniforms.uBeam.value = strength;
    this.beam.visible = strength > 0.01;
  }

  update(dt, t, camera, under, camDepth) {
    this.t = t;
    // bubbles rise, wobble and pop at the surface
    const b = this.b;
    for (let i = 0; i < this.bN; i++) {
      const s = b.size[i];
      if (s <= 0) continue;
      const k = i * 3;
      b.vel[k + 1] = Math.min(b.vel[k + 1] + (0.9 + s * 14) * dt, 0.6 + s * 9);
      const drag = Math.exp(-1.6 * dt);
      b.vel[k] *= drag;
      b.vel[k + 2] *= drag;
      b.pos[k] += (b.vel[k] + Math.sin(t * 6 + b.ph[i]) * 0.18) * dt;
      b.pos[k + 1] += b.vel[k + 1] * dt;
      b.pos[k + 2] += (b.vel[k + 2] + Math.cos(t * 5 + b.ph[i]) * 0.18) * dt;
      if (b.pos[k + 1] > waveHeight(b.pos[k], b.pos[k + 2], t) - 0.04) b.size[i] = 0;
    }
    this.bubbles.geometry.attributes.position.needsUpdate = true;
    this.bubbles.geometry.attributes.aSize.needsUpdate = true;

    const s = this.s;
    for (let i = 0; i < this.sN; i++) {
      if (s.life[i] <= 0) continue;
      s.life[i] -= dt;
      const k = i * 3;
      s.vel[k + 1] -= s.grav[i] * dt;
      const drag = Math.exp(-(s.grav[i] > 0 ? 0.3 : 2.5) * dt);
      for (let a = 0; a < 3; a++) {
        s.vel[k + a] *= drag;
        s.pos[k + a] += s.vel[k + a] * dt;
      }
      // droplets vanish into the sea
      if (s.grav[i] > 0 && s.pos[k + 1] < waveHeight(s.pos[k], s.pos[k + 2], t) && s.vel[k + 1] < 0) s.life[i] = 0;
      s.col[i * 4 + 3] = Math.max(0, s.life[i] / s.max[i]);
      if (s.life[i] <= 0) s.size[i] = 0;
    }
    for (const k of ['position', 'aSize', 'aColor']) this.sparks.geometry.attributes[k].needsUpdate = true;

    this.plankton.visible = under;
    this.rays.visible = under;
    if (under) this._updateRays(camera, camDepth);
  }

  _updateRays(camera, camDepth) {
    const cam = camera.position;
    const fwd = camera.getWorldDirection(new THREE.Vector3());
    const m = new THREE.Matrix4();
    const X = new THREE.Vector3(), Y = this.rayDir.clone().negate(), Z = new THREE.Vector3(), toCam = new THREE.Vector3();
    const r = this.rng;
    this.rayData.forEach((d, i) => {
      if ((d.x - cam.x) ** 2 + (d.z - cam.z) ** 2 > 28 * 28) {
        const a = Math.atan2(fwd.z, fwd.x) + range(r, -1.2, 1.2), dist = range(r, 5, 26);
        d.x = cam.x + Math.cos(a) * dist;
        d.z = cam.z + Math.sin(a) * dist;
        d.w = range(r, 0.5, 1.8);
        d.len = range(r, 10, 22);
      }
      const top = new THREE.Vector3(d.x, -0.1, d.z);
      toCam.subVectors(cam, top);
      X.crossVectors(Y, toCam).normalize();
      Z.crossVectors(X, Y);
      m.makeBasis(X.clone().multiplyScalar(d.w), Y.clone().multiplyScalar(d.len), Z).setPosition(top);
      this.rays.setMatrixAt(i, m);
    });
    this.rays.instanceMatrix.needsUpdate = true;
    this.rayMat.uniforms.uVis.value = Math.exp(-camDepth * 0.055);
  }
}
