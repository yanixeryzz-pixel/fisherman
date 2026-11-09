import * as THREE from 'three';

// Shared lighting/fog/caustics uniforms and GLSL used by every material, so the
// terrain, fish, diver, water and particles all sit in the same light.

export const LAYER_WATER = 1;
export const SUN_DIR = new THREE.Vector3(-0.34, 0.6, -0.72).normalize();

const lin = (hex, k = 1) => new THREE.Color(hex).multiplyScalar(k);

export const U = {
  uTime: { value: 0 },
  uWaterLevel: { value: 0 },
  uCamUnder: { value: 0 },
  uFogColor: { value: lin('#1C9AAE') },
  uFogDensity: { value: 0.04 },
  uAirFogColor: { value: lin('#EADFCB') },
  uAirFogDensity: { value: 0.0011 },
  uSunDir: { value: SUN_DIR.clone() },
  uSunColor: { value: lin('#FFE4BC', 2.2) },
  uAmbSky: { value: lin('#9ED8E6', 0.6) },
  uAmbGround: { value: lin('#D9B98A', 0.32) },
  uCaustics: { value: 1 },
  uAbsorb: { value: new THREE.Vector3(0.1, 0.042, 0.028) },
  uLampPos: { value: new THREE.Vector3() },
  uLampDir: { value: new THREE.Vector3(0, 0, -1) },
  uLampColor: { value: new THREE.Color(0, 0, 0) },
  uLampCos: { value: 0.84 },
  uLampRange: { value: 0 },
  uPlayerPos: { value: new THREE.Vector3(0, 100, 0) },
  uSkyZenith: { value: lin('#56B6DA') },
  uSkyHorizon: { value: lin('#FBE9D0') },
  uSkyGround: { value: lin('#CFE3DA') },
};

// Spread keeps references to the same {value} objects, so updates propagate everywhere.
export const shared = (extra = {}) => ({ ...U, ...extra });

export const UW_PARS = /* glsl */ `
uniform float uTime;
uniform float uWaterLevel;
uniform float uCamUnder;
uniform vec3 uFogColor;
uniform float uFogDensity;
uniform vec3 uAirFogColor;
uniform float uAirFogDensity;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec3 uAmbSky;
uniform vec3 uAmbGround;
uniform float uCaustics;
uniform vec3 uAbsorb;
uniform vec3 uLampPos;
uniform vec3 uLampDir;
uniform vec3 uLampColor;
uniform float uLampCos;
uniform float uLampRange;

vec2 uwHash2(vec2 p) {
  p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)));
  return fract(sin(p) * 43758.5453);
}

// Distance to the nearest Voronoi edge: thin bright lines read as caustics.
float uwCell(vec2 p, float t) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  float f1 = 8.0;
  float f2 = 8.0;
  for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) {
      vec2 g = vec2(float(x), float(y));
      vec2 o = uwHash2(i + g);
      o = 0.5 + 0.42 * sin(t + 6.2831 * o);
      vec2 r = g + o - f;
      float d = dot(r, r);
      if (d < f1) { f2 = f1; f1 = d; } else if (d < f2) { f2 = d; }
    }
  }
  return sqrt(f2) - sqrt(f1);
}

float uwCaustics(vec2 p, float t) {
  vec2 q = p * 0.95;
  q += 0.45 * vec2(sin(q.y * 1.3 + t * 0.7), cos(q.x * 1.1 - t * 0.6));
  float a = uwCell(q, t * 0.9);
  float b = uwCell(q * 1.43 + vec2(4.1, 1.7) + 0.3 * vec2(cos(q.y * 2.1), sin(q.x * 1.9)), t * 1.15 + 1.3);
  float c = smoothstep(0.16, 0.0, a) * 0.85 + smoothstep(0.13, 0.0, b) * 0.6;
  // slow large-scale modulation breaks up the regular network
  return c * (0.55 + 0.45 * sin(p.x * 0.21 + t * 0.3) * sin(p.y * 0.17 - t * 0.25));
}

float uwLamp(vec3 wp, vec3 n) {
  if (uLampRange <= 0.0) return 0.0;
  vec3 L = uLampPos - wp;
  float d = length(L);
  L /= max(d, 1e-3);
  float cone = smoothstep(uLampCos, uLampCos + (1.0 - uLampCos) * 0.6, dot(-L, uLampDir));
  float fall = 1.0 - clamp(d / uLampRange, 0.0, 1.0);
  return cone * fall * fall * (clamp(dot(n, L), 0.0, 1.0) * 0.8 + 0.2);
}

vec3 uwAbsorbCol(vec3 col, float depth) {
  return col * exp(-uAbsorb * max(depth, 0.0));
}

vec3 uwFog(vec3 col, vec3 wp) {
  vec3 dv = wp - cameraPosition;
  float dist = length(dv);
  if (uCamUnder > 0.5) {
    // only the part of the view ray that is under the surface is fogged
    float frac = 1.0;
    if (wp.y > uWaterLevel) frac = clamp((uWaterLevel - cameraPosition.y) / max(wp.y - cameraPosition.y, 1e-3), 0.0, 1.0);
    float f = 1.0 - exp(-uFogDensity * dist * frac);
    float vy = dv.y / max(dist, 1e-3);
    vec3 fc = uFogColor * mix(0.5, 1.4, smoothstep(-0.8, 0.8, vy));
    return mix(col, fc, f);
  }
  float f = 1.0 - exp(-uAirFogDensity * dist);
  f *= exp(-max(wp.y - 2.0, 0.0) * 0.006);
  return mix(col, uAirFogColor, f);
}
`;

