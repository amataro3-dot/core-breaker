// 持ち物(銃・爆弾・つるはし・ブロック)と、飛んでいる弾・爆弾
import { T, SOLID } from './config.js';
import { HAND_MAX, HAND_START } from './terrain.js';

export const ITEM_LIST = ['gun', 'bomb', 'pick', 'block'];

// 数字は最初の目安(あとで調整)
// ピストル: 狙って離すと1発。次に撃てるまで0.35秒
export const GUN = { cool: 0.35, speed: 40, life: 0.6, dmgPlayer: 20, dmgCore: 10 };
export const BOMB = {
  max: 3, refill: 8, fuse: 2, radius: 2.5,
  gravity: 30, minSpeed: 7, maxSpeed: 19, r: 0.28,
  push: 14, pushRange: 3.5, // 爆風で人が飛ばされる強さと範囲
  dmgPlayer: 60, dmgRange: 3.2, // 人へのダメージ(中心から1マス以内で最大。遠いほど小さい)
  dmgCore: 150, coreRange: 3,   // コアへのダメージ
};
export const PICK = { rate: 0.25, range: 2.5 };
export const BLOCK_RANGE = 3;

const solidAt = (map, x, y) => SOLID[map.get(Math.floor(x), Math.floor(y))];

// まっすぐ線をのばして、最初に stop(種類) が true になるマスを探す
function rayTile(map, x, y, dx, dy, maxDist, stop) {
  for (let d = 0; d <= maxDist; d += 0.05) {
    const tx = Math.floor(x + dx * d), ty = Math.floor(y + dy * d);
    if (stop(map.get(tx, ty))) return { tx, ty, dist: d, x: x + dx * d, y: y + dy * d };
  }
  return null;
}

// つるはしが通り抜けるもの(空気・水・ハシゴ)
const passPick = (t) => t === T.AIR || t === T.WATER || t === T.LADDER;

export class Items {
  // hooks: { flash(tx,ty,kind), tip(text), shake(amount), changed() }
  constructor(world, hooks) {
    this.world = world; // { map, terrain, effects, players, match }
    this.hooks = hooks;
    this.reset();
  }

  // 試合の最初の状態にもどす
  reset() {
    this.current = 'gun';
    this.hand = HAND_START;  // 手持ちのブロック
    this.bombs = BOMB.max;   // 手持ちの爆弾
    this.refillT = 0;        // 爆弾の補充までの時間
    this.cool = 0;           // 銃・つるはしの次に使えるまでの時間
    this.warned = false;     // 硬いブロックのお知らせを、押している間1回だけにする
    this.bullets = [];
    this.thrown = [];        // 飛んでいる爆弾
    this.preview = null;     // 狙っているときの表示(照準線、軌道、枠)
    this.hooks.changed();
  }

  select(item) {
    if (ITEM_LIST.includes(item)) this.current = item;
    this.hooks.changed();
  }

  // ---- 毎回の計算(1秒に60回) ----
  update(dt, me, input) {
    this.cool = Math.max(0, this.cool - dt);
    if (!input.aimHeld) this.warned = false;

    // 爆弾の補充
    if (this.bombs < BOMB.max) {
      this.refillT += dt;
      if (this.refillT >= BOMB.refill) {
        this.refillT = 0;
        this.bombs++;
        this.hooks.changed();
      }
    } else {
      this.refillT = 0;
    }

    // 狙っている間は、その向きを向く
    if (input.aim && Math.abs(input.aim.x) > 0.15) me.facing = Math.sign(input.aim.x);

    this.preview = null;
    const aim = input.aim;
    // やられている間や、試合が終わったあとは使えない
    const canUse = !me.dead && this.world.match.state === 'play';
    switch (canUse ? this.current : '') {
      case 'gun':
        // 狙っている間は照準線。離したら1発(タップなら向いている方へ)
        if (aim) this.preview = { kind: 'gun', ...this.gunLine(me, aim), ready: this.cool <= 0 };
        if (input.release && !input.release.cancel && this.cool <= 0) {
          this.fire(me, input.release.aim || this.facingAim(me, 0));
          this.cool = GUN.cool;
        }
        break;
      case 'pick':
        if (aim) {
          const hit = this.pickTarget(me, aim);
          this.preview = { kind: 'pick', hit };
          if (this.cool <= 0) { this.dig(hit); this.cool = PICK.rate; }
        } else if (input.release && !input.release.cancel && !input.release.aim) {
          this.dig(this.pickTarget(me, this.facingAim(me, 0)));
        }
        break;
      case 'block':
        if (aim) {
          this.preview = { kind: 'block', ...this.blockTarget(me, aim) };
        }
        if (input.release && !input.release.cancel) {
          const target = input.release.aim
            ? this.blockTarget(me, input.release.aim)
            : this.blockFront(me); // タップ: 向いている方の足もとに置く
          this.placeBlock(target);
        }
        break;
      case 'bomb':
        if (aim) {
          this.preview = { kind: 'bomb', points: this.bombPath(me, aim) };
        }
        if (input.release && !input.release.cancel) {
          this.throwBomb(me, input.release.aim || this.facingAim(me, -0.6, 0.45));
        }
        break;
      default: break;
    }

    this.updateBullets(dt);
    this.updateBombs(dt);
  }

