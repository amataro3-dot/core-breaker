// 練習用の的。左右にうろうろ歩くだけで、撃ち返さない。
// ステップ5で、AIに置きかえる。
import { Player } from './player.js';

export class Dummy extends Player {
  // home: 足もとの位置(ここで生まれて、ここで復活する)。range: 左右に歩く幅
  constructor(team, home, range) {
    super(team, home, '的');
    this.home = home;
    this.range = range;
    this.dir = Math.random() < 0.5 ? -1 : 1;
    this.stuckT = 0;
    this.pauseT = 0;
    this.ctrl = { x: 0, y: 0, jumpHeld: false };
  }

  // 毎回の計算の前に呼ぶ。スティックの代わりに、歩く向きを決める
  think(dt) {
    const c = this.ctrl;
    if (this.pauseT > 0) {
      // 向きを変えるときは、少し立ち止まる
      this.pauseT -= dt;
      c.x = 0;
      return c;
    }
    const turn = () => { this.dir = -this.dir; this.pauseT = 0.4 + Math.random() * 0.8; this.stuckT = 0; };
    if (this.cx < this.home.x - this.range && this.dir < 0) turn();
    else if (this.cx > this.home.x + this.range && this.dir > 0) turn();
    // 壁に当たって進めないときも引き返す
    if (this.onGround && Math.abs(this.vx) < 0.05) this.stuckT += dt;
    else this.stuckT = 0;
    if (this.stuckT > 0.3) turn();
    c.x = this.pauseT > 0 ? 0 : this.dir * 0.65;
    return c;
  }
}
