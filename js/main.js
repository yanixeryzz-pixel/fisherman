import * as THREE from 'three';
import { UPGRADES, statsFor, levelInfo } from './config.js';
import { U } from './shaders.js';
import { createWorld } from './world.js';
import { Water } from './water.js';
import { Sky } from './sky.js';
import { FishSystem } from './fish.js';
import { Diver } from './diver.js';
import { FX } from './fx.js';
import { Post } from './post.js';
import { AudioEngine } from './audio.js';
import { Input } from './input.js';
import { loadSave, writeSave, clearSave, hasSave } from './save.js';
import { UI } from './ui.js';
import { Player } from './player.js';
import { damp, smoothstep, lerp } from './util.js';

const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V'];
const canvas = document.getElementById('scene');
const ui = new UI();

let renderer;
try {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', stencil: false });
} catch (err) {
  ui.e.play.querySelector('span').textContent = 'Нужен браузер с WebGL 2';
  throw err;
}
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.shadowMap.autoUpdate = false;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(58, innerWidth / innerHeight, 0.1, 3000);

const game = {
  mode: 'title',
  save: loadSave(),
  stats: null,
  persist() {
    writeSave(this.save);
  },
  sell: null,
};
game.stats = statsFor(game.save.up);
const S = () => game.save;

const audio = new AudioEngine();
audio.volume = S().settings.volume;
audio.muted = S().settings.muted;
const input = new Input(canvas);
const world = createWorld(scene);
const water = new Water(scene);
const sky = new Sky(scene);
const fish = new FishSystem(scene);
const diver = new Diver();
scene.add(diver.root);
const fx = new FX(scene);
const post = new Post(renderer, scene, camera, { samples: S().settings.quality === 'high' ? 4 : 0 });
const player = new Player({ camera, diver, fish, water, world, fx, audio, ui, game });
if (S().settings.quality !== 'high') world.sun.shadow.mapSize.set(1024, 1024);

// Dynamic resolution keeps the frame rate up on weaker GPUs and phones.
let resScale = 1;
const perf = { acc: 0, n: 0, t: 0 };
function adaptResolution(raw) {
  if (debug.fixedRes) return;
  perf.acc += raw;
  perf.n++;
  perf.t += raw;
  if (perf.t < 2.5) return;
  const avg = perf.acc / perf.n;
  perf.acc = perf.n = perf.t = 0;
  const prev = resScale;
  if (avg > 0.024) resScale = Math.max(0.5, resScale - 0.15);
  else if (avg < 0.0135) resScale = Math.min(1, resScale + 0.1);
  if (resScale !== prev) resize();
}

function resize() {
  const pr = Math.min(window.devicePixelRatio || 1, S().settings.quality === 'high' ? 1.5 : 1) * resScale;
  renderer.setPixelRatio(pr);
  renderer.setSize(innerWidth, innerHeight, false);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  post.setSize(innerWidth, innerHeight, pr);
}
addEventListener('resize', resize);
resize();

// underwater fog darkens and cools with the camera's depth
const FOG = [[0, '#3EC3C0'], [7, '#1F93A8'], [16, '#125F82'], [26, '#0A3757'], [36, '#06223B']].map(([d, h]) => [d, new THREE.Color(h)]);
function fogAt(depth, out) {
  for (let i = 1; i < FOG.length; i++) {
    if (depth <= FOG[i][0]) {
      const [d0, c0] = FOG[i - 1], [d1, c1] = FOG[i];
      return out.copy(c0).lerp(c1, Math.max(0, (depth - d0) / (d1 - d0)));
    }
  }
  return out.copy(FOG[FOG.length - 1][1]);
}

// ---------------------------------------------------------------- flows

function resume() {
  game.mode = 'play';
  input.requestLock();
}

