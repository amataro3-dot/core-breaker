// 入口: マップを作って、1人で動ける・掘れる状態にする(ステップ2)
import { STEP, T } from './config.js';
import { buildMap } from './map.js';
import { Player, hitsSolid } from './player.js';
import { Stick, Input } from './input.js';
import { Renderer } from './render.js';
import { Terrain, TERRAIN_HZ, REACH, HAND_MAX, HAND_START } from './terrain.js';

// 古い端末向け: 角の丸い四角が描けないときの代わり
if (!CanvasRenderingContext2D.prototype.roundRect) {
  CanvasRenderingContext2D.prototype.roundRect = function (x, y, w, h) { this.rect(x, y, w, h); };
}

const map = buildMap();
const terrain = new Terrain(map);
const me = new Player('cyan', map.spawns.cyan);
const players = [me];
let hand = HAND_START; // 手持ちのブロック数

const canvas = document.getElementById('game');
const handEl = document.getElementById('hand-count');
const tipEl = document.getElementById('tip');

const input = new Input(new Stick(document.getElementById('stick-left')));
const renderer = new Renderer(canvas, document.getElementById('minimap'), map);

window.addEventListener('resize', () => renderer.resize());
// 画面の長押しメニューやダブルタップの拡大を止める
document.addEventListener('contextmenu', (e) => e.preventDefault());
document.addEventListener('gesturestart', (e) => e.preventDefault());

// ---- 画面タップで掘る・置く(右スティックができるまでの仮の操作) ----
let tipTimer = 0;
function showTip(text) {
  tipEl.textContent = text;
  tipEl.classList.add('show');
  clearTimeout(tipTimer);
  tipTimer = setTimeout(() => tipEl.classList.remove('show'), 1400);
}

function updateHand() {
  handEl.textContent = `${hand} / ${HAND_MAX}`;
}

// プレイヤーとブロックが重なるか
function overlapsPlayer(tx, ty) {
  return players.some((p) =>
    p.x < tx + 1 && p.x + p.w > tx && p.y < ty + 1 && p.y + p.h > ty);
}

function useAt(tx, ty) {
  const dist = Math.hypot(tx + 0.5 - me.cx, ty + 0.5 - me.cy);
  if (dist > REACH) {
    renderer.flash(tx, ty, 'ng');
    showTip('遠すぎて届かない');
    return;
  }
  const t = map.get(tx, ty);
  if (terrain.canDig(tx, ty)) {
    terrain.dig(tx, ty);
    hand = Math.min(HAND_MAX, hand + 1);
    renderer.flash(tx, ty, 'dig');
  } else if (t === T.AIR) {
    if (hand <= 0) { renderer.flash(tx, ty, 'ng'); showTip('ブロックがない'); return; }
    if (overlapsPlayer(tx, ty)) { renderer.flash(tx, ty, 'ng'); return; }
    if (!terrain.place(tx, ty)) { renderer.flash(tx, ty, 'ng'); return; }
    hand--;
    renderer.flash(tx, ty, 'place');
  } else {
    renderer.flash(tx, ty, 'ng');
    if (t === T.HARD) showTip('硬いブロックは爆弾でしか壊れない');
    else if (t === T.WATER) showTip('水の中には置けない');
    else if (t === T.CORE_C || t === T.CORE_P) showTip('コアは掘れない');
    else showTip('ここは壊せない');
  }
  updateHand();
}

canvas.addEventListener('pointerdown', (e) => {
  e.preventDefault();
  const { tx, ty } = renderer.screenToTile(e.clientX, e.clientY);
  useAt(tx, ty);
});

// ---- 毎フレームの計算と描画 ----
const TERRAIN_STEP = 1 / TERRAIN_HZ;
let last = performance.now();
let acc = 0;
let terrainAcc = 0;
let time = 0;

function frame(now) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  acc += dt;
  terrainAcc += dt;

  // ブロックの物理(1秒に10回)
  while (terrainAcc >= TERRAIN_STEP) {
    terrain.tick();
    terrainAcc -= TERRAIN_STEP;
    // 落ちてきた物に埋まったら押し出す
    for (const p of players) p.unstick(map);
    // 地形が変わったらミニマップを描き直す
    // (オンラインになったら、ここで変わったブロックだけを送る)
    if (terrain.takeChanges().length > 0) renderer.redrawMiniTerrain();
  }

  while (acc >= STEP) {
    me.update(STEP, input.read(), map);
    acc -= STEP;
    time += STEP;
  }
  renderer.updateCamera(dt, me);
  renderer.draw(players, me, time);
  requestAnimationFrame(frame);
}

updateHand();
renderer.updateCamera(0, me, true);
requestAnimationFrame(frame);

// テスト用(画面の確認に使う)
window.__cb = { map, me, input, renderer, terrain, useAt, hitsSolid };
