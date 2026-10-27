// AI(コンピューターのプレイヤー)。仲間にも敵にもなる。
// 役わり: 'attack'(地上から攻め)、'tunnel'(地下から攻め)、'defend'(守り)
// 動きは人と同じ Player の物理を使い、スティックと同じ形の入力を毎回作る。
// 持ち物(撃つ・投げる・掘る・置く)は、自分の Items を直接使う。
import { T, SOLID } from './config.js';
import { Player } from './player.js';
import { GUN, PICK } from './items.js';
import { REACH } from './terrain.js';

// 強さごとの数字
export const SKILL = {
  weak:   { react: 0.8,  gap: 1.1,  aimErr: 12,  sight: 11, bombErr: 1.6, bombEnemy: false },
  normal: { react: 0.5,  gap: 0.75, aimErr: 6,   sight: 13, bombErr: 0.8, bombEnemy: false },
  strong: { react: 0.25, gap: 0.45, aimErr: 2.5, sight: 15, bombErr: 0.3, bombEnemy: true },
};

export const ROLE_LABEL = { attack: 'せめ', tunnel: 'ちか', defend: 'まもり' };

const LOWER_FEET = 23; // 足もとがこれより下なら「地下の層」
const SIEGE_DIST = 4.5; // 相手のコアから、これだけ離れて爆弾を投げる

const rand = (a, b) => a + Math.random() * (b - a);
const isSolid = (map, x, y) => SOLID[map.get(Math.floor(x), Math.floor(y))];

// 2点の間に、ぶつかるブロックがないか(見えるか)
export function canSee(map, x0, y0, x1, y1) {
  const d = Math.hypot(x1 - x0, y1 - y0);
  const n = Math.ceil(d / 0.25);
  for (let i = 1; i < n; i++) {
    const t = i / n;
    if (isSolid(map, x0 + (x1 - x0) * t, y0 + (y1 - y0) * t)) return false;
  }
  return true;
}

export class Bot extends Player {
  // world: { map, terrain, match, players }
  constructor(team, spawn, role, skill, world) {
    super(team, spawn, ROLE_LABEL[role]);
    this.role = role;
    this.skill = SKILL[skill] || SKILL.normal;
    this.world = world;
    this.items = null; // あとで main.js が入れる
    this.ctrl = { x: 0, y: 0, jumpHeld: false, aimHeld: false, aim: null, release: null };
    this.climbDir = 0;   // ハシゴを登っている(-1)・降りている(+1)
    this.seenT = 0;      // 敵を見つけてからの時間
    this.target = null;  // 狙っている敵
    this.shotT = 0;      // 次に撃てるまで
    this.bombT = rand(0, 1.5); // 次に爆弾を考えるまで
    this.lookT = 0;      // 次に敵を探すまで
    this.stuckT = 0;
    this.lastX = 0;
    this.retreatT = 0;
    const W = world.map.W;
    // 自分の陣地がある向き(シアンは左、ピンクは右)と、相手のコア
    this.home = team === 'cyan' ? -1 : 1;
    this.myCore = world.match.core(team);
    this.enemyCore = world.match.core(team === 'cyan' ? 'pink' : 'cyan');
    // ハシゴの列(地下トンネルの高さにハシゴがある列)
    this.ladders = [];
    for (let x = 0; x < W; x++) if (world.map.get(x, 27) === T.LADDER) this.ladders.push(x);
  }

  get feet() { return this.y + this.h; }
  get layer() { return this.feet > LOWER_FEET ? 'lower' : 'upper'; }

  respawn() {
    super.respawn();
    this.climbDir = 0;
    this.target = null;
    this.seenT = 0;
    this.stuckT = 0;
    this.retreatT = 0;
  }

  // ---- 毎回(1秒に60回)呼ぶ。入力を返す ----
  think(dt) {
    const c = this.ctrl;
    c.x = 0; c.y = 0; c.jumpHeld = false;
    const { match } = this.world;
    if (this.dead || match.state !== 'play') return c;

    this.shotT -= dt;
    this.bombT -= dt;
    this.lookT -= dt;
    this.retreatT -= dt;

    this.fight(dt);

    // どこへ行くか
    const goal = this.pickGoal();
    if (goal) this.moveTo(goal, dt);

    // 敵がすぐ近くにいたら立ち止まって撃ち合う。攻めは、撃ちながら進み続ける
    if (this.target && this.retreatT <= 0) {
      const d = Math.abs(this.target.cx - this.cx);
      const stop = this.role === 'defend' ? 7 : 2.5;
      if (d < stop && !this.climbing && this.onGround) c.x = 0;
    }
    // 水の中では上に泳ぐ
    if (this.inWater) c.y = -1;
    return c;
  }