game.sell = (items) => {
  const save = S();
  const before = levelInfo(save.xp);
  const sum = { rows: {}, shells: 0, xp: 0 };
  let best = items[0];
  for (const it of items) {
    const r = sum.rows[it.id] || (sum.rows[it.id] = { id: it.id, count: 0, value: 0 });
    r.count++;
    r.value += it.value;
    sum.shells += it.value;
    sum.xp += it.xp;
    save.caught[it.id] = (save.caught[it.id] || 0) + 1;
    save.best[it.id] = Math.max(save.best[it.id] || 0, +it.size.toFixed(2));
    if (it.value > best.value) best = it;
  }
  save.shells += sum.shells;
  save.xp += sum.xp;
  save.dives++;
  const after = levelInfo(save.xp);
  game.persist();
  player.trophy(best);
  audio.coins(items.length);
  if (after.level > before.level) {
    setTimeout(() => {
      audio.levelUp();
      ui.toast(`<svg class="ic"><use href="#i-star"/></svg><div class="tx"><b>Уровень дайвера ${after.level}!</b><small>В мастерской открылись новые улучшения</small></div>`, 'level');
    }, 1300);
  }
  const showPanel = () => {
    // wait out a pause instead of dropping the summary
    if (game.mode === 'pause') return setTimeout(showPanel, 400);
    if (game.mode !== 'play') return;
    game.mode = 'panel';
    input.exitLock();
    ui.openSell(sum, before, after, () => {
      ui.closeSell();
      openShop();
    }, () => {
      ui.closeSell();
      resume();
    });
  };
  setTimeout(showPanel, 1200);
};

function openShop() {
  if (player.state !== 'shore') {
    ui.toast('<svg class="ic"><use href="#i-lock"/></svg><div class="tx"><b>Мастерская на берегу</b><small>Поднимись на пирс по лестнице</small></div>', 'warn');
    return;
  }
  game.mode = 'panel';
  input.exitLock();
  audio.click();
  ui.openShop(S(), buy, () => {
    ui.closeShop();
    resume();
  });
}

function buy(id) {
  const save = S();
  const u = UPGRADES.find((x) => x.id === id);
  const l = save.up[id];
  if (l >= u.max || save.shells < u.cost[l] || levelInfo(save.xp).level < u.req[l]) return;
  save.shells -= u.cost[l];
  save.up[id]++;
  game.stats = statsFor(save.up);
  player.o2 = game.stats.o2Max;
  game.persist();
  audio.jingle();
  ui.renderShop();
  ui.toast(`<svg class="ic"><use href="#${u.icon}"/></svg><div class="tx"><b>${u.name} ${ROMAN[save.up[id]]}</b><small>${u.fmt(u.value(save.up[id]))}</small></div>`, 'level');
}

function toggleView() {
  const s = S().settings;
  s.view = s.view === 'first' ? 'third' : 'first';
  diver.setFirstPerson(s.view === 'first' && game.mode !== 'title');
  game.persist();
}

function toggleQuality() {
  const s = S().settings;
  s.quality = s.quality === 'high' ? 'low' : 'high';
  post.sceneRT.dispose();
  post.sceneRT.samples = s.quality === 'high' ? 4 : 0;
  const shadow = world.sun.shadow;
  shadow.mapSize.setScalar(s.quality === 'high' ? 2048 : 1024);
  shadow.map?.dispose();
  shadow.map = null;
  game.persist();
  resize();
}

function openPause() {
  if (game.mode !== 'play') return;
  game.mode = 'pause';
  ui.openPause(S().settings, {
    resume: () => {
      ui.closePause();
      resume();
    },
    view: toggleView,
    quality: toggleQuality,
    volume: (v) => {
      S().settings.volume = v;
      audio.setVolume(v);
      game.persist();
    },
    reset: () => {
      clearSave();
      location.reload();
    },
  });
}

input.onLockChange = (locked) => {
  if (!locked && game.mode === 'play' && !input.touchEnabled) openPause();
};
canvas.addEventListener('click', () => {
  if (game.mode === 'play' && !input.locked) input.requestLock();
});

function handleKeys() {
  if (input.hit('KeyV')) toggleView();
  if (input.hit('KeyM')) {
    const s = S().settings;
    s.muted = !s.muted;
    audio.setMuted(s.muted);
    game.persist();
    ui.toast(`<svg class="ic"><use href="#i-sound"/></svg><div class="tx"><b>Звук ${s.muted ? 'выключен' : 'включён'}</b></div>`);
  }
  if (input.hit('KeyU') || input.hit('Tab')) openShop();
  if (input.hit('KeyP') || (input.touchEnabled && input.hit('Escape'))) openPause();
}

function startGame() {
  audio.init();
  audio.setVolume(S().settings.volume);
  audio.setMuted(S().settings.muted);
  ui.hideStart();
  game.mode = 'play';
  diver.setFirstPerson(S().settings.view === 'first');
  player.camInit = true;
  camera.fov = 70;
  if (matchMedia('(pointer: coarse)').matches && !matchMedia('(pointer: fine)').matches) input.enableTouch(document.getElementById('touch'));
  input.requestLock();
}

