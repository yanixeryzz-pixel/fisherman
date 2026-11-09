import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { PALETTE, WORLD } from './config.js';
import { patchWorldMaterial, SUN_DIR } from './shaders.js';
import { waveHeight } from './water.js';
import { mulberry32, range, fbm, noise2, smoothstep } from './util.js';

const C = (hex) => new THREE.Color(hex);
const UP = new THREE.Vector3(0, 1, 0);

// ---------------------------------------------------------------- terrain

export const shoreZ = (x) => 26 + 3.2 * Math.sin(x * 0.045) + 1.6 * Math.sin(x * 0.11 + 1.3);

export function groundY(x, z) {
  const d = shoreZ(x) - z; // distance offshore
  let y;
  if (d <= 0) {
    const l = -d;
    y = Math.min(l * 0.17, 1.7) + smoothstep(9, 30, l) * 2.4 + fbm(x * 0.06, z * 0.06, 3) * 0.9 * smoothstep(6, 22, l);
  } else {
    y = -(4.2 * smoothstep(0, 21, d) + 5.2 * smoothstep(17, 56, d) + 9.8 * smoothstep(52, 79, d) + 7 * smoothstep(80, 122, d) + 10 * smoothstep(118, 158, d));
    y += fbm(x * 0.035 + 3.1, z * 0.035 - 1.7, 4) * (0.5 + smoothstep(10, 90, d) * 2.2) * smoothstep(0, 8, d);
    y += 0.08 * Math.sin(x * 0.85 + z * 0.33 + fbm(x * 0.1, z * 0.1, 2) * 3) * smoothstep(3, 10, d) * (1 - smoothstep(45, 70, d));
  }
  // the cove walls close the bay on both sides as low rocky headlands
  const side = Math.max(0, Math.abs(x) - 54);
  return y + smoothstep(0, 26, side) * (13 + fbm(x * 0.05, z * 0.05, 3) * 6) + Math.min(side, 6) * 0.4;
}

export function groundNormal(x, z, out = new THREE.Vector3()) {
  const e = 0.5;
  return out.set(groundY(x - e, z) - groundY(x + e, z), 2 * e, groundY(x, z - e) - groundY(x, z + e)).normalize();
}

export function pierDeckAt(x, z) {
  const p = WORLD.pier;
  return x > p.x0 && x < p.x1 && z > p.z0 && z < p.z1 ? p.deckY : -Infinity;
}

export const walkableY = (x, z) => Math.max(groundY(x, z), pierDeckAt(x, z));

// ---------------------------------------------------------------- helpers

function paint(geo, fn) {
  const pos = geo.attributes.position;
  const arr = new Float32Array(pos.count * 3);
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    fn(pos.getX(i), pos.getY(i), pos.getZ(i), c, i);
    arr[i * 3] = c.r;
    arr[i * 3 + 1] = c.g;
    arr[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return geo;
}
const solid = (geo, color) => paint(geo, (x, y, z, c) => c.copy(color));

function clean(g) {
  const out = g.index ? g.toNonIndexed() : g;
  for (const k of Object.keys(out.attributes)) if (!['position', 'normal', 'color'].includes(k)) out.deleteAttribute(k);
  if (!out.attributes.normal) out.computeVertexNormals();
  return out;
}
const merge = (parts) => mergeGeometries(parts.map(clean));

function stdMat(opts = {}, patch = {}) {
  return patchWorldMaterial(
    new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.9, metalness: 0, ...opts }),
    patch,
  );
}

function instanced(geo, mat, list, { cast = true, receive = true } = {}) {
  const mesh = new THREE.InstancedMesh(geo, mat, Math.max(1, list.length));
  const m = new THREE.Matrix4();
  list.forEach((it, i) => mesh.setMatrixAt(i, m.compose(it.p, it.q, it.s)));
  mesh.count = list.length;
  mesh.castShadow = cast;
  mesh.receiveShadow = receive;
  mesh.computeBoundingSphere();
  return mesh;
}

const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
function place(x, y, z, sx, sy, sz, yaw = 0, tiltX = 0, tiltZ = 0) {
  return {
    p: new THREE.Vector3(x, y, z),
    q: new THREE.Quaternion().setFromEuler(_e.set(tiltX, yaw, tiltZ)),
    s: new THREE.Vector3(sx, sy, sz),
  };
}
function alignedPlace(x, z, s, sy, yaw, sink, rng, align = 0.6) {
  const n = groundNormal(x, z);
  const up = UP.clone().lerp(n, align).normalize();
  const q = new THREE.Quaternion().setFromUnitVectors(UP, up).multiply(_q.setFromAxisAngle(UP, yaw));
  return { p: new THREE.Vector3(x, groundY(x, z) - sink, z), q, s: new THREE.Vector3(s, sy, s) };
}

const nearPier = (x, z, m = 2.2) => x > WORLD.pier.x0 - m && x < WORLD.pier.x1 + m && z > WORLD.pier.z0 - m - 1;

