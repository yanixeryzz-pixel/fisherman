import { SPECIES, RARITY, UPGRADES, levelInfo } from './config.js';

const $ = (s, r = document) => r.querySelector(s);
const icon = (id, cls = 'ic') => `<svg class="${cls}" aria-hidden="true"><use href="#${id}"/></svg>`;
const fishIcon = (id) => `<svg class="fish-ic" style="color:${SPECIES[id].colors.back}" aria-hidden="true"><use href="#i-fish"/></svg>`;
const ROMAN = ['0', 'I', 'II', 'III', 'IV', 'V'];
const DEPTH_MAX = 36;

export class UI {
  constructor() {
    this.cache = {};
    this.e = {
      hud: $('#hud'),
      shells: $('#shells'),
      lvl: $('#lvl'),
      lvlArc: $('#lvl-arc'),
      o2: $('#o2'),
      o2Fill: $('#o2-fill'),
      o2Needle: $('#o2-needle'),
      o2Val: $('#o2-val'),
      depth: $('#depth'),
      depthMark: $('#depth-mark'),
      depthVal: $('#depth-val'),
      depthLimit: $('#depth-limit'),
      depthLimitVal: $('#depth-limit-val'),
      zone: $('#zone-name'),
      bag: $('#bag'),
      bagCount: $('#bag-count'),
      bagSlots: $('#bag-slots'),
      reticle: $('#reticle'),
      rSweet: $('#r-sweet'),
      rRing: $('#r-ring'),
      target: $('#target'),
      prompt: $('#prompt'),
      hint: $('#hint'),
      marker: $('#marker'),
      toasts: $('#toasts'),
      banner: $('#banner'),
      fade: $('#fade'),
      start: $('#start'),
      play: $('#btn-play'),
      saveSummary: $('#save-summary'),
      sell: $('#sell'),
      shop: $('#shop'),
      shopGrid: $('#shop-grid'),
      pause: $('#pause'),
    };
    this._buildO2();
    this._buildDepth();
  }

  set(key, value, fn) {
    if (this.cache[key] === value) return;
    this.cache[key] = value;
    fn(value);
  }

  _buildO2() {
    const g = $('#o2-ticks');
    let s = '';
    for (let i = 0; i <= 27; i++) {
      const a = ((135 + i * 10) * Math.PI) / 180;
      const major = i % 9 === 0;
      const r0 = major ? 64 : 67, r1 = 72;
      s += `<line class="${major ? 'major' : ''}" x1="${80 + Math.cos(a) * r0}" y1="${80 + Math.sin(a) * r0}" x2="${80 + Math.cos(a) * r1}" y2="${80 + Math.sin(a) * r1}"/>`;
    }
    g.innerHTML = s;
  }

  _buildDepth() {
    const rail = $('#depth-ticks');
    let s = '';
    for (let d = 0; d <= DEPTH_MAX; d += 2) {
      const major = d % 10 === 0;
      s += `<div class="tick ${major ? 'major' : ''}" style="top:${(d / DEPTH_MAX) * 100}%">${major ? `<span>${d}</span>` : ''}</div>`;
    }
    rail.innerHTML = s;
  }

  // ------------------------------------------------------------ screens

  setReady(hasProgress, summary) {
    this.e.play.disabled = false;
    this.e.play.querySelector('span').textContent = hasProgress ? 'Продолжить' : 'Нырнуть';
    this.e.saveSummary.innerHTML = summary || '';
  }

  hideStart() {
    this.e.start.classList.add('leaving');
    setTimeout(() => (this.e.start.hidden = true), 700);
    this.e.hud.hidden = false;
    requestAnimationFrame(() => this.e.hud.classList.add('on'));
  }

  fade(on, color = '#FFF4E3') {
    this.e.fade.style.background = color;
    this.e.fade.classList.toggle('on', on);
  }

  // ------------------------------------------------------------ HUD