// ---------------------------------------------------------------- loop

const NULL_INPUT = { dx: 0, dy: 0, mouseDown: false, mousePressed: false, mouseReleased: false, axis: () => ({ x: 0, y: 0 }), hit: () => false, down: () => false };
const FAR = new THREE.Vector3(0, 100, 0);
const debug = { timeScale: 1 };
const fxp = { under: 0, drops: 0, low: 0, pressure: 0, focus: 12 };
let last = performance.now(), time = 0, wasUnder = false;

function attract(dt) {
  const a = time * 0.05;
  camera.position.set(6.8 + Math.sin(a) * 2.2, 2.3 + Math.sin(time * 0.4) * 0.08, 15.5 + Math.cos(a) * 1.5);
  camera.lookAt(-0.6, 1.5, 4);
  player.updateBody(dt);
  player.updateDiver(dt);
}

function frame(now) {
  requestAnimationFrame(frame);
  const raw = Math.max(0, (now - last) / 1000);
  const dt = Math.min(0.05, raw) * debug.timeScale;
  last = now;
  if (game.mode !== 'title') adaptResolution(raw);
  const paused = game.mode === 'pause';
  const sdt = paused ? 0 : dt;
  time += sdt;
  U.uTime.value = time;

  if (game.mode === 'play') handleKeys();
  if (game.mode === 'title') attract(dt);
  else if (!paused) player.update(dt, game.mode === 'play' ? input : NULL_INPUT);

  U.uPlayerPos.value.copy(game.mode === 'title' ? FAR : player.pos);
  fish.update(sdt, time, player.view);
  world.update(sdt, time, player.pos);
  sky.update(sdt, time, camera);
  water.update(camera);
  camera.updateMatrixWorld();

  const wh = water.heightAt(camera.position.x, camera.position.z);
  const camUnder = camera.position.y < wh;
  const camDepth = Math.max(0, -camera.position.y);
  U.uCamUnder.value = camUnder ? 1 : 0;
  fogAt(camDepth, U.uFogColor.value);
  U.uFogDensity.value = lerp(0.034, 0.05, smoothstep(0, 30, camDepth));
  if (wasUnder && !camUnder) fxp.drops = 1;
  wasUnder = camUnder;
  fxp.drops = Math.max(0, fxp.drops - dt * 0.45);
  fxp.under = damp(fxp.under, camUnder ? 1 : 0, 12, dt);
  fxp.low = player.state === 'under' ? smoothstep(0.25, 0.04, player.o2 / game.stats.o2Max) : 0;
  fxp.pressure = player.overDepth / 3;
  fxp.focus = game.mode === 'title' ? 12 : player.focus || 4;

  fx.setViewport(post.size.y, camera.fov);
  fx.update(sdt, time, camera, camUnder, camDepth);
  audio.update(dt, fxp.under);
  post.render(dt, time, sky, water, fxp);

  if (game.mode !== 'title') {
    const save = S();
    ui.update({ ...player.hud(innerWidth, innerHeight), shells: save.shells, level: levelInfo(save.xp) });
    ui.hint(game.mode === 'play' ? player.hint() : '');
  }
  input.endFrame();
}

const save = S();
const total = Object.values(save.caught).reduce((a, b) => a + b, 0);
ui.setReady(
  hasSave() && total > 0,
  hasSave() && total > 0
    ? `<span><svg class="ic sm"><use href="#i-shell"/></svg>${save.shells}</span><span>Ур. ${levelInfo(save.xp).level}</span><span>поймано ${total}</span>`
    : '',
);
ui.e.play.addEventListener('click', startGame);
requestAnimationFrame(frame);

// Handy for debugging from the console.
window.__game = {
  game, player, fish, ui, U, camera, renderer, post, water, diver, scene, sky, world, fx, input, audio, debug,
  start: startGame,
  give(n) {
    S().shells += n;
    game.persist();
  },
  tp(x, y, z, state = 'under') {
    player.pos.set(x, y, z);
    player.vel.set(0, 0, 0);
    player.state = state;
    player.camInit = true;
  },
  look(yaw, pitch) {
    player.yaw = yaw;
    player.pitch = pitch;
  },
};