  // 向いている方向(タップしたとき用)
  facingAim(me, upY, mag = 1) {
    const x = me.facing, y = upY;
    const l = Math.hypot(x, y);
    return { x: x / l, y: y / l, mag };
  }

  // ---- 銃 ----
  gunLine(me, aim) {
    const hit = rayTile(this.world.map, me.cx, me.cy - 0.2, aim.x, aim.y, GUN.speed * GUN.life,
      (t) => SOLID[t]);
    const len = hit ? hit.dist : GUN.speed * GUN.life;
    return { x0: me.cx, y0: me.cy - 0.2, x1: me.cx + aim.x * len, y1: me.cy - 0.2 + aim.y * len };
  }

  fire(me, aim) {
    this.bullets.push({
      x: me.cx + aim.x * 0.5, y: me.cy - 0.2 + aim.y * 0.5,
      vx: aim.x * GUN.speed, vy: aim.y * GUN.speed,
      life: GUN.life, team: me.team,
    });
  }

  updateBullets(dt) {
    const { map, effects, players, match } = this.world;
    for (const b of this.bullets) {
      // 速いので細かく分けて進める(ブロックをすり抜けないように)
      const steps = Math.ceil(Math.hypot(b.vx, b.vy) * dt / 0.2);
      for (let i = 0; i < steps && b.life > 0; i++) {
        b.x += b.vx * dt / steps;
        b.y += b.vy * dt / steps;
        // 人に当たる(銃は仲間には当たらない)
        const p = players.find((q) => !q.dead && q.team !== b.team &&
          b.x >= q.x && b.x <= q.x + q.w && b.y >= q.y && b.y <= q.y + q.h);
        if (p) {
          match.hitPlayer(p, GUN.dmgPlayer);
          effects.sparks(b.x, b.y, p.team === 'pink' ? '#ff3366' : '#00f3ff', 7);
          b.life = 0;
          break;
        }
        const t = map.get(Math.floor(b.x), Math.floor(b.y));
        if (solidAt(map, b.x, b.y)) {
          // 相手のコアに当たったらダメージ
          const c = match.coreOfTile(t);
          if (c && c.team !== b.team) match.hitCore(c, GUN.dmgCore);
          effects.sparks(b.x - b.vx * 0.004, b.y - b.vy * 0.004, c ? '#ffffff' : undefined);
          b.life = 0;
        }
      }
      b.life -= dt;
    }
    this.bullets = this.bullets.filter((b) => b.life > 0);
  }

  // ---- つるはし ----
  pickTarget(me, aim) {
    return rayTile(this.world.map, me.cx, me.cy, aim.x, aim.y, PICK.range, (t) => !passPick(t));
  }

  dig(hit) {
    const { terrain, effects, map } = this.world;
    if (!hit) return;
    const t = map.get(hit.tx, hit.ty);
    if (terrain.dig(hit.tx, hit.ty)) {
      effects.debris(hit.tx, hit.ty, t, 6, 4);
      this.hand = Math.min(HAND_MAX, this.hand + 1);
      this.hooks.flash(hit.tx, hit.ty, 'dig');
      this.hooks.changed();
    } else if (!this.warned) {
      this.warned = true;
      this.hooks.flash(hit.tx, hit.ty, 'ng');
      if (t === T.HARD) this.hooks.tip('硬いブロックは爆弾でしか壊れない');
      else if (t === T.CORE_C || t === T.CORE_P) this.hooks.tip('コアは掘れない');
      else this.hooks.tip('ここは壊せない');
    }
  }