// ---------------------------------------------------------------- terrain mesh

const T = {
  dry: C('#F6DFB3'), dune: C('#E8C690'), wet: C('#C9A676'), sand: C('#EEDAB0'), sandCool: C('#D7D2B6'),
  rock: C('#90A09A'), grass: C('#79A98E'), cliff: C('#B49A7C'),
};

function terrainColor(x, y, z, c) {
  const n = fbm(x * 0.08, z * 0.08, 3);
  if (y > 0.3) {
    c.copy(T.dry).lerp(T.dune, smoothstep(1.4, 4.2, y) * 0.75 + n * 0.25);
    c.lerp(T.wet, 1 - smoothstep(0.3, 0.75, y));
    const side = Math.max(0, Math.abs(x) - 56);
    if (side > 3) c.lerp(T.cliff, smoothstep(3, 9, side) * 0.8);
  } else {
    c.copy(T.sand).lerp(T.sandCool, smoothstep(-2, -22, y));
    const p = fbm(x * 0.05 + 11, z * 0.05 - 7, 3);
    c.lerp(T.rock, smoothstep(0.2, 0.42, p) * 0.5);
    const g = fbm(x * 0.09 - 5, z * 0.09 + 3, 2);
    if (y < -1.5 && y > -14) c.lerp(T.grass, smoothstep(0.22, 0.44, g) * 0.5);
    c.lerp(T.wet, (1 - smoothstep(-0.9, 0.3, y)) * 0.6);
  }
  c.multiplyScalar(1 + noise2(x * 1.9, z * 1.9) * 0.04);
}

function buildTerrain(group) {
  const geo = new THREE.PlaneGeometry(232, 244, 186, 196);
  geo.rotateX(-Math.PI / 2);
  geo.translate(0, 0, -38);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) pos.setY(i, groundY(pos.getX(i), pos.getZ(i)));
  paint(geo, terrainColor);
  geo.deleteAttribute('uv');
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, stdMat({ roughness: 0.96 }, { caustics: true }));
  mesh.receiveShadow = true;
  group.add(mesh);
}

// ---------------------------------------------------------------- rocks

function rockGeo(rng, flat) {
  const g = new THREE.IcosahedronGeometry(1, 1);
  const pos = g.attributes.position;
  const s = rng() * 50;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const k = 1 + 0.26 * noise2(x * 1.4 + s, z * 1.4 + y * 0.8) + 0.1 * noise2(y * 2.6 - s, x * 2.2 + z);
    pos.setXYZ(i, x * k, y * k * flat, z * k);
  }
  const dark = C(PALETTE.rockDark), light = C(PALETTE.rock), dust = C('#DCCDA6'), moss = C('#5E9A86');
  paint(g, (x, y, z, c) => {
    c.copy(dark).lerp(light, smoothstep(-0.6 * flat, 0.75 * flat, y));
    if (y > 0.45 * flat) c.lerp(dust, 0.3 + 0.25 * noise2(x * 3 + s, z * 3));
    else if (y > -0.1) c.lerp(moss, 0.18 * (noise2(x * 4 - s, z * 4) + 1));
  });
  return clean(g);
}

function buildRocks(group, colliders) {
  const rng = mulberry32(7);
  const flats = [0.62, 0.75, 0.55, 0.85, 1.3];
  const protos = flats.map((f) => rockGeo(rng, f));
  const lists = protos.map(() => []);
  const mat = stdMat({ roughness: 0.95 });
  const add = (x, z, s, sy, k, sink = 0.3) => {
    const y = groundY(x, z) - sink * s;
    lists[k].push(place(x, y, z, s * range(rng, 0.85, 1.2), s * sy, s * range(rng, 0.85, 1.2), rng() * 6.28, range(rng, -0.15, 0.15), range(rng, -0.15, 0.15)));
    if (s > 0.6) colliders.push({ x, y: y + s * sy * 0.35, z, r: s * 0.95 });
  };
  for (let i = 0; i < 150; i++) {
    const x = range(rng, -58, 58), z = range(rng, -128, 22);
    if (nearPier(x, z, 3)) continue;
    const zone2 = z < -26;
    const big = rng() < (zone2 ? 0.22 : 0.1);
    const s = big ? range(rng, 1.8, 3.6) : range(rng, 0.35, 1.3);
    add(x, z, s, 1, Math.floor(rng() * 4));
    if (rng() < 0.35) add(x + range(rng, -1.5, 1.5), z + range(rng, -1.5, 1.5), s * range(rng, 0.3, 0.6), 1, Math.floor(rng() * 4));
  }
  // tall spires give the blue zone a silhouette
  for (let i = 0; i < 16; i++) {
    const x = range(rng, -50, 50), z = range(rng, -125, -62);
    add(x, z, range(rng, 2.2, 4.2), range(rng, 2.2, 3.4), 4, 0.15);
  }
  // reef arch near the slope
  add(-6, -40, 3.4, 1.4, 4, 0.2);
  add(-1.5, -41.5, 3.0, 1.6, 4, 0.2);
  // beach and headland rocks
  for (let i = 0; i < 22; i++) {
    const side = rng() < 0.5 ? -1 : 1;
    const x = side * range(rng, 40, 64), z = range(rng, 10, 46);
    add(x, z, range(rng, 0.8, 2.6), 1, Math.floor(rng() * 4), 0.35);
  }
  protos.forEach((g, k) => group.add(instanced(g, mat, lists[k])));
}

