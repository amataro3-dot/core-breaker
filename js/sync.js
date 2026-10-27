// オンライン対戦の同期。
// ホスト(部屋を作った人)のスマホが、地形・コア・体力・爆弾・AI・時間・勝ち負けを計算して送る。
// ほかの人は、自分の位置と、使った持ち物(掘る・置く・爆弾・当たり)を送る。
//
// データの場所(round は何試合目か):
//   rooms/コード/g/round/s        ホストが送る様子(1秒に10回)
//   rooms/コード/g/round/td       変わったブロック { t番号: 種類 }
//   rooms/コード/g/round/p/ID     それぞれの位置(1秒に10回)
//   rooms/コード/g/round/ev/キー  ホストへの受付箱(掘る・置く・爆弾・当たり)
import { Player } from './player.js?v=0.7';
import { T, SOLID } from './config.js?v=0.7';
import { BOMB } from './items.js?v=0.7';

const SEND = 0.1;       // 送る間かく(秒)
const FX_LIFE = 1.5;    // 見た目の出来事を残す時間(秒)
const r2 = (v) => Math.round(v * 100) / 100;

// ほかの人(人もAIも)。位置は受け取ったものに、なめらかに近づける
export class RemotePlayer extends Player {
  constructor(id, team, spawn, name, kind) {
    super(team, spawn, name);
    this.id = id;
    this.remote = true;
    this.kind = kind; // 'h'(人) か 'b'(AI)
    this.tgt = null;
  }

  setTarget(x, y, vx, vy, f, cl) {
    this.tgt = { x, y, vx, vy, t: performance.now() };
    if (f) this.facing = f;
    this.climbing = !!cl;
    // はじめてか、大きく離れていたら(復活など)、すぐその場所へ
    if (!this.seen || Math.hypot(x - this.x, y - this.y) > 4) {
      this.x = x; this.y = y; this.seen = true;
    }
    this.vx = vx; this.vy = vy;
  }

  // 毎回: 受け取った位置(と、その後の動きの予想)へ近づける
  smooth(dt) {
    if (!this.tgt) return;
    const age = Math.min(0.2, (performance.now() - this.tgt.t) / 1000);
    const px = this.tgt.x + this.tgt.vx * age;
    const py = this.tgt.y + this.tgt.vy * age;
    const k = Math.min(1, dt * 14);
    this.x += (px - this.x) * k;
    this.y += (py - this.y) * k;
  }
}

// 自分のではない弾(見た目だけ。当たり判定はしない)
function ghostBullet(x, y, vx, vy, team) {
  return { x, y, vx, vy, life: 0.6, team };
}

export class Sync {
  // opts: { db, base, uid, isHost, world, me, effects, renderer, hooks }
  // hooks: { meHurt(), result(r), botFor(remote) → Bot }
  constructor(opts) {
    Object.assign(this, opts);
    this.ghost = { bullets: [], thrown: [] }; // ほかの人の弾・ホストの爆弾(見た目)
    this.offs = [];
    this.sendT = 0;
    this.n = 0;
    this.fx = [];          // ホスト: 見た目の出来事
    this.fxId = 0;
    this.seenFx = 0;       // ほかの人: どこまで見たか
    this.seenEv = new Set();
    this.lastShot = {};    // ほかの人: 最後に見た弾の番号
    this.myShot = null;
    this.myShotN = 0;
    this.tdLast = {};
    this.pendingTd = {};
    this.lastSnapAt = performance.now();
    this.stopped = false;
  }

  get players() { return this.world.players; }
  byId(id) { return this.players.find((p) => p.id === id); }

  start() {
    const { db, base } = this;
    if (this.isHost) {
      this.offs.push(db.onValue(`${base}/ev`, (v) => this.onEvents(v || {})));
      this.offs.push(db.onValue(`${base}/p`, (v) => this.onPositions(v || {})));
    } else {
      this.offs.push(db.onValue(`${base}/s`, (v) => v && this.onSnapshot(v)));
      this.offs.push(db.onValue(`${base}/p`, (v) => this.onPositions(v || {})));
      this.offs.push(db.onValue(`${base}/td`, (v) => this.onTiles(v || {})));
    }
  }

