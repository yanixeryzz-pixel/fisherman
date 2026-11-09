// Everything is synthesised with WebAudio: no audio files to download.
const mtof = (m) => 440 * 2 ** ((m - 69) / 12);
const CHORDS = [
  [53, 57, 60, 64], // Fmaj7
  [57, 60, 64, 67], // Am7
  [50, 53, 57, 60, 64], // Dm9
  [46, 50, 53, 57], // Bbmaj7
];
const PENTA = [65, 67, 69, 72, 74, 77, 79, 81];
const rand = (a, b) => a + Math.random() * (b - a);

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.volume = 0.8;
    this.muted = false;
    this.under = 0;
    this.gullT = 5;
  }

  init() {
    if (this.ctx) {
      this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = (this.ctx = new AC());
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 3.5;
    comp.connect(ctx.destination);
    this.master = this._gain(this.muted ? 0 : this.volume, comp);
    this.uw = ctx.createBiquadFilter();
    this.uw.type = 'lowpass';
    this.uw.frequency.value = 18000;
    this.uw.Q.value = 0.7;
    this.uw.connect(this.master);
    this.sfx = this._gain(0.9, this.uw);
    this.amb = this._gain(0.8, this.uw);
    this.musicFilter = ctx.createBiquadFilter();
    this.musicFilter.type = 'lowpass';
    this.musicFilter.frequency.value = 16000;
    this.musicFilter.connect(this.master);
    this.music = this._gain(0.26, this.musicFilter);
    this.padFilter = ctx.createBiquadFilter();
    this.padFilter.type = 'lowpass';
    this.padFilter.frequency.value = 1100;
    this.padFilter.connect(this.music);
    this.delay = ctx.createDelay(1.0);
    this.delay.delayTime.value = 0.42;
    const fb = this._gain(0.34);
    const dl = ctx.createBiquadFilter();
    dl.type = 'lowpass';
    dl.frequency.value = 2200;
    this.delay.connect(dl).connect(fb).connect(this.delay);
    dl.connect(this.music);

    this.white = this._noise(3, false);
    this.brown = this._noise(4, true);
    this._ambience();
    this.nextChord = ctx.currentTime + 0.2;
    this.nextPluck = ctx.currentTime + 1.5;
    this.chordIdx = 0;
    this.timer = setInterval(() => this._schedule(), 200);
  }

  _gain(v, dest) {
    const g = this.ctx.createGain();
    g.gain.value = v;
    if (dest) g.connect(dest);
    return g;
  }

  _noise(sec, brown) {
    const ctx = this.ctx, len = Math.floor(sec * ctx.sampleRate);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      if (brown) {
        last = (last + 0.02 * w) / 1.02;
        d[i] = last * 3.5;
      } else d[i] = w;
    }
    return buf;
  }

  _loop(buf) {
    const s = this.ctx.createBufferSource();
    s.buffer = buf;
    s.loop = true;
    s.start();
    return s;
  }

  _ambience() {
    const ctx = this.ctx;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 650;
    bp.Q.value = 0.45;
    this.surfGain = this._gain(0.11, this.amb);
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.11;
    lfo.connect(this._gain(0.07, this.surfGain.gain));
    lfo.start();
    this._loop(this.white).connect(bp).connect(this.surfGain);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 420;
    this.rumble = this._gain(0, this.master);
    this._loop(this.brown).connect(lp).connect(this.rumble);
  }

  _schedule() {
    if (!this.ctx || this.ctx.state !== 'running') return;
    const now = this.ctx.currentTime;
    while (this.nextChord < now + 0.6) {
      this._pad(CHORDS[this.chordIdx % CHORDS.length], this.nextChord, 8.4);
      this.chordIdx++;
      this.nextChord += 8;
    }
    while (this.nextPluck < now + 0.6) {
      if (Math.random() < 0.36) this._pluck(PENTA[Math.floor(Math.random() * PENTA.length)], this.nextPluck);
      this.nextPluck += 0.5;
    }
  }

  _pad(notes, t, dur) {
    const ctx = this.ctx;
    for (const n of notes) {
      for (const [type, det] of [['triangle', -5], ['sine', 6]]) {
        const o = ctx.createOscillator();
        o.type = type;
        o.frequency.value = mtof(n);
        o.detune.value = det;
        const g = ctx.createGain();
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(0.04, t + 2.5);
        g.gain.setValueAtTime(0.04, t + dur - 3);
        g.gain.linearRampToValueAtTime(0, t + dur);
        o.connect(g).connect(this.padFilter);
        o.start(t);
        o.stop(t + dur + 0.1);
      }
    }
    const b = ctx.createOscillator();
    b.frequency.value = mtof(notes[0] - 12);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.07, t + 1.5);
    g.gain.linearRampToValueAtTime(0, t + dur);
    b.connect(g).connect(this.music);
    b.start(t);
    b.stop(t + dur + 0.1);
  }

  _pluck(n, t) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.frequency.value = mtof(n);
    const o2 = ctx.createOscillator();
    o2.type = 'triangle';
    o2.frequency.value = mtof(n) * 2;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.06, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 1.4);
    const g2 = this._gain(0.25);
    o.connect(g);
    o2.connect(g2).connect(g);
    g.connect(this.music);
    g.connect(this.delay);
    o.start(t);
    o2.start(t);
    o.stop(t + 1.5);
    o2.stop(t + 1.5);
  }

  _tone(freq, t, dur, gain, { type = 'sine', to = null, attack = 0.005, dest = this.sfx } = {}) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (to) o.frequency.exponentialRampToValueAtTime(to, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(dest);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  _hiss(t, dur, f0, f1, gain, { type = 'bandpass', q = 0.8, attack = 0.01 } = {}) {
    const ctx = this.ctx;
    const s = ctx.createBufferSource();
    s.buffer = this.white;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.Q.value = q;
    f.frequency.setValueAtTime(f0, t);
    f.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f).connect(g).connect(this.sfx);
    s.start(t, Math.random() * 2);
    s.stop(t + dur + 0.05);
  }

  get ok() {
    return this.ctx && this.ctx.state === 'running';
  }

  splash(s = 1) {
    if (!this.ok) return;
    const t = this.ctx.currentTime;
    this._hiss(t, 0.9, 2600, 380, 0.5 * s, { q: 0.6 });
    this._hiss(t + 0.05, 0.5, 5000, 1500, 0.15 * s, { type: 'highpass' });
    this._tone(130, t, 0.35, 0.35 * s, { to: 45 });
  }

  pop() {
    if (!this.ok) return;
    const t = this.ctx.currentTime;
    this._tone(950, t, 0.1, 0.35, { to: 240 });
    this._tone(1568, t + 0.07, 0.35, 0.09);
    this._tone(2093, t + 0.14, 0.45, 0.08);
  }

  bubbles(n = 4, gain = 0.05) {
    if (!this.ok) return;
    const t = this.ctx.currentTime;
    for (let i = 0; i < n; i++) {
      const f = rand(320, 820);
      this._tone(f, t + i * 0.05 + rand(0, 0.04), 0.07, gain, { to: f * 2.2 });
    }
  }

  exhale() {
    if (!this.ok) return;
    this._hiss(this.ctx.currentTime, 0.7, 500, 900, 0.035, { type: 'lowpass', attack: 0.2 });
    this.bubbles(6, 0.035);
  }

  gasp() {
    if (!this.ok) return;
    this._hiss(this.ctx.currentTime, 0.6, 1600, 900, 0.07, { attack: 0.15, q: 1.2 });
  }

  dash() {
    if (!this.ok) return;
    this._hiss(this.ctx.currentTime, 0.4, 300, 1400, 0.2, { type: 'lowpass', attack: 0.05 });
    this.bubbles(5, 0.04);
  }

  miss() {
    if (!this.ok) return;
    this._hiss(this.ctx.currentTime, 0.25, 1500, 3500, 0.12, { type: 'highpass' });
  }

  reach() {
    if (!this.ok) return;
    this._hiss(this.ctx.currentTime, 0.18, 700, 1300, 0.05, { attack: 0.03 });
  }

  step(wood) {
    if (!this.ok) return;
    const t = this.ctx.currentTime;
    if (wood) {
      this._tone(rand(170, 210), t, 0.06, 0.07, { type: 'triangle' });
      this._hiss(t, 0.05, 900, 400, 0.04);
    } else this._hiss(t, 0.08, 2600, 1200, 0.03);
  }

  jingle() {
    if (!this.ok) return;
    const t = this.ctx.currentTime;
    [72, 76, 79, 84].forEach((n, i) => {
      this._tone(mtof(n), t + i * 0.085, 0.9, 0.11);
      this._tone(mtof(n) * 2.76, t + i * 0.085, 0.35, 0.025);
    });
  }

  levelUp() {
    if (!this.ok) return;
    const t = this.ctx.currentTime;
    [67, 72, 76, 79, 84, 88].forEach((n, i) => {
      this._tone(mtof(n), t + i * 0.07, 1.2, 0.1);
      this._tone(mtof(n) * 2.76, t + i * 0.07, 0.4, 0.02);
    });
  }

  coins(n) {
    if (!this.ok) return;
    const t = this.ctx.currentTime;
    for (let i = 0; i < Math.min(n, 9); i++) this._tone(1760 + i * 110, t + i * 0.07, 0.25, 0.06);
  }

  low() {
    if (!this.ok) return;
    const t = this.ctx.currentTime;
    this._tone(880, t, 0.12, 0.06);
    this._tone(660, t + 0.14, 0.16, 0.05);
  }

  click() {
    if (!this.ok) return;
    this._tone(1300, this.ctx.currentTime, 0.04, 0.04);
  }

  gull() {
    const t = this.ctx.currentTime;
    const n = 2 + Math.floor(Math.random() * 2);
    for (let i = 0; i < n; i++) {
      const s = t + i * 0.28;
      this._tone(2300, s, 0.22, 0.025, { type: 'triangle', to: 1500, attack: 0.02, dest: this.amb });
    }
  }

  setVolume(v) {
    this.volume = v;
    if (this.master) this.master.gain.setTargetAtTime(this.muted ? 0 : v, this.ctx.currentTime, 0.05);
  }

  setMuted(m) {
    this.muted = m;
    this.setVolume(this.volume);
  }

  update(dt, under) {
    if (!this.ok) return;
    const t = this.ctx.currentTime;
    this.under = under;
    this.uw.frequency.setTargetAtTime(18000 * Math.pow(650 / 18000, under), t, 0.05);
    this.surfGain.gain.setTargetAtTime(0.11 * (1 - under), t, 0.1);
    this.rumble.gain.setTargetAtTime(0.32 * under, t, 0.1);
    this.musicFilter.frequency.setTargetAtTime(16000 * Math.pow(1800 / 16000, under), t, 0.1);
    this.gullT -= dt;
    if (this.gullT <= 0) {
      this.gullT = rand(7, 16);
      if (under < 0.5) this.gull();
    }
  }
}
