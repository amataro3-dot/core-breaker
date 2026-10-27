// ブロックの物理(掘る、置く、砂が落ちる、水が流れる、支えのない足場が崩れる)
// あとでオンラインにするときは、この計算をホストだけが行い、
// 変わったブロック(takeChanges の中身)だけを全員に送る。
import { T } from './config.js?v=0.6.2';

// 支えになる(崩れない)ブロック。通常ブロックは、これにつながっていれば崩れない
// ハシゴも壁に固定されていて、支えになる
const ANCHOR = new Uint8Array(16);
for (const t of [T.HARD, T.BEDROCK, T.CORE_C, T.CORE_P, T.LADDER]) ANCHOR[t] = 1;

// 落ちてくる物に押しのけられる(入れ替わる)もの
const OPEN = new Uint8Array(16);
OPEN[T.AIR] = 1;
OPEN[T.WATER] = 1;

export const TERRAIN_HZ = 10;  // 1秒に何回計算するか
export const REACH = 4.5;      // 掘る・置くが届く距離(ブロック)
export const HAND_MAX = 20;    // 手持ちブロックの上限
export const HAND_START = 10;  // 最初の手持ち
const WATER_LOOK = 8;          // 水が「低いところ」を横に探す距離

export class Terrain {
  constructor(map) {
    this.map = map;
    this.W = map.W;
    this.H = map.H;
    this.tiles = map.tiles;
    const n = this.W * this.H;
    this.comp = new Int32Array(n);   // つながりの番号(計算用)
    this.queue = new Int32Array(n);  // 順番待ちの列(計算用)
    this.moved = new Uint8Array(n);  // この回にもう動いたか
    this.changed = new Set();        // 変わったブロックの番号
    this.dirty = true;               // 崩れるかどうか調べ直す必要があるか
    this.flip = false;               // 左右の処理順を毎回入れ替える(かたよらないように)
  }

  at(x, y) { return this.map.get(x, y); }

  setTile(x, y, t) {
    if (x < 0 || x >= this.W || y < 0 || y >= this.H) return;
    const i = y * this.W + x;
    if (this.tiles[i] === t) return;
    this.tiles[i] = t;
    this.changed.add(i);
  }

  // 2つのマスの中身を入れかえる
  swap(i, j) {
    const a = this.tiles[i];
    this.tiles[i] = this.tiles[j];
    this.tiles[j] = a;
    this.changed.add(i);
    this.changed.add(j);
  }

  // ---- 掘る・置く ----
  canDig(x, y) {
    const t = this.at(x, y);
    return t === T.DIRT || t === T.SAND;
  }

  dig(x, y) {
    if (!this.canDig(x, y)) return false;
    this.setTile(x, y, T.AIR);
    this.dirty = true;
    return true;
  }

  canPlace(x, y) {
    return x > 0 && x < this.W - 1 && y >= 0 && y < this.H - 1 && this.at(x, y) === T.AIR;
  }

  place(x, y) {
    if (!this.canPlace(x, y)) return false;
    this.setTile(x, y, T.DIRT);
    this.dirty = true;
    return true;
  }