  // ---- 行き先 ----
  pickGoal() {
    const { map } = this.world;
    const W = map.W;
    const ec = this.enemyCore, mc = this.myCore;
    const ecx = ec.x + ec.w / 2, mcx = mc.x + mc.w / 2;

    // 体力が少なく、敵が見えているときは、自分の陣地の方へ下がる
    if (this.retreatT > 0) {
      return { x: this.home < 0 ? 8 : W - 8, layer: this.layer };
    }

    if (this.role === 'defend') {
      // 守り: 壊れたコアの壁があれば、ふさぎに行く
      const hole = this.findHole();
      if (hole) return { x: hole.tx + 0.5 - this.home * 1.5, layer: 'upper', hole };
      // ブロックが少ないときは、近くの土を掘って集める
      if (this.items.hand < 5 && !this.target) {
        const spot = this.findDirt();
        if (spot) return { x: spot.tx + 0.5 + this.home * 1.2, layer: 'upper', dirt: spot };
      }
      return { x: mcx - this.home * 3.5, layer: 'upper' };
    }

    const siegeX = ecx + this.home * SIEGE_DIST; // 相手のコアの、自分の陣地側
    if (this.role === 'tunnel') {
      // 地下攻め: まず地下トンネルを通って、相手の陣地のハシゴまで行く
      const enemyLadder = this.home < 0
        ? Math.max(...this.ladders)
        : Math.min(...this.ladders);
      // 相手の陣地のハシゴに着いたら、そのハシゴで地上に出て攻める
      const reached = this.home < 0 ? this.cx > enemyLadder - 0.5 : this.cx < enemyLadder + 1.5;
      if (!reached) return { x: enemyLadder + 0.5, layer: 'lower' };
    }
    return { x: siegeX, layer: 'upper', siege: true };
  }

  // 自分のコアのまわりで、空いてしまった壁(ふさぐ場所)
  findHole() {
    const { map } = this.world;
    const c = this.myCore;
    if (this.items.hand <= 0) return null;
    let best = null, bestD = Infinity;
    for (let y = c.y - 1; y <= c.y + c.h; y++) {
      for (let x = c.x - 1; x <= c.x + c.w; x++) {
        const inner = x >= c.x && x < c.x + c.w && y >= c.y && y < c.y + c.h;
        if (inner || map.get(x, y) !== T.AIR) continue;
        if (this.overlapsSomeone(x, y)) continue;
        const d = Math.hypot(x + 0.5 - this.cx, y + 0.5 - this.cy);
        if (d < bestD) { bestD = d; best = { tx: x, ty: y }; }
      }
    }
    return best;
  }

  // ブロック集め用の土: コアから少し離れた地面(深さ2段まで)
  findDirt() {
    const { map } = this.world;
    const c = this.myCore;
    const mcx = c.x + c.w / 2;
    for (let k = 6; k <= 9; k++) {
      const x = Math.floor(mcx - this.home * k);
      for (let y = map.surf[x]; y <= map.surf[x] + 1; y++) {
        if (map.get(x, y) === T.DIRT && map.get(x, y - 1) === T.AIR) return { tx: x, ty: y };
      }
    }
    return null;
  }

  overlapsSomeone(tx, ty) {
    return this.world.players.some((p) => !p.dead &&
      p.x < tx + 1 && p.x + p.w > tx && p.y < ty + 1 && p.y + p.h > ty);
  }

  // ---- 移動 ----
  moveTo(goal, dt) {
    const c = this.ctrl;

    // ハシゴの途中なら、登り切る・降り切るまで続ける
    if (this.climbDir && this.climbing) {
      if (this.climbDir < 0) { c.y = -1; return; }
      if (!this.onGround) { c.y = 1; return; }
    }
    this.climbDir = 0;

    let tx = goal.x;
    if (goal.layer !== this.layer) {
      // 層がちがう: いちばん近道になるハシゴへ行って、登る・降りる
      let best = this.ladders[0], bestCost = Infinity;
      for (const L of this.ladders) {
        const cost = Math.abs(this.cx - (L + 0.5)) + Math.abs(L + 0.5 - goal.x);
        if (cost < bestCost - 0.01 || (Math.abs(cost - bestCost) < 0.01 && Math.abs(this.cx - L) < Math.abs(this.cx - best))) {
          best = L; bestCost = cost;
        }
      }
      tx = best + 0.5;
      // 体がハシゴの列からはみ出さないところまで寄せる(はみ出すと、となりの地面に立ってしまう)
      if (Math.abs(this.cx - tx) < (1 - this.w) / 2 - 0.02) {
        this.climbDir = goal.layer === 'lower' ? 1 : -1;
        c.y = this.climbDir;
        c.x = 0;
        return;
      }
    }

    // 着いた
    const dx = tx - this.cx;
    const near = goal.layer !== this.layer ? 0.08 : 0.3;
    if (Math.abs(dx) < near) {
      if (goal.hole) this.patchHole(goal.hole);
      if (goal.siege) this.siege();
      if (goal.dirt) this.gather(goal.dirt);
      this.stuckT = 0;
      return;
    }
    // 着く前でも、届くならふさぐ・攻める
    if (goal.hole) this.patchHole(goal.hole);
    if (goal.siege && Math.abs(dx) < 1.5) this.siege();
    if (goal.dirt) this.gather(goal.dirt);

    const dir = Math.sign(dx);
    // 近づいたらゆっくり(ハシゴにぴったり合わせるため)
    c.x = dir * (Math.abs(dx) < 0.6 ? 0.3 : Math.max(0.45, Math.min(1, Math.abs(dx) * 1.2)));
    this.handleObstacle(dir, dt);
  }

