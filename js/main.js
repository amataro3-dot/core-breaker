// 入口: 1人で試合ができる状態にする(ステップ4)
// コア・体力・やられる・復活・勝ち負け・タイマー。相手はまだ練習用の的
import { STEP, T, COLORS as C } from './config.js';
import { buildMap } from './map.js';
import { Player, hitsSolid } from './player.js';
import { Dummy } from './dummy.js';
import { Stick, Input } from './input.js';
import { Renderer } from './render.js';
import { Terrain, TERRAIN_HZ, REACH, HAND_MAX } from './terrain.js';
import { Effects } from './effects.js';
import { Items, BOMB } from './items.js';
import { Match, RULES } from './game.js';

// 古い端末向け: 角の丸い四角が描けないときの代わり
if (!CanvasRenderingContext2D.prototype.roundRect) {
  CanvasRenderingContext2D.prototype.roundRect = function (x, y, w, h) { this.rect(x, y, w, h); };
}

const map = buildMap();
const terrain = new Terrain(map);
const effects = new Effects(map);
const me = new Player('cyan', map.spawns.cyan, 'YOU');

// 練習用の的(ピンク3体)。地上に2体、地下トンネルに1体
function floorBelow(x, fromY) {
  let y = fromY;
  while (y < map.H && !hitsSolid(map, x, y, 0.1, 0.1)) y++;
  return y;
}
const dummies = [
  new Dummy('pink', { x: 141.5, y: map.surf[141] }, 4),
  new Dummy('pink', { x: 130.5, y: map.surf[130] }, 5),
  new Dummy('pink', { x: 128.5, y: floorBelow(128.5, 27) }, 6),
];
const players = [me, ...dummies];

const $ = (id) => document.getElementById(id);
const canvas = $('game');
const itemButtons = [...document.querySelectorAll('.item')];

const input = new Input(new Stick($('stick-left')), new Stick($('stick-right')));
const renderer = new Renderer(canvas, $('minimap'), map);

// ---- お知らせ・表示 ----
let tipTimer = 0;
function showTip(text) {
  $('tip').textContent = text;
  $('tip').classList.add('show');
  clearTimeout(tipTimer);
  tipTimer = setTimeout(() => $('tip').classList.remove('show'), 1400);
}

let items = null;
// 持ち物の表示(選んでいる物、残りの数)を新しくする
function updateItemsUI() {
  if (!items) return;
  for (const b of itemButtons) b.classList.toggle('active', b.dataset.item === items.current);
  $('hand-count').textContent = `${items.hand} / ${HAND_MAX}`;
  $('block-count').textContent = items.hand;
  $('block-count').classList.toggle('empty', items.hand === 0);
  $('bomb-count').textContent = items.bombs;
  $('bomb-count').classList.toggle('empty', items.bombs === 0);
}

let hurtTimer = 0;
function hurtFlash() {
  const el = $('hurt');
  el.classList.add('on');
  clearTimeout(hurtTimer);
  hurtTimer = setTimeout(() => el.classList.remove('on'), 60);
}

const teamColor = (team) => (team === 'cyan' ? C.cyan : C.pink);

// ---- 試合 ----
const match = new Match(map, players, {
  playerHit(p, amount) {
    effects.text(p.cx, p.y - 0.2, `-${amount}`, p === me ? '#ff6b6b' : '#ffffff');
    if (p === me) hurtFlash();
  },
  died(p) {
    effects.pop(p.cx, p.cy, teamColor(p.team));
    if (p === me) renderer.shake(0.25);
  },
  coreHit(c, amount) {
    effects.text(c.x + c.w / 2, c.y - 0.3, `-${amount}`, C.yellow);
  },
  coreBroken(c) {
    // コアが壊れた: ブロックを消して、大きな爆発
    for (let y = c.y; y < c.y + c.h; y++) {
      for (let x = c.x; x < c.x + c.w; x++) {
        terrain.setTile(x, y, T.AIR);
        effects.debris(x, y, T.HARD, 8, 9, { x: c.x + c.w / 2, y: c.y + c.h / 2 });
      }
    }
    terrain.dirty = true;
    effects.blast(c.x + c.w / 2, c.y + c.h / 2, 5);
    effects.pop(c.x + c.w / 2, c.y + c.h / 2, teamColor(c.team));
    renderer.shake(0.9);
  },
  ended(result) {
    // 少し待って(爆発を見せてから)結果を出す
    setTimeout(() => showResult(result), result.reason === 'core' ? 1400 : 300);
  },
});

