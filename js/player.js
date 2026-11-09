import * as THREE from 'three';
import { WORLD, ZONES, RARITY, zoneIndexAt } from './config.js';
import { U } from './shaders.js';
import { groundY, walkableY, pierDeckAt } from './world.js';
import { clamp, damp, dampAngle, smoothstep, lerp } from './util.js';

export const STAND_H = 0.92;
const UP = new THREE.Vector3(0, 1, 0);
const P = WORLD.pier, L = WORLD.ladder, B = WORLD.bounds;
const LAMPS = [null, { range: 12, cos: 0.86, i: 2.2 }, { range: 18, cos: 0.83, i: 3.2 }, { range: 26, cos: 0.8, i: 4.2 }];
const LAMP_COL = new THREE.Color('#FFF1D6');
const SWEET_CENTER = 0.3;

const _v = new THREE.Vector3();
const _w = new THREE.Vector3();
const _x = new THREE.Vector3();
const _z = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _qa = new THREE.Quaternion();
const _qb = new THREE.Quaternion();
const _qr = new THREE.Quaternion();

export class Player {
  constructor(ctx) {
    Object.assign(this, ctx); // camera, diver, fish, water, world, fx, audio, ui, game
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.bodyQ = new THREE.Quaternion();
    this.camTarget = new THREE.Vector3();
    this.camPos = new THREE.Vector3();
    this.fwd = new THREE.Vector3();
    this.flat = new THREE.Vector3();
    this.right = new THREE.Vector3();
    this.chest = new THREE.Vector3();
    this.head = new THREE.Vector3();
    this.hand = new THREE.Vector3();
    this.bag = [];
    this.grab = { active: false, t: 0, target: null, sweet: [0, 0], dur: 1.0 };
    this.heldCache = {};
    this.t = 0;
    this.lampSwitch = true;
    this.lampF = 0;
    this.respawn();
  }

  get stats() {
    return this.game.stats;
  }

  get flags() {
    return this.game.save.flags;
  }

  respawn() {
    this.state = 'shore';
    this.pos.set(WORLD.spawn.x, P.deckY + STAND_H, WORLD.spawn.z);
    this.vel.set(0, 0, 0);
    this.yaw = WORLD.spawn.yaw;
    this.pitch = -0.1;
    this.bodyYaw = this.yaw;
    this.bodyQ.setFromAxisAngle(UP, this.bodyYaw + Math.PI);
    this.o2 = this.stats.o2Max;
    this.swimF = 0;
    this.bank = 0;
    this.airT = 0;
    this.diving = false;
    this.dashCD = 0;
    this.dashT = 0;
    this.burst = 0;
    this.fovKick = 0;
    this.heldT = 0;
    this.stowT = 0;
    this.victoryT = 0;
    this.swipeT = 0;
    this.breathT = 2;
    this.rippleT = 0;
    this.stepPh = 0;
    this.lowT = 0;
    this.overDepth = 0;
    this.zone = -1;
    this.nearLadder = false;
    this.grab.active = false;
    this.target = null;
    this.camInit = true;
    this.diver.detachHeld();
  }

  // what the fish perceive
  get view() {
    return {
      pos: this.pos,
      inWater: this.state === 'under' || this.state === 'surface',
      speedNorm: this.vel.length() / this.stats.speed,
      burst: this.burst,
      lampOn: this.lampF > 0.5,
    };
  }

  update(dt, input) {
    this.t += dt;
    const sens = 0.0022;
    this.yaw -= input.dx * sens;
    this.pitch = clamp(this.pitch - input.dy * sens, -1.45, 1.35);
    this.fwd.set(-Math.sin(this.yaw) * Math.cos(this.pitch), Math.sin(this.pitch), -Math.cos(this.yaw) * Math.cos(this.pitch));
    this.flat.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    this.right.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    this.burst = Math.max(0, this.burst - dt * 2);
    this.dashCD -= dt;
    this.dashT -= dt;
    this.swipeT -= dt;
    this.victoryT -= dt;
    const ax = input.axis();

    switch (this.state) {
      case 'shore': this.updateShore(dt, input, ax); break;
      case 'air': this.updateAir(dt); break;
      case 'surface': this.updateSurface(dt, input, ax); break;
      case 'under': this.updateUnder(dt, input, ax); break;
      case 'climb': this.updateClimb(dt); break;
      case 'rescue': this.updateRescue(dt); break;
    }
    if (input.hit('KeyL') && this.stats.lamp > 0) this.lampSwitch = !this.lampSwitch;
    this.updateBody(dt);
    this.updateDiver(dt);
    this.chest.copy(UP).applyQuaternion(this.bodyQ).multiplyScalar(0.42).add(this.pos);
    this.diver.headWorld(this.head);
    this.diver.handWorld(this.hand);
    this.updateCatch(dt, input);
    this.updateHeld(dt);
    this.updateCamera(dt);
    this.updateLamp(dt);
    this.updateZone();
  }

