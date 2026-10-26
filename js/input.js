// 画面のスティック(指で動かす操作)

export const AIM_DEAD = 0.25; // これより小さく倒しただけなら「狙っていない」

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
    // 離したときの情報(右スティックで使う)
    this.lastX = 0;
    this.lastY = 0;
    this.maxMag = 0;    // 押している間に、いちばん強く倒した量
    this.release = null; // 離した瞬間に入る。読んだら空にする

    el.addEventListener('pointerdown', (e) => this.onDown(e));
    el.addEventListener('pointermove', (e) => this.onMove(e));
    el.addEventListener('pointerup', (e) => this.onUp(e));
    el.addEventListener('pointercancel', (e) => this.onUp(e));
    el.addEventListener('lostpointercapture', (e) => this.onUp(e));
  }

  get held() { return this.pointerId !== null; }
  get mag() { return Math.hypot(this.x, this.y); }

  onDown(e) {
    if (!this.enabled || this.pointerId !== null) return;
    e.preventDefault();
    this.pointerId = e.pointerId;
    this.maxMag = 0;
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
    this.lastX = dx;
    this.lastY = dy;
    this.maxMag = Math.max(this.maxMag, Math.min(1, len));
    const move = radius * 0.6;
    this.knob.style.transform = `translate(${dx * move}px, ${dy * move}px)`;
  }

  onUp(e) {
    if (e.pointerId !== this.pointerId) return;
    this.pointerId = null;
    this.release = { x: this.lastX, y: this.lastY, maxMag: this.maxMag };
    this.x = 0;
    this.y = 0;
    this.knob.style.transform = '';
    this.el.classList.remove('held');
  }
}

// ゲームが読む入力をまとめる
export class Input {
  constructor(leftStick, rightStick) {
    this.left = leftStick;
    this.right = rightStick;
    this.state = {
      x: 0, y: 0, jumpHeld: false,
      // 右スティック
      aimHeld: false,   // 押しているか
      aim: null,        // 狙っている向き { x, y, mag }(小さく倒しただけなら null)
      release: null,    // 離した瞬間だけ { aim(null ならタップ) , cancel }
    };
  }

  // 1回の計算ごとに呼ぶ
  read() {
    const s = this.state;
    s.x = this.left.x;
    s.y = this.left.y;
    // 上に倒している間はジャンプし続ける(着地するたびにまた跳ぶ)
    s.jumpHeld = this.left.y < -0.55;

    const r = this.right;
    s.aimHeld = r.held;
    s.aim = r.held && r.mag >= AIM_DEAD ? { x: r.x / r.mag, y: r.y / r.mag, mag: Math.min(1, r.mag) } : null;
    s.release = null;
    if (r.release) {
      const rel = r.release;
      r.release = null;
      const lastMag = Math.hypot(rel.x, rel.y);
      if (rel.maxMag < AIM_DEAD) {
        s.release = { aim: null, cancel: false };             // 軽くタップしただけ
      } else if (lastMag < AIM_DEAD) {
        s.release = { aim: null, cancel: true };              // 倒してから真ん中にもどした = やめる
      } else {
        s.release = { aim: { x: rel.x / lastMag, y: rel.y / lastMag, mag: Math.min(1, lastMag) }, cancel: false };
      }
    }
    return s;
  }
}
