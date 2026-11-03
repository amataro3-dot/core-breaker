// 空から落ちてくるアイテム箱(v0.8)。30秒ごとに、まん中あたりにパラシュートで落ちてくる。
// 地面に着いたら、その場所のブロックが「アイテム箱」になる(さわるか掘ると開く)。
// この計算はホスト(ひとりで遊ぶときは自分)だけが行う。着いた箱は、変わったブロックとして全員に届く。
import { T, SOLID } from './config.js?v=0.9';

export const DROP = {
  every: 20,     // 何秒ごとに落ちてくるか(v0.8.1 で 30 → 20)
  fall: 3.2,     // 落ちる速さ(マス/秒。パラシュートでゆっくり)
  spread: 9,     // まん中から左右何マスの間に落ちるか
};

export class Drops {
  // world: { map, terrain, effects, match }
  constructor(world, hooks = {}) {
    this.world = world;
    this.hooks = hooks; // { spawned(drop), landed(tx, ty) }
    this.reset();
  }

  reset() {
    this.list = [];       // 落ちている箱 { x, y, sway }
    this.t = DROP.every;  // 次に落ちてくるまで
  }

  update(dt) {
    const { map, match } = this.world;
    if (match.state !== 'play') return;
    this.t -= dt;
    if (this.t <= 0) {
      this.t = DROP.every;
      const x = Math.floor(map.W / 2 + (Math.random() * 2 - 1) * DROP.spread) + 0.5;
      const d = { x, y: -1, sway: Math.random() * 6 };
      this.list.push(d);
      if (this.hooks.spawned) this.hooks.spawned(d);
    }
    for (const d of this.list) {
      d.sway += dt;
      d.y += DROP.fall * dt;
      // 下のマス(箱の下の面)がぶつかるブロックか箱なら、着地
      const tx = Math.floor(d.x);
      const below = map.get(tx, Math.floor(d.y + 0.5));
      if (SOLID[below] || below === T.CRATE || d.y > map.H) this.land(d);
    }
    this.list = this.list.filter((d) => !d.done);
  }

  land(d) {
    const { map, terrain, effects } = this.world;
    d.done = true;
    const tx = Math.floor(d.x);
    // 着いた場所(か、そのすぐ上の空いている所)を箱にする
    for (let ty = Math.floor(d.y + 0.5) - 1; ty >= 0; ty--) {
      const t = map.get(tx, ty);
      if (t === T.AIR || t === T.WATER) {
        terrain.setTile(tx, ty, T.CRATE);
        if (effects) effects.sparks(tx + 0.5, ty + 1, '#ffb020', 8);
        if (this.hooks.landed) this.hooks.landed(tx, ty);
        return;
      }
    }
  }
}
