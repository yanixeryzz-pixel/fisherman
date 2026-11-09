// Keyboard, pointer-lock mouse and an optional touch layer, all collapsed into one per-frame snapshot.
export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.keys = new Set();
    this.pressed = new Set();
    this.dx = 0;
    this.dy = 0;
    this.mouseDown = false;
    this.mousePressed = false;
    this.mouseReleased = false;
    this.locked = false;
    this.onLockChange = null;
    this.touch = { x: 0, y: 0 };
    this.touchEnabled = false;

    addEventListener('keydown', (e) => {
      if (e.code === 'Tab' || e.code === 'Space') e.preventDefault();
      if (!e.repeat) this.pressed.add(e.code);
      this.keys.add(e.code);
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => {
      this.keys.clear();
      if (this.mouseDown) this._release();
    });
    addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      this.dx += e.movementX;
      this.dy += e.movementY;
    });
    canvas.addEventListener('mousedown', (e) => {
      if (e.button !== 0 || !this.locked) return;
      this.mouseDown = true;
      this.mousePressed = true;
    });
    addEventListener('mouseup', (e) => {
      if (e.button === 0 && this.mouseDown) this._release();
    });
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === canvas;
      if (!this.locked && this.mouseDown) this._release();
      this.onLockChange?.(this.locked);
    });
  }

  _release() {
    this.mouseDown = false;
    this.mouseReleased = true;
  }

  requestLock() {
    if (this.touchEnabled || !this.canvas.requestPointerLock) return;
    try {
      const p = this.canvas.requestPointerLock();
      if (p && p.catch) p.catch(() => {});
    } catch {
      /* not allowed without a gesture; the player clicks the canvas instead */
    }
  }

  exitLock() {
    if (document.pointerLockElement) document.exitPointerLock();
  }

  down(code) {
    return this.keys.has(code);
  }

  hit(code) {
    return this.pressed.has(code);
  }

  axis() {
    const k = (c) => (this.keys.has(c) ? 1 : 0);
    return {
      x: k('KeyD') + k('ArrowRight') - k('KeyA') - k('ArrowLeft') + this.touch.x,
      y: k('KeyW') + k('ArrowUp') - k('KeyS') - k('ArrowDown') + this.touch.y,
    };
  }

  endFrame() {
    this.pressed.clear();
    this.dx = 0;
    this.dy = 0;
    this.mousePressed = false;
    this.mouseReleased = false;
  }

  enableTouch(root) {
    this.touchEnabled = true;
    root.hidden = false;
    const stick = root.querySelector('#stick');
    const knob = stick.querySelector('.stick-knob');
    let stickId = null, lookId = null, lx = 0, ly = 0;
    const R = 46;
    stick.addEventListener('pointerdown', (e) => {
      stickId = e.pointerId;
      stick.setPointerCapture(e.pointerId);
    });
    stick.addEventListener('pointermove', (e) => {
      if (e.pointerId !== stickId) return;
      const r = stick.getBoundingClientRect();
      let x = e.clientX - (r.left + r.width / 2), y = e.clientY - (r.top + r.height / 2);
      const l = Math.hypot(x, y);
      if (l > R) { x *= R / l; y *= R / l; }
      knob.style.transform = `translate(${x}px, ${y}px)`;
      this.touch.x = x / R;
      this.touch.y = -y / R;
    });
    const endStick = (e) => {
      if (e.pointerId !== stickId) return;
      stickId = null;
      knob.style.transform = '';
      this.touch.x = this.touch.y = 0;
    };
    stick.addEventListener('pointerup', endStick);
    stick.addEventListener('pointercancel', endStick);
    this.canvas.addEventListener('pointerdown', (e) => {
      if (e.pointerType !== 'touch') return;
      lookId = e.pointerId;
      lx = e.clientX;
      ly = e.clientY;
    });
    this.canvas.addEventListener('pointermove', (e) => {
      if (e.pointerId !== lookId) return;
      this.dx += (e.clientX - lx) * 1.6;
      this.dy += (e.clientY - ly) * 1.6;
      lx = e.clientX;
      ly = e.clientY;
    });
    const endLook = (e) => { if (e.pointerId === lookId) lookId = null; };
    this.canvas.addEventListener('pointerup', endLook);
    this.canvas.addEventListener('pointercancel', endLook);
    for (const b of root.querySelectorAll('[data-k]')) {
      const k = b.dataset.k;
      b.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        if (k === 'grab') {
          this.mouseDown = true;
          this.mousePressed = true;
        } else {
          this.pressed.add(k);
          this.keys.add(k);
        }
      });
      const up = () => {
        if (k === 'grab') { if (this.mouseDown) this._release(); } else this.keys.delete(k);
      };
      b.addEventListener('pointerup', up);
      b.addEventListener('pointercancel', up);
    }
  }
}