  // ---- ブロック ----
  // 倒した向き・強さで、最大3マス先の空いているマスを探す
  blockTarget(me, aim) {
    const { map } = this.world;
    const maxD = 1 + aim.mag * (BLOCK_RANGE - 1);
    const oy = me.cy - 0.35; // 胸の高さから(となりの1段の段差を越えて置けるように)
    let found = null;
    for (let d = 0; d <= maxD; d += 0.05) {
      const tx = Math.floor(me.cx + aim.x * d), ty = Math.floor(oy + aim.y * d);
      const t = map.get(tx, ty);
      if (t !== T.AIR) break; // ブロック・水・ハシゴの手前で止める
      if (!this.overlapsPlayer(tx, ty)) found = { tx, ty };
    }
    if (!found) {
      // 置ける場所がないときは、狙った先を赤く出す
      const tx = Math.floor(me.cx + aim.x * maxD), ty = Math.floor(oy + aim.y * maxD);
      return { tx, ty, ok: false };
    }
    return { ...found, ok: this.hand > 0 };
  }

  blockFront(me) {
    const tx = Math.floor(me.cx + me.facing * (me.w / 2 + 0.5));
    const ty = Math.floor(me.y + me.h - 0.5);
    const ok = this.world.map.get(tx, ty) === T.AIR && !this.overlapsPlayer(tx, ty) && this.hand > 0;
    return { tx, ty, ok };
  }

  overlapsPlayer(tx, ty) {
    return this.world.players.some((p) => !p.dead &&
      p.x < tx + 1 && p.x + p.w > tx && p.y < ty + 1 && p.y + p.h > ty);
  }

  placeBlock(target) {
    const { terrain } = this.world;
    if (this.hand <= 0) { this.hooks.flash(target.tx, target.ty, 'ng'); this.hooks.tip('ブロックがない'); return false; }
    if (!target.ok || !terrain.place(target.tx, target.ty)) {
      this.hooks.flash(target.tx, target.ty, 'ng');
      return false;
    }
    this.hand--;
    this.hooks.flash(target.tx, target.ty, 'place');
    this.hooks.changed();
    return true;
  }

  // 画面タップ用(仮の操作。v0.2から残している)
  tapAt(me, tx, ty, reach) {
    if (me.dead || this.world.match.state !== 'play') return;
    const { map, terrain } = this.world;
    const dist = Math.hypot(tx + 0.5 - me.cx, ty + 0.5 - me.cy);
    if (dist > reach) { this.hooks.flash(tx, ty, 'ng'); this.hooks.tip('遠すぎて届かない'); return; }
    const t = map.get(tx, ty);
    if (terrain.canDig(tx, ty)) {
      this.warned = false;
      this.dig({ tx, ty });
    } else if (t === T.AIR) {
      this.placeBlock({ tx, ty, ok: !this.overlapsPlayer(tx, ty) });
    } else {
      this.hooks.flash(tx, ty, 'ng');
      if (t === T.HARD) this.hooks.tip('硬いブロックは爆弾でしか壊れない');
      else if (t === T.WATER) this.hooks.tip('水の中には置けない');
      else if (t === T.CORE_C || t === T.CORE_P) this.hooks.tip('コアは掘れない');
      else this.hooks.tip('ここは壊せない');
    }
  }

  // ---- 爆弾 ----
  bombVelocity(aim) {
    const s = BOMB.minSpeed + aim.mag * (BOMB.maxSpeed - BOMB.minSpeed);
    return { vx: aim.x * s, vy: aim.y * s };
  }