// ---------------------------------------------------------------- plants

function seaweedGeo() {
  const g = new THREE.PlaneGeometry(0.24, 1, 1, 7);
  g.translate(0, 0.5, 0);
  const pos = g.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i);
    const taper = 1 - y * 0.7, a = y * 2.2;
    pos.setXYZ(i, x * taper * Math.cos(a), y, x * taper * Math.sin(a) + Math.sin(y * 2.5) * 0.12);
  }
  const base = C('#1E6B5C'), tip = C('#8AD9B6');
  paint(g, (x, y, z, c) => c.copy(base).lerp(tip, y));
  return clean(g);
}

function buildSeaweed(group) {
  const rng = mulberry32(21);
  const list = [];
  for (let p = 0; p < 46; p++) {
    const cx = range(rng, -54, 54), cz = range(rng, -58, 18);
    if (nearPier(cx, cz, 3)) continue;
    const deep = cz < -28;
    const n = Math.floor(range(rng, 8, 24));
    for (let i = 0; i < n; i++) {
      const a = rng() * 6.28, r = Math.sqrt(rng()) * range(rng, 1.4, 3.2);
      const x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r;
      const h = deep ? range(rng, 1.8, 4.6) : range(rng, 0.7, 2.4);
      list.push(place(x, groundY(x, z) - 0.05, z, range(rng, 0.9, 1.6), h, 1, rng() * 6.28));
    }
  }
  const mat = stdMat({ roughness: 0.75, side: THREE.DoubleSide }, { sway: 0.32, swayHeight: 1 });
  group.add(instanced(seaweedGeo(), mat, list, { cast: false }));
}

function branchCoral(rng, base, tip) {
  const parts = [];
  const q = new THREE.Quaternion();
  const grow = (start, dir, len, r, lvl) => {
    const g = new THREE.CylinderGeometry(r * 0.72, r, len, 5, 1);
    g.translate(0, len / 2, 0);
    g.applyQuaternion(q.setFromUnitVectors(UP, dir));
    g.translate(start.x, start.y, start.z);
    const col = base.clone().lerp(tip, (lvl + 0.4) / 4);
    solid(g, col);
    parts.push(g);
    const end = start.clone().addScaledVector(dir, len);
    if (lvl < 3) {
      const n = lvl === 0 ? 3 : 2 + (rng() < 0.4 ? 1 : 0);
      for (let k = 0; k < n; k++) {
        const nd = dir.clone().add(new THREE.Vector3(range(rng, -0.9, 0.9), range(rng, 0.15, 0.6), range(rng, -0.9, 0.9))).normalize();
        grow(end, nd, len * range(rng, 0.62, 0.8), r * 0.7, lvl + 1);
      }
    } else {
      const t = new THREE.IcosahedronGeometry(r * 1.15, 0);
      t.translate(end.x, end.y, end.z);
      parts.push(solid(t, tip));
    }
  };
  grow(new THREE.Vector3(0, -0.05, 0), UP.clone(), 0.32, 0.07, 0);
  return merge(parts);
}

function brainCoral(c1, c2) {
  const g = new THREE.IcosahedronGeometry(0.5, 2);
  const pos = g.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const k = 1 + 0.05 * Math.sin(x * 18 + Math.sin(z * 11) * 2.0);
    pos.setXYZ(i, x * k, Math.max(y * k * 0.62, -0.05) + 0.08, z * k);
  }
  paint(g, (x, y, z, c) => c.copy(c1).lerp(c2, 0.5 + 0.5 * Math.sin(x * 18 + Math.sin(z * 11) * 2.0)));
  return clean(g);
}

function tubeSponge(rng, outer, inner) {
  const parts = [];
  const n = 3 + Math.floor(rng() * 3);
  for (let i = 0; i < n; i++) {
    const r = range(rng, 0.07, 0.13), h = range(rng, 0.3, 0.85);
    const x = range(rng, -0.18, 0.18), z = range(rng, -0.18, 0.18);
    const g = new THREE.CylinderGeometry(r, r * 0.8, h, 7, 2);
    g.translate(x, h / 2, z);
    paint(g, (px, py, pz, c) => c.copy(outer).lerp(inner, smoothstep(h * 0.6, h, py) * 0.6));
    parts.push(g);
    const cap = new THREE.CircleGeometry(r * 0.85, 7).rotateX(-Math.PI / 2).translate(x, h + 0.002, z);
    parts.push(solid(cap, inner));
  }
  return merge(parts);
}

