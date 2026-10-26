// プレイヤーの動き(移動、ジャンプ、ハシゴ、水)
import { T, SOLID, PHYS } from './config.js';

const EPS = 1e-4;

// 四角(x, y, w, h)がぶつかるブロックに重なっているか
export function hitsSolid(map, x, y, w, h) {
  const x0 = Math.floor(x), x1 = Math.floor(x + w - EPS);
  const y0 = Math.floor(y), y1 = Math.floor(y + h - EPS);
  for (let ty = y0; ty <= y1; ty++) {
    for (let tx = x0; tx <= x1; tx++) {
      if (SOLID[map.get(tx, ty)]) return true;
    }
  }
  return false;
}

// 四角が、指定した種類のブロックに重なっているか
function touches(map, x, y, w, h, type) {
  const x0 = Math.floor(x), x1 = Math.floor(x + w - EPS);
  const y0 = Math.floor(y), y1 = Math.floor(y + h - EPS);
  for (let ty = y0; ty <= y1; ty++) {
    for (let tx = x0; tx <= x1; tx++) {
      if (map.get(tx, ty) === type) return true;
    }
  }
  return false;
}

// ハシゴの一番上(上がハシゴでない)は、上に乗れる足場になる
function isLadderTop(map, tx, ty) {
  return map.get(tx, ty) === T.LADDER && map.get(tx, ty - 1) !== T.LADDER;
}

const approach = (v, target, step) =>
  v < target ? Math.min(v + step, target) : Math.max(v - step, target);

export class Player {
  constructor(team, spawn) {
    this.team = team;
    this.w = 0.75;
    this.h = 1.75;
    this.spawn = spawn;
    this.respawn();
  }

  respawn() {
    this.x = this.spawn.x - this.w / 2;
    this.y = this.spawn.y - this.h;
    this.vx = 0;
    this.vy = 0;
    this.onGround = false;
    this.climbing = false;
    this.inWater = false;
    this.facing = this.team === 'pink' ? -1 : 1;
  }

  get cx() { return this.x + this.w / 2; }

  // 落ちてきたブロックや砂に埋まったら、いちばん近い空いた場所に押し出す
  unstick(map) {
    const { w, h } = this;
    if (!hitsSolid(map, this.x, this.y, w, h)) return false;
    const footY = Math.floor(this.y + h + 1e-3); // 足もとの段
    let best = null, bestScore = Infinity;
    for (let dy = -8; dy <= 4; dy++) {
      for (let dx = -6; dx <= 6; dx++) {
        const nx = this.x + dx;
        const ny = footY + dy - h;
        if (hitsSolid(map, nx, ny, w, h)) continue;
        const score = Math.abs(dx) + Math.abs(dy) + (dy > 0 ? 0.5 : 0); // 同じ近さなら上に
        if (score < bestScore) { bestScore = score; best = [nx, ny]; }
      }
    }
    if (!best) return false;
    this.x = best[0];
    this.y = best[1];
    this.vy = 0;
    return true;
  }
  get cy() { return this.y + this.h / 2; }

  // input: { x, y (-1〜1。上がマイナス), jumpHeld }
  update(dt, input, map) {
    const { w, h } = this;
    const wet = touches(map, this.x, this.y + h * 0.4, w, h * 0.6, T.WATER);
    this.inWater = wet;
    // 体の真ん中あたりがハシゴに重なっているか
    const onLadder = touches(map, this.x + w * 0.3, this.y, w * 0.4, h, T.LADDER);

    if (onLadder && Math.abs(input.y) > 0.5) this.climbing = true;
    if (!onLadder) this.climbing = false;

    // 左右
    const ax = Math.abs(input.x);
    const power = ax < 0.2 ? 0 : Math.min(1, (ax - 0.2) / 0.6);
    let maxSpeed = PHYS.move * (wet ? PHYS.waterMove : 1) * (this.climbing ? 0.6 : 1);
    const target = Math.sign(input.x) * power * maxSpeed;
    const accel = this.onGround || this.climbing ? 70 : 35;
    this.vx = approach(this.vx, target, accel * dt);
    if (power > 0) this.facing = Math.sign(input.x);

    // 上下
    if (this.climbing) {
      this.vy = Math.abs(input.y) > 0.3 ? input.y * PHYS.climb : 0;
    } else {
      this.vy += PHYS.gravity * (wet ? PHYS.waterGravity : 1) * dt;
      const maxFall = wet ? PHYS.waterMaxFall : PHYS.maxFall;
      if (this.vy > maxFall) this.vy = maxFall;
      // 上に倒している間は、着地するたびにまた跳ぶ
      if (input.jumpHeld && this.onGround) {
        this.vy = -PHYS.jump * (wet ? 0.6 : 1);
      } else if (wet && input.y < -0.55) {
        this.vy = Math.max(this.vy - 45 * dt, -PHYS.swimUp);
      }
    }

    this.moveX(dt, map);
    this.moveY(dt, map, input);

    // マップの外に落ちたら陣地に戻す(念のため)
    if (this.y > map.H + 5) this.respawn();
  }

  moveX(dt, map) {
    const { w, h } = this;
    let nx = this.x + this.vx * dt;
    if (!hitsSolid(map, nx, this.y, w, h)) { this.x = nx; return; }

    // 1段だけの段差は自動で登る
    if (this.onGround && !this.climbing && this.vx !== 0 &&
        !hitsSolid(map, nx, this.y - 1, w, h)) {
      // 段の上にちょうど乗る高さにそろえる
      this.y = Math.floor(this.y + h - 1 + EPS) - h;
      if (!hitsSolid(map, nx, this.y, w, h)) { this.x = nx; return; }
    }

    // 壁にぴったりくっつける
    if (this.vx > 0) nx = Math.floor(nx + w - EPS) - w;
    else nx = Math.floor(nx) + 1;
    if (!hitsSolid(map, nx, this.y, w, h)) this.x = nx;
    this.vx = 0;
  }

  moveY(dt, map, input) {
    const { w, h } = this;
    let ny = this.y + this.vy * dt;
    this.onGround = false;

    if (this.vy > 0) {
      if (hitsSolid(map, this.x, ny, w, h)) {
        ny = Math.floor(ny + h - EPS) - h;
        this.vy = 0;
        this.onGround = true;
      } else if (!this.climbing && input.y <= 0.5) {
        // ハシゴの一番上に着地(下に倒している間はすり抜けて降りる)
        const prevBottom = this.y + h;
        const row = Math.floor(ny + h);
        if (prevBottom <= row + EPS) {
          const x0 = Math.floor(this.x), x1 = Math.floor(this.x + w - EPS);
          for (let tx = x0; tx <= x1; tx++) {
            if (isLadderTop(map, tx, row)) {
              ny = row - h;
              this.vy = 0;
              this.onGround = true;
              break;
            }
          }
        }
      }
    } else if (this.vy < 0) {
      if (hitsSolid(map, this.x, ny, w, h)) {
        ny = Math.floor(ny) + 1;
        this.vy = 0;
      }
    }
    this.y = ny;
  }
}