  // ------------------------------------------------------------ movement states

  wish(ax, forward) {
    _v.set(0, 0, 0).addScaledVector(forward, ax.y).addScaledVector(this.right, ax.x);
    if (_v.lengthSq() > 1) _v.normalize();
    return _v;
  }

  updateShore(dt, input, ax) {
    const wish = this.wish(ax, this.flat);
    const wading = walkableY(this.pos.x, this.pos.z) < -0.05;
    const speed = (input.down('ShiftLeft') || input.down('ShiftRight') ? 5.0 : 2.8) * (wading ? 0.6 : 1);
    this.vel.x = damp(this.vel.x, wish.x * speed, 10, dt);
    this.vel.z = damp(this.vel.z, wish.z * speed, 10, dt);
    this.vel.y = 0;
    this.pos.x += this.vel.x * dt;
    this.pos.z += this.vel.z * dt;
    this.clampBounds();
    const gy = walkableY(this.pos.x, this.pos.z);
    if (this.pos.y - STAND_H - gy > 0.6) {
      // stepped off the pier
      this.state = 'air';
      this.airT = 0;
      this.diving = false;
      return;
    }
    if (gy < -1.05) {
      this.state = 'surface';
      return;
    }
    this.pos.y = damp(this.pos.y, gy + STAND_H, 18, dt);
    const sp = Math.hypot(this.vel.x, this.vel.z);
    if (wish.lengthSq() > 0.01) this.bodyYaw = dampAngle(this.bodyYaw, Math.atan2(-wish.x, -wish.z), 10, dt);
    this.stepPh += dt * sp * 1.6;
    if (this.stepPh > 1) {
      this.stepPh -= 1;
      this.audio.step(pierDeckAt(this.pos.x, this.pos.z) > -1);
      if (wading) this.water.addRipple(this.pos.x, this.pos.z, 0.3);
    }
    if (input.hit('Space')) this.jump();
  }

  jump() {
    const onPier = pierDeckAt(this.pos.x, this.pos.z) > -1;
    this.state = 'air';
    this.airT = 0;
    this.diving = true;
    this.vel.y = 4.3;
    const push = onPier ? 3.6 : 1.6;
    this.vel.x = this.vel.x * 0.4 + this.flat.x * push;
    this.vel.z = this.vel.z * 0.4 + this.flat.z * push;
    this.bodyYaw = this.yaw;
    this.audio.step(onPier);
  }

  updateAir(dt) {
    this.airT += dt;
    this.vel.y -= 9.8 * dt;
    this.pos.addScaledVector(this.vel, dt);
    this.clampBounds();
    const gy = walkableY(this.pos.x, this.pos.z);
    const wh = this.water.heightAt(this.pos.x, this.pos.z);
    if (gy > wh - 0.3 && this.pos.y - STAND_H <= gy && this.vel.y <= 0) {
      this.pos.y = gy + STAND_H;
      this.vel.set(0, 0, 0);
      this.state = 'shore';
      return;
    }
    if (this.pos.y < wh + 0.3 && gy < wh - 0.3) {
      const s = clamp(0.5 + Math.abs(this.vel.y) * 0.11, 0.5, 1.4);
      this.splash(s);
      if (this.vel.y < -2.5 || this.diving) {
        this.state = 'under';
        this.vel.multiplyScalar(0.55);
        this.vel.y = Math.min(this.vel.y, -2.2);
        if (!this.flags.dived) {
          this.flags.dived = true;
          this.game.persist();
        }
      } else this.state = 'surface';
    }
  }