function seaFan(rng, c1, c2) {
  const pos = [], col = [];
  const K = 12;
  const pts = [];
  for (let k = 0; k <= K; k++) {
    const a = 0.25 + ((Math.PI - 0.5) * k) / K;
    const r = 0.75 + 0.2 * Math.sin(k * 2.7 + rng() * 2);
    pts.push([Math.cos(a) * r, Math.sin(a) * r]);
  }
  const push = (x, y, c) => { pos.push(x, y, 0); col.push(c.r, c.g, c.b); };
  for (let k = 0; k < K; k++) {
    const [ax, ay] = pts[k], [bx, by] = pts[k + 1];
    push(0, 0, c2); push(ax * 0.5, ay * 0.5, c2.clone().lerp(c1, 0.5)); push(bx * 0.5, by * 0.5, c2.clone().lerp(c1, 0.5));
    push(ax * 0.5, ay * 0.5, c2.clone().lerp(c1, 0.5)); push(ax, ay, c1); push(bx, by, c1);
    push(ax * 0.5, ay * 0.5, c2.clone().lerp(c1, 0.5)); push(bx, by, c1); push(bx * 0.5, by * 0.5, c2.clone().lerp(c1, 0.5));
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.computeVertexNormals();
  return g;
}

function anemoneGeo() {
  const parts = [];
  const base = new THREE.CylinderGeometry(0.09, 0.12, 0.12, 7);
  base.translate(0, 0.06, 0);
  parts.push(solid(base, C('#2A6F7E')));
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2;
    const t = new THREE.ConeGeometry(0.025, 0.22, 4);
    t.translate(0, 0.11, 0);
    t.rotateZ(Math.cos(a) * 0.5);
    t.rotateX(Math.sin(a) * 0.5);
    t.translate(Math.cos(a) * 0.06, 0.1, Math.sin(a) * 0.06);
    parts.push(solid(t, C('#BFFFF4')));
  }
  return merge(parts);
}

function buildCorals(group) {
  const rng = mulberry32(33);
  const coral = C(PALETTE.coral), sun = C(PALETTE.sun), foam = C(PALETTE.foam), turq = C(PALETTE.turquoise);
  const deep = C('#1F5B7A'), rose = C('#F2876F'), sand = C(PALETTE.sand);
  const protos = [
    { g: branchCoral(rng, coral, sun), w: 3 },
    { g: branchCoral(rng, rose, foam), w: 2 },
    { g: branchCoral(rng, C('#E9A04F'), C('#FFF0C9')), w: 2 },
    { g: brainCoral(sun, C('#E2A75A')), w: 2 },
    { g: brainCoral(C('#C7D9A8'), sand), w: 1 },
    { g: tubeSponge(rng, turq, deep), w: 2 },
    { g: tubeSponge(rng, C('#F08A6C'), C('#8E3B3A')), w: 1 },
  ];
  const fans = [seaFan(rng, coral, C('#A8433E')), seaFan(rng, sun, C('#B9773A'))];
  const lists = protos.map(() => []);
  const fanLists = fans.map(() => []);
  const totalW = protos.reduce((s, p) => s + p.w, 0);
  const pick = () => {
    let r = rng() * totalW;
    for (let i = 0; i < protos.length; i++) { r -= protos[i].w; if (r <= 0) return i; }
    return 0;
  };
  const scatter = (count, zMin, zMax, sMin, sMax) => {
    for (let i = 0; i < count; i++) {
      const cx = range(rng, -54, 54), cz = range(rng, zMin, zMax);
      if (nearPier(cx, cz, 3)) continue;
      const n = 1 + Math.floor(rng() * 4);
      for (let j = 0; j < n; j++) {
        const x = cx + range(rng, -1.6, 1.6), z = cz + range(rng, -1.6, 1.6);
        const s = range(rng, sMin, sMax);
        if (rng() < 0.18) {
          const k = Math.floor(rng() * fans.length);
          fanLists[k].push(alignedPlace(x, z, s * 1.2, s * 1.2, rng() * 6.28, 0.05, rng, 0.2));
        } else {
          const k = pick();
          lists[k].push(alignedPlace(x, z, s, s * range(rng, 0.85, 1.25), rng() * 6.28, 0.04, rng));
        }
      }
    }
  };
  scatter(28, -26, 18, 0.7, 1.4);
  scatter(80, -58, -24, 1.0, 2.2);
  scatter(18, -125, -58, 1.2, 2.4);
  const mat = stdMat({ roughness: 0.7 });
  protos.forEach((p, k) => group.add(instanced(p.g, mat, lists[k], { cast: false })));
  const fanMat = stdMat({ roughness: 0.7, side: THREE.DoubleSide }, { sway: 0.06, swayHeight: 1 });
  fans.forEach((g, k) => group.add(instanced(g, fanMat, fanLists[k], { cast: false })));

  const glow = [];
  for (let i = 0; i < 90; i++) {
    const x = range(rng, -52, 52), z = range(rng, -128, -48);
    glow.push(alignedPlace(x, z, range(rng, 1, 2.2), range(rng, 1, 2), rng() * 6.28, 0.02, rng));
  }
  const glowMat = stdMat({ emissive: PALETTE.turquoise, emissiveIntensity: 2.6, roughness: 0.6 }, { caustics: false });
  group.add(instanced(anemoneGeo(), glowMat, glow, { cast: false }));

  // starfish on the shallows
  const star = new THREE.Shape();
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2 + Math.PI / 2;
    const r = i % 2 ? 0.075 : 0.19;
    if (i === 0) star.moveTo(Math.cos(a) * r, Math.sin(a) * r);
    else star.lineTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  const sg = new THREE.ExtrudeGeometry(star, { depth: 0.035, bevelEnabled: false });
  sg.rotateX(-Math.PI / 2);
  solid(sg, C('#FFFFFF'));
  const starMesh = new THREE.InstancedMesh(clean(sg), stdMat({ roughness: 0.6 }), 70);
  const m = new THREE.Matrix4();
  const tints = [coral, sun, C('#FF9A7A'), C('#F06A5A')];
  let n = 0;
  for (let i = 0; i < 70; i++) {
    const x = range(rng, -40, 40), z = range(rng, -30, 22);
    if (nearPier(x, z, 1)) continue;
    const p = alignedPlace(x, z, range(rng, 0.8, 1.4), 1, rng() * 6.28, -0.01, rng, 0.9);
    starMesh.setMatrixAt(n, m.compose(p.p, p.q, p.s));
    starMesh.setColorAt(n, tints[i % tints.length]);
    n++;
  }
  starMesh.count = n;
  starMesh.receiveShadow = true;
  group.add(starMesh);
}

