// 持ち物(銃・爆弾・つるはし・ブロック)と、飛んでいる弾・爆弾。
// v0.8: ねらいアシスト、アイテム箱(中身: ショットガン・マシンガン・ライフル・C4・レーション・シールド)
import { T, SOLID } from './config.js?v=0.9';
import { HAND_MAX, HAND_START } from './terrain.js?v=0.9';

export const ITEM_LIST = ['gun', 'bomb', 'pick', 'block'];

// 銃の種類(数字は最初の目安。あとで調整)
//   cool: 次に撃てるまで(秒)、speed: 弾の速さ(マス/秒)、life: 弾が消えるまで(秒)。とどく距離 = speed × life
//   pellets: 1回に出る弾の数、spread: 広がり(左右それぞれ、ラジアン)
//   auto: 倒している間ずっと撃つ、assist: ねらいアシストの角度(度)、ammo: 撃てる回数
export const GUNS = {
  pistol: { name: 'ピストル', cool: 0.35, speed: 40, life: 0.6, dmgPlayer: 20, dmgCore: 10, pellets: 1, spread: 0, auto: false, assist: 18, ammo: 0 },
  shotgun: { name: 'ショットガン', cool: 0.75, speed: 34, life: 0.28, dmgPlayer: 14, dmgCore: 6, pellets: 5, spread: 0.2, auto: false, assist: 22, ammo: 8 },
  mg: { name: 'マシンガン', cool: 0.12, speed: 40, life: 0.6, dmgPlayer: 8, dmgCore: 4, pellets: 1, spread: 0.04, auto: true, assist: 15, ammo: 40 },
  rifle: { name: 'ライフル', cool: 1.0, speed: 60, life: 0.5, dmgPlayer: 50, dmgCore: 25, pellets: 1, spread: 0, auto: false, assist: 10, ammo: 5, scope: true },
};
export const GUN = GUNS.pistol; // 前からの名前(ピストル)
export const BOMB = {
  max: 3, refill: 8, fuse: 2, radius: 2.5,
  gravity: 30, minSpeed: 7, maxSpeed: 19, r: 0.28,
  push: 9.8, pushRange: 3.5, // 爆風で人が飛ばされる強さと範囲
  dmgPlayer: 60, dmgRange: 3.2, // 人へのダメージ(中心から1マス以内で最大。遠いほど小さい)
  dmgCore: 150, coreRange: 3,   // コアへのダメージ
};
// C4: 爆弾の所がC4に変わる。壁・床・敵にくっついて3秒で爆発。爆弾より強く、範囲も大きい
export const C4 = {
  max: 4, fuse: 3, radius: 3.5,
  push: 12, pushRange: 4.5,
  dmgPlayer: 90, dmgRange: 4.5,
  dmgCore: 250, coreRange: 4,
};
export const SHIELD_MAX = 150; // シールド: HP とは別のゲージ(150)。ダメージはシールドから先に減る。やられたら消える
export const PICK = { rate: 0.25, range: 2.5 };
export const BLOCK_RANGE = 3;
export const SCOPE_LOOK = 18; // ライフル: ねらっている方へ、カメラが最大何マス先まで動くか(とどく距離30マスが見えるように)

// アイテム箱の中身(どれか1つ。みんな同じ確率)
export const LOOT = ['shotgun', 'mg', 'rifle', 'c4', 'ration', 'shield'];
export const LOOT_NAME = {
  shotgun: 'ショットガン', mg: 'マシンガン', rifle: 'ライフル', c4: 'C4', ration: 'レーション', shield: 'シールド',
};

const solidAt = (map, x, y) => SOLID[map.get(Math.floor(x), Math.floor(y))];

// まっすぐ線をのばして、最初に stop(種類) が true になるマスを探す
function rayTile(map, x, y, dx, dy, maxDist, stop) {
  for (let d = 0; d <= maxDist; d += 0.05) {
    const tx = Math.floor(x + dx * d), ty = Math.floor(y + dy * d);
    if (stop(map.get(tx, ty))) return { tx, ty, dist: d, x: x + dx * d, y: y + dy * d };
  }
  return null;
}

// 2点の間に、ぶつかるブロックがないか(見えるか)
function clearLine(map, x0, y0, x1, y1) {
  const d = Math.hypot(x1 - x0, y1 - y0);
  const n = Math.ceil(d / 0.25);
  for (let i = 1; i < n; i++) {
    const t = i / n;
    if (solidAt(map, x0 + (x1 - x0) * t, y0 + (y1 - y0) * t)) return false;
  }
  return true;
}