  // 前に壁があるとき: ジャンプで越える、掘る、爆破する
  handleObstacle(dir, dt) {
    const { map } = this.world;
    const c = this.ctrl;
    const fx = Math.floor(this.cx + dir * (this.w / 2 + 0.35));
    const feetRow = Math.floor(this.feet - 0.01);

    // 前の壁の高さ(足もとの段から上へ)
    let wall = 0;
    while (wall < 5 && SOLID[map.get(fx, feetRow - wall)]) wall++;
    // 頭の上が空いているか
    let headroom = 0;
    while (headroom < 4 && !SOLID[map.get(Math.floor(this.cx), Math.floor(this.y) - 1 - headroom)]) headroom++;

    if (wall >= 2) {
      const overFree = !SOLID[map.get(fx, feetRow - wall)] && !SOLID[map.get(fx, feetRow - wall - 1)];
      if (wall <= 3 && headroom >= wall && overFree) {
        c.jumpHeld = true; // 跳んで越える
      } else {
        this.digFront(fx, feetRow, dir);
      }
    }

    // 進めていないとき(何かに引っかかっている)
    if (Math.abs(this.cx - this.lastX) < 0.02 && this.onGround) this.stuckT += dt;
    else this.stuckT = Math.max(0, this.stuckT - dt * 2);
    this.lastX = this.cx;
    if (this.stuckT > 0.6) {
      this.digFront(fx, feetRow, dir);
      if (this.stuckT > 1.5) c.jumpHeld = true;
      if (this.stuckT > 3) this.stuckT = 0;
    }
  }

  // 前のブロック(体の高さ)を掘る。硬いブロックなら爆弾で壊す
  digFront(fx, feetRow, dir) {
    const { map } = this.world;
    const it = this.items;
    for (const row of [feetRow - 1, feetRow - 2, feetRow]) {
      const t = map.get(fx, row);
      if (t === T.DIRT || t === T.SAND) {
        if (it.cool <= 0) {
          it.current = 'pick';
          it.dig({ tx: fx, ty: row });
          it.cool = PICK.rate;
        }
        return;
      }
      if (t === T.HARD && row !== feetRow) {
        // 下がってから爆弾を投げる
        if (this.bombT <= 0 && it.bombs > 0) {
          this.throwAt(fx + 0.5, row + 0.5, 0.2);
          this.bombT = 3;
        } else if (this.retreatT <= 0) {
          this.ctrl.x = -dir * 0.8;
        }
        return;
      }
    }
  }

  // ---- 守り: 壁の穴をブロックでふさぐ ----
  patchHole(hole) {
    const it = this.items;
    if (it.hand <= 0 || it.cool > 0) return;
    const d = Math.hypot(hole.tx + 0.5 - this.cx, hole.ty + 0.5 - (this.cy - 0.35));
    if (d > REACH) return;
    if (this.world.map.get(hole.tx, hole.ty) !== T.AIR || this.overlapsSomeone(hole.tx, hole.ty)) return;
    it.current = 'block';
    it.placeBlock({ tx: hole.tx, ty: hole.ty, ok: true });
    it.cool = 0.5;
  }

  gather(spot) {
    const it = this.items;
    if (it.cool > 0) return;
    if (Math.hypot(spot.tx + 0.5 - this.cx, spot.ty + 0.5 - this.cy) > PICK.range + 0.4) return;
    it.current = 'pick';
    it.dig(spot);
    it.cool = PICK.rate * 1.5;
  }

  // ---- 攻め: 相手のコアに爆弾を投げる・撃つ ----
  siege() {
    const ec = this.enemyCore;
    if (ec.hp <= 0) return;
    const it = this.items;
    const ecx = ec.x + ec.w / 2, ecy = ec.y + ec.h / 2;
    // コアが見えていれば撃つ
    if (!this.target && this.shotT <= 0 && it.cool <= 0) {
      for (let y = ec.y; y < ec.y + ec.h; y++) {
        for (let x = ec.x; x < ec.x + ec.w; x++) {
          if (this.seeTile(x, y)) {
            this.shootAt(x + 0.5, y + 0.5);
            return;
          }
        }
      }
    }
    // 爆弾を投げる(コアの真上に落ちるように)
    if (this.bombT <= 0 && it.bombs > 0 && this.onGround) {
      if (this.throwAt(ecx, ecy - 1.5, this.skill.bombErr)) this.bombT = 2.6;
      else this.bombT = 0.5;
    }
  }