  splash(s) {
    this.fx.splash(this.pos, s);
    this.water.addRipple(this.pos.x, this.pos.z, 1.5 * s);
    this.audio.splash(s);
    this.fish.noise(this.pos, 10, 0.7 * s);
    this.fovKick = 0.6;
    this.burst = 1;
  }

  updateSurface(dt, input, ax) {
    const sprint = input.down('ShiftLeft') || input.down('ShiftRight');
    const wish = this.wish(ax, this.flat);
    const speed = this.stats.speed * 0.62 * (sprint ? 1.25 : 1);
    this.vel.x = damp(this.vel.x, wish.x * speed, this.stats.agility * 1.2, dt);
    this.vel.z = damp(this.vel.z, wish.z * speed, this.stats.agility * 1.2, dt);
    this.vel.y = 0;
    this.pos.x += this.vel.x * dt;
    this.pos.z += this.vel.z * dt;
    this.clampBounds();
    this.collide();
    const wh = this.water.heightAt(this.pos.x, this.pos.z);
    this.pos.y = damp(this.pos.y, wh - 0.55, 8, dt);
    this.o2 = Math.min(this.stats.o2Max, this.o2 + this.stats.o2Max * 0.35 * dt);
    if (wish.lengthSq() > 0.01) this.bodyYaw = dampAngle(this.bodyYaw, Math.atan2(-wish.x, -wish.z), 6, dt);
    const sp = Math.hypot(this.vel.x, this.vel.z);
    if (sp > 0.4) {
      this.rippleT -= dt;
      if (this.rippleT <= 0) {
        this.rippleT = 0.5;
        this.water.addRipple(this.pos.x, this.pos.z, 0.35);
      }
    }
    if ((ax.y > 0.2 && this.pitch < -0.32) || input.hit('Space') || input.down('KeyC')) {
      this.state = 'under';
      this.vel.y = -2.2;
      this.vel.addScaledVector(this.flat, 1.0);
      this.water.addRipple(this.pos.x, this.pos.z, 0.8);
      this.audio.splash(0.3);
      this.fx.burst(this.pos, 16, 0.4);
      return;
    }
    if (groundY(this.pos.x, this.pos.z) > -0.75) {
      this.state = 'shore';
      this.landed();
      return;
    }
    this.nearLadder = Math.hypot(this.pos.x - L.x, this.pos.z - L.z) < 2.3;
    if (this.nearLadder && input.hit('KeyE')) this.startClimb();
  }

  updateUnder(dt, input, ax) {
    const sprint = input.down('ShiftLeft') || input.down('ShiftRight');
    const wish = this.wish(ax, this.fwd);
    if (input.down('KeyC')) wish.y -= 0.8;
    const moving = wish.lengthSq() > 0.01;
    const max = this.stats.speed * (sprint ? 1.35 : 1);
    const k = this.stats.agility;
    this.vel.x = damp(this.vel.x, wish.x * max, k, dt);
    this.vel.y = damp(this.vel.y, wish.y * max, k, dt);
    this.vel.z = damp(this.vel.z, wish.z * max, k, dt);
    if (!moving) this.vel.y += 0.5 * dt;
    if (input.hit('Space') && this.dashCD <= 0) {
      this.vel.addScaledVector(this.fwd, 4.6 + this.game.save.up.fins * 0.3);
      this.dashCD = 1.1;
      this.dashT = 0.45;
      this.o2 -= 1;
      this.burst = 1.2;
      this.fovKick = 1;
      this.fx.burst(this.pos, 18, 0.3, 0.012, 0.05, 0.6);
      this.audio.dash();
      this.fish.noise(this.pos, 6, 0.5);
    }
    this.pos.addScaledVector(this.vel, dt);
    this.clampBounds();
    this.collide();
    const gy = groundY(this.pos.x, this.pos.z);
    if (this.pos.y < gy + 0.55) {
      this.pos.y = gy + 0.55;
      if (this.vel.y < 0) this.vel.y *= -0.1;
    }
    const depth = -this.pos.y;
    this.overDepth = Math.max(0, depth - this.stats.maxDepth);
    if (this.overDepth > 0) this.vel.y += (2 + this.overDepth * 5) * dt;
    this.o2 -= dt * (1 + depth / 45) * (sprint && moving ? 1.4 : 1);
    if (this.o2 <= 0) {
      this.o2 = 0;
      this.startRescue();
      return;
    }
    if (this.o2 / this.stats.o2Max < 0.25) {
      this.lowT -= dt;
      if (this.lowT <= 0) {
        this.lowT = 1.1;
        this.audio.low();
      }
    }
    this.breathT -= dt;
    if (this.breathT <= 0) {
      this.breathT = 3.4;
      this.fx.burst(this.head, 12, 0.05, 0.012, 0.05, 0.25);
      this.audio.exhale();
    }
    const wh = this.water.heightAt(this.pos.x, this.pos.z);
    if (this.pos.y > wh - 0.55 && this.vel.y > -0.3) {
      this.state = 'surface';
      this.overDepth = 0;
      this.water.addRipple(this.pos.x, this.pos.z, 0.9);
      if (this.o2 < this.stats.o2Max * 0.85) this.audio.gasp();
    }
  }