// ---------------------------------------------------------------- pier & beach

function buildPier(group, colliders) {
  const P = WORLD.pier, deck = P.deckY;
  const wood = C(PALETTE.wood), woodDark = C(PALETTE.woodDark), weather = C('#CDA77E'), algae = C('#3E7A6A');
  const metal = C('#C9D3D5');
  const rng = mulberry32(77);
  const parts = [];
  for (let z = P.z0 + 0.15; z < P.z1; z += 0.31) {
    const g = new THREE.BoxGeometry(P.x1 - P.x0 + range(rng, -0.05, 0.14), 0.07, 0.27);
    g.rotateY(range(rng, -0.012, 0.012));
    g.translate(range(rng, -0.05, 0.05), deck - 0.035 + range(rng, -0.008, 0.008), z);
    parts.push(solid(g, (rng() < 0.12 ? weather : wood).clone().multiplyScalar(range(rng, 0.82, 1.08))));
  }
  for (const x of [-1.15, 1.15]) {
    const g = new THREE.BoxGeometry(0.16, 0.2, P.z1 - P.z0);
    g.translate(x, deck - 0.17, (P.z0 + P.z1) / 2);
    parts.push(solid(g, woodDark));
  }
  for (let z = P.z0 + 0.3; z < P.z1; z += 3.1) {
    const cross = new THREE.BoxGeometry(P.x1 - P.x0 + 0.1, 0.16, 0.14);
    cross.translate(0, deck - 0.3, z);
    parts.push(solid(cross, woodDark));
    for (const x of [P.x0 + 0.12, P.x1 - 0.12]) {
      const bottom = groundY(x, z) - 0.6, top = deck + (z < P.z0 + 1 ? 0.4 : 0.02);
      const h = top - bottom;
      const g = new THREE.CylinderGeometry(0.13, 0.15, h, 7, 10);
      g.translate(x, bottom + h / 2, z);
      paint(g, (px, py, pz, c) => {
        if (py < -0.15) c.copy(algae).lerp(woodDark, smoothstep(-3, -0.2, py) * 0.5);
        else c.copy(woodDark).multiplyScalar(1.08);
        if (py > -0.35 && py < 0.2) c.multiplyScalar(0.7);
      });
      parts.push(g);
      colliders.push({ x, y: Math.min(0, top) - 1.5, z, r: 0.3, post: true });
    }
  }
  // ladder on the seaward end
  const L = WORLD.ladder, lz = P.z0 - 0.07;
  for (const dx of [-0.26, 0.26]) {
    const h = deck + 0.75 + 2.4;
    const g = new THREE.BoxGeometry(0.06, h, 0.06);
    g.translate(L.x + dx, -2.4 + h / 2, lz);
    parts.push(solid(g, metal));
  }
  for (let y = -2.1; y < deck; y += 0.32) {
    const g = new THREE.CylinderGeometry(0.025, 0.025, 0.52, 6);
    g.rotateZ(Math.PI / 2);
    g.translate(L.x, y, lz);
    parts.push(solid(g, metal));
  }
  // bollards and props
  for (const [x, z] of [[P.x0 + 0.25, P.z0 + 0.35], [P.x1 - 0.25, P.z0 + 1.6], [P.x0 + 0.25, P.z1 - 3]]) {
    const g = new THREE.CylinderGeometry(0.12, 0.14, 0.42, 8);
    g.translate(x, deck + 0.21, z);
    parts.push(solid(g, woodDark));
  }
  const crate = (x, z, s, y = deck, col = C('#B98657')) => {
    const g = new THREE.BoxGeometry(s, s, s);
    g.rotateY(range(rng, -0.3, 0.3));
    g.translate(x, y + s / 2, z);
    parts.push(paint(g, (px, py, pz, c) => c.copy(col).multiplyScalar(0.85 + 0.25 * smoothstep(y, y + s, py))));
  };
  crate(-1.0, 30.6, 0.6);
  crate(-1.05, 29.8, 0.5);
  crate(-1.0, 30.6, 0.42, deck + 0.6);
  crate(1.05, 6.8, 0.55, deck, C('#2E7E9E'));
  const coil = new THREE.TorusGeometry(0.22, 0.05, 6, 14);
  coil.rotateX(Math.PI / 2);
  coil.translate(-0.95, deck + 0.05, 7.4);
  parts.push(solid(coil, C('#E2C99A')));
  const post = new THREE.CylinderGeometry(0.05, 0.06, 2.3, 6);
  post.translate(-1.4, deck + 1.15, P.z0 + 1.2);
  parts.push(solid(post, woodDark));

  const mesh = new THREE.Mesh(merge(parts), stdMat({ roughness: 0.85 }));
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  group.add(mesh);

  const bulb = new THREE.Mesh(new THREE.IcosahedronGeometry(0.13, 1), stdMat({ vertexColors: false, color: PALETTE.sun, emissive: PALETTE.sun, emissiveIntensity: 3.5 }, { caustics: false }));
  bulb.position.set(-1.4, deck + 2.35, P.z0 + 1.2);
  group.add(bulb);
}

