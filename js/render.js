// 画面に描く(ゲーム画面とミニマップ)
import { SCOPE_LOOK, SHIELD_MAX } from './items.js?v=0.9';
import { T, SOLID, COLORS as C, VIEW_TILES_X } from './config.js?v=0.9';
import { REACH } from './terrain.js?v=0.9';

// 遠くのビル(背景の飾り)。毎回同じ形にする
function makeSkyline() {
  const list = [];
  let x = 0, i = 0;
  while (x < 120) {
    const r = Math.sin(i * 91.7) * 0.5 + 0.5;
    const w = 3 + Math.round(r * 4);
    const h = 4 + Math.round((Math.sin(i * 17.3) * 0.5 + 0.5) * 9);
    list.push({ x, w, h, seed: i });
    x += w + 1;
    i++;
  }
  return list;
}

export class Renderer {
  constructor(canvas, minimapCanvas, map) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.mini = minimapCanvas;
    this.miniCtx = minimapCanvas.getContext('2d');
    this.map = map;
    this.cam = { x: 0, y: 0, ready: false };
    this.skyline = makeSkyline();
    this.view = { left: 0, top: 0 };
    this.flashes = []; // 掘った・置いた場所を一瞬光らせる
    this.shakeAmt = 0; // 画面のゆれ(爆発のとき)
    // ミニマップに映す範囲(空の上のほうは省く)
    this.miniTop = 10;
    this.miniRows = 28; // 10〜37段目(見張り台から、地下トンネルの少し下まで)
    this.miniTerrain = document.createElement('canvas');
    this.redrawMiniTerrain();
    this.resize();
  }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    this.dpr = dpr;

    // 1. 先にミニマップの高さを決める(これでゲーム画面の高さが変わるため)
    const mr = this.mini.getBoundingClientRect();
    const mw = Math.max(1, mr.width);
    // 高さは、横120ブロックのときと同じにする(マップが狭いぶん、横に引きのばして描く)
    const mh = Math.round(mw * this.miniRows / 120);
    this.mini.style.height = mh + 'px';
    this.mini.width = Math.round(mw * dpr);
    this.mini.height = Math.round(mh * dpr);

    // 2. そのあとで、ゲーム画面の大きさを測る
    const r = this.canvas.getBoundingClientRect();
    this.cssW = Math.max(1, r.width);
    this.cssH = Math.max(1, r.height);
    this.canvas.width = Math.round(this.cssW * dpr);
    this.canvas.height = Math.round(this.cssH * dpr);
    this.tile = this.cssW / VIEW_TILES_X; // 1ブロックの大きさ(CSSピクセル)

    // 3. 画面の大きさがあとから変わったら(アドレスバーが隠れたなど)、自動で測り直す
    if (!this.observer && window.ResizeObserver) {
      this.observer = new ResizeObserver(() => {
        const now = this.canvas.getBoundingClientRect();
        if (Math.abs(now.width - this.cssW) > 0.5 || Math.abs(now.height - this.cssH) > 0.5) {
          this.resize();
        }
      });
      this.observer.observe(this.canvas);
    }
  }

  // 地形が変わったときに呼ぶ(ミニマップの地形を作り直す)
  redrawMiniTerrain() {
    const { map } = this;
    const c = this.miniTerrain;
    c.width = map.W;
    c.height = this.miniRows;
    const g = c.getContext('2d');
    const img = g.createImageData(map.W, this.miniRows);
    const col = {
      [T.AIR]: [5, 8, 17], [T.DIRT]: [44, 58, 92], [T.HARD]: [70, 80, 122],
      [T.BEDROCK]: [26, 32, 52], [T.SAND]: [201, 162, 74], [T.WATER]: [30, 111, 217],
      [T.LADDER]: [138, 155, 168], [T.CORE_C]: [0, 243, 255], [T.CORE_P]: [255, 51, 102],
      [T.CRATE]: [255, 176, 32],
    };
    for (let y = 0; y < this.miniRows; y++) {
      for (let x = 0; x < map.W; x++) {
        const my = y + this.miniTop;
        let t = map.get(x, my);
        let rgb = col[t] || col[T.AIR];
        if (t === T.AIR && my > map.surf[x]) rgb = [12, 16, 30]; // 地下の空間
        const i = (y * map.W + x) * 4;
        img.data[i] = rgb[0]; img.data[i + 1] = rgb[1]; img.data[i + 2] = rgb[2]; img.data[i + 3] = 255;
      }
    }
    g.putImageData(img, 0, 0);
  }

  // 画面の位置(指の場所)を、マップのブロックの位置に直す
  screenToTile(clientX, clientY) {
    const r = this.canvas.getBoundingClientRect();
    return {
      tx: Math.floor(this.view.left + (clientX - r.left) / this.tile),
      ty: Math.floor(this.view.top + (clientY - r.top) / this.tile),
    };
  }

  // kind: 'dig'(掘った) 'place'(置いた) 'ng'(できない)
  flash(tx, ty, kind) {
    this.flashes.push({ tx, ty, kind, t0: performance.now() });
  }

  // 画面をゆらす(amount: ゆれの大きさ、ブロック単位)
  shake(amount) {
    this.shakeAmt = Math.max(this.shakeAmt, amount);
  }

  // look: ライフルでねらっている向き(その方へカメラを先まで動かして、遠くを見せる)
  updateCamera(dt, target, snap = false, look = null) {
    this.shakeAmt = Math.max(0, this.shakeAmt - dt * 1.2);
    const viewW = this.cssW / this.tile;
    const viewH = this.cssH / this.tile;
    let tx = target.cx;
    let ty = target.cy + viewH * 0.12; // 足もとの下(地下)まで見えるように
    if (look) {
      tx += look.x * SCOPE_LOOK;
      ty += look.y * SCOPE_LOOK * 0.8 - viewH * 0.12 * Math.abs(look.y);
    }
    this.scoping = !!look;
    if (snap || !this.cam.ready) {
      this.cam.x = tx; this.cam.y = ty; this.cam.ready = true;
    } else {
      const k = 1 - Math.pow(0.0005, dt); // なめらかに追いかける
      this.cam.x += (tx - this.cam.x) * k;
      this.cam.y += (ty - this.cam.y) * k;
    }
    const { W, H } = this.map;
    this.cam.x = Math.min(Math.max(this.cam.x, viewW / 2), W - viewW / 2);
    this.cam.y = Math.min(Math.max(this.cam.y, viewH / 2), H - viewH / 2);
  }

  // extras: プレイヤーのものではない弾・爆弾(オンラインで、ほかの人のもの)
  // drops: 空から落ちてくるアイテム箱
  draw(players, me, time, items, effects, extras = [], drops = []) {
    const { ctx, map, tile } = this;
    const viewW = this.cssW / tile;
    const viewH = this.cssH / tile;
    // タップの位置計算には、ゆれる前の位置を使う
    this.view.left = this.cam.x - viewW / 2;
    this.view.top = this.cam.y - viewH / 2;
    const shake = this.shakeAmt;
    const left = this.view.left + (shake ? (Math.random() - 0.5) * shake : 0);
    const top = this.view.top + (shake ? (Math.random() - 0.5) * shake : 0);
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);

    // ブロック座標を画面の位置に(すき間が出ないように整数にそろえる)
    const sx = (x) => Math.round((x - left) * tile * this.dpr) / this.dpr;
    const sy = (y) => Math.round((y - top) * tile * this.dpr) / this.dpr;

    // 空
    ctx.fillStyle = C.sky;
    ctx.fillRect(0, 0, this.cssW, this.cssH);
    this.drawSkyline(left, top, tile);

    const x0 = Math.floor(left), x1 = Math.ceil(left + viewW);
    const y0 = Math.floor(top), y1 = Math.ceil(top + viewH);

    for (let ty = y0; ty <= y1; ty++) {
      for (let tx = x0; tx <= x1; tx++) {
        const t = map.get(tx, ty);
        const px = sx(tx), py = sy(ty);
        const pw = sx(tx + 1) - px, ph = sy(ty + 1) - py;
        const under = tx >= 0 && tx < map.W && ty > map.surf[tx];

        // 地下の奥の壁
        if (!SOLID[t] && under) {
          ctx.fillStyle = C.backWall;
          ctx.fillRect(px, py, pw, ph);
          ctx.strokeStyle = C.backGrid;
          ctx.lineWidth = 1;
          ctx.strokeRect(px + 0.5, py + 0.5, pw - 1, ph - 1);
        }

        switch (t) {
          case T.DIRT: this.block(px, py, pw, ph, C.dirt, C.dirtLine); break;
          case T.HARD:
            this.block(px, py, pw, ph, C.hard, C.hardLine);
            ctx.strokeStyle = C.hardLine;
            ctx.beginPath();
            ctx.moveTo(px + pw * 0.25, py + ph * 0.75);
            ctx.lineTo(px + pw * 0.75, py + ph * 0.25);
            ctx.stroke();
            break;
          case T.BEDROCK: this.block(px, py, pw, ph, C.bedrock, C.bedrockLine); break;
          case T.SAND:
            ctx.fillStyle = C.sand;
            ctx.fillRect(px, py, pw, ph);
            ctx.fillStyle = C.sandDot;
            ctx.fillRect(px + pw * 0.2, py + ph * 0.3, 2, 2);
            ctx.fillRect(px + pw * 0.6, py + ph * 0.6, 2, 2);
            ctx.fillRect(px + pw * 0.75, py + ph * 0.15, 2, 2);
            break;
          case T.WATER: {
            const wave = Math.sin(time * 2 + tx * 0.8) * 1.5;
            const surfaceTile = map.get(tx, ty - 1) !== T.WATER;
            ctx.fillStyle = C.water;
            if (surfaceTile) {
              ctx.fillRect(px, py + 3 + wave, pw, ph - 3 - wave);
              ctx.fillStyle = C.waterTop;
              ctx.fillRect(px, py + 3 + wave, pw, 1.5);
            } else {
              ctx.fillRect(px, py, pw, ph);
            }
            break;
          }
          case T.LADDER: this.ladder(px, py, pw, ph); break;
          case T.CRATE: this.crate(px, py, pw, ph, time); break;
          case T.CORE_C:
          case T.CORE_P:
            this.block(px, py, pw, ph, '#0b1424', t === T.CORE_C ? C.cyan : C.pink);
            break;
          default: break;
        }

        // 地表のふち(上が空いているブロック)をネオンで光らせる
        if (SOLID[t] && t !== T.BEDROCK && !SOLID[map.get(tx, ty - 1)] && map.get(tx, ty - 1) !== T.WATER) {
          ctx.fillStyle = C.edge;
          ctx.fillRect(px, py, pw, 2);
        }
      }
    }

    this.drawCores(sx, sy, time);
    this.drawDrops(drops, sx, sy, tile, time);
    this.drawReach(me, sx, sy, tile);
    // 全員の爆弾と弾を描く(狙いの表示は自分のだけ)
    for (const p of players) if (p.items) this.drawBombs(p.items, sx, sy, tile, time);
    for (const it of extras) this.drawBombs(it, sx, sy, tile, time);

    for (const p of players) this.drawPlayer(p, sx, sy, tile, p === me);

    for (const p of players) if (p.items) this.drawBullets(p.items, sx, sy, tile);
    for (const it of extras) this.drawBullets(it, sx, sy, tile);
    if (effects) this.drawEffects(effects, sx, sy, tile);
    if (items) this.drawPreview(items, sx, sy, tile);
    this.drawFlashes(sx, sy);
    if (this.scoping) this.drawScope();

    this.drawMinimap(players, me, left, top, viewW, viewH, drops);
  }

  // 飛んでいる爆弾(点滅するランプつき)
  drawBombs(items, sx, sy, tile, time) {
    const { ctx } = this;
    for (const b of items.thrown) {
      const x = sx(b.x), y = sy(b.y), r = 0.28 * tile;
      if (b.c4) { this.drawC4(x, y, r, b, time); continue; }
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(b.spin);
      ctx.fillStyle = '#1b2236';
      ctx.strokeStyle = C.yellow;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.restore();
      // 爆発が近いほど速く点滅する
      const fast = b.fuse < 0.7 ? 14 : 6;
      if (Math.sin(time * fast * Math.PI) > 0) {
        ctx.save();
        ctx.fillStyle = '#ff3b3b';
        ctx.shadowColor = '#ff3b3b';
        ctx.shadowBlur = 8;
        ctx.beginPath();
        ctx.arc(x, y - r * 0.2, r * 0.35, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
    }
  }

  // 弾(短い光の線)
  drawBullets(items, sx, sy, tile) {
    const { ctx } = this;
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineWidth = Math.max(2, tile * 0.12);
    ctx.shadowBlur = 8;
    for (const b of items.bullets) {
      const color = b.team === 'pink' ? C.pink : C.cyan;
      ctx.strokeStyle = '#ffffff';
      ctx.shadowColor = color;
      const tail = 0.018;
      ctx.beginPath();
      ctx.moveTo(sx(b.x - b.vx * tail), sy(b.y - b.vy * tail));
      ctx.lineTo(sx(b.x), sy(b.y));
      ctx.stroke();
    }
    ctx.restore();
  }

  // 破片・火花・爆発の光
  drawEffects(effects, sx, sy, tile) {
    const { ctx } = this;
    for (const b of effects.blasts) {
      const k = b.age / b.life;
      const r = b.r * tile * (0.5 + k * 0.8);
      ctx.save();
      ctx.globalAlpha = 1 - k;
      const g = ctx.createRadialGradient(sx(b.x), sy(b.y), 0, sx(b.x), sy(b.y), r);
      g.addColorStop(0, 'rgba(255,255,230,0.95)');
      g.addColorStop(0.35, 'rgba(255,204,0,0.8)');
      g.addColorStop(1, 'rgba(255,90,40,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(sx(b.x), sy(b.y), r, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
    // ダメージの数字
    ctx.save();
    ctx.textAlign = 'center';
    ctx.font = 'bold 13px system-ui, sans-serif';
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(0,0,0,.7)';
    for (const t of effects.texts) {
      ctx.globalAlpha = Math.min(1, (t.life - t.age) / 0.3);
      const x = sx(t.x), y = sy(t.y - t.age * 1.2);
      ctx.strokeText(t.text, x, y);
      ctx.fillStyle = t.color;
      ctx.fillText(t.text, x, y);
    }
    ctx.restore();
    for (const p of effects.parts) {
      const a = Math.min(1, (p.life - p.age) / 0.25);
      const s = p.size * tile;
      ctx.save();
      ctx.globalAlpha = a;
      ctx.fillStyle = p.color;
      if (p.glow) { ctx.shadowColor = p.color; ctx.shadowBlur = 6; }
      ctx.fillRect(sx(p.x) - s / 2, sy(p.y) - s / 2, s, s);
      ctx.restore();
    }
  }

  // 狙っているときの表示
  drawPreview(items, sx, sy, tile) {
    const pv = items.preview;
    if (!pv) return;
    const { ctx } = this;
    ctx.save();
    if (pv.kind === 'gun') {
      // 次に撃てるまでは、うすく出す
      ctx.strokeStyle = pv.ready === false ? 'rgba(0, 243, 255, 0.22)' : 'rgba(0, 243, 255, 0.6)';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([6, 5]);
      ctx.beginPath();
      ctx.moveTo(sx(pv.x0), sy(pv.y0));
      ctx.lineTo(sx(pv.x1), sy(pv.y1));
      ctx.stroke();
      // ねらいアシストで吸いついた敵に、四すみの印
      if (pv.lock && !pv.lock.dead) this.drawLock(pv.lock, sx, sy, tile);
    } else if (pv.kind === 'bomb') {
      ctx.fillStyle = pv.c4 ? 'rgba(255, 80, 80, 0.85)' : 'rgba(255, 204, 0, 0.8)';
      for (const p of pv.points) {
        ctx.beginPath();
        ctx.arc(sx(p.x), sy(p.y), p.end ? 4 : 2.2, 0, Math.PI * 2);
        ctx.fill();
      }
    } else if (pv.kind === 'pick' || pv.kind === 'block') {
      let tx, ty, color;
      if (pv.kind === 'pick') {
        if (!pv.hit) { ctx.restore(); return; }
        tx = pv.hit.tx; ty = pv.hit.ty;
        const t = this.map.get(tx, ty);
        color = t === T.DIRT || t === T.SAND ? C.yellow : '#ff3b3b';
      } else {
        tx = pv.tx; ty = pv.ty;
        color = pv.ok ? C.cyan : '#ff3b3b';
      }
      const px = sx(tx), py = sy(ty);
      const pw = sx(tx + 1) - px, ph = sy(ty + 1) - py;
      ctx.strokeStyle = color;
      ctx.shadowColor = color;
      ctx.shadowBlur = 6;
      ctx.lineWidth = 2;
      if (pv.kind === 'block') {
        ctx.setLineDash([4, 3]);
        ctx.fillStyle = pv.ok ? 'rgba(0, 243, 255, 0.15)' : 'rgba(255, 59, 59, 0.12)';
        ctx.fillRect(px, py, pw, ph);
      }
      ctx.strokeRect(px + 1, py + 1, pw - 2, ph - 2);
    }
    ctx.restore();
  }

  // 掘る・置くが届く範囲(うすい点線の円)
  drawReach(me, sx, sy, tile) {
    const { ctx } = this;
    ctx.save();
    ctx.strokeStyle = 'rgba(0, 243, 255, 0.18)';
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 6]);
    ctx.beginPath();
    ctx.arc(sx(me.cx), sy(me.cy), REACH * tile, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  drawFlashes(sx, sy) {
    const { ctx } = this;
    const now = performance.now();
    const life = 350;
    this.flashes = this.flashes.filter((f) => now - f.t0 < life);
    for (const f of this.flashes) {
      const a = 1 - (now - f.t0) / life;
      const color = f.kind === 'dig' ? C.yellow : f.kind === 'place' ? C.cyan : '#ff3b3b';
      const px = sx(f.tx), py = sy(f.ty);
      const pw = sx(f.tx + 1) - px, ph = sy(f.ty + 1) - py;
      const grow = (1 - a) * pw * 0.25;
      ctx.save();
      ctx.globalAlpha = a;
      ctx.strokeStyle = color;
      ctx.shadowColor = color;
      ctx.shadowBlur = 8;
      ctx.lineWidth = 2;
      ctx.strokeRect(px - grow + 1, py - grow + 1, pw + grow * 2 - 2, ph + grow * 2 - 2);
      if (f.kind === 'ng') {
        ctx.beginPath();
        ctx.moveTo(px + pw * 0.25, py + ph * 0.25); ctx.lineTo(px + pw * 0.75, py + ph * 0.75);
        ctx.moveTo(px + pw * 0.75, py + ph * 0.25); ctx.lineTo(px + pw * 0.25, py + ph * 0.75);
        ctx.stroke();
      }
      ctx.restore();
    }
  }

  block(px, py, pw, ph, fill, line) {
    const { ctx } = this;
    ctx.fillStyle = fill;
    ctx.fillRect(px, py, pw, ph);
    ctx.strokeStyle = line;
    ctx.lineWidth = 1;
    ctx.strokeRect(px + 0.5, py + 0.5, pw - 1, ph - 1);
  }

  ladder(px, py, pw, ph) {
    const { ctx } = this;
    ctx.strokeStyle = C.ladder;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(px + pw * 0.22, py); ctx.lineTo(px + pw * 0.22, py + ph);
    ctx.moveTo(px + pw * 0.78, py); ctx.lineTo(px + pw * 0.78, py + ph);
    for (let k = 0.25; k < 1; k += 0.5) {
      ctx.moveTo(px + pw * 0.22, py + ph * k); ctx.lineTo(px + pw * 0.78, py + ph * k);
    }
    ctx.stroke();
  }

  drawCores(sx, sy, time) {
    const { ctx } = this;
    for (const c of this.map.cores) {
      if (c.hp !== undefined && c.hp <= 0) continue; // 壊れたコアは描かない
      const ratio = c.hp === undefined ? 1 : c.hp / 1000;
      let color = c.team === 'cyan' ? C.cyan : C.pink;
      if (c.hitT > 0) color = '#ffffff'; // 当たった瞬間は白く光る
      const cx = (sx(c.x) + sx(c.x + c.w)) / 2;
      const cy = (sy(c.y) + sy(c.y + c.h)) / 2;
      const r = (sx(c.x + c.w) - sx(c.x)) * 0.32 * (1 + Math.sin(time * 3) * 0.06);
      ctx.save();
      // 体力が少ないと、ちらつく
      if (ratio < 0.3) ctx.globalAlpha = 0.55 + 0.45 * Math.abs(Math.sin(time * 9));
      ctx.shadowColor = color;
      ctx.shadowBlur = 14;
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(cx, cy - r); ctx.lineTo(cx + r, cy); ctx.lineTo(cx, cy + r); ctx.lineTo(cx - r, cy);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
      ctx.fillStyle = '#0b1424';
      ctx.beginPath();
      ctx.arc(cx, cy, r * 0.32, 0, Math.PI * 2);
      ctx.fill();
      // 修理中は、まわりに光の輪
      if (c.repairing) {
        ctx.save();
        ctx.strokeStyle = '#7dffb0';
        ctx.shadowColor = '#7dffb0';
        ctx.shadowBlur = 8;
        ctx.lineWidth = 2;
        ctx.globalAlpha = 0.5 + 0.5 * Math.sin(time * 8);
        ctx.beginPath();
        ctx.arc(cx, cy, r * 1.5, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }
    }
  }

  drawPlayer(p, sx, sy, tile, isMe) {
    if (p.dead) return;
    // 復活してすぐ(ダメージを受けない間)は点滅する
    if (p.safeT > 0 && Math.floor(p.safeT * 10) % 2 === 0) return;
    const { ctx } = this;
    const color = p.hurtT > 0 ? '#ffffff' : (p.team === 'cyan' ? C.cyan : C.pink);
    const x = sx(p.x), y = sy(p.y);
    const w = p.w * tile, h = p.h * tile;
    const r = w * 0.3;

    // ダッシュ中: うしろに光のすじ
    if (p.dashing) {
      ctx.save();
      ctx.strokeStyle = C.yellow;
      ctx.shadowColor = C.yellow;
      ctx.shadowBlur = 6;
      ctx.lineWidth = 1.5;
      ctx.globalAlpha = 0.7;
      const back = -p.facing;
      const bx0 = p.facing > 0 ? x : x + w;
      ctx.beginPath();
      for (const [k, len] of [[0.3, 0.9], [0.55, 1.3], [0.8, 0.8]]) {
        ctx.moveTo(bx0 + back * w * 0.15, y + h * k);
        ctx.lineTo(bx0 + back * w * len, y + h * k);
      }
      ctx.stroke();
      ctx.restore();
    }

    // 体
    ctx.save();
    ctx.shadowColor = color;
    ctx.shadowBlur = isMe ? 10 : 6;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.roundRect(x, y + h * 0.18, w, h * 0.82, r);
    ctx.fill();
    ctx.restore();

    // 頭とバイザー
    ctx.fillStyle = '#0b1424';
    ctx.beginPath();
    ctx.roundRect(x + w * 0.08, y, w * 0.84, h * 0.42, r);
    ctx.fill();
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.fillStyle = '#ffffff';
    const vx = p.facing > 0 ? x + w * 0.45 : x + w * 0.15;
    ctx.fillRect(vx, y + h * 0.14, w * 0.4, h * 0.08);

    // 名前と体力バー
    const label = isMe ? 'YOU' : p.name;
    ctx.fillStyle = '#e2e8f0';
    ctx.font = '11px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(label, x + w / 2, y - 9);
    ctx.textAlign = 'start';
    const bw = Math.max(w * 1.6, 22), bh = 3;
    const bx = x + w / 2 - bw / 2;
    let by = y - 6;
    const ratio = p.hp / p.maxHp;
    const sh = p.shield || 0;
    // シールド中: 体のまわりに六角の光、体力バーの下に細い金色のバー
    if (sh > 0) {
      this.drawShield(x, y, w, h);
      by -= 3;
      ctx.fillStyle = 'rgba(0,0,0,.6)';
      ctx.fillRect(bx, by + bh + 1, bw, 2);
      ctx.fillStyle = C.crateLine;
      ctx.fillRect(bx, by + bh + 1, bw * Math.min(1, sh / SHIELD_MAX), 2);
    }
    ctx.fillStyle = 'rgba(0,0,0,.6)';
    ctx.fillRect(bx, by, bw, bh);
    ctx.fillStyle = ratio > 0.5 ? (p.team === 'cyan' ? C.cyan : C.pink) : ratio > 0.25 ? C.yellow : '#ff3b3b';
    ctx.fillRect(bx, by, bw * ratio, bh);
  }

  drawSkyline(left, top, tile) {
    const { ctx } = this;
    const par = 0.35; // 遠くのものはゆっくり動く
    const groundY = (18 - top) * tile;
    const offset = -left * tile * par;
    const unit = tile * 0.9;
    const total = 120 * unit;
    ctx.fillStyle = '#0f1630';
    for (const b of this.skyline) {
      let bx = ((b.x * unit + offset) % total + total) % total - unit * 8;
      for (let rep = 0; rep < 2; rep++, bx += total) {
        if (bx > this.cssW || bx + b.w * unit < 0) continue;
        const bh = b.h * unit;
        ctx.fillStyle = '#0f1630';
        ctx.fillRect(bx, groundY - bh, b.w * unit, bh);
        // 窓
        ctx.fillStyle = b.seed % 3 === 0 ? 'rgba(255,51,102,.35)' : 'rgba(0,243,255,.25)';
        for (let wy = 1; wy < b.h - 1; wy += 2) {
          for (let wx = 1; wx < b.w - 1; wx += 2) {
            if (Math.sin(b.seed * 31 + wx * 7 + wy * 13) > 0.2) {
              ctx.fillRect(bx + wx * unit, groundY - bh + wy * unit, unit * 0.5, unit * 0.6);
            }
          }
        }
      }
    }
  }

  // アイテム箱(地面の中・着地したもの)
  crate(px, py, pw, ph, time) {
    const { ctx } = this;
    const m = Math.max(1, pw * 0.08);
    ctx.save();
    ctx.fillStyle = C.crate;
    ctx.fillRect(px + m, py + m, pw - m * 2, ph - m * 2);
    ctx.strokeStyle = C.crateLine;
    ctx.shadowColor = C.crateLine;
    ctx.shadowBlur = 4 + 3 * (0.5 + 0.5 * Math.sin(time * 4));
    ctx.lineWidth = Math.max(1.5, pw * 0.09);
    ctx.strokeRect(px + m, py + m, pw - m * 2, ph - m * 2);
    ctx.shadowBlur = 0;
    // 帯(×)と、まん中の「?」
    ctx.lineWidth = Math.max(1, pw * 0.06);
    ctx.globalAlpha = 0.55;
    ctx.beginPath();
    ctx.moveTo(px + m * 2, py + m * 2); ctx.lineTo(px + pw - m * 2, py + ph - m * 2);
    ctx.moveTo(px + pw - m * 2, py + m * 2); ctx.lineTo(px + m * 2, py + ph - m * 2);
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#ffe08a';
    ctx.font = `bold ${Math.round(ph * 0.62)}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('?', px + pw / 2, py + ph * 0.54);
    ctx.restore();
  }

  // 空から落ちてくる箱(パラシュートつき)
  drawDrops(drops, sx, sy, tile, time) {
    const { ctx } = this;
    for (const d of drops) {
      const sw = Math.sin(d.sway * 2.2) * 0.12;
      const x = d.x + sw;
      const px = sx(x - 0.5), py = sy(d.y - 0.5);
      const pw = sx(x + 0.5) - px, ph = sy(d.y + 0.5) - py;
      // ひもとパラシュート
      const cx = sx(x), top = sy(d.y - 2.1);
      const rr = tile * 1.1;
      ctx.save();
      ctx.strokeStyle = 'rgba(226, 232, 240, 0.7)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(px + 1, py); ctx.lineTo(cx - rr, top);
      ctx.moveTo(px + pw - 1, py); ctx.lineTo(cx + rr, top);
      ctx.moveTo(cx, py); ctx.lineTo(cx, top - rr * 0.1);
      ctx.stroke();
      ctx.fillStyle = 'rgba(255, 176, 32, 0.22)';
      ctx.strokeStyle = C.crateLine;
      ctx.shadowColor = C.crateLine;
      ctx.shadowBlur = 8;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(cx, top, rr, Math.PI, 0);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.restore();
      this.crate(px, py, pw, ph, time);
    }
  }

  // C4(赤いランプの四角い箱。くっつくので回らない)
  drawC4(x, y, r, b, time) {
    const { ctx } = this;
    const w = r * 2.1, h = r * 1.5;
    ctx.save();
    ctx.fillStyle = '#3a1418';
    ctx.strokeStyle = '#ff5050';
    ctx.lineWidth = 1.5;
    ctx.shadowColor = '#ff5050';
    ctx.shadowBlur = 6;
    ctx.beginPath();
    ctx.roundRect(x - w / 2, y - h / 2, w, h, 2);
    ctx.fill();
    ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#d9c8a0';
    ctx.fillRect(x - w * 0.35, y - h * 0.18, w * 0.7, h * 0.36);
    const fast = b.fuse < 1 ? 16 : 6;
    if (Math.sin(time * fast * Math.PI) > 0) {
      ctx.fillStyle = '#ff2b2b';
      ctx.shadowColor = '#ff2b2b';
      ctx.shadowBlur = 10;
      ctx.beginPath();
      ctx.arc(x + w * 0.38, y - h * 0.5, r * 0.3, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  // ねらいアシストの印(敵のまわりの四すみ)
  drawLock(p, sx, sy, tile) {
    const { ctx } = this;
    const pad = 0.25;
    const x0 = sx(p.x - pad), y0 = sy(p.y - pad), x1 = sx(p.x + p.w + pad), y1 = sy(p.y + p.h + pad);
    const k = tile * 0.35;
    ctx.save();
    ctx.setLineDash([]);
    ctx.strokeStyle = '#ff3b3b';
    ctx.shadowColor = '#ff3b3b';
    ctx.shadowBlur = 6;
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (const [x, y, dx, dy] of [[x0, y0, 1, 1], [x1, y0, -1, 1], [x0, y1, 1, -1], [x1, y1, -1, -1]]) {
      ctx.moveTo(x + dx * k, y); ctx.lineTo(x, y); ctx.lineTo(x, y + dy * k);
    }
    ctx.stroke();
    ctx.restore();
  }

  // シールド(体のまわりの六角形の光)
  drawShield(x, y, w, h) {
    const { ctx } = this;
    const cx = x + w / 2, cy = y + h / 2, r = h * 0.68;
    ctx.save();
    ctx.strokeStyle = 'rgba(255, 176, 32, 0.75)';
    ctx.shadowColor = '#ffb020';
    ctx.shadowBlur = 8;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (let i = 0; i < 6; i++) {
      const a = Math.PI / 6 + (i * Math.PI) / 3;
      const px = cx + Math.cos(a) * r * 0.78, py = cy + Math.sin(a) * r;
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.stroke();
    ctx.restore();
  }

  // ライフルのスコープ(まわりを少し暗く)
  drawScope() {
    const { ctx } = this;
    const w = this.cssW, h = this.cssH;
    const g = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.35, w / 2, h / 2, Math.max(w, h) * 0.75);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(1, 'rgba(0,0,0,0.55)');
    ctx.save();
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    ctx.restore();
  }

  drawMinimap(players, me, left, top, viewW, viewH, drops = []) {
    const g = this.miniCtx;
    const W = this.mini.width, H = this.mini.height;
    const s = W / this.map.W;           // 横の1ブロック
    const t = H / this.miniRows;          // 縦の1ブロック
    g.imageSmoothingEnabled = false;
    g.drawImage(this.miniTerrain, 0, 0, W, H);

    // コア
    // コア(体力が減ると、色の部分が下から減っていく)
    for (const c of this.map.cores) {
      const color = c.team === 'cyan' ? C.cyan : C.pink;
      const x = (c.x - 0.5) * s, y = (c.y - this.miniTop - 0.5) * t;
      const w = (c.w + 1) * s, h = (c.h + 1) * t;
      const ratio = c.hp === undefined ? 1 : Math.max(0, c.hp / 1000);
      g.fillStyle = '#05080f';
      g.fillRect(x, y, w, h);
      g.fillStyle = color;
      g.fillRect(x, y + h * (1 - ratio), w, h * ratio);
      g.strokeStyle = color;
      g.lineWidth = Math.max(1, this.dpr * 0.7);
      g.strokeRect(x, y, w, h);
    }
    // プレイヤー(やられている人は出さない)
    for (const p of players) {
      if (p.dead) continue;
      g.fillStyle = p === me ? '#ffffff' : (p.team === 'cyan' ? C.cyan : C.pink);
      g.beginPath();
      g.arc(p.cx * s, (p.cy - this.miniTop) * t, Math.max(2, t * 1.2), 0, Math.PI * 2);
      g.fill();
    }
    // 落ちてくるアイテム箱
    g.fillStyle = '#ffb020';
    for (const d of drops) {
      if (d.y < this.miniTop) continue;
      g.fillRect(d.x * s - t, (d.y - this.miniTop) * t - t, t * 2, t * 2);
    }
    // 今見えている範囲
    g.strokeStyle = 'rgba(255,255,255,.8)';
    g.lineWidth = Math.max(1, this.dpr);
    g.setLineDash([3 * this.dpr, 2 * this.dpr]);
    g.strokeRect(left * s, (top - this.miniTop) * t, viewW * s, viewH * t);
    g.setLineDash([]);
  }
}
