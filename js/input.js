// 画面のスティック(指で動かす操作)

export const AIM_DEAD = 0.25; // これより小さく倒しただけなら「狙っていない」
// 照準線が指の向きに追いつく速さ(大きいほど速い)。約0.15秒でほぼ追いつく
const AIM_FOLLOW = 20;
const STEP = 1 / 60;

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
    this.smooth = null; // 画面に出ている照準の向き { ang, mag }(指に少し遅れてついてくる)
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
    if (r.held && r.mag >= AIM_DEAD) {
      // 照準の向きを、指の向きへ少しずつ近づける(最初はすぐその向き)
      const ang = Math.atan2(r.y, r.x);
      const mag = Math.min(1, r.mag);
      if (!this.smooth) {
        this.smooth = { ang, mag };
      } else {
        const k = 1 - Math.exp(-AIM_FOLLOW * STEP);
        let diff = ang - this.smooth.ang;
        diff = Math.atan2(Math.sin(diff), Math.cos(diff)); // いちばん近い回り方で
        this.smooth.ang += diff * k;
        this.smooth.mag += (mag - this.smooth.mag) * k;
      }
      s.aim = { x: Math.cos(this.smooth.ang), y: Math.sin(this.smooth.ang), mag: this.smooth.mag };
    } else {
      s.aim = null;
    }
    s.release = null;
    if (r.release) {
      const rel = r.release;
      r.release = null;
      const lastMag = Math.hypot(rel.x, rel.y);
      if (rel.maxMag < AIM_DEAD) {
        s.release = { aim: null, cancel: false };             // 軽くタップしただけ
      } else if (lastMag < AIM_DEAD) {
        s.release = { aim: null, cancel: true };              // 倒してから真ん中にもどした = やめる
      } else if (this.smooth) {
        // 画面に出ていた照準の向きで使う(見えていたとおりに飛ぶ)
        const sm = this.smooth;
        s.release = { aim: { x: Math.cos(sm.ang), y: Math.sin(sm.ang), mag: sm.mag }, cancel: false };
      } else {
        // 照準が出る前に、すばやくはじいて離した: 指の向きで使う
        s.release = { aim: { x: rel.x / lastMag, y: rel.y / lastMag, mag: Math.min(1, lastMag) }, cancel: false };
      }
    }
    if (!r.held) this.smooth = null;
    return s;
  }
}