  seeTile(x, y) {
    const map = this.world.map;
    const ox = this.cx, oy = this.cy - 0.2;
    // コアのブロックそのものは「ぶつかるブロック」なので、手前まで調べる
    const d = Math.hypot(x + 0.5 - ox, y + 0.5 - oy);
    if (d > this.skill.sight) return false;
    const n = Math.ceil(d / 0.25);
    for (let i = 1; i < n; i++) {
      const t = i / n;
      const px = ox + (x + 0.5 - ox) * t, py = oy + (y + 0.5 - oy) * t;
      if (Math.floor(px) === x && Math.floor(py) === y) return true;
      if (isSolid(map, px, py)) return false;
    }
    return true;
  }

  // ---- 撃ち合い ----
  fight(dt) {
    const { players } = this.world;
    const sk = this.skill;
    if (this.lookT <= 0) {
      this.lookT = 0.15;
      let best = null, bestD = Infinity;
      for (const p of players) {
        if (p.dead || p.team === this.team) continue;
        const d = Math.hypot(p.cx - this.cx, p.cy - this.cy);
        if (d > sk.sight || d >= bestD) continue;
        if (!canSee(this.world.map, this.cx, this.cy - 0.2, p.cx, p.cy - 0.2)) continue;
        best = p; bestD = d;
      }
      if (best !== this.target) this.seenT = 0;
      this.target = best;
    }
    if (!this.target || this.target.dead) { this.target = null; return; }
    this.seenT += dt;
    if (this.seenT < sk.react) return; // 見つけてから少し迷う

    // 体力が少ないと下がる(守りは下がらない)
    if (this.hp <= 35 && this.role !== 'defend' && this.retreatT <= 0 && Math.random() < 0.02) {
      this.retreatT = 2.5;
    }

    const it = this.items;
    if (this.shotT <= 0 && it.cool <= 0) {
      this.shootAt(this.target.cx, this.target.cy - 0.1);
    }
    // つよいAIは、敵が少し遠いと爆弾も投げる
    if (sk.bombEnemy && this.bombT <= 0 && it.bombs >= 2) {
      const d = Math.abs(this.target.cx - this.cx);
      if (d > 4.5 && d < 9) {
        if (this.throwAt(this.target.cx, this.target.cy, 0.6)) this.bombT = 5;
        else this.bombT = 1;
      }
    }
  }

  shootAt(x, y) {
    const it = this.items;
    const ox = this.cx, oy = this.cy - 0.2;
    let ang = Math.atan2(y - oy, x - ox);
    // 強さによって、狙いがずれる
    ang += ((Math.random() + Math.random() - 1) * this.skill.aimErr * Math.PI) / 180;
    it.current = 'gun';
    this.facing = Math.cos(ang) >= 0 ? 1 : -1;
    it.fire(this, { x: Math.cos(ang), y: Math.sin(ang), mag: 1 });
    it.cool = GUN.cool;
    this.shotT = this.skill.gap * rand(0.8, 1.25);
  }

  // 爆弾を (x, y) の近くに落ちるように投げる。投げたら true
  throwAt(x, y, err) {
    const it = this.items;
    if (it.bombs <= 0) return false;
    x += rand(-err, err);
    const dir = Math.sign(x - this.cx) || this.facing;
    let best = null, bestScore = Infinity;
    for (let deg = 15; deg <= 80; deg += 8) {
      const a = (deg * Math.PI) / 180;
      for (let mag = 0.05; mag <= 1.001; mag += 0.08) {
        const aim = { x: dir * Math.cos(a), y: -Math.sin(a), mag };
        const pts = it.bombPath(this, aim);
        const end = pts[pts.length - 1];
        if (!end || !end.end) continue;
        const score = Math.abs(end.x - x) + Math.abs(end.y - y) * 0.3;
        if (score < bestScore) { bestScore = score; best = { aim, end }; }
      }
    }
    if (!best || bestScore > 2.5) return false;
    // 自分や仲間が巻きこまれるなら投げない
    const safe = this.world.players.every((p) => p.dead || p.team !== this.team ||
      Math.hypot(p.cx - best.end.x, p.cy - best.end.y) > 3.6);
    if (!safe) return false;
    it.current = 'bomb';
    this.facing = dir;
    it.throwBomb(this, best.aim);
    return true;
  }
}