  // 投げる軌道の見本(最初にぶつかるところまで)
  bombPath(me, aim) {
    const { map } = this.world;
    let { vx, vy } = this.bombVelocity(aim);
    let x = me.cx, y = me.cy - 0.3;
    const pts = [];
    const dt = 1 / 30;
    for (let i = 0; i < 45; i++) {
      vy += BOMB.gravity * dt;
      x += vx * dt;
      y += vy * dt;
      if (solidAt(map, x, y) || map.get(Math.floor(x), Math.floor(y)) === T.WATER) { pts.push({ x, y, end: true }); break; }
      if (i % 2 === 0) pts.push({ x, y });
    }
    return pts;
  }

  throwBomb(me, aim) {
    if (this.bombs <= 0) { this.hooks.tip('爆弾がない(8秒で1個たまる)'); return; }
    this.bombs--;
    const v = this.bombVelocity(aim);
    this.thrown.push({ x: me.cx, y: me.cy - 0.3, vx: v.vx, vy: v.vy, fuse: BOMB.fuse, spin: 0, team: me.team });
    this.hooks.changed();
  }

  updateBombs(dt) {
    const { map } = this.world;
    const r = BOMB.r;
    for (const b of this.thrown) {
      b.fuse -= dt;
      const wet = map.get(Math.floor(b.x), Math.floor(b.y)) === T.WATER;
      b.vy += BOMB.gravity * (wet ? 0.3 : 1) * dt;
      if (wet) { b.vx *= Math.pow(0.1, dt); b.vy *= Math.pow(0.1, dt); }

      // 横に動く。壁に当たったらはね返る
      const nx = b.x + b.vx * dt;
      const side = nx + Math.sign(b.vx) * r;
      if (b.vx !== 0 && solidAt(map, side, b.y)) {
        b.vx = -b.vx * 0.4;
      } else {
        b.x = nx;
      }
      // 縦に動く。床に当たったらはずんで、だんだん止まる
      const ny = b.y + b.vy * dt;
      const edge = ny + Math.sign(b.vy) * r;
      if (b.vy !== 0 && solidAt(map, b.x, edge)) {
        if (b.vy > 0) {
          b.y = Math.floor(edge) - r - 0.001;
          b.vx *= 0.7;
          b.vy = Math.abs(b.vy) > 3 ? -b.vy * 0.35 : 0;
        } else {
          b.vy = 0;
        }
      } else {
        b.y = ny;
      }
      // 床の上ではころがって止まる
      if (b.vy === 0 && solidAt(map, b.x, b.y + r + 0.05)) b.vx *= Math.pow(0.15, dt);
      b.spin += b.vx * dt * 2;

      if (b.fuse <= 0) this.explode(b);
    }
    this.thrown = this.thrown.filter((b) => b.fuse > 0);
  }

  explode(b) {
    const { terrain, effects, players, match } = this.world;
    const broken = terrain.explode(b.x, b.y, BOMB.radius);
    for (const [x, y, t] of broken) effects.debris(x, y, t, 5, 6, { x: b.x, y: b.y });
    effects.blast(b.x, b.y, BOMB.radius);
    // 爆風: 人(自分も仲間も)にダメージ。近いほど大きい
    for (const p of players) {
      if (p.dead) continue;
      const d = Math.hypot(p.cx - b.x, p.cy - b.y);
      if (d < BOMB.dmgRange) {
        match.hitPlayer(p, BOMB.dmgPlayer * Math.min(1, (BOMB.dmgRange - d) / (BOMB.dmgRange - 1)));
      }
    }
    // 相手のコアにダメージ(自分のコアには当たらない)
    for (const c of match.cores) {
      if (c.team === b.team) continue;
      const d = match.coreDist(c, b.x, b.y);
      if (d < BOMB.coreRange) match.hitCore(c, BOMB.dmgCore * Math.min(1, (BOMB.coreRange - d) / (BOMB.coreRange - 1)));
    }
    // 爆風で人が飛ばされる
    for (const p of players) {
      if (p.dead) continue;
      const dx = p.cx - b.x, dy = p.cy - b.y;
      const d = Math.hypot(dx, dy);
      if (d > BOMB.pushRange) continue;
      const k = BOMB.push * (1 - d / BOMB.pushRange);
      p.vx += (dx / (d || 1)) * k;
      p.vy += (dy / (d || 1)) * k - k * 0.5;
    }
    this.hooks.shake(0.35);
  }
}