function buildHut(group) {
  const { x: hx, z: hz } = WORLD.shop;
  const gy = groundY(hx, hz);
  const floorY = gy + 0.65;
  const parts = [];
  const wall = C('#E4BC8C'), woodDark = C(PALETTE.woodDark), coral = C(PALETTE.coral), foam = C(PALETTE.foam);
  const floor = new THREE.BoxGeometry(4.6, 0.22, 3.9);
  floor.translate(hx, floorY, hz);
  parts.push(solid(floor, C(PALETTE.wood)));
  for (const [dx, dz] of [[-2.1, -1.7], [2.1, -1.7], [-2.1, 1.7], [2.1, 1.7]]) {
    const s = new THREE.CylinderGeometry(0.11, 0.11, 1.4, 6);
    s.translate(hx + dx, floorY - 0.6, hz + dz);
    parts.push(solid(s, woodDark));
  }
  const walls = new THREE.BoxGeometry(3.9, 2.2, 3.2, 1, 9, 1);
  walls.translate(hx, floorY + 1.2, hz);
  parts.push(paint(walls, (x, y, z, c) => c.copy(wall).multiplyScalar(Math.floor((y - floorY) / 0.245) % 2 ? 0.92 : 1.0)));
  const door = new THREE.BoxGeometry(0.06, 1.6, 0.9);
  door.translate(hx + 1.97, floorY + 0.9, hz - 0.5);
  parts.push(solid(door, woodDark));
  const win = new THREE.BoxGeometry(0.06, 0.6, 0.9);
  win.translate(hx + 1.97, floorY + 1.35, hz + 0.85);
  parts.push(solid(win, C('#1E5675')));
  const roof = new THREE.ConeGeometry(3.4, 1.5, 8).toNonIndexed();
  roof.rotateY(Math.PI / 8);
  roof.translate(hx, floorY + 2.3 + 0.75, hz);
  parts.push(paint(roof, (x, y, z, c, i) => c.copy(Math.floor(i / 6) % 2 ? foam : coral)));
  const sign = new THREE.BoxGeometry(0.08, 0.5, 2.0);
  sign.translate(hx + 2.02, floorY + 2.05, hz);
  parts.push(solid(sign, C(PALETTE.turquoise)));
  const fish = new THREE.Shape();
  fish.moveTo(-0.45, 0);
  fish.quadraticCurveTo(-0.1, 0.22, 0.3, 0.02);
  fish.lineTo(0.48, 0.16);
  fish.lineTo(0.44, -0.14);
  fish.lineTo(0.3, -0.02);
  fish.quadraticCurveTo(-0.1, -0.22, -0.45, 0);
  const fg = new THREE.ExtrudeGeometry(fish, { depth: 0.03, bevelEnabled: false });
  fg.rotateY(Math.PI / 2);
  fg.translate(hx + 2.07, floorY + 2.05, hz);
  parts.push(solid(fg, foam));
  for (let k = 0; k < 4; k++) {
    const t = new THREE.CylinderGeometry(0.12, 0.12, 0.75, 8);
    t.translate(hx + 2.55, gy + 0.37, hz - 1.4 + k * 0.32);
    parts.push(paint(t, (x, y, z, c) => c.copy(y > gy + 0.6 ? foam : coral)));
  }
  const pole = new THREE.CylinderGeometry(0.05, 0.06, 5.2, 6);
  pole.translate(hx - 2.7, gy + 2.6, hz + 2.3);
  parts.push(solid(pole, foam));
  const mesh = new THREE.Mesh(merge(parts), stdMat({ roughness: 0.85 }, { caustics: false }));
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  group.add(mesh);

  const flagGeo = new THREE.PlaneGeometry(1.3, 0.75, 10, 2);
  flagGeo.translate(0.65, 0, 0);
  paint(flagGeo, (x, y, z, c) => c.copy(Math.abs(y) < 0.12 ? foam : coral));
  const flag = new THREE.Mesh(flagGeo, stdMat({ roughness: 0.8, side: THREE.DoubleSide }, { caustics: false }));
  flag.position.set(hx - 2.7, gy + 4.75, hz + 2.3);
  flag.castShadow = true;
  group.add(flag);
  flag.userData.base = Float32Array.from(flagGeo.attributes.position.array);
  return flag;
}