  stop() {
    this.stopped = true;
    for (const off of this.offs) off();
    this.offs = [];
  }

  // ---- 毎回(1/60秒)呼ぶ ----
  tick(dt) {
    if (this.stopped) return;
    for (const p of this.players) if (p.remote) p.smooth(dt);
    this.updateGhost(dt);
    this.sendT -= dt;
    if (this.sendT <= 0) {
      this.sendT = SEND;
      this.sendMine();
      if (this.isHost) this.sendSnapshot();
    }
  }

  // ---- 自分の位置(全員) ----
  sendMine() {
    const m = this.me;
    const v = [r2(m.x), r2(m.y), r2(m.vx), r2(m.vy), m.facing, m.climbing ? 1 : 0, this.myShotN];
    if (this.myShot) v.push(...this.myShot);
    this.db.set(`${this.base}/p/${this.uid}`, v);
  }

  // 自分が撃った(ほかの人の画面に、見た目の弾を出してもらう)
  onShot(owner, b) {
    if (owner === this.me) {
      this.myShotN++;
      this.myShot = [r2(b.x), r2(b.y), r2(b.vx), r2(b.vy)];
      this.sendT = 0; // すぐ送る
    } else if (this.isHost) {
      this.addFx('sh', r2(b.x), r2(b.y), r2(b.vx), r2(b.vy), owner.team);
    }
  }

  onPositions(all) {
    for (const [id, v] of Object.entries(all)) {
      if (id === this.uid || !Array.isArray(v)) continue;
      const p = this.byId(id);
      if (!p || !p.remote || p.kind !== 'h') continue;
      if (!p.dead) p.setTarget(v[0], v[1], v[2], v[3], v[4], v[5]);
      const n = v[6] || 0;
      if (n > (this.lastShot[id] || 0)) {
        if (this.lastShot[id] !== undefined && v.length >= 11) {
          this.ghost.bullets.push(ghostBullet(v[7], v[8], v[9], v[10], p.team));
        }
        this.lastShot[id] = n;
      }
      if (this.lastShot[id] === undefined) this.lastShot[id] = n;
    }
  }

  // 見た目だけの弾と爆弾を動かす
  updateGhost(dt) {
    const { map, effects } = this.world;
    for (const b of this.ghost.bullets) {
      const steps = Math.ceil(Math.hypot(b.vx, b.vy) * dt / 0.2);
      for (let i = 0; i < steps && b.life > 0; i++) {
        b.x += b.vx * dt / steps;
        b.y += b.vy * dt / steps;
        if (SOLID[map.get(Math.floor(b.x), Math.floor(b.y))]) {
          effects.sparks(b.x - b.vx * 0.004, b.y - b.vy * 0.004);
          b.life = 0;
        }
        const p = this.players.find((q) => !q.dead && q.team !== b.team &&
          b.x >= q.x && b.x <= q.x + q.w && b.y >= q.y && b.y <= q.y + q.h);
        if (p) { effects.sparks(b.x, b.y, p.team === 'pink' ? '#ff3366' : '#00f3ff', 7); b.life = 0; }
      }
      b.life -= dt;
    }
    this.ghost.bullets = this.ghost.bullets.filter((b) => b.life > 0);
  }

  // ================= ホスト =================
  addFx(...a) {
    this.fx.push({ id: ++this.fxId, t: performance.now(), a });
  }

  // 地形が変わった(ホストの step から、変わったブロックを渡す)
  addTiles(changes) {
    for (const [i, t] of changes) this.pendingTd[`t${i}`] = t;
  }

