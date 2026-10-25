// 画面のスティック(指で動かす操作)

export class Stick {
  // el: スティック全体の要素。指はこの範囲で受け付ける
  constructor(el) {
    this.el = el;
    this.base = el.querySelector('.stick-base');
    this.knob = el.querySelector('.stick-knob');
    this.x = 0;
    this.y = 0;
    this.pointerId = null;
    this.enabled = true;

    el.addEventListener('pointerdown', (e) => this.onDown(e));
    el.addEventListener('pointermove', (e) => this.onMove(e));
    el.addEventListener('pointerup', (e) => this.onUp(e));
    el.addEventListener('pointercancel', (e) => this.onUp(e));
    el.addEventListener('lostpointercapture', (e) => this.onUp(e));
  }

  onDown(e) {
    if (!this.enabled || this.pointerId !== null) return;
    e.preventDefault();
    this.pointerId = e.pointerId;
    try { this.el.setPointerCapture(e.pointerId); } catch (_) { /* 古い端末では無視 */ }
    this.el.classList.add('held');
    this.onMove(e);
  }

  onMove(e) {
    if (e.pointerId !== this.pointerId) return;
    e.preventDefault();
    const r = this.base.getBoundingClientRect();
    const radius = r.width / 2;
    let dx = (e.clientX - (r.left + radius)) / radius;
    let dy = (e.clientY - (r.top + radius)) / radius;
    const len = Math.hypot(dx, dy);
    if (len > 1) { dx /= len; dy /= len; }
    this.x = dx;
    this.y = dy;
    const move = radius * 0.6;
    this.knob.style.transform = `translate(${dx * move}px, ${dy * move}px)`;
  }

  onUp(e) {
    if (e.pointerId !== this.pointerId) return;
    this.pointerId = null;
    this.x = 0;
    this.y = 0;
    this.knob.style.transform = '';
    this.el.classList.remove('held');
  }
}

// ゲームが読む入力をまとめる
export class Input {
  constructor(leftStick) {
    this.left = leftStick;
    this.prevUp = false;
    this.state = { x: 0, y: 0, jumpPressed: false };
  }

  // 1回の計算ごとに呼ぶ
  read() {
    const up = this.left.y < -0.55;
    this.state.x = this.left.x;
    this.state.y = this.left.y;
    this.state.jumpPressed = up && !this.prevUp; // 上に倒した瞬間だけジャンプ
    this.prevUp = up;
    return this.state;
  }
}