items = new Items({ map, terrain, effects, players, match }, {
  flash: (tx, ty, kind) => renderer.flash(tx, ty, kind),
  tip: showTip,
  shake: (a) => renderer.shake(a),
  changed: updateItemsUI,
});

function showResult(r) {
  const title = $('result-title');
  title.className = '';
  if (r.winner === me.team) { title.textContent = 'WIN'; title.classList.add('win'); }
  else if (r.winner) { title.textContent = 'LOSE'; title.classList.add('lose'); }
  else { title.textContent = 'DRAW'; title.classList.add('draw'); }
  $('result-reason').textContent = r.reason === 'core'
    ? (r.winner === me.team ? '相手のコアを壊した!' : '自分のコアが壊された…')
    : '時間切れ(コアの残り体力で判定)';
  $('result-cyan').textContent = Math.round(r.cyan);
  $('result-pink').textContent = Math.round(r.pink);
  $('result').classList.add('show');
}

// もう一度: マップも全部、最初の状態にもどす
function newMatch() {
  map.tiles.set(buildMap().tiles);
  terrain.changed.clear();
  terrain.dirty = true;
  effects.clear();
  match.reset();
  for (const p of players) p.respawn();
  items.reset();
  renderer.redrawMiniTerrain();
  renderer.updateCamera(0, me, true);
  $('result').classList.remove('show');
}
$('again').addEventListener('click', newMatch);

// ---- 操作 ----
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

// 画面タップで掘る・置く(v0.2からの操作。持ち物に関係なく使える)
canvas.addEventListener('pointerdown', (e) => {
  e.preventDefault();
  const { tx, ty } = renderer.screenToTile(e.clientX, e.clientY);
  items.tapAt(me, tx, ty, REACH);
});

// ---- HUD(上のコア体力・タイマー、自分の体力) ----
const hudCache = {};
function setText(id, text) {
  if (hudCache[id] === text) return;
  hudCache[id] = text;
  $(id).textContent = text;
}
function setWidth(id, ratio) {
  const v = `${Math.max(0, Math.min(1, ratio)) * 100}%`;
  if (hudCache[id] === v) return;
  hudCache[id] = v;
  $(id).style.width = v;
}
function updateHud() {
  setWidth('core-cyan', match.core('cyan').hp / RULES.coreHp);
  setWidth('core-pink', match.core('pink').hp / RULES.coreHp);
  const t = Math.ceil(match.timeLeft);
  setText('timer', `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`);
  $('timer').classList.toggle('hurry', t <= 30);

  setWidth('hp-fill', me.hp / me.maxHp);
  setText('hp-num', String(Math.ceil(me.hp)));
  const fill = $('hp-fill');
  fill.classList.toggle('mid', me.hp / me.maxHp <= 0.5 && me.hp / me.maxHp > 0.25);
  fill.classList.toggle('low', me.hp / me.maxHp <= 0.25);

  $('dead').classList.toggle('show', me.dead && match.state === 'play');
  if (me.dead) setText('dead-count', String(Math.max(1, Math.ceil(me.respawnT))));
}

// ---- 毎フレームの計算と描画 ----
const TERRAIN_STEP = 1 / TERRAIN_HZ;
const NO_INPUT = { x: 0, y: 0, jumpHeld: false, aimHeld: false, aim: null, release: null };
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
    for (const p of players) if (!p.dead) p.unstick(map);
    // 地形が変わったらミニマップを描き直す
    // (オンラインになったら、ここで変わったブロックだけを送る)
    if (terrain.takeChanges().length > 0) renderer.redrawMiniTerrain();
  }

  // 動き・持ち物・試合(1秒に60回)
  while (acc >= STEP) {
    const playing = match.state === 'play';
    const inp = playing ? input.read() : (input.read(), NO_INPUT);
    const wasDead = me.dead;
    if (!me.dead) me.update(STEP, inp, map);
    for (const d of dummies) if (!d.dead) d.update(STEP, playing ? d.think(STEP) : NO_INPUT, map);
    items.update(STEP, me, me.dead ? NO_INPUT : inp);
    match.update(STEP);
    if (wasDead && !me.dead) renderer.updateCamera(0, me, true); // 復活したらカメラを自分へ
    acc -= STEP;
    time += STEP;
  }
  effects.update(dt);
  renderer.updateCamera(dt, me);
  renderer.draw(players, me, time, items, effects);
  updateHud();
  requestAnimationFrame(frame);
}

updateItemsUI();
renderer.updateCamera(0, me, true);
requestAnimationFrame(frame);

// テスト用(画面の確認に使う)
window.__cb = { map, me, dummies, players, input, renderer, terrain, items, effects, match, hitsSolid, BOMB, newMatch };