  // ほかの人の受付箱
  onEvents(all) {
    const { db, base, world } = this;
    const { map, terrain, match } = world;
    const done = {};
    for (const [key, e] of Object.entries(all)) {
      if (this.seenEv.has(key)) continue;
      this.seenEv.add(key);
      done[key] = null;
      const p = this.byId(e.by);
      if (!e || !p) continue;
      if (e.k === 'dig' || e.k === 'place') {
        const x = e.i % map.W, y = Math.floor(e.i / map.W);
        let ok = false;
        if (e.k === 'dig') ok = terrain.dig(x, y);
        else {
          const over = this.players.some((q) => q !== p && !q.dead &&
            q.x < x + 1 && q.x + q.w > x && q.y < y + 1 && q.y + q.h > y);
          ok = !over && terrain.place(x, y);
        }
        // できなかったら、その人の画面を元にもどしてもらう
        if (!ok) this.pendingTd[`t${e.i}`] = map.tiles[e.i];
      } else if (e.k === 'bomb' && p.items && !p.dead) {
        p.items.thrown.push({ x: e.x, y: e.y, vx: e.vx, vy: e.vy, fuse: BOMB.fuse - 0.1, spin: 0, team: p.team });
      } else if (e.k === 'hit') {
        const t = this.byId(e.t);
        if (t && !t.dead && t.team !== p.team) match.hitPlayer(t, e.d);
      } else if (e.k === 'core') {
        const c = match.core(e.team);
        if (c && c.team !== p.team) match.hitCore(c, e.d);
      }
    }
    if (Object.keys(done).length) db.update(`${base}/ev`, done);
  }

  // 爆風で人を飛ばす(ほかの人は、その人の画面で動かしてもらう)
  knock(p, vx, vy) {
    if (p.remote && p.kind === 'h') this.addFx('kb', p.id, r2(vx), r2(vy));
    else { p.vx += vx; p.vy += vy; }
  }

  onBoom(b) { this.addFx('bm', r2(b.x), r2(b.y)); }

  sendSnapshot() {
    const { match } = this.world;
    const now = performance.now();
    this.fx = this.fx.filter((f) => now - f.t < FX_LIFE * 1000);
    const e = {};
    for (const p of this.players) {
      const id = p === this.me ? this.uid : p.id;
      e[id] = {
        k: p.remote && p.kind === 'h' ? 'h' : (p === this.me ? 'h' : 'b'),
        tm: p.team, nm: p.name,
        x: r2(p.x), y: r2(p.y), vx: r2(p.vx), vy: r2(p.vy), f: p.facing, cl: p.climbing ? 1 : 0,
        hp: Math.round(p.hp), d: p.dead ? 1 : 0, rt: r2(p.respawnT || 0), sf: p.safeT > 0 ? 1 : 0,
      };
    }
    const bombs = [];
    for (const p of this.players) {
      if (!p.items) continue;
      for (const b of p.items.thrown) bombs.push([r2(b.x), r2(b.y), r2(b.fuse), r2(b.spin)]);
    }
    const s = {
      n: ++this.n,
      tl: r2(match.timeLeft),
      st: match.state,
      res: match.result || null,
      c: match.cores.map((c) => Math.round(c.hp)),
      rp: match.cores.map((c) => (c.repairing ? 1 : 0)),
      e,
      b: bombs.length ? bombs : null,
      fx: this.fx.length ? this.fx.map((f) => [f.id, ...f.a]) : null,
    };
    const upd = { s };
    if (Object.keys(this.pendingTd).length) {
      for (const [k, v] of Object.entries(this.pendingTd)) upd[`td/${k}`] = v;
      this.pendingTd = {};
    }
    this.db.update(this.base, upd);
  }

  // 回線が切れた人の代わりに、AIを入れる(ホスト)
  replaceWithBot(id) {
    const i = this.players.findIndex((p) => p.id === id && p.remote && p.kind === 'h');
    if (i < 0) return;
    const old = this.players[i];
    const bot = this.hooks.botFor(old);
    this.players[i] = bot;
  }

