import * as THREE from 'three';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import { LAYER_WATER } from './shaders.js';
import { clamp } from './util.js';

// Pipeline: half-res refraction pass (scene without water, with depth) → main MSAA pass
// where the water samples it → bloom → final grade (DOF, LUT, lens drops, grain, vignette).

const VS = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const FINAL_FS = /* glsl */ `
#include <packing>
uniform sampler2D tColor;
uniform sampler2D tDepth;
uniform highp sampler3D tLutA;
uniform highp sampler3D tLutW;
uniform vec2 uRes;
uniform float uNear;
uniform float uFar;
uniform float uTime;
uniform float uUnder;
uniform float uDrops;
uniform float uLow;
uniform float uPressure;
uniform float uFocus;
uniform float uExposure;
varying vec2 vUv;

float h12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
vec2 h22(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.xx + p3.yz) * p3.zy);
}
float viewZ(vec2 uv) {
  return -perspectiveDepthToViewZ(texture2D(tDepth, uv).x, uNear, uFar);
}
// water drops sliding down the mask after surfacing
vec2 drops(vec2 uv) {
  vec2 off = vec2(0.0);
  vec2 asp = vec2(uRes.x / uRes.y, 1.0);
  for (int l = 0; l < 2; l++) {
    float fl = float(l);
    float sc = l == 0 ? 7.0 : 13.0;
    vec2 p = uv * asp * sc;
    p.y += uTime * (0.08 + 0.05 * fl) * sc * 0.25;
    vec2 id = floor(p);
    vec2 c = fract(p) - 0.5 - (h22(id + fl * 17.0) - 0.5) * 0.6;
    float r = 0.14 + 0.14 * h12(id + 5.0);
    float m = smoothstep(r, r * 0.55, length(c * vec2(1.0, 0.85))) * step(0.45, h12(id + 9.1 + fl));
    off += c * m * 0.6 / sc;
  }
  return off;
}
// Khronos PBR Neutral: keeps the brand palette's hues intact while rolling off highlights
vec3 neutralTM(vec3 color) {
  const float startCompression = 0.76;
  const float desaturation = 0.15;
  float x = min(color.r, min(color.g, color.b));
  float offset = x < 0.08 ? x - 6.25 * x * x : 0.04;
  color -= offset;
  float peak = max(color.r, max(color.g, color.b));
  if (peak < startCompression) return color;
  const float d = 1.0 - startCompression;
  float newPeak = 1.0 - d * d / (peak + d - startCompression);
  color *= newPeak / peak;
  float g = 1.0 - 1.0 / (desaturation * (peak - newPeak) + 1.0);
  return mix(color, vec3(newPeak), g);
}
vec3 toSRGB(vec3 c) {
  return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
}
void main() {
  vec2 uv = vUv;
  uv += uUnder * vec2(sin(uv.y * 22.0 + uTime * 1.6), cos(uv.x * 19.0 + uTime * 1.3)) * 0.0016;
  if (uDrops > 0.001) uv += drops(vUv) * uDrops;

  float z = viewZ(uv);
  float far = smoothstep(uFocus * 1.4, uFocus * 5.0 + 6.0, z);
  float near = 1.0 - smoothstep(0.25, 0.9, z);
  float coc = clamp(far * mix(1.6, 3.4, uUnder) + near * 3.0, 0.0, 4.0) * (uRes.y / 1080.0);
  vec3 col = texture2D(tColor, uv).rgb;
  if (coc > 0.35) {
    vec3 acc = col;
    float wsum = 1.0;
    for (int i = 0; i < 12; i++) {
      float a = float(i) * 2.39996;
      float rr = sqrt((float(i) + 0.5) / 12.0);
      vec2 suv = uv + vec2(cos(a), sin(a)) * rr * coc / uRes;
      float w = viewZ(suv) < z - 1.0 ? 0.25 : 1.0;
      acc += texture2D(tColor, suv).rgb * w;
      wsum += w;
    }
    col = acc / wsum;
  }
  vec2 dc = uv - 0.5;
  float ca = (0.0025 + 0.004 * uUnder) * dot(dc, dc) * 4.0;
  col.r = mix(col.r, texture2D(tColor, uv + dc * ca).r, 0.6);
  col.b = mix(col.b, texture2D(tColor, uv - dc * ca).b, 0.6);

  col = toSRGB(clamp(neutralTM(col * uExposure), 0.0, 1.0));
  vec3 lc = col * (31.0 / 32.0) + 0.5 / 32.0;
  col = mix(texture(tLutA, lc).rgb, texture(tLutW, lc).rgb, uUnder);

  float r = length(dc * vec2(1.0, 0.8));
  col *= mix(1.0, smoothstep(0.85, 0.2, r * 1.15), 0.32 + 0.22 * uUnder);
  float pulse = 0.5 + 0.5 * sin(uTime * 5.0);
  float rim = smoothstep(0.35, 0.85, r * 1.3);
  col = mix(col, vec3(1.0, 0.44, 0.37), rim * uLow * (0.3 + 0.35 * pulse));
  col = mix(col, vec3(0.02, 0.07, 0.12), rim * uPressure * (0.55 + 0.2 * pulse));
  col += (h12(gl_FragCoord.xy + fract(uTime * 7.31) * 113.0) - 0.5) * 0.035;
  gl_FragColor = vec4(col, 1.0);
}`;

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const curve = (x, k) => x + (x * x * (3 - 2 * x) - x) * k;
function saturate(o, k) {
  const l = o[0] * 0.2126 + o[1] * 0.7152 + o[2] * 0.0722;
  for (let i = 0; i < 3; i++) o[i] = l + (o[i] - l) * k;
}