// 角度の差(-π〜π)
function angDiff(a, b) {
  let d = a - b;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

// つるはしが通り抜けるもの(空気・水・ハシゴ)
const passPick = (t) => t === T.AIR || t === T.WATER || t === T.LADDER;

export class Items {
  // hooks: { flash(tx,ty,kind), tip(text), shake(amount), changed(), shot(owner, bullet) }
  constructor(world, hooks) {
    this.world = world; // { map, terrain, effects, players, match }
    this.hooks = hooks;
    this.remote = null; // オンラインでホストでないとき: Sync(ホストに知らせる)
    this.owner = null;  // この持ち物の持ち主(update のたびに入る)
    this.reset();
  }

  // 試合の最初の状態にもどす
  reset() {
    this.bullets = [];
    this.thrown = [];        // 飛んでいる爆弾・C4
    this.resetLoadout();
  }

  // 復活したとき: 持ち物を最初の状態にもどす(飛んでいる弾・爆弾はそのまま)
  resetLoadout() {
    this.current = 'gun';
    this.gunKind = 'pistol'; // 今の銃
    this.ammo = 0;           // ピストル以外の残り
    this.c4 = 0;             // C4 の残り(0 なら爆弾)
    this.hand = HAND_START;  // 手持ちのブロック
    this.bombs = BOMB.max;   // 手持ちの爆弾
    this.refillT = 0;        // 爆弾の補充までの時間
    this.cool = 0;           // 銃・つるはしの次に使えるまでの時間
    this.warned = false;     // 硬いブロックのお知らせを、押している間1回だけにする
    this.preview = null;     // 狙っているときの表示(照準線、軌道、枠)
    this.scope = null;       // ライフルでねらっているときの向き(カメラを動かす)
    this.hooks.changed();
  }

  select(item) {
    if (ITEM_LIST.includes(item)) this.current = item;
    this.hooks.changed();
  }

  get gun() { return GUNS[this.gunKind]; }
  // 投げられる物の残り(C4 があれば C4)
  get throwables() { return this.c4 > 0 ? this.c4 : this.bombs; }

  // ---- 毎回の計算(1秒に60回) ----
  update(dt, me, input) {
    this.owner = me;
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
    this.scope = null;
    const aim = input.aim;
    // やられている間や、試合が終わったあとは使えない
    const canUse = !me.dead && this.world.match.state === 'play';
    // アイテム箱にさわったら開ける(ほかの人の分は、その人のスマホが決める)
    if (canUse && !me.remote) this.touchCrates(me);

    // SHOT ボタン: 持ち物に関係なく、今の銃で、見えていていちばん近い敵へ撃つ(いなければ向いている方へ)
    if (canUse && input.shotHeld) {
      const g = this.gun;
      const t = this.nearestEnemy(me, g);
      if (t && !aim) {
        this.preview = { kind: 'gun', ...this.gunLine(me, this.aimAt(me, t), g), ready: this.cool <= 0, lock: t };
        me.facing = t.cx >= me.cx ? 1 : -1;
      }
      if (this.cool <= 0) this.shoot(me, t ? this.aimAt(me, t) : this.facingAim(me, 0));
    }

    switch (canUse ? this.current : '') {
      case 'gun': {
        const g = this.gun;
        if (aim) {
          const a = this.assist(me, aim, g);
          this.preview = { kind: 'gun', ...this.gunLine(me, a.aim, g), ready: this.cool <= 0, lock: a.target };
          if (g.scope) this.scope = { x: aim.x * aim.mag, y: aim.y * aim.mag };
          // マシンガン: 倒している間ずっと撃つ
          if (g.auto && this.cool <= 0) this.shoot(me, a.aim);
        }
        // 離したら1発。軽くタップなら、見えているいちばん近い敵へ(いなければ向いている方へ)
        if (input.release && !input.release.cancel && this.cool <= 0 && !(g.auto && input.release.aim)) {
          let fa;
          if (input.release.aim) fa = this.assist(me, input.release.aim, g).aim;
          else {
            const t = this.nearestEnemy(me, g);
            fa = t ? this.aimAt(me, t) : this.facingAim(me, 0);
          }
          this.shoot(me, fa);
        }
        break;
      }
      case 'pick':
        if (aim) {
          const hit = this.pickTarget(me, aim);
          this.preview = { kind: 'pick', hit };
          if (this.cool <= 0) { this.dig(hit, me); this.cool = PICK.rate; }
        } else if (input.release && !input.release.cancel && !input.release.aim) {
          this.dig(this.pickTarget(me, this.facingAim(me, 0)), me);
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
          this.preview = { kind: 'bomb', points: this.bombPath(me, aim), c4: this.c4 > 0 };
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
  muzzle(me) { return { x: me.cx, y: me.cy - 0.2 }; }
  range(g) { return g.speed * g.life; }

  // 敵の当たりやすい所(体のまん中)
  aimPoint(p) { return { x: p.cx, y: p.y + p.h * 0.45 }; }

  aimAt(me, p, mag = 1) {
    const o = this.muzzle(me), t = this.aimPoint(p);
    const dx = t.x - o.x, dy = t.y - o.y;
    const l = Math.hypot(dx, dy) || 1;
    return { x: dx / l, y: dy / l, mag };
  }

  // 見えていて、弾がとどく敵か
  canShoot(me, p, g) {
    if (p.dead || p.team === me.team) return false;
    const o = this.muzzle(me), t = this.aimPoint(p);
    if (Math.hypot(t.x - o.x, t.y - o.y) > this.range(g) + 0.5) return false;
    return clearLine(this.world.map, o.x, o.y, t.x, t.y);
  }

  // ねらいアシスト: スティックの向きの近く(assist 度以内)に敵がいれば、その敵へ吸いつく
  assist(me, aim, g) {
    const base = Math.atan2(aim.y, aim.x);
    const lim = (g.assist * Math.PI) / 180;
    const o = this.muzzle(me);
    let best = null, bestD = Infinity;
    for (const p of this.world.players) {
      if (!this.canShoot(me, p, g)) continue;
      const t = this.aimPoint(p);
      const d = Math.abs(angDiff(Math.atan2(t.y - o.y, t.x - o.x), base));
      if (d <= lim && d < bestD) { best = p; bestD = d; }
    }
    if (!best) return { aim, target: null };
    return { aim: this.aimAt(me, best, aim.mag), target: best };
  }

  // 見えていて弾がとどく、いちばん近い敵
  nearestEnemy(me, g) {
    let best = null, bestD = Infinity;
    for (const p of this.world.players) {
      if (!this.canShoot(me, p, g)) continue;
      const d = Math.hypot(p.cx - me.cx, p.cy - me.cy);
      if (d < bestD) { best = p; bestD = d; }
    }
    return best;
  }

  gunLine(me, aim, g = this.gun) {
    const o = this.muzzle(me);
    const len0 = this.range(g);
    const hit = rayTile(this.world.map, o.x, o.y, aim.x, aim.y, len0, (t) => SOLID[t]);
    const len = hit ? hit.dist : len0;
    return { x0: o.x, y0: o.y, x1: o.x + aim.x * len, y1: o.y + aim.y * len };
  }

  // 今の銃で撃つ(弾を減らす。なくなったらピストルにもどる)
  shoot(me, aim) {
    const g = this.gun;
    const base = Math.atan2(aim.y, aim.x);
    for (let k = 0; k < g.pellets; k++) {
      let a = base;
      if (g.pellets > 1) a += -g.spread + (2 * g.spread * k) / (g.pellets - 1);
      else if (g.spread) a += (Math.random() * 2 - 1) * g.spread;
      this.fire(me, { x: Math.cos(a), y: Math.sin(a) }, g);
    }
    this.cool = g.cool;
    if (this.gunKind !== 'pistol') {
      this.ammo--;
      if (this.ammo <= 0) {
        this.hooks.tip(`${g.name}の弾がなくなった`);
        this.gunKind = 'pistol';
        this.ammo = 0;
      }
      this.hooks.changed();
    }
  }

  // 弾を1つ出す
  fire(me, aim, g = this.gun) {
    const o = this.muzzle(me);
    const b = {
      x: o.x + aim.x * 0.5, y: o.y + aim.y * 0.5,
      vx: aim.x * g.speed, vy: aim.y * g.speed,
      life: g.life, team: me.team, dmg: g.dmgPlayer, dmgCore: g.dmgCore,
    };
    this.bullets.push(b);
    if (this.hooks.shot) this.hooks.shot(me, b); // オンライン: ほかの人に見た目の弾を出してもらう
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
          match.hitPlayer(p, b.dmg ?? GUN.dmgPlayer);
          effects.sparks(b.x, b.y, p.team === 'pink' ? '#ff3366' : '#00f3ff', 7);
          b.life = 0;
          break;
        }
        const t = map.get(Math.floor(b.x), Math.floor(b.y));
        if (solidAt(map, b.x, b.y)) {
          // 相手のコアに当たったらダメージ
          const c = match.coreOfTile(t);
          if (c && c.team !== b.team) match.hitCore(c, b.dmgCore ?? GUN.dmgCore);
          effects.sparks(b.x - b.vx * 0.004, b.y - b.vy * 0.004, c ? '#ffffff' : undefined);
          b.life = 0;
        }
      }
      b.life -= dt;
    }
    this.bullets = this.bullets.filter((b) => b.life > 0);
  }

  // ---- アイテム箱 ----
  // 体が箱にさわったら開ける
  touchCrates(me) {
    const { map } = this.world;
    const x0 = Math.floor(me.x - 0.05), x1 = Math.floor(me.x + me.w + 0.05);
    const y0 = Math.floor(me.y), y1 = Math.floor(me.y + me.h - 0.01);
    for (let ty = y0; ty <= y1; ty++) {
      for (let tx = x0; tx <= x1; tx++) {
        if (map.get(tx, ty) === T.CRATE) this.openCrate(me, tx, ty);
      }
    }
  }

  openCrate(me, tx, ty) {
    const { terrain, effects, map } = this.world;
    if (map.get(tx, ty) !== T.CRATE) return;
    terrain.setTile(tx, ty, T.AIR);
    // オンライン(ホストでない): 自分の画面ですぐ消して、ホストに知らせる
    if (this.remote) this.remote.send({ k: 'open', i: ty * map.W + tx });
    effects.debris(tx, ty, T.CRATE, 6, 5);
    effects.sparks(tx + 0.5, ty + 0.5, '#ffb020', 10);
    // HP が満タンのときは、レーションは出ない
    const pool = me.hp >= me.maxHp ? LOOT.filter((k) => k !== 'ration') : LOOT;
    const kind = pool[Math.floor(Math.random() * pool.length)];
    this.give(me, kind);
  }

  // 中身をもらう
  give(me, kind) {
    const { effects } = this.world;
    if (GUNS[kind]) {
      this.gunKind = kind;
      this.ammo = GUNS[kind].ammo;
      this.current = 'gun';
    } else if (kind === 'c4') {
      this.c4 = C4.max;
      this.current = 'bomb';
    } else if (kind === 'ration') {
      // HP だけ満タン(シールドはもどらない)。体力はホストが決めるので、オンライン(ホストでない)はホストに頼む
      if (this.remote) this.remote.send({ k: 'buff', b: 'r' });
      else me.hp = me.maxHp;
    } else if (kind === 'shield') {
      // シールドを150に(もう一度取っても150にもどる)
      if (this.remote) this.remote.send({ k: 'buff', b: 's' });
      else me.shield = SHIELD_MAX;
    }
    const name = LOOT_NAME[kind];
    effects.text(me.cx, me.y - 0.7, `${name}!`, '#ffcc00');
    this.hooks.tip(`${name}を手に入れた!`);
    this.hooks.changed();
  }

  // ---- つるはし ----
  pickTarget(me, aim) {
    return rayTile(this.world.map, me.cx, me.cy, aim.x, aim.y, PICK.range, (t) => !passPick(t));
  }

  dig(hit, me = this.owner) {
    const { terrain, effects, map } = this.world;
    if (!hit) return;
    const t = map.get(hit.tx, hit.ty);
    if (t === T.CRATE) { if (me) this.openCrate(me, hit.tx, hit.ty); return; }
    if (terrain.dig(hit.tx, hit.ty)) {
      // オンライン(ホストでない): 自分の画面ですぐ変えて、ホストに知らせる
      if (this.remote) this.remote.send({ k: 'dig', i: hit.ty * this.world.map.W + hit.tx });
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
    if (this.remote) this.remote.send({ k: 'place', i: target.ty * this.world.map.W + target.tx });
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
    if (t === T.CRATE) {
      this.openCrate(me, tx, ty);
    } else if (terrain.canDig(tx, ty)) {
      this.warned = false;
      this.dig({ tx, ty }, me);
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

  // ---- 爆弾・C4 ----
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
    const c4 = this.c4 > 0;
    if (!c4 && this.bombs <= 0) { this.hooks.tip('爆弾がない(8秒で1個たまる)'); return; }
    if (c4) {
      this.c4--;
      if (this.c4 <= 0) this.hooks.tip('C4がなくなった(爆弾にもどる)');
    } else {
      this.bombs--;
    }
    const v = this.bombVelocity(aim);
    if (this.remote) {
      // オンライン(ホストでない): 爆弾はホストが動かす
      this.remote.send({ k: 'bomb', x: me.cx, y: me.cy - 0.3, vx: v.vx, vy: v.vy, c: c4 ? 1 : 0 });
    } else {
      this.thrown.push(this.makeBomb(me, me.cx, me.cy - 0.3, v.vx, v.vy, c4));
    }
    this.hooks.changed();
  }

  makeBomb(me, x, y, vx, vy, c4, late = 0) {
    return { x, y, vx, vy, fuse: (c4 ? C4.fuse : BOMB.fuse) - late, spin: 0, team: me.team, c4, by: me };
  }

  updateBombs(dt) {
    const { map, players } = this.world;
    const r = BOMB.r;
    for (const b of this.thrown) {
      b.fuse -= dt;
      if (b.fuse <= 0) { this.explode(b); continue; }
      if (b.c4) {
        // くっついている C4 は、くっついた物といっしょに動く
        if (b.on) {
          if (b.on.dead || !players.includes(b.on)) b.on = null;
          else { b.x = b.on.cx + b.ox; b.y = b.on.y + b.oy; continue; }
        }
        if (b.stuck) continue;
        // 敵にさわったらくっつく
        const p = players.find((q) => !q.dead && q.team !== b.team &&
          b.x > q.x - r && b.x < q.x + q.w + r && b.y > q.y - r && b.y < q.y + q.h + r);
        if (p) {
          b.on = p; b.stuck = true;
          b.ox = Math.max(-p.w / 2, Math.min(p.w / 2, b.x - p.cx));
          b.oy = Math.max(0.2, Math.min(p.h - 0.2, b.y - p.y));
          b.vx = 0; b.vy = 0;
          continue;
        }
      }
      const wet = map.get(Math.floor(b.x), Math.floor(b.y)) === T.WATER;
      b.vy += BOMB.gravity * (wet ? 0.3 : 1) * dt;
      if (wet) { b.vx *= Math.pow(0.1, dt); b.vy *= Math.pow(0.1, dt); }

      // 横に動く。壁に当たったらはね返る(C4 はくっつく)
      const nx = b.x + b.vx * dt;
      const side = nx + Math.sign(b.vx) * r;
      if (b.vx !== 0 && solidAt(map, side, b.y)) {
        if (b.c4) { this.stick(b); continue; }
        b.vx = -b.vx * 0.4;
      } else {
        b.x = nx;
      }
      // 縦に動く。床に当たったらはずんで、だんだん止まる(C4 はくっつく)
      const ny = b.y + b.vy * dt;
      const edge = ny + Math.sign(b.vy) * r;
      if (b.vy !== 0 && solidAt(map, b.x, edge)) {
        if (b.c4) {
          b.y = b.vy > 0 ? Math.floor(edge) - r - 0.001 : Math.ceil(edge) + r + 0.001;
          this.stick(b);
          continue;
        }
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
    }
    this.thrown = this.thrown.filter((b) => b.fuse > 0);
  }

  stick(b) {
    b.stuck = true;
    b.vx = 0;
    b.vy = 0;
  }

  explode(b) {
    const { terrain, effects, players, match } = this.world;
    const S = b.c4 ? C4 : BOMB;
    const broken = terrain.explode(b.x, b.y, S.radius);
    for (const [x, y, t] of broken) effects.debris(x, y, t, 5, 6, { x: b.x, y: b.y });
    effects.blast(b.x, b.y, S.radius);
    // 爆風: 人(自分も仲間も)にダメージ。近いほど大きい
    for (const p of players) {
      if (p.dead) continue;
      const d = Math.hypot(p.cx - b.x, p.cy - b.y);
      if (d < S.dmgRange) {
        match.hitPlayer(p, S.dmgPlayer * Math.min(1, (S.dmgRange - d) / (S.dmgRange - 1)));
      }
    }
    // 相手のコアにダメージ(自分のコアには当たらない)
    for (const c of match.cores) {
      if (c.team === b.team) continue;
      const d = match.coreDist(c, b.x, b.y);
      if (d < S.coreRange) match.hitCore(c, S.dmgCore * Math.min(1, (S.coreRange - d) / (S.coreRange - 1)));
    }
    // 爆風で人が飛ばされる
    for (const p of players) {
      if (p.dead) continue;
      const dx = p.cx - b.x, dy = p.cy - b.y;
      const d = Math.hypot(dx, dy);
      if (d > S.pushRange) continue;
      const k = S.push * (1 - d / S.pushRange);
      const kx = (dx / (d || 1)) * k, ky = (dy / (d || 1)) * k - k * 0.5;
      // オンライン(ホスト): ほかの人は、その人の画面で飛ばしてもらう
      if (this.world.knock) this.world.knock(p, kx, ky);
      else { p.vx += kx; p.vy += ky; }
    }
    if (this.world.onBoom) this.world.onBoom(b, S.radius);
    this.hooks.shake(b.c4 ? 0.5 : 0.35);
  }
}