  update(d) {
    const e = this.e;
    this.set('shells', d.shells, (v) => (e.shells.textContent = v));
    this.set('lvl', d.level.level, (v) => (e.lvl.textContent = v));
    this.set('lvlP', Math.round(d.level.progress * 100), (v) => (e.lvlArc.style.strokeDashoffset = 100 - v));

    const ratio = Math.max(0, d.o2 / d.o2Max);
    this.set('o2r', Math.round(ratio * 400), () => {
      e.o2Fill.style.strokeDashoffset = 100 - ratio * 100;
      e.o2Needle.setAttribute('transform', `rotate(${135 + ratio * 270} 80 80)`);
    });
    this.set('o2s', Math.ceil(d.o2), (v) => (e.o2Val.textContent = v));
    this.set('o2c', ratio < 0.25 ? 'low' : ratio < 0.5 ? 'mid' : '', (v) => (e.o2.dataset.level = v));
    this.set('o2refill', d.refilling, (v) => e.o2.classList.toggle('refill', v));

    this.set('inWater', d.inWater, (v) => {
      e.depth.classList.toggle('on', v);
      e.bag.classList.toggle('wet', v);
    });
    const depth = Math.max(0, d.depth);
    this.set('depth', Math.round(depth * 10), () => {
      e.depthMark.style.top = `${(Math.min(depth, DEPTH_MAX) / DEPTH_MAX) * 100}%`;
      e.depthVal.textContent = depth.toFixed(1);
    });
    this.set('limit', d.maxDepth, (v) => {
      e.depthLimit.style.top = `${(Math.min(v, DEPTH_MAX) / DEPTH_MAX) * 100}%`;
      e.depthLimitVal.textContent = `${v} м`;
      e.depthLimit.hidden = v >= DEPTH_MAX;
    });
    this.set('over', d.overDepth > 0, (v) => e.depth.classList.toggle('danger', v));
    this.set('zone', d.zoneName, (v) => (e.zone.textContent = v));

    const bagKey = d.bag.map((b) => b.id).join(',') + '/' + d.bagSize;
    this.set('bag', bagKey, () => {
      e.bagCount.textContent = `${d.bag.length}/${d.bagSize}`;
      let s = '';
      for (let i = 0; i < d.bagSize; i++) {
        const it = d.bag[i];
        s += it ? `<span class="slot full r-${SPECIES[it.id].rarity}">${fishIcon(it.id)}</span>` : '<span class="slot"></span>';
      }
      e.bagSlots.innerHTML = s;
      e.bag.classList.toggle('full', d.bag.length >= d.bagSize);
    });

    this._reticle(d);
    this._marker(d.marker);
    this.set('prompt', d.prompt || '', (v) => {
      e.prompt.innerHTML = v;
      e.prompt.classList.toggle('on', !!v);
    });
  }

  _reticle(d) {
    const e = this.e, t = d.target;
    let mode = 'idle';
    if (d.grab) mode = 'grab';
    else if (t) mode = t.locked ? 'locked' : d.bagFull ? 'locked' : 'target';
    this.set('rmode', mode, (v) => (e.reticle.dataset.mode = v));
    this.set('rshow', d.showReticle, (v) => e.reticle.classList.toggle('on', v));
    if (d.grab) {
      const [a, b] = d.grab.sweet;
      const R = (v) => 8 + v * 44;
      e.rSweet.setAttribute('r', R((a + b) / 2));
      e.rSweet.style.strokeWidth = `${(b - a) * 44}px`;
      const ring = 1 - d.grab.t;
      e.rRing.setAttribute('r', R(Math.max(0, ring)));
      e.reticle.classList.toggle('in-zone', ring >= a && ring <= b);
    }
    const key = t ? `${t.id}|${t.locked}|${d.bagFull}` : '';
    this.set('target', key, () => {
      if (!t) {
        e.target.classList.remove('on');
        return;
      }
      const def = SPECIES[t.id], r = RARITY[def.rarity];
      e.target.innerHTML = `<div class="t-name">${def.name}</div>
        <div class="t-meta"><span class="pill r-${def.rarity}">${r.label}</span>
        ${t.locked ? `<span class="t-lock">${icon('i-lock', 'ic sm')} нужен хват ${def.strength}</span>` : d.bagFull ? `<span class="t-lock">${icon('i-bag', 'ic sm')} сумка полна</span>` : `<span class="eye">${icon('i-eye', 'ic sm')}<i><b></b></i></span>`}
        <span class="t-val mono">${icon('i-shell', 'ic sm')}${def.value}</span></div>`;
      e.target.classList.add('on');
    });
    if (t && !t.locked) {
      const bar = e.target.querySelector('.eye b');
      if (bar) {
        bar.style.width = `${Math.min(100, t.awareness * 100)}%`;
        bar.parentElement.parentElement.classList.toggle('alert', t.awareness > 0.6);
      }
    }
  }