  startClimb() {
    this.state = 'climb';
    this.climbT = 0;
    this.climbFrom = this.pos.clone();
    this.vel.set(0, 0, 0);
    this.bodyYaw = Math.PI;
    this.grab.active = false;
  }

  updateClimb(dt) {
    this.climbT += dt / 1.7;
    const t = Math.min(1, this.climbT);
    const lz = P.z0 - 0.4;
    if (t < 0.7) {
      const k = smoothstep(0, 1, t / 0.7);
      this.pos.set(lerp(this.climbFrom.x, L.x, Math.min(1, k * 3)), lerp(this.climbFrom.y, P.deckY + STAND_H - 0.15, k), lerp(this.climbFrom.z, lz, Math.min(1, k * 3)));
    } else {
      const k = smoothstep(0, 1, (t - 0.7) / 0.3);
      this.pos.set(L.x, P.deckY + STAND_H - 0.15 + Math.sin(k * Math.PI) * 0.25 + k * 0.15, lerp(lz, P.z0 + 1.0, k));
    }
    if (t >= 1) {
      this.state = 'shore';
      this.yaw = Math.PI;
      this.landed();
    }
  }

  landed() {
    this.o2 = this.stats.o2Max;
    this.overDepth = 0;
    if (this.bag.length) this.game.sell(this.bag.splice(0));
  }

  startRescue() {
    this.state = 'rescue';
    this.rescueT = 0;
    this.grab.active = false;
    this.ui.fade(true);
    this.audio.gasp();
  }

  updateRescue(dt) {
    this.rescueT += dt;
    this.pos.y += dt * 1.2;
    if (this.rescueT > 0.9 && !this.rescued) {
      this.rescued = true;
      const lost = this.bag.length;
      this.bag.length = 0;
      this.respawn();
      this.state = 'rescue';
      this.rescueT = 0.95;
      this.ui.toast(
        `<svg class="ic"><use href="#i-o2"/></svg><div class="tx"><b>Воздух закончился</b><small>Лодка подобрала тебя у пирса${lost ? ` · улов уплыл (${lost})` : ''}</small></div>`,
        'warn',
      );
    }
    if (this.rescueT > 1.9) {
      this.rescued = false;
      this.state = 'shore';
      this.ui.fade(false);
    }
  }

  collide() {
    for (const c of this.world.colliders) {
      if (c.post) {
        if (this.pos.y > P.deckY) continue;
        const dx = this.pos.x - c.x, dz = this.pos.z - c.z;
        const d = Math.hypot(dx, dz), r = c.r + 0.25;
        if (d < r && d > 1e-4) {
          this.pos.x = c.x + (dx / d) * r;
          this.pos.z = c.z + (dz / d) * r;
        }
      } else {
        const dx = this.pos.x - c.x, dy = this.pos.y - c.y, dz = this.pos.z - c.z;
        const d = Math.hypot(dx, dy, dz), r = c.r + 0.35;
        if (d < r && d > 1e-4) {
          const k = r / d;
          this.pos.set(c.x + dx * k, c.y + dy * k, c.z + dz * k);
          const n = _w.set(dx / d, dy / d, dz / d);
          const vn = this.vel.dot(n);
          if (vn < 0) this.vel.addScaledVector(n, -vn);
        }
      }
    }
  }