// Split-tone grades baked into 3D LUTs: warm sunlit highs / teal shadows above water,
// turquoise highs / deep-blue shadows below.
function gradeAir(r, g, b, o) {
  const l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const sh = (1 - l) * (1 - l), hi = l * l;
  o[0] = r + 0.015 * sh + 0.045 * hi;
  o[1] = g + 0.035 * sh + 0.018 * hi;
  o[2] = b + 0.06 * sh - 0.03 * hi;
  for (let i = 0; i < 3; i++) o[i] = curve(clamp01(o[i]), 0.2);
  saturate(o, 1.08);
  o[0] = o[0] * 0.965 + 0.012;
  o[1] = o[1] * 0.965 + 0.022;
  o[2] = o[2] * 0.965 + 0.035;
}
function gradeWater(r, g, b, o) {
  const l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const sh = (1 - l) * (1 - l), hi = l * l;
  o[0] = r * 0.95 + 0.02 * hi;
  o[1] = g + 0.03 * sh + 0.04 * hi;
  o[2] = b * 1.02 + 0.06 * sh + 0.02 * hi;
  for (let i = 0; i < 3; i++) o[i] = curve(clamp01(o[i]), 0.16);
  saturate(o, 1.12);
  o[0] = o[0] * 0.97 + 0.004;
  o[1] = o[1] * 0.97 + 0.03;
  o[2] = o[2] * 0.97 + 0.05;
}

function makeLUT(grade, N = 32) {
  const data = new Uint8Array(N * N * N * 4);
  const o = [0, 0, 0];
  let i = 0;
  for (let b = 0; b < N; b++) {
    for (let g = 0; g < N; g++) {
      for (let r = 0; r < N; r++) {
        grade(r / (N - 1), g / (N - 1), b / (N - 1), o);
        data[i++] = Math.round(clamp01(o[0]) * 255);
        data[i++] = Math.round(clamp01(o[1]) * 255);
        data[i++] = Math.round(clamp01(o[2]) * 255);
        data[i++] = 255;
      }
    }
  }
  const tex = new THREE.Data3DTexture(data, N, N, N);
  tex.format = THREE.RGBAFormat;
  tex.type = THREE.UnsignedByteType;
  tex.minFilter = tex.magFilter = THREE.LinearFilter;
  tex.wrapS = tex.wrapT = tex.wrapR = THREE.ClampToEdgeWrapping;
  tex.unpackAlignment = 1;
  tex.needsUpdate = true;
  return tex;
}