  _marker(m) {
    const e = this.e.marker;
    if (!m) {
      this.set('marker', false, () => e.classList.remove('on'));
      return;
    }
    this.set('marker', true, () => e.classList.add('on'));
    e.style.transform = `translate(${m.x}px, ${m.y}px)`;
    this.set('markerText', m.text, (v) => (e.querySelector('span').textContent = v));
    e.classList.toggle('edge', m.edge);
  }

  flash(kind) {
    const r = this.e.reticle;
    r.classList.remove('ok', 'miss');
    void r.offsetWidth;
    r.classList.add(kind);
  }

  hint(text) {
    this.set('hint', text || '', (v) => {
      this.e.hint.textContent = v;
      this.e.hint.classList.toggle('on', !!v);
    });
  }

  toast(html, kind = '') {
    const el = document.createElement('div');
    el.className = `toast ${kind}`;
    el.innerHTML = html;
    this.e.toasts.prepend(el);
    while (this.e.toasts.children.length > 4) this.e.toasts.lastChild.remove();
    setTimeout(() => el.classList.add('out'), 2600);
    setTimeout(() => el.remove(), 3200);
  }

  fishToast(item, isNew) {
    const def = SPECIES[item.id];
    this.toast(
      `${fishIcon(item.id)}<div class="tx"><b>+1 ${def.name}!</b><small>${RARITY[def.rarity].label} · ${item.size.toFixed(2)} м${isNew ? ' · <em>новый вид</em>' : ''}</small></div>
       <div class="tv mono">${icon('i-shell', 'ic sm')}+${item.value}</div>`,
      `fish r-${def.rarity}`,
    );
  }

  banner(kicker, title, sub) {
    const b = this.e.banner;
    b.innerHTML = `<small class="mono">${kicker}</small><h2>${title}</h2><span>${sub}</span>`;
    b.classList.remove('on');
    void b.offsetWidth;
    b.classList.add('on');
    clearTimeout(this._bannerT);
    this._bannerT = setTimeout(() => b.classList.remove('on'), 3400);
  }

  // ------------------------------------------------------------ panels

  openSell(sum, before, after, onShop, onClose) {
    const el = this.e.sell;
    const rows = Object.values(sum.rows)
      .map((r) => `<li>${fishIcon(r.id)}<span class="n">${SPECIES[r.id].name}</span><span class="c mono">×${r.count}</span><span class="v mono">+${r.value}</span></li>`)
      .join('');
    el.querySelector('#sell-list').innerHTML = rows;
    const shellsEl = el.querySelector('#sell-shells'), xpEl = el.querySelector('#sell-xp');
    this._count(shellsEl, sum.shells, '+');
    this._count(xpEl, sum.xp, '+');
    const fill = el.querySelector('#sell-xpbar');
    el.querySelector('#sell-lvl').textContent = `Ур. ${after.level}`;
    fill.style.transition = 'none';
    fill.style.width = `${(after.level > before.level ? 0 : before.progress) * 100}%`;
    requestAnimationFrame(() => {
      fill.style.transition = '';
      fill.style.width = `${after.progress * 100}%`;
    });
    el.querySelector('[data-act="shop"]').onclick = onShop;
    el.querySelector('[data-act="close"]').onclick = onClose;
    el.hidden = false;
    requestAnimationFrame(() => el.classList.add('on'));
  }