  clampBounds() {
    this.pos.x = clamp(this.pos.x, B.xMin, B.xMax);
    this.pos.z = clamp(this.pos.z, B.zMin, B.zMax);
  }

  // ------------------------------------------------------------ body & animation

  swimQuat(dir, out) {
    const Y = _w.copy(dir).normalize();
    _z.set(0, -1, 0).addScaledVector(Y, Y.y);
    if (_z.lengthSq() < 1e-4) _z.copy(this.flat);
    _z.normalize();
    _x.crossVectors(Y, _z);
    _m.makeBasis(_x, Y, _z);
    return out.setFromRotationMatrix(_m);
  }

  updateBody(dt) {
    const upright = _qa.setFromAxisAngle(UP, this.bodyYaw + Math.PI);
    const target = _qb.copy(upright);
    const sp = this.vel.length();
    if (this.state === 'under' || this.state === 'rescue') {
      this.swimF = damp(this.swimF, smoothstep(0.35, 1.6, sp) * 0.83 + 0.12, 4, dt);
      const prevYaw = this.bodyYaw;
      this.bodyYaw = dampAngle(this.bodyYaw, sp > 0.3 ? Math.atan2(-this.vel.x, -this.vel.z) : this.yaw, 3, dt);
      const yawRate = (this.bodyYaw - prevYaw) / Math.max(dt, 1e-3);
      this.bank = damp(this.bank, clamp(yawRate * 0.25, -0.5, 0.5), 4, dt);
      const dir = sp > 0.2 ? _v.copy(this.vel) : _v.copy(this.flat);
      const swim = this.swimQuat(dir, new THREE.Quaternion());
      swim.multiply(_qr.setFromAxisAngle(UP, this.bank));
      target.copy(upright).slerp(swim, this.swimF);
    } else if (this.state === 'air' && this.diving) {
      const s = smoothstep(0.1, 0.7, this.airT);
      target.copy(upright).slerp(this.swimQuat(_v.copy(this.vel), new THREE.Quaternion()), s);
    } else if (this.state === 'surface') {
      this.swimF = damp(this.swimF, sp > 0.4 ? 0.3 : 0.06, 4, dt);
      target.copy(upright).slerp(this.swimQuat(_v.copy(this.flat), new THREE.Quaternion()), this.swimF);
    } else {
      this.swimF = 0;
    }
    this.bodyQ.slerp(target, 1 - Math.exp(-8 * dt));
  }

  updateDiver(dt) {
    let state = 'stand', speed = this.vel.length(), intensity = 0, tilt = 0;
    switch (this.state) {
      case 'shore':
        speed = Math.hypot(this.vel.x, this.vel.z);
        state = this.victoryT > 0 ? 'victory' : speed > 0.3 ? 'walk' : 'stand';
        break;
      case 'air': state = this.diving ? 'dive' : 'stand'; break;
      case 'surface': state = 'tread'; break;
      case 'under':
        state = this.dashT > 0 ? 'dash' : speed > 0.6 ? 'swim' : 'hover';
        intensity = clamp(speed / this.stats.speed, 0, 1.5);
        tilt = this.swimF;
        break;
      case 'climb': state = 'climb'; break;
      case 'rescue': state = 'hover'; break;
    }
    const reach = this.grab.active ? smoothstep(0, 0.85, this.grab.t) : this.swipeT > 0 ? 1 : 0;
    this.diver.update(dt, {
      state, speed, intensity, tilt, reach,
      hold: (this.heldT > 0 || this.victoryT > 0) && !this.grab.active,
      stow: this.stowT > 0,
      struggle: this.heldT > 0,
    });
    this.diver.root.position.copy(this.pos);
    this.diver.root.quaternion.copy(this.bodyQ);
    this.diver.root.updateMatrixWorld(true);
  }

  // ------------------------------------------------------------ catching

