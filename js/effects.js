// 見た目だけの物理(破片、火花、爆発の光)。
// 各スマホが自分で描くだけで、オンラインでも同期しない。
import { T, SOLID, COLORS as C } from './config.js?v=0.6.3';

const MAX_PARTS = 500;

// ブロックの種類ごとの破片の色
const DEBRIS_COLOR = {
  [T.DIRT]: [C.dirtLine, C.dirt, '#3b4d78'],
  [T.SAND]: [C.sand, C.sandDot, '#a8842f'],
  [T.HARD]: [C.hardLine, C.hard, '#5c6896'],
};

export class Effects {
  constructor(map) {
    this.map = map;
    this.parts = [];  // 破片や火花
    this.blasts = []; // 爆発の光の輪
    this.texts = [];  // ダメージの数字
  }

  clear() {
    this.parts = [];
    this.blasts = [];
    this.texts = [];
  }

  // 浮かび上がって消える文字(ダメージの数字など)
  text(x, y, text, color) {
    this.texts.push({ x: x + (Math.random() - 0.5) * 0.4, y, text, color, age: 0, life: 0.8 });
  }

  // やられたとき: チームの色の破片がはじける
  pop(x, y, color) {
    for (let i = 0; i < 24; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 3 + Math.random() * 9;
      this.add({
        x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 4,
        size: 0.14 + Math.random() * 0.14, color: Math.random() < 0.7 ? color : '#ffffff',
        life: 0.6 + Math.random() * 0.6, age: 0,
        gravity: 25, bounce: true, glow: true,
      });
    }
  }

  add(p) {
    if (this.parts.length >= MAX_PARTS) this.parts.shift();
    this.parts.push(p);
  }

  // ブロック1個ぶんの破片(掘ったとき・爆発のとき)
  debris(tx, ty, type, count = 6, power = 4, from = null) {
    const colors = DEBRIS_COLOR[type] || DEBRIS_COLOR[T.DIRT];
    for (let i = 0; i < count; i++) {
      const x = tx + Math.random();
      const y = ty + Math.random();
      let vx = (Math.random() - 0.5) * power;
      let vy = -Math.random() * power;
      if (from) {
        // 爆発の中心から外へ飛ばす
        const dx = x - from.x, dy = y - from.y;
        const d = Math.hypot(dx, dy) || 1;
        vx += (dx / d) * power * (0.6 + Math.random());
        vy += (dy / d) * power * (0.6 + Math.random()) - power * 0.4;
      }
      this.add({
        x, y, vx, vy,
        size: 0.12 + Math.random() * 0.16,
        color: colors[(Math.random() * colors.length) | 0],
        life: 0.6 + Math.random() * 0.7, age: 0,
        gravity: 30, bounce: true, glow: false,
      });
    }
  }

  // 弾がブロックに当たった火花
  sparks(x, y, color = C.yellow, count = 5) {
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = 3 + Math.random() * 6;
      this.add({
        x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s,
        size: 0.08 + Math.random() * 0.06, color,
        life: 0.15 + Math.random() * 0.2, age: 0,
        gravity: 10, bounce: false, glow: true,
      });
    }
  }

  // 爆発(光の輪と火花)。壊れたブロックの破片は debris で別に出す
  blast(x, y, r) {
    this.blasts.push({ x, y, r, age: 0, life: 0.45 });
    for (let i = 0; i < 26; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = 6 + Math.random() * 14;
      this.add({
        x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 3,
        size: 0.1 + Math.random() * 0.12,
        color: Math.random() < 0.6 ? C.yellow : '#ff8a3d',
        life: 0.25 + Math.random() * 0.35, age: 0,
        gravity: 12, bounce: false, glow: true,
      });
    }
  }

  update(dt) {
    const { map } = this;
    for (const p of this.parts) {
      p.age += dt;
      p.vy += p.gravity * dt;
      const nx = p.x + p.vx * dt;
      const ny = p.y + p.vy * dt;
      if (p.bounce && SOLID[map.get(Math.floor(nx), Math.floor(ny))]) {
        // ブロックに当たったら、はねて止まっていく
        if (SOLID[map.get(Math.floor(p.x), Math.floor(ny))]) { p.vy *= -0.3; p.vx *= 0.6; }
        else { p.vx *= -0.4; }
      } else {
        p.x = nx;
        p.y = ny;
      }
    }
    this.parts = this.parts.filter((p) => p.age < p.life);
    for (const t of this.texts) t.age += dt;
    this.texts = this.texts.filter((t) => t.age < t.life);
    for (const b of this.blasts) b.age += dt;
    this.blasts = this.blasts.filter((b) => b.age < b.life);
  }
}