  closeSell() {
    const el = this.e.sell;
    el.classList.remove('on');
    setTimeout(() => (el.hidden = true), 350);
  }

  _count(el, to, prefix = '') {
    const t0 = performance.now();
    const step = (now) => {
      const k = Math.min(1, (now - t0) / 900);
      el.textContent = prefix + Math.round(to * (1 - Math.pow(1 - k, 3)));
      if (k < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  openShop(save, onBuy, onClose) {
    this._shopArgs = [save, onBuy, onClose];
    this.renderShop();
    const m = this.e.shop;
    m.querySelector('[data-act="close"]').onclick = onClose;
    m.hidden = false;
    requestAnimationFrame(() => m.classList.add('on'));
  }

  renderShop() {
    const [save, onBuy] = this._shopArgs;
    const lvl = levelInfo(save.xp).level;
    $('#shop-shells').textContent = save.shells;
    $('#shop-lvl').textContent = `Ур. ${lvl}`;
    this.e.shopGrid.innerHTML = UPGRADES.map((u) => {
      const l = save.up[u.id];
      const maxed = l >= u.max;
      const cost = u.cost[l], req = u.req[l];
      const pips = Array.from({ length: u.max }, (_, i) => `<i class="${i < l ? 'on' : ''}"></i>`).join('');
      let btn;
      if (maxed) btn = '<button class="btn btn-buy" disabled><span>Максимум</span></button>';
      else if (lvl < req) btn = `<button class="btn btn-buy" disabled>${icon('i-lock', 'ic sm')}<span>нужен ур. ${req}</span></button>`;
      else btn = `<button class="btn btn-buy" data-up="${u.id}" ${save.shells < cost ? 'disabled' : ''}>${icon('i-shell', 'ic sm')}<span class="mono">${cost}</span></button>`;
      const stat = maxed
        ? `<b>${u.fmt(u.value(l))}</b>`
        : `<span>${u.fmt(u.value(l))}</span>${icon('i-arrow-right', 'ic sm')}<b>${u.fmt(u.value(l + 1))}</b>`;
      return `<article class="card ${maxed ? 'maxed' : ''}">
        <div class="card-top"><span class="card-ic">${icon(u.icon)}</span>
          <div><h3>${u.name} <em class="mono">${ROMAN[l] === '0' ? '' : ROMAN[l]}</em></h3><div class="pips">${pips}</div></div></div>
        <p>${u.desc}</p>
        <div class="card-stat mono">${stat}</div>
        ${btn}
      </article>`;
    }).join('');
    for (const b of this.e.shopGrid.querySelectorAll('[data-up]')) b.onclick = () => onBuy(b.dataset.up);
  }

  closeShop() {
    const m = this.e.shop;
    m.classList.remove('on');
    setTimeout(() => (m.hidden = true), 300);
  }

  openPause(settings, handlers) {
    const m = this.e.pause;
    const sync = () => {
      for (const seg of m.querySelectorAll('.seg')) {
        const key = seg.dataset.act;
        for (const s of seg.querySelectorAll('[data-v]')) s.classList.toggle('on', settings[key] === s.dataset.v);
      }
    };
    sync();
    const vol = m.querySelector('#vol');
    vol.value = settings.volume;
    vol.oninput = () => handlers.volume(+vol.value);
    m.querySelector('[data-act="resume"]').onclick = handlers.resume;
    for (const seg of m.querySelectorAll('.seg')) {
      seg.onclick = () => {
        handlers[seg.dataset.act]();
        sync();
      };
    }
    const reset = m.querySelector('[data-act="reset"]');
    reset.textContent = 'Сбросить прогресс';
    reset.classList.remove('armed');
    reset.onclick = () => {
      if (reset.classList.contains('armed')) handlers.reset();
      else {
        reset.classList.add('armed');
        reset.textContent = 'Точно? Нажми ещё раз';
      }
    };
    m.hidden = false;
    requestAnimationFrame(() => m.classList.add('on'));
  }

  closePause() {
    const m = this.e.pause;
    m.classList.remove('on');
    setTimeout(() => (m.hidden = true), 300);
  }
}
