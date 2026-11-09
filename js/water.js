import * as THREE from 'three';
import { shared, UW_PARS, SKY_PARS, LAYER_WATER, U } from './shaders.js';
import { PALETTE } from './config.js';

// Same wave set drives the GPU surface and CPU buoyancy, so the diver bobs on the waves you see.
const WAVES = [
  { dir: [0.96, 0.28], k: 0.28, w: 0.85, a: 0.12 },
  { dir: [-0.37, 0.93], k: 0.46, w: 1.1, a: 0.065 },
  { dir: [0.8, -0.6], k: 0.92, w: 1.65, a: 0.03 },
  { dir: [-0.93, -0.36], k: 1.6, w: 2.3, a: 0.016 },
].map((w) => {
  const l = Math.hypot(w.dir[0], w.dir[1]);
  return { ...w, dir: [w.dir[0] / l, w.dir[1] / l], len: (Math.PI * 2) / w.k };
});

export function waveHeight(x, z, t = U.uTime.value) {
  let h = 0;
  for (const w of WAVES) h += w.a * Math.sin((w.dir[0] * x + w.dir[1] * z) * w.k + t * w.w);
  return h;
}

const f = (v) => v.toFixed(5);
const WAVE_GLSL = /* glsl */ `
float waveH(vec2 p, float t, float cd, out vec2 grad) {
  float h = 0.0;
  grad = vec2(0.0);
  ${WAVES.map((w) => `{
    vec2 d = vec2(${f(w.dir[0])}, ${f(w.dir[1])});
    float A = ${f(w.a)} * (1.0 - smoothstep(${f(w.len * 5)}, ${f(w.len * 14)}, cd));
    float ph = dot(d, p) * ${f(w.k)} + t * ${f(w.w)};
    h += A * sin(ph);
    grad += A * ${f(w.k)} * cos(ph) * d;
  }`).join('\n')}
  return h;
}`;

const VERT = /* glsl */ `
uniform float uTime;
uniform vec4 uRipples[8];
varying vec3 vWorld;
varying vec3 vNormalW;
varying float vRipple;
varying float vViewZ;
${WAVE_GLSL}
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  float cd = length(wp.xz - cameraPosition.xz);
  vec2 g;
  float h = waveH(wp.xz, uTime, cd, g);
  float rip = 0.0;
  vec2 rg = vec2(0.0);
  float rf = 0.0;
  for (int i = 0; i < 8; i++) {
    vec4 R = uRipples[i];
    float age = uTime - R.z;
    if (R.w <= 0.0 || age < 0.0 || age > 3.5) continue;
    vec2 dd = wp.xz - R.xy;
    float dist = length(dd) + 1e-4;
    float x = dist - age * 2.2;
    float env = exp(-x * x * 2.0) * exp(-age * 1.3) * R.w;
    rip += env * sin(x * 6.0) * 0.1;
    rg += env * cos(x * 6.0) * 0.6 * (dd / dist);
    rf += env;
  }
  wp.y += h + rip;
  vNormalW = normalize(vec3(-(g.x + rg.x), 1.0, -(g.y + rg.y)));
  vRipple = rf;
  vWorld = wp.xyz;
  vec4 mv = viewMatrix * wp;
  vViewZ = mv.z;
  gl_Position = projectionMatrix * mv;
}`;