  updateCatch(dt, input) {
    const g = this.grab;
    if (this.state !== 'under') {
      if (g.active) g.active = false;
      this.target = null;
      this.fish.highlight = null;
      return;
    }
    const origin = _v.copy(this.chest).addScaledVector(this.fwd, 0.25);
    const reach = this.stats.reach;
    if (!g.active) this.target = this.fish.findTarget(this.camera.position, this.fwd, origin, reach, 0.94);
    this.fish.highlight = this.target;
    const full = this.bag.length >= this.stats.bag;

    if (input.mousePressed) {
      if (this.heldT > 0) this.beginStow();
      if (full) {
        this.ui.toast('<svg class="ic"><use href="#i-bag"/></svg><div class="tx"><b>Сумка полна</b><small>Всплывай и сдай улов у пирса</small></div>', 'warn');
        this.audio.miss();
      } else if (this.target && this.target.def.strength > this.stats.strength) {
        this.ui.toast(`<svg class="ic"><use href="#i-hand"/></svg><div class="tx"><b>Слишком крупная</b><small>Нужен хват ${this.target.def.strength} — улучши в мастерской</small></div>`, 'warn');
        this.audio.miss();
      } else if (this.target) {
        const h = this.target.def.sweet + this.stats.sweetBonus;
        g.active = true;
        g.t = 0;
        g.target = this.target;
        g.sweet = [Math.max(0.04, SWEET_CENTER - h), SWEET_CENTER + h];
        this.audio.reach();
      } else {
        this.swipeT = 0.35;
        this.audio.reach();
        this.fish.noise(this.pos, 3, 0.2);
      }
    }
    if (g.active) {
      g.t += dt / g.dur;
      const f = g.target;
      f.awareness += 0.18 * dt;
      const dist = f.pos.distanceTo(origin);
      if (!f.alive || f.state === 'flee' || dist > reach * 1.4) this.grabFail('Уплыла!');
      else if (input.mouseReleased || !input.mouseDown) {
        const ring = 1 - g.t;
        if (ring >= g.sweet[0] && ring <= g.sweet[1]) this.grabSuccess(f);
        else this.grabFail(ring > g.sweet[1] ? 'Рано!' : 'Поздно!');
      } else if (g.t >= 1) this.grabFail('Поздно!');
    }
  }

  grabFail(msg) {
    const f = this.grab.target;
    this.grab.active = false;
    if (f && f.alive) this.fish.startle(f, this.pos);
    this.ui.toast(`<div class="tx"><b>${msg}</b><small>Рыба ускользнула</small></div>`, 'miss');
    this.ui.flash('miss');
    this.audio.miss();
    this.swipeT = 0.3;
  }

  grabSuccess(f) {
    const info = this.fish.capture(f);
    const def = info.def;
    const value = Math.max(1, Math.round(def.value * (info.size / def.size) ** 2));
    const item = { id: def.id, size: info.size, value, xp: def.xp };
    this.bag.push(item);
    this.grab.active = false;
    this.holdFish(item, 2.6);
    const isNew = !this.game.save.caught[def.id];
    this.ui.fishToast(item, isNew);
    this.ui.flash('ok');
    this.audio.pop();
    this.fx.sparkle(this.hand, RARITY[def.rarity].color);
    this.fx.burst(this.hand, 10, 0.1);
    if (!this.flags.caught) {
      this.flags.caught = true;
      this.game.persist();
    }
  }

  holdFish(item, seconds) {
    let mesh = this.heldCache[item.id];
    if (!mesh) mesh = this.heldCache[item.id] = this.fish.makeHeld(item.id);
    this.diver.attachHeld(mesh, item.size);
    this.heldItem = item;
    this.heldT = seconds;
    this.stowT = 0;
    this.heldPhase = 0;
  }

  trophy(item) {
    this.holdFish(item, 3.4);
    this.victoryT = 3.4;
    this.bodyYaw = this.yaw + Math.PI;
  }

  beginStow() {
    this.heldT = 0;
    this.victoryT = 0;
    this.stowT = 0.4;
  }