  // 爆発: 半径 r の中の通常ブロック・砂・硬いブロックを壊す。
  // 壊したブロックを [x, y, 種類] のリストで返す(破片を出すため)
  explode(cx, cy, r) {
    const out = [];
    for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++) {
      for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) {
        if (Math.hypot(x + 0.5 - cx, y + 0.5 - cy) > r) continue;
        const t = this.at(x, y);
        if (t === T.DIRT || t === T.SAND || t === T.HARD) {
          this.setTile(x, y, T.AIR);
          out.push([x, y, t]);
        }
      }
    }
    if (out.length) this.dirty = true;
    return out;
  }

  // 変わったブロックを [番号, 種類] の形で取り出す(取り出したら空にする)
  takeChanges() {
    const out = [];
    for (const i of this.changed) out.push([i, this.tiles[i]]);
    this.changed.clear();
    return out;
  }

  // ---- 1回分の計算 ----
  tick() {
    this.flip = !this.flip;
    this.moved.fill(0);
    let shifted = false;
    if (this.dirty) {
      this.dirty = false;
      if (this.stepBlocks()) shifted = true;
    }
    if (this.stepSand()) shifted = true;
    // 何かが動いたら、次の回も崩れるかどうか調べ直す
    if (shifted) this.dirty = true;
    this.stepWater();
  }

  // 支えのない通常ブロックの固まりを、1段落とす
  stepBlocks() {
    const { W, H, tiles, comp, queue } = this;
    comp.fill(0);

    // 1. 支え(硬いブロック・岩盤・コア)から、つながっている通常ブロックをたどる
    let head = 0, tail = 0;
    for (let i = 0; i < W * H; i++) {
      if (ANCHOR[tiles[i]]) { comp[i] = 1; queue[tail++] = i; }
    }
    while (head < tail) {
      const i = queue[head++];
      const x = i % W;
      if (x > 0) tail = this.reach(i - 1, 1, tail);
      if (x < W - 1) tail = this.reach(i + 1, 1, tail);
      if (i >= W) tail = this.reach(i - W, 1, tail);
      if (i + W < W * H) tail = this.reach(i + W, 1, tail);
    }

    // 2. 残った通常ブロックは浮いている。固まりごとに落とせるか調べる
    let fell = false;
    let id = 2;
    for (let s = 0; s < W * H; s++) {
      if (tiles[s] !== T.DIRT || comp[s] !== 0) continue;
      head = 0; tail = 0;
      comp[s] = id; queue[tail++] = s;
      while (head < tail) {
        const i = queue[head++];
        const x = i % W;
        if (x > 0) tail = this.reach(i - 1, id, tail);
        if (x < W - 1) tail = this.reach(i + 1, id, tail);
        if (i >= W) tail = this.reach(i - W, id, tail);
        if (i + W < W * H) tail = this.reach(i + W, id, tail);
      }
      const cells = Array.from(queue.subarray(0, tail));
      if (this.dropGroup(cells, id)) fell = true;
      id++;
    }
    return fell;
  }

  // つながりをたどる(通常ブロックで、まだ番号がないマスだけ)
  reach(j, id, tail) {
    if (this.comp[j] === 0 && this.tiles[j] === T.DIRT) {
      this.comp[j] = id;
      this.queue[tail++] = j;
    }
    return tail;
  }

  // 固まりの真下がすべて空いていれば(空気か水)、1段落とす
  dropGroup(cells, id) {
    const { W, H, tiles, comp } = this;
    for (const i of cells) {
      const b = i + W;
      if (b >= W * H) return false;
      if (comp[b] === id) continue;
      if (!OPEN[tiles[b]]) return false;
    }
    // 下のほうから順に入れかえると、押しのけた空気や水が上に移る
    cells.sort((a, b) => b - a);
    for (const i of cells) {
      this.swap(i, i + W);
      this.moved[i + W] = 1;
      comp[i + W] = id;
    }
    return true;
  }

  // 砂: 下が空いていれば落ちる。ふさがっていれば、ななめ下にくずれる
  stepSand() {
    const { W, H, tiles, moved } = this;
    let any = false;
    for (let y = H - 2; y >= 0; y--) {
      for (let k = 0; k < W; k++) {
        const x = this.flip ? k : W - 1 - k;
        const i = y * W + x;
        if (tiles[i] !== T.SAND || moved[i]) continue;
        const b = i + W;
        if (OPEN[tiles[b]]) {
          this.swap(i, b); moved[b] = 1; moved[i] = 1; any = true;
          continue;
        }
        const dirs = this.flip ? [1, -1] : [-1, 1];
        for (const d of dirs) {
          const nx = x + d;
          if (nx <= 0 || nx >= W - 1) continue;
          if (OPEN[tiles[i + d]] && OPEN[tiles[b + d]]) {
            this.swap(i, b + d); moved[b + d] = 1; moved[i] = 1; any = true;
            break;
          }
        }
      }
    }
    return any;
  }

  // 水: 量は変わらない。下が空いていれば落ちる。
  // ふさがっていれば、近くの「低いところ」に向かって横に流れる。
  // 上に水が乗っているときは、その重さで横の空きに押し出される。
  stepWater() {
    const { W, H, tiles, moved } = this;
    for (let y = H - 2; y >= 0; y--) {
      for (let k = 0; k < W; k++) {
        const x = this.flip ? k : W - 1 - k;
        const i = y * W + x;
        if (tiles[i] !== T.WATER || moved[i]) continue;
        const b = i + W;
        if (tiles[b] === T.AIR) {
          this.swap(i, b); moved[b] = 1; continue;
        }
        const dirs = this.flip ? [1, -1] : [-1, 1];
        // 低いところ(横の空きの、さらに下が空いている所)を探す
        let best = 0, bestDist = WATER_LOOK + 1;
        for (const d of dirs) {
          for (let s = 1; s <= WATER_LOOK; s++) {
            const nx = x + d * s;
            if (nx < 0 || nx >= W) break;
            if (tiles[i + d * s] !== T.AIR) break;
            if (tiles[b + d * s] === T.AIR) {
              if (s < bestDist) { best = d; bestDist = s; }
              break;
            }
          }
        }
        if (best === 0 && y > 0 && tiles[i - W] === T.WATER) {
          // 上に水が乗っている → 横の空きに押し出される
          for (const d of dirs) {
            if (tiles[i + d] === T.AIR) { best = d; break; }
          }
        }
        if (best !== 0) {
          this.swap(i, i + best); moved[i + best] = 1;
        }
      }
    }
  }
}