export const SKY_PARS = /* glsl */ `
uniform vec3 uSkyZenith;
uniform vec3 uSkyHorizon;
uniform vec3 uSkyGround;
vec3 skyColor(vec3 d) {
  float y = d.y;
  vec3 c = mix(uSkyHorizon, uSkyZenith, pow(smoothstep(0.0, 0.85, max(y, 0.0)), 0.42));
  c = mix(c, uSkyGround, smoothstep(0.0, -0.25, y));
  float s = max(dot(d, uSunDir), 0.0);
  c += uSunColor * (pow(s, 12.0) * 0.04 + pow(s, 96.0) * 0.22);
  return c;
}
`;

const UW_APPLY = /* glsl */ `
{
  vec3 uwN = inverseTransformDirection(normal, viewMatrix);
  float uwDepth = uWaterLevel - vUwWorld.y;
  if (uwDepth > 0.0) {
    #ifdef UW_CAUSTICS
      float cz = uwCaustics(vUwWorld.xz, uTime) * uCaustics;
      cz *= clamp(uwN.y * 0.85 + 0.15, 0.0, 1.0) * exp(-uwDepth * 0.075) * smoothstep(0.0, 0.5, uwDepth);
      outgoingLight += diffuseColor.rgb * uSunColor * cz * 0.55;
    #endif
    outgoingLight = uwAbsorbCol(outgoingLight, uwDepth);
  }
  outgoingLight += diffuseColor.rgb * uLampColor * uwLamp(vUwWorld, uwN);
}
`;

const PROJECT = /* glsl */ `
vec4 uwp = vec4(transformed, 1.0);
#ifdef USE_INSTANCING
  uwp = instanceMatrix * uwp;
#endif
uwp = modelMatrix * uwp;
#ifdef UW_SWAY
{
  float sh = clamp(position.y / uSwayH, 0.0, 1.0);
  sh *= sh;
  float ph = dot(uwp.xz, vec2(0.23, 0.17));
  vec3 off = vec3(sin(uTime * 1.05 + ph + position.y * 0.9), 0.0, 0.7 * cos(uTime * 0.83 + ph * 1.3 + position.y * 0.7)) * uSwayAmp * sh;
  // plants lean away from the swimming diver
  vec3 away = uwp.xyz - uPlayerPos;
  float dd = length(away.xz);
  float push = (1.0 - smoothstep(0.2, 1.8, dd)) * step(abs(away.y), 2.5);
  off.xz += normalize(away.xz + 1e-4) * push * 0.75 * sh;
  uwp.xyz += off;
}
#endif
vUwWorld = uwp.xyz;
vec4 mvPosition = viewMatrix * uwp;
gl_Position = projectionMatrix * mvPosition;
`;

// Adds caustics, depth absorption, the diver's lamp and our own air/water fog to a
// built-in lit material (Standard/Lambert). Optional sway bends plants in the current.
export function patchWorldMaterial(mat, { caustics = true, sway = 0, swayHeight = 1 } = {}) {
  mat.defines = { ...(mat.defines || {}) };
  if (caustics) mat.defines.UW_CAUSTICS = '';
  if (sway) mat.defines.UW_SWAY = '';
  mat.onBeforeCompile = (shader) => {
    for (const k in U) shader.uniforms[k] = U[k];
    shader.uniforms.uSwayAmp = { value: sway };
    shader.uniforms.uSwayH = { value: swayHeight };
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        '#include <common>\nvarying vec3 vUwWorld;\nuniform float uTime;\nuniform float uSwayAmp;\nuniform float uSwayH;\nuniform vec3 uPlayerPos;',
      )
      .replace('#include <project_vertex>', PROJECT);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying vec3 vUwWorld;\n${UW_PARS}`)
      .replace('#include <opaque_fragment>', `${UW_APPLY}\n#include <opaque_fragment>`)
      .replace('#include <fog_fragment>', 'gl_FragColor.rgb = uwFog(gl_FragColor.rgb, vUwWorld);');
  };
  mat.customProgramCacheKey = () => `uw${caustics ? 1 : 0}${sway ? 1 : 0}`;
  return mat;
}
