// 入口: マップを作って、1人で動ける・掘れる・持ち物を使える状態にする(ステップ3)
import { STEP } from './config.js';
import { buildMap } from './map.js';
import { Player, hitsSolid } from './player.js';
import { Stick, Input } from './input.js';
import { Renderer } from './render.js';
import { Terrain, TERRAIN_HZ, REACH, HAND_MAX } from './terrain.js';
import { Effects } from './effects.js';
import { Items, BOMB } from './items.js';

// 古い端末向け: 角の丸い四角が描けないときの代わり
if (!CanvasRenderingContext2D.prototype.roundRect) {
  CanvasRenderingContext2D.prototype.roundRect = function (x, y, w, h) { this.rect(x, y, w, h); };
}

const map = buildMap();
const terrain = new Terrain(map);
const effects = new Effects(map);
const me = new Player('cyan', map.spawns.cyan);
const players = [me];

const canvas = document.getElementById('game');
const handEl = document.getElementById('hand-count');
const tipEl = document.getElementById('tip');
const bombEl = document.getElementById('bomb-count');
const blockEl = document.getElementById('block-count');
const itemButtons = [...document.querySelectorAll('.item')];

const input = new Input(
  new Stick(document.getElementById('stick-left')),
  new Stick(document.getElementById('stick-right')),
);
const renderer = new Renderer(canvas, document.getElementById('minimap'), map);

// 一瞬出るお知らせ
let tipTimer = 0;
function showTip(text) {
  tipEl.textContent = text;
  tipEl.classList.add('show');
  clearTimeout(tipTimer);
  tipTimer = setTimeout(() => tipEl.classList.remove('show'), 1400);
}

// 持ち物の表示(選んでいる物、残りの数)を新しくする
function updateItemsUI() {
  for (const b of itemButtons) b.classList.toggle('active', b.dataset.item === items.current);
  handEl.textContent = `${items.hand} / ${HAND_MAX}`;
  blockEl.textContent = items.hand;
  blockEl.classList.toggle('empty', items.hand === 0);
  bombEl.textContent = items.bombs;
  bombEl.classList.toggle('empty', items.bombs === 0);
}

const items = new Items({ map, terrain, effects, players }, {
  flash: (tx, ty, kind) => renderer.flash(tx, ty, kind),
  tip: showTip,
  shake: (a) => renderer.shake(a),
  changed: updateItemsUI,
});

for (const b of itemButtons) {
  b.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    items.select(b.dataset.item);
  });
}

window.addEventListener('resize', () => renderer.resize());
// 画面の長押しメニューやダブルタップの拡大を止める
document.addEventListener('contextmenu', (e) => e.preventDefault());
document.addEventListener('gesturestart', (e) => e.preventDefault());

// 画面タップで掘る・置く(v0.2からの仮の操作。持ち物に関係なく使える)
canvas.addEventListener('pointerdown', (e) => {
  e.preventDefault();
  const { tx, ty } = renderer.screenToTile(e.clientX, e.clientY);
  items.tapAt(me, tx, ty, REACH);
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

  // 動きと持ち物(1秒に60回)
  while (acc >= STEP) {
    const inp = input.read();
    me.update(STEP, inp, map);
    items.update(STEP, me, inp);
    acc -= STEP;
    time += STEP;
  }
  effects.update(dt);
  renderer.updateCamera(dt, me);
  renderer.draw(players, me, time, items, effects);
  requestAnimationFrame(frame);
}

updateItemsUI();
renderer.updateCamera(0, me, true);
requestAnimationFrame(frame);

// テスト用(画面の確認に使う)
window.__cb = { map, me, input, renderer, terrain, items, effects, hitsSolid, BOMB };