  updateHeld(dt) {
    const h = this.diver.held;
    if (!h) return;
    const u = h.userData.uHeld.value;
    const thrash = Math.sin(this.t * 1.7) > 0.6 ? 1 : 0;
    this.heldPhase += dt * (13 + 6 * Math.sin(this.t * 3.1) + thrash * 10);
    u.x = this.heldPhase;
    u.y = 1.4 + 0.6 * Math.sin(this.t * 6.3) + thrash * 0.9;
    h.rotation.x = Math.sin(this.t * 17) * (thrash ? 0.18 : 0.05);
    if (this.heldT > 0) {
      this.heldT -= dt;
      if (this.heldT <= 0) this.beginStow();
    }
    if (this.stowT > 0) {
      this.stowT -= dt;
      h.scale.setScalar(this.heldItem.size * Math.max(0.01, this.stowT / 0.4));
      if (this.stowT <= 0) this.diver.detachHeld();
    }
  }

  // ------------------------------------------------------------ camera, lamp, zones

  updateCamera(dt) {
    const fp = this.game.save.settings.view === 'first';
    const tgt = _v.copy(this.chest);
    if (this.state === 'shore' || this.state === 'climb') tgt.y = this.pos.y + 0.55;
    if (this.camInit) {
      this.camTarget.copy(tgt);
      this.camInit = false;
    } else this.camTarget.lerp(tgt, 1 - Math.exp(-14 * dt));
    const under = this.state === 'under' || this.state === 'rescue';
    if (fp) {
      this.camPos.copy(this.head).addScaledVector(this.fwd, 0.1);
    } else {
      // over the shoulder, so the diver never hides what the reticle points at
      const dist = under ? 3.2 : 3.9;
      this.camPos.copy(this.camTarget).addScaledVector(this.fwd, -dist).addScaledVector(this.right, under ? 0.8 : 0.55);
      this.camPos.y += under ? 0.35 : 0.3;
      // in the water the pier deck is a ceiling, not a floor
      const wet = under || this.state === 'surface';
      const gy = wet ? groundY(this.camPos.x, this.camPos.z) : walkableY(this.camPos.x, this.camPos.z);
      if (this.camPos.y < gy + 0.35) this.camPos.y = gy + 0.35;
      if (wet && pierDeckAt(this.camPos.x, this.camPos.z) > -1) this.camPos.y = Math.min(this.camPos.y, P.deckY - 0.35);
    }
    const wh = this.water.heightAt(this.camPos.x, this.camPos.z);
    if (Math.abs(this.camPos.y - wh) < 0.22) this.camPos.y = under ? wh - 0.22 : wh + 0.22;
    const cam = this.camera;
    cam.position.copy(this.camPos);
    const camUnder = this.camPos.y < wh;
    if (camUnder) cam.position.y += Math.sin(this.t * 0.9) * 0.025;
    cam.rotation.set(this.pitch, this.yaw, camUnder ? Math.sin(this.t * 0.7) * 0.012 : 0, 'YXZ');
    this.fovKick = damp(this.fovKick, 0, 3, dt);
    const fov = (camUnder ? 74 : 70) + this.fovKick * 8;
    cam.fov = damp(cam.fov, fov, 6, dt);
    cam.updateProjectionMatrix();
    this.focus = fp ? (this.target ? this.target.pos.distanceTo(cam.position) : 6) : this.camTarget.distanceTo(cam.position);
  }

  updateLamp(dt) {
    const lvl = this.stats.lamp;
    const want = lvl > 0 && this.lampSwitch && (this.state === 'under' || this.state === 'rescue');
    this.lampF = damp(this.lampF, want ? 1 : 0, 6, dt);
    if (!lvl || this.lampF < 0.01) {
      U.uLampRange.value = 0;
      this.fx.setBeam(this.head, this.fwd, 0, 1);
      return;
    }
    const Lp = LAMPS[lvl];
    U.uLampPos.value.copy(this.head);
    U.uLampDir.value.copy(this.fwd);
    U.uLampRange.value = Lp.range;
    U.uLampCos.value = Lp.cos;
    U.uLampColor.value.copy(LAMP_COL).multiplyScalar(Lp.i * this.lampF);
    const depth = Math.max(0, -this.pos.y);
    this.fx.setBeam(_w.copy(this.head).addScaledVector(this.fwd, 0.25), this.fwd, this.lampF * (0.25 + smoothstep(4, 22, depth) * 0.75), Lp.range * 0.8);
  }

