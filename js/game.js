// 試合のルール(コアの体力、プレイヤーの体力、やられる・復活、修理、タイマー、勝ち負け)
// あとでオンラインにするときは、この計算をホストだけが行う。
import { T } from './config.js';

// 数字は最初の目安(あとで調整)
export const RULES = {
  coreHp: 1000,
  time: 300,         // 試合の長さ(秒)
  respawn: 5,        // 復活までの秒数
  repairRange: 5,    // 自分のコアから何マス以内で修理できるか(真上の地面からも届く)
  repairRate: 10,    // 1秒に回復する量
};

export class Match {
  // hooks: { playerHit(p, amount), died(p), coreHit(core, amount), coreBroken(core), ended(result) }
  constructor(map, players, hooks) {
    this.map = map;
    this.players = players;
    this.hooks = hooks;
    this.cores = map.cores; // { team, x, y, w, h } に hp を足して使う
    this.reset();
  }

  reset() {
    this.timeLeft = RULES.time;
    this.state = 'play'; // 'play'(試合中) か 'end'(終わり)
    this.result = null;
    for (const c of this.cores) { c.hp = RULES.coreHp; c.hitT = 0; c.repairing = false; }
  }

  core(team) { return this.cores.find((c) => c.team === team); }

  // 点(x, y)からコアの四角までの距離
  coreDist(c, x, y) {
    const dx = Math.max(c.x - x, 0, x - (c.x + c.w));
    const dy = Math.max(c.y - y, 0, y - (c.y + c.h));
    return Math.hypot(dx, dy);
  }

  // ブロックの種類から、どちらのコアか
  coreOfTile(t) {
    if (t === T.CORE_C) return this.core('cyan');
    if (t === T.CORE_P) return this.core('pink');
    return null;
  }

  hitPlayer(p, amount) {
    if (this.state !== 'play' || p.dead || amount <= 0) return;
    amount = Math.round(amount);
    p.hp = Math.max(0, p.hp - amount);
    p.hurtT = 0.25;
    this.hooks.playerHit(p, amount);
    if (p.hp <= 0) {
      p.dead = true;
      p.respawnT = RULES.respawn;
      p.vx = 0;
      p.vy = 0;
      this.hooks.died(p);
    }
  }

  hitCore(c, amount) {
    if (this.state !== 'play' || !c || c.hp <= 0 || amount <= 0) return;
    amount = Math.round(amount);
    c.hp = Math.max(0, c.hp - amount);
    c.hitT = 0.2;
    this.hooks.coreHit(c, amount);
    if (c.hp <= 0) {
      this.hooks.coreBroken(c);
      // コアを壊したチームの勝ち
      this.finish(c.team === 'cyan' ? 'pink' : 'cyan', 'core');
    }
  }

  finish(winner, reason) {
    if (this.state !== 'play') return;
    this.state = 'end';
    this.result = {
      winner, // 'cyan' / 'pink' / null(引き分け)
      reason, // 'core'(コアを壊した) / 'time'(時間切れ)
      cyan: this.core('cyan').hp,
      pink: this.core('pink').hp,
    };
    this.hooks.ended(this.result);
  }

  update(dt) {
    for (const c of this.cores) { c.hitT = Math.max(0, c.hitT - dt); c.repairing = false; }
    for (const p of this.players) p.hurtT = Math.max(0, p.hurtT - dt);
    if (this.state !== 'play') return;

    // 復活
    for (const p of this.players) {
      if (!p.dead) continue;
      p.respawnT -= dt;
      if (p.respawnT <= 0) p.respawn();
    }

    // 修理: 自分のコアの近くにいると、少しずつ回復する
    for (const p of this.players) {
      if (p.dead) continue;
      const c = this.core(p.team);
      if (c.hp <= 0 || c.hp >= RULES.coreHp) continue;
      if (this.coreDist(c, p.cx, p.cy) <= RULES.repairRange) {
        c.hp = Math.min(RULES.coreHp, c.hp + RULES.repairRate * dt);
        c.repairing = true;
      }
    }

    // タイマー
    this.timeLeft = Math.max(0, this.timeLeft - dt);
    if (this.timeLeft <= 0) {
      const a = Math.round(this.core('cyan').hp), b = Math.round(this.core('pink').hp);
      this.finish(a > b ? 'cyan' : b > a ? 'pink' : null, 'time');
    }
  }
}