function palmGeo(rng, height) {
  const parts = [];
  const wood = C(PALETTE.wood), woodDark = C(PALETTE.woodDark), leaf = C(PALETTE.leaf), leafTip = C('#86CFA6');
  const lean = range(rng, 0.12, 0.3), dir = rng() * 6.28;
  const seg = 8;
  const pt = (t) => new THREE.Vector3(Math.cos(dir) * lean * t * t * height, t * height, Math.sin(dir) * lean * t * t * height);
  for (let i = 0; i < seg; i++) {
    const a = pt(i / seg), b = pt((i + 1) / seg);
    const d = b.clone().sub(a);
    const len = d.length();
    const g = new THREE.CylinderGeometry(0.2 - 0.08 * ((i + 1) / seg), 0.22 - 0.08 * (i / seg), len, 7);
    g.translate(0, len / 2, 0);
    g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(UP, d.normalize()));
    g.translate(a.x, a.y, a.z);
    parts.push(solid(g, i % 2 ? wood : woodDark));
  }
  const top = pt(1);
  const fronds = 8;
  for (let f = 0; f < fronds; f++) {
    const a = (f / fronds) * Math.PI * 2 + rng() * 0.4;
    const len = range(rng, 2.2, 3.0), droop = range(rng, 0.6, 1.0);
    const dx = Math.cos(a), dz = Math.sin(a);
    const px = -dz, pz = dx;
    const pos = [], col = [];
    const S = 6;
    const spine = (s) => [top.x + dx * s * len, top.y + 0.15 + s * len * 0.35 - s * s * len * droop, top.z + dz * s * len];
    for (let k = 0; k < S; k++) {
      const s0 = k / S, s1 = (k + 1) / S;
      const w0 = Math.sin(Math.PI * Math.min(1, s0 * 1.1 + 0.05)) * 0.42, w1 = Math.sin(Math.PI * Math.min(1, s1 * 1.1 + 0.05)) * 0.42;
      const a0 = spine(s0), a1 = spine(s1);
      const l0 = [a0[0] + px * w0, a0[1] - 0.08, a0[2] + pz * w0], r0 = [a0[0] - px * w0, a0[1] - 0.08, a0[2] - pz * w0];
      const l1 = [a1[0] + px * w1, a1[1] - 0.08, a1[2] + pz * w1], r1 = [a1[0] - px * w1, a1[1] - 0.08, a1[2] - pz * w1];
      const c0 = leaf.clone().lerp(leafTip, s0), c1 = leaf.clone().lerp(leafTip, s1);
      for (const [v, c] of [[a0, c0], [l0, c0], [a1, c1], [l0, c0], [l1, c1], [a1, c1], [a0, c0], [a1, c1], [r0, c0], [r0, c0], [a1, c1], [r1, c1]]) {
        pos.push(...v);
        col.push(c.r, c.g, c.b);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.computeVertexNormals();
    parts.push(g);
  }
  for (let k = 0; k < 3; k++) {
    const c = new THREE.IcosahedronGeometry(0.13, 0);
    const a = k * 2.1;
    c.translate(top.x + Math.cos(a) * 0.18, top.y - 0.1, top.z + Math.sin(a) * 0.18);
    parts.push(solid(c, woodDark));
  }
  return merge(parts);
}

function buildBeach(group) {
  const rng = mulberry32(55);
  const mat = stdMat({ roughness: 0.85, side: THREE.DoubleSide }, { caustics: false });
  for (const [x, z] of [[-14, 44], [-19.5, 40], [9, 42.5], [15, 47], [-27, 49], [25, 41], [5, 53], [33, 47]]) {
    const m = new THREE.Mesh(palmGeo(rng, range(rng, 5, 7.2)), mat);
    m.position.set(x, groundY(x, z) - 0.1, z);
    m.castShadow = true;
    group.add(m);
  }
  // rowboat pulled up on the sand
  const hull = new THREE.SphereGeometry(1, 12, 6, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2);
  hull.scale(0.78, 0.48, 2.0);
  paint(hull, (x, y, z, c) => c.copy(y > -0.12 ? C(PALETTE.foam) : C(PALETTE.coral)));
  const seat = new THREE.BoxGeometry(1.4, 0.05, 0.3);
  seat.translate(0, -0.12, 0.2);
  solid(seat, C(PALETTE.wood));
  const boat = new THREE.Mesh(merge([hull, seat]), mat);
  boat.position.set(12.5, groundY(12.5, 35.5) + 0.42, 35.5);
  boat.rotation.set(0.04, 0.6, 0.14);
  boat.castShadow = true;
  group.add(boat);
}

// zone boundary buoys bob on the swell and mark where the deeper zones begin
function buildBuoys(group) {
  const foam = C(PALETTE.foam);
  const make = (main) => paint(new THREE.IcosahedronGeometry(0.34, 1), (x, y, z, c) => c.copy(Math.abs(y) < 0.08 ? foam : main));
  const lines = [{ z: -29.5, col: C(PALETTE.coral) }, { z: -54.5, col: C(PALETTE.sun) }];
  const meshes = [];
  const ropes = [];
  const mat = stdMat({ roughness: 0.55 });
  for (const line of lines) {
    const xs = [];
    for (let x = -40; x <= 40; x += 8) xs.push(x);
    const mesh = new THREE.InstancedMesh(clean(make(line.col)), mat, xs.length);
    mesh.castShadow = true;
    mesh.userData.xs = xs;
    mesh.userData.z = line.z;
    meshes.push(mesh);
    group.add(mesh);
    for (const x of xs) ropes.push(place(x, groundY(x, line.z), line.z, 1, -groundY(x, line.z) - 0.2, 1));
  }
  const ropeGeo = new THREE.CylinderGeometry(0.018, 0.018, 1, 4);
  ropeGeo.translate(0, 0.5, 0);
  group.add(instanced(clean(solid(ropeGeo, C('#E8D2A4'))), mat, ropes, { cast: false }));
  return meshes;
}

// ---------------------------------------------------------------- world

export function createWorld(scene) {
  const group = new THREE.Group();
  scene.add(group);
  const colliders = [];
  buildTerrain(group);
  buildRocks(group, colliders);
  buildSeaweed(group);
  buildCorals(group);
  buildPier(group, colliders);
  const flag = buildHut(group);
  buildBeach(group);
  const buoys = buildBuoys(group);

  const sun = new THREE.DirectionalLight('#FFE7C4', 2.3);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const sc = sun.shadow.camera;
  sc.left = -34; sc.right = 34; sc.top = 34; sc.bottom = -34; sc.near = 1; sc.far = 170;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.04;
  sun.shadow.radius = 2;
  scene.add(sun, sun.target);
  const hemi = new THREE.HemisphereLight('#A6DCEB', '#D9B98A', 1.0);
  scene.add(hemi);

  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const s = new THREE.Vector3(1, 1, 1);
  const p = new THREE.Vector3();
  const e = new THREE.Euler();

  return {
    group,
    colliders,
    sun,
    hemi,
    update(dt, t, focus) {
      const snap = 1;
      const tx = Math.round(focus.x / snap) * snap, tz = Math.round(focus.z / snap) * snap;
      sun.target.position.set(tx, Math.min(focus.y, 0), tz);
      sun.position.copy(sun.target.position).addScaledVector(SUN_DIR, 80);
      for (const mesh of buoys) {
        const z = mesh.userData.z;
        mesh.userData.xs.forEach((x, i) => {
          const h = waveHeight(x, z, t);
          const hx = waveHeight(x + 0.6, z, t) - h, hz = waveHeight(x, z + 0.6, t) - h;
          p.set(x, h - 0.06, z);
          q.setFromEuler(e.set(hz * 0.9, 0, -hx * 0.9));
          mesh.setMatrixAt(i, m.compose(p, q, s));
        });
        mesh.instanceMatrix.needsUpdate = true;
      }
      const pos = flag.geometry.attributes.position;
      const base = flag.userData.base;
      for (let i = 0; i < pos.count; i++) {
        const x = base[i * 3];
        pos.setZ(i, Math.sin(x * 3.2 - t * 5.5) * 0.12 * x + Math.sin(x * 7 - t * 9) * 0.02 * x);
      }
      pos.needsUpdate = true;
      flag.geometry.computeVertexNormals();
    },
  };
}