  // ================= ほかの人(ホストでない) =================
  onSnapshot(s) {
    this.lastSnapAt = performance.now();
    const { match, effects, map } = this.world;
    const me = this.me;
    // 時間・コア
    match.timeLeft = s.tl;
    (s.c || []).forEach((hp, k) => {
      const c = match.cores[k];
      if (!c) return;
      if (hp < c.hp) {
        effects.text(c.x + c.w / 2, c.y - 0.3, `-${Math.round(c.hp - hp)}`, '#ffcc00');
        c.hitT = 0.2;
      }
      if (hp <= 0 && c.hp > 0) this.hooks.coreBroken(c);
      c.hp = hp;
      c.repairing = !!(s.rp && s.rp[k]);
    });
    // 人とAI
    const e = s.e || {};
    const ids = new Set(Object.keys(e));
    for (const [id, v] of Object.entries(e)) {
      if (id === this.uid) { this.applyMe(v); continue; }
      let p = this.byId(id);
      if (!p) {
        p = new RemotePlayer(id, v.tm, map.spawns[v.tm], v.nm, v.k);
        this.players.push(p);
      }
      p.kind = v.k;
      p.name = v.nm;
      if (v.hp < p.hp && !p.dead) {
        effects.text(p.cx, p.y - 0.2, `-${p.hp - v.hp}`, '#ffffff');
        p.hurtT = 0.25;
      }
      if (v.d && !p.dead) effects.pop(p.cx, p.cy, p.team === 'cyan' ? '#00f3ff' : '#ff3366');
      p.hp = v.hp;
      p.dead = !!v.d;
      p.respawnT = v.rt;
      p.safeT = v.sf ? 1 : 0;
      if (p.kind === 'b' || !p.tgt) p.setTarget(v.x, v.y, v.vx, v.vy, v.f, v.cl);
    }
    // いなくなった人を消す
    for (let i = this.players.length - 1; i >= 0; i--) {
      const p = this.players[i];
      if (p.remote && !ids.has(p.id)) this.players.splice(i, 1);
    }
    // 爆弾(見た目)
    this.ghost.thrown = (s.b || []).map((b) => ({ x: b[0], y: b[1], fuse: b[2], spin: b[3] }));
    // 見た目の出来事
    for (const f of s.fx || []) {
      const [id, type, ...a] = f;
      if (id <= this.seenFx) continue;
      this.seenFx = id;
      if (type === 'sh') this.ghost.bullets.push(ghostBullet(a[0], a[1], a[2], a[3], a[4]));
      else if (type === 'bm') {
        effects.blast(a[0], a[1], BOMB.radius);
        if (Math.abs(a[0] - me.cx) < 14 && Math.abs(a[1] - me.cy) < 10) this.renderer.shake(0.3);
      } else if (type === 'kb' && a[0] === this.uid && !me.dead) {
        me.vx += a[1];
        me.vy += a[2];
      }
    }
    // 試合の終わり
    if (s.st === 'end' && s.res && match.state === 'play') {
      match.state = 'end';
      match.result = s.res;
      this.hooks.result(s.res);
    }
  }

  applyMe(v) {
    const me = this.me;
    if (v.hp < me.hp && !me.dead) {
      this.world.effects.text(me.cx, me.y - 0.2, `-${me.hp - v.hp}`, '#ff6b6b');
      this.hooks.meHurt();
    }
    if (v.d && !me.dead) {
      // やられた
      me.dead = true;
      me.vx = 0; me.vy = 0;
      this.world.effects.pop(me.cx, me.cy, me.team === 'cyan' ? '#00f3ff' : '#ff3366');
      this.renderer.shake(0.25);
    } else if (!v.d && me.dead) {
      // 復活(位置と持ち物を最初にもどす)
      me.respawn();
      this.hooks.respawned();
    }
    me.hp = v.hp;
    me.respawnT = v.rt;
    if (!v.sf) me.safeT = 0;
  }

  // 変わったブロック
  onTiles(td) {
    const { map, effects } = this.world;
    let changed = false;
    for (const [k, t] of Object.entries(td)) {
      if (this.tdLast[k] === t) continue;
      this.tdLast[k] = t;
      const i = Number(k.slice(1));
      const old = map.tiles[i];
      if (old === t) continue;
      map.tiles[i] = t;
      changed = true;
      // 壊れたブロックは破片を出す
      if (t === T.AIR && SOLID[old]) effects.debris(i % map.W, Math.floor(i / map.W), old, 3, 5);
    }
    if (changed) {
      if (!this.me.dead) this.me.unstick(map);
      this.renderer.redrawMiniTerrain();
    }
  }

  // ---- ほかの人: 持ち物を使った(受付箱へ) ----
  send(ev) {
    this.db.push(`${this.base}/ev`, { ...ev, by: this.uid });
  }

  // ホストからの様子が、しばらく届いていない
  get stale() { return !this.isHost && performance.now() - this.lastSnapAt > 10000; }
}