const FRAG = /* glsl */ `
#include <packing>
uniform sampler2D tRefr;
uniform sampler2D tDepth;
uniform vec2 uRes;
uniform float uNear;
uniform float uFar;
uniform vec3 uShallow;
uniform vec3 uDeepCol;
uniform vec3 uFoamCol;
${UW_PARS}
${SKY_PARS}
varying vec3 vWorld;
varying vec3 vNormalW;
varying float vRipple;
varying float vViewZ;

float sceneZ(vec2 uv) {
  return -perspectiveDepthToViewZ(texture2D(tDepth, uv).x, uNear, uFar);
}
float wHash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(wHash(i), wHash(i + vec2(1.0, 0.0)), f.x), mix(wHash(i + vec2(0.0, 1.0)), wHash(i + vec2(1.0)), f.x), f.y);
}
vec2 detailGrad(vec2 p, float t) {
  vec2 g = vec2(0.0);
  vec2 d1 = vec2(0.86, 0.5);   g += d1 * cos(dot(p, d1) * 3.1 + t * 2.7) * 0.155;
  vec2 d2 = vec2(-0.6, 0.8);   g += d2 * cos(dot(p, d2) * 4.7 - t * 3.3) * 0.141;
  vec2 d3 = vec2(0.2, -0.98);  g += d3 * cos(dot(p, d3) * 7.3 + t * 4.1) * 0.117;
  vec2 d4 = vec2(-0.95, -0.3); g += d4 * cos(dot(p, d4) * 11.0 - t * 5.0) * 0.088;
  return g;
}

void main() {
  vec2 suv = gl_FragCoord.xy / uRes;
  vec3 toCam = cameraPosition - vWorld;
  float dist = length(toCam);
  vec3 V = toCam / dist;
  vec2 dg = detailGrad(vWorld.xz, uTime) * mix(0.55, 0.0, smoothstep(15.0, 110.0, dist));
  vec3 n = normalize(vNormalW + vec3(-dg.x, 0.0, -dg.y));
  float waterZ = -vViewZ;
  float nz = vnoise(vWorld.xz * 1.3 + vec2(uTime * 0.15, -uTime * 0.1));
  vec3 col;

  if (cameraPosition.y > vWorld.y) {
    float sz = sceneZ(suv);
    float thick = max(sz - waterZ, 0.0);
    vec2 off = n.xz * 0.035 * smoothstep(0.0, 2.0, thick) / max(1.0, dist * 0.05);
    vec2 ruv = clamp(suv + off, 0.001, 0.999);
    float sz2 = sceneZ(ruv);
    if (sz2 < waterZ) { ruv = suv; sz2 = sz; }
    float th = max(sz2 - waterZ, 0.0);

    vec3 refr = texture2D(tRefr, ruv).rgb;
    vec3 T = exp(-vec3(0.36, 0.085, 0.06) * th);
    float scat = 1.0 - exp(-0.22 * th);
    vec3 waterCol = mix(uShallow, uDeepCol, smoothstep(0.5, 7.0, th));
    vec3 body = refr * T + waterCol * scat * (0.55 + 0.45 * uSunDir.y);

    vec3 R = reflect(-V, n);
    R.y = abs(R.y);
    vec3 refl = skyColor(R);
    float fres = 0.02 + 0.98 * pow(1.0 - clamp(dot(n, V), 0.0, 1.0), 5.0);
    col = mix(body, refl, clamp(fres, 0.0, 0.85));

    float sd = max(dot(R, uSunDir), 0.0);
    float glint = pow(sd, 900.0) * 30.0 + pow(sd, 120.0) * 0.18 + smoothstep(0.9965, 0.9995, sd) * 4.0;
    col += uSunColor * glint;

    // hand-drawn foam: shoreline, intersections, bands rolling to the beach and ripple rings
    float edge = 1.0 - smoothstep(0.0, 0.45, thick);
    float bands = smoothstep(0.62, 0.7, fract(thick * 0.8 - uTime * 0.22 + nz * 0.35)) * (1.0 - smoothstep(0.2, 2.2, thick));
    float foam = edge * (0.55 + 0.6 * nz) + bands * 0.8 + vRipple * (0.35 + nz * 0.7);
    foam = smoothstep(0.48, 0.56, foam);
    vec3 foamLit = uFoamCol * (0.65 + 0.5 * max(dot(n, uSunDir), 0.0));
    col = mix(col, foamLit, foam * 0.92);
  } else {
    // from below: Snell's window shows the sky, outside it total internal reflection
    vec3 d = -V;
    float c = dot(d, n);
    float win = smoothstep(0.62, 0.76, c);
    vec3 above = texture2D(tRefr, clamp(suv + n.xz * 0.06, 0.001, 0.999)).rgb;
    vec3 tir = uFogColor * 0.85;
    col = mix(tir, above * 1.1, win);
    col += uFogColor * 0.7 * smoothstep(0.45, 0.66, c) * (1.0 - win);
    col = mix(col, uFoamCol * 1.2, smoothstep(0.5, 0.6, vRipple * (0.4 + nz)) * 0.6);
  }
  col = uwFog(col, vWorld);
  gl_FragColor = vec4(col, 1.0);
}`;

// Polar grid that follows the camera: dense under the player, sparse at the horizon.
function polarGrid(rings = 82, segs = 192) {
  const radii = [0];
  let r = 0, step = 0.45;
  for (let i = 0; i < rings; i++) {
    r += step;
    radii.push(r);
    step *= 1.075;
  }
  const pos = [0, 0, 0];
  for (let i = 1; i < radii.length; i++) {
    for (let j = 0; j < segs; j++) {
      const a = (j / segs) * Math.PI * 2;
      pos.push(Math.cos(a) * radii[i], 0, Math.sin(a) * radii[i]);
    }
  }
  const idx = [];
  for (let j = 0; j < segs; j++) idx.push(0, 1 + ((j + 1) % segs), 1 + j);
  for (let i = 1; i < radii.length - 1; i++) {
    const a0 = 1 + (i - 1) * segs, a1 = 1 + i * segs;
    for (let j = 0; j < segs; j++) {
      const j1 = (j + 1) % segs;
      idx.push(a0 + j, a0 + j1, a1 + j, a0 + j1, a1 + j1, a1 + j);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  return g;
}

export class Water {
  constructor(scene) {
    this.ripples = Array.from({ length: 8 }, () => new THREE.Vector4(0, 0, -100, 0));
    this.rippleIdx = 0;
    this.material = new THREE.ShaderMaterial({
      uniforms: shared({
        tRefr: { value: null },
        tDepth: { value: null },
        uRes: { value: new THREE.Vector2(1, 1) },
        uNear: { value: 0.1 },
        uFar: { value: 3000 },
        uShallow: { value: new THREE.Color('#5FE3D2') },
        uDeepCol: { value: new THREE.Color('#0B4C76') },
        uFoamCol: { value: new THREE.Color(PALETTE.foam) },
        uRipples: { value: this.ripples },
      }),
      vertexShader: VERT,
      fragmentShader: FRAG,
      side: THREE.DoubleSide,
    });
    this.mesh = new THREE.Mesh(polarGrid(), this.material);
    this.mesh.frustumCulled = false;
    this.mesh.layers.set(LAYER_WATER);
    scene.add(this.mesh);
  }

  addRipple(x, z, strength = 1) {
    this.ripples[this.rippleIdx].set(x, z, U.uTime.value, strength);
    this.rippleIdx = (this.rippleIdx + 1) % this.ripples.length;
  }

  heightAt(x, z) {
    return waveHeight(x, z);
  }

  update(camera) {
    this.mesh.position.set(camera.position.x, 0, camera.position.z);
    this.material.uniforms.uNear.value = camera.near;
    this.material.uniforms.uFar.value = camera.far;
  }
}