  updateZone() {
    if (this.state !== 'under' && this.state !== 'surface') return;
    const zi = zoneIndexAt(this.pos.z);
    if (zi === this.zone) return;
    const first = this.zone === -1;
    this.zone = zi;
    const z = ZONES[zi];
    if (!first || zi > 0) this.ui.banner(`Зона ${zi + 1}`, z.name, z.range);
  }

  // ------------------------------------------------------------ HUD data

  hint() {
    const r = this.o2 / this.stats.o2Max;
    if (this.state === 'under' && r < 0.25) return 'Воздух на исходе — всплывай!';
    if (this.overDepth > 0) return `Костюм держит только ${this.stats.maxDepth} м — улучши гидрокостюм в мастерской`;
    if (this.state === 'under' && this.bag.length >= this.stats.bag) return 'Сумка полна — всплыви и доплыви до лестницы у пирса';
    if (this.grab.active && !this.flags.caught) return 'Отпусти ЛКМ, когда кольцо войдёт в бирюзовую зону';
    if (this.state === 'under' && this.target && !this.flags.caught) return 'Зажми ЛКМ, чтобы потянуться к рыбе';
    if (this.state === 'under' && !this.flags.caught) return 'Подплывай к рыбе сзади и медленно — так она тебя не заметит';
    if (this.state === 'surface' && this.bag.length) return 'Плыви к лестнице на конце пирса — там скупщик';
    if (this.state === 'surface' && !this.flags.caught) return 'Посмотри вниз и нажми W или Пробел, чтобы нырнуть';
    if (this.state === 'shore' && !this.flags.dived) return 'Подойди к краю пирса и нажми Пробел — прыжок в воду';
    return '';
  }

  prompt() {
    if (this.state === 'surface' && this.nearLadder) return '<kbd>E</kbd> Подняться на пирс';
    if (this.state === 'surface') return '<kbd>Пробел</kbd> Нырнуть';
    if (this.state === 'shore') {
      if (Math.hypot(this.pos.x - WORLD.shop.x, this.pos.z - WORLD.shop.z) < 7) return '<kbd>U</kbd> Мастерская';
      if (pierDeckAt(this.pos.x, this.pos.z) > -1) return '<kbd>Пробел</kbd> Прыжок в воду';
    }
    return '';
  }

  marker(w, h) {
    if (this.state !== 'surface' && this.state !== 'under') return null;
    if (!this.bag.length && this.state === 'under') return null;
    const p = _w.set(L.x, 1.2, P.z0 - 0.1);
    const dist = Math.hypot(this.pos.x - p.x, this.pos.z - p.z);
    if (dist < 3) return null;
    p.project(this.camera);
    let x = p.x, y = p.y;
    const behind = p.z > 1;
    if (behind) { x = -x; y = -y; }
    const m = 0.86;
    const edge = behind || Math.abs(x) > m || Math.abs(y) > m;
    if (edge) {
      const k = m / Math.max(Math.abs(x), Math.abs(y), 1e-3);
      x *= k;
      y *= k;
    }
    return { x: (x * 0.5 + 0.5) * w, y: (-y * 0.5 + 0.5) * h, text: `Пирс · ${Math.round(dist)} м`, edge };
  }

  hud(w, h) {
    const t = this.target;
    return {
      o2: this.o2,
      o2Max: this.stats.o2Max,
      refilling: this.state === 'surface' && this.o2 < this.stats.o2Max - 0.5,
      inWater: this.state === 'under' || this.state === 'surface',
      depth: Math.max(0, -this.pos.y - 0.4),
      maxDepth: this.stats.maxDepth,
      overDepth: this.overDepth,
      zoneName: this.state === 'under' || this.state === 'surface' ? ZONES[Math.max(0, this.zone)].name : 'Пирс',
      bag: this.bag,
      bagSize: this.stats.bag,
      bagFull: this.bag.length >= this.stats.bag,
      target: t ? { id: t.def.id, locked: t.def.strength > this.stats.strength, awareness: t.awareness } : null,
      grab: this.grab.active ? this.grab : null,
      showReticle: this.state === 'under',
      prompt: this.prompt(),
      marker: this.marker(w, h),
    };
  }
}