export class Post {
  constructor(renderer, scene, camera, { samples = 4 } = {}) {
    this.renderer = renderer;
    this.scene = scene;
    this.camera = camera;
    const hf = THREE.HalfFloatType;
    this.refrRT = new THREE.WebGLRenderTarget(1, 1, { type: hf, depthTexture: new THREE.DepthTexture(1, 1) });
    this.sceneRT = new THREE.WebGLRenderTarget(1, 1, { type: hf, samples, depthTexture: new THREE.DepthTexture(1, 1) });
    this.postRT = new THREE.WebGLRenderTarget(1, 1, { type: hf });
    this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.32, 0.45, 1.05);
    this.copy = new FullScreenQuad(new THREE.ShaderMaterial({
      uniforms: { tDiffuse: { value: null } },
      vertexShader: VS,
      fragmentShader: 'uniform sampler2D tDiffuse; varying vec2 vUv; void main() { gl_FragColor = texture2D(tDiffuse, vUv); }',
      depthTest: false,
      depthWrite: false,
    }));
    this.uniforms = {
      tColor: { value: this.postRT.texture },
      tDepth: { value: this.sceneRT.depthTexture },
      tLutA: { value: makeLUT(gradeAir) },
      tLutW: { value: makeLUT(gradeWater) },
      uRes: { value: new THREE.Vector2(1, 1) },
      uNear: { value: camera.near },
      uFar: { value: camera.far },
      uTime: { value: 0 },
      uUnder: { value: 0 },
      uDrops: { value: 0 },
      uLow: { value: 0 },
      uPressure: { value: 0 },
      uFocus: { value: 4 },
      uExposure: { value: 1.0 },
    };
    this.final = new FullScreenQuad(new THREE.ShaderMaterial({ uniforms: this.uniforms, vertexShader: VS, fragmentShader: FINAL_FS, depthTest: false, depthWrite: false }));
    this.size = new THREE.Vector2(1, 1);
  }

  setSize(w, h, pr) {
    const W = Math.max(1, Math.floor(w * pr)), H = Math.max(1, Math.floor(h * pr));
    this.size.set(W, H);
    this.sceneRT.setSize(W, H);
    this.postRT.setSize(W, H);
    this.refrRT.setSize(Math.max(1, W >> 1), Math.max(1, H >> 1));
    this.bloom.setSize(W, H);
    this.uniforms.uRes.value.set(W, H);
    return this.size;
  }

  render(dt, t, sky, water, p) {
    const r = this.renderer, cam = this.camera, u = this.uniforms;
    water.material.uniforms.tRefr.value = this.refrRT.texture;
    water.material.uniforms.tDepth.value = this.refrRT.depthTexture;
    water.material.uniforms.uRes.value.copy(this.size);

    sky.material.uniforms.uPass.value = 0;
    cam.layers.set(0);
    r.shadowMap.needsUpdate = true;
    r.setRenderTarget(this.refrRT);
    r.render(this.scene, cam);

    sky.material.uniforms.uPass.value = 1;
    cam.layers.enable(LAYER_WATER);
    r.setRenderTarget(this.sceneRT);
    r.render(this.scene, cam);
    cam.layers.set(0);

    this.copy.material.uniforms.tDiffuse.value = this.sceneRT.texture;
    r.setRenderTarget(this.postRT);
    this.copy.render(r);
    this.bloom.render(r, null, this.postRT, dt, false);

    u.uTime.value = t;
    u.uUnder.value = p.under;
    u.uDrops.value = p.drops;
    u.uLow.value = p.low;
    u.uPressure.value = clamp(p.pressure, 0, 1);
    u.uFocus.value = p.focus;
    u.uNear.value = cam.near;
    u.uFar.value = cam.far;
    r.setRenderTarget(null);
    this.final.render(r);
  }
}
