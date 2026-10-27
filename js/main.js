// 入口: 最初の画面、ひとりで遊ぶ(AI戦)、みんなで遊ぶ(部屋・ロビー。js/online.js)
// 試合の前に人数(1対1 / 2対2 / 4対4)と強さを選ぶ。自分以外はAI
// みんなで遊ぶ: ホストのスマホが試合を計算して、ほかの人に送る(js/sync.js)
import { STEP, T, COLORS as C } from './config.js?v=0.7';
import { buildMap } from './map.js?v=0.7';
import { Player, hitsSolid } from './player.js?v=0.7';
import { Bot, ROLE_LABEL } from './ai.js?v=0.7';
import { Sync, RemotePlayer } from './sync.js?v=0.7';
import { Stick, Input } from './input.js?v=0.7';
import { Renderer } from './render.js?v=0.7';
import { Terrain, TERRAIN_HZ, REACH, HAND_MAX } from './terrain.js?v=0.7';
import { Effects } from './effects.js?v=0.7';
import { Items, BOMB } from './items.js?v=0.7';
import { Match, RULES } from './game.js?v=0.7';
import { initOnline } from './online.js?v=0.7';

// 古い端末向け: 角の丸い四角が描けないときの代わり
if (!CanvasRenderingContext2D.prototype.roundRect) {
  CanvasRenderingContext2D.prototype.roundRect = function (x, y, w, h) { this.rect(x, y, w, h); };
}

// 人数ごとのAIの役わり(ally = 自分のチームの、自分のほかのAI)
const ROSTER = {
  1: { ally: [], enemy: ['attack'] },
  2: { ally: ['defend'], enemy: ['attack', 'defend'] },
  4: { ally: ['attack', 'tunnel', 'defend'], enemy: ['attack', 'tunnel', 'defend', 'attack'] },
};

const map = buildMap();
const terrain = new Terrain(map);
const effects = new Effects(map);
const me = new Player('cyan', map.spawns.cyan, 'YOU');
me.id = 'me';
const players = [me];
const bots = [];
let sync = null; // みんなで遊ぶの試合中だけ

const $ = (id) => document.getElementById(id);
const canvas = $('game');
const itemButtons = [...document.querySelectorAll('.item')];

const input = new Input(new Stick($('stick-left')), new Stick($('stick-right')));
const renderer = new Renderer(canvas, $('minimap'), map);

// ---- 設定(前回選んだものを覚えておく) ----
const settings = { size: 4, level: 'normal' };
try {
  const saved = JSON.parse(localStorage.getItem('cb-settings') || '{}');
  if ([1, 2, 4].includes(saved.size)) settings.size = saved.size;
  if (['weak', 'normal', 'strong'].includes(saved.level)) settings.level = saved.level;
} catch (_) { /* 保存できない環境では毎回ふつう */ }

// ---- お知らせ・表示 ----
let tipTimer = 0;
function showTip(text) {
  $('tip').textContent = text;
  $('tip').classList.add('show');
  clearTimeout(tipTimer);
  tipTimer = setTimeout(() => $('tip').classList.remove('show'), 1400);
}

// 持ち物の表示(選んでいる物、残りの数)を新しくする
function updateItemsUI() {
  const it = me.items;
  if (!it) return;
  for (const b of itemButtons) b.classList.toggle('active', b.dataset.item === it.current);
  $('hand-count').textContent = `${it.hand} / ${HAND_MAX}`;
  $('block-count').textContent = it.hand;
  $('block-count').classList.toggle('empty', it.hand === 0);
  $('bomb-count').textContent = it.bombs;
  $('bomb-count').classList.toggle('empty', it.bombs === 0);
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
match.state = 'setup'; // 設定画面の間は、まだ始まっていない

const world = { map, terrain, effects, players, match };

me.items = new Items(world, {
  flash: (tx, ty, kind) => renderer.flash(tx, ty, kind),
  tip: showTip,
  shake: (a) => renderer.shake(a),
  changed: updateItemsUI,
  shot: (owner, b) => { if (sync) sync.onShot(owner, b); },
});

// AIの持ち物: 画面の表示は出さない。爆発のゆれは、自分の近くのときだけ
function botItems(bot) {
  return new Items(world, {
    flash() {},
    tip() {},
    changed() {},
    shake(a) {
      if (Math.abs(bot.cx - me.cx) < 14 && Math.abs(bot.cy - me.cy) < 10) renderer.shake(a * 0.7);
    },
    shot: (owner, b) => { if (sync) sync.onShot(owner, b); },
  });
}

// チームを組む(自分 + AI)。自分はシアンでもピンクでもよい
function buildTeams(size, level, myTeam) {
  players.length = 0;
  bots.length = 0;
  me.team = myTeam;
  me.spawn = map.spawns[myTeam];
  players.push(me);
  const roster = ROSTER[size];
  const add = (team, roles) => {
    roles.forEach((role, i) => {
      const base = map.spawns[team];
      const side = team === 'cyan' ? 1 : -1;
      // 生まれる場所を少しずつずらす
      const spawn = { x: base.x + side * (i + 1) * 0.9, y: base.y };
      const bot = new Bot(team, spawn, role, level, world);
      bot.items = botItems(bot);
      bots.push(bot);
      players.push(bot);
    });
  };
  const enemyTeam = myTeam === 'cyan' ? 'pink' : 'cyan';
  add(myTeam, roster.ally);
  add(enemyTeam, roster.enemy);
}

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
  $('result').classList.toggle('online', mode === 'online');
  $('result').classList.toggle('host', !!(sync && sync.isHost));
  $('result').classList.add('show');
}

let mode = 'solo'; // 'solo'(ひとりで) か 'online'(みんなで)

// 画面の切りかえ(最初の画面・設定・みんなで・ロビー・結果)
const SCREENS = ['title', 'setup', 'online', 'lobby', 'result'];
function showScreen(id) {
  for (const s of SCREENS) $(s).classList.toggle('show', s === id);
}

// マップ・効果・オンラインの状態を、最初にもどす
function resetWorld() {
  if (sync) { sync.stop(); sync = null; }
  map.tiles.set(buildMap().tiles);
  terrain.changed.clear();
  terrain.dirty = true;
  effects.clear();
  world.knock = null;
  world.onBoom = null;
  me.items.remote = null;
  me.id = 'me';
  me.name = 'YOU';
}

// 新しい試合(ひとりで遊ぶ): マップも全部、最初の状態にもどす
function newMatch(opts = { size: settings.size, level: settings.level, team: 'cyan' }) {
  resetWorld();
  buildTeams(opts.size, opts.level, opts.team);
  match.reset();
  for (const p of players) p.respawn();
  me.items.reset();
  renderer.redrawMiniTerrain();
  renderer.updateCamera(0, me, true);
  showScreen(null);
}

// 試合を止めて、画面の後ろで待つ(最初の画面やロビーのとき)
function stopMatch() {
  match.state = 'setup';
  if (sync) { sync.stop(); sync = null; }
}

// ---- みんなで遊ぶの試合 ----
// 空いた枠のAIの役わり(人が多いほど、前から順に使う)
const BOT_ROLES = { 1: ['attack'], 2: ['defend', 'attack'], 4: ['defend', 'tunnel', 'attack', 'attack'] };

// 全員が同じ並びになるように、部屋の人の一覧からチームを組む
function onlineRoster(humans, size) {
  const list = [];
  for (const team of ['cyan', 'pink']) {
    const hs = humans.filter((h) => h.team === team);
    hs.forEach((h, i) => list.push({ id: h.id, name: h.name, team, kind: 'h', slot: i }));
    BOT_ROLES[size].slice(0, Math.max(0, size - hs.length)).forEach((role, j) => {
      list.push({ id: `bot-${team}-${j}`, name: ROLE_LABEL[role], team, kind: 'b', role, slot: hs.length + j });
    });
  }
  return list;
}

const spawnAt = (team, slot) => {
  const base = map.spawns[team];
  return { x: base.x + (team === 'cyan' ? 1 : -1) * slot * 0.9, y: base.y };
};

// opts: { db, base, uid, isHost, humans: [{id, name, team}], size, level }
function startOnline(opts) {
  mode = 'online';
  resetWorld();
  players.length = 0;
  bots.length = 0;
  const roster = onlineRoster(opts.humans, opts.size);
  const mine = roster.find((r) => r.id === opts.uid);
  me.team = mine ? mine.team : 'cyan';
  me.spawn = spawnAt(me.team, mine ? mine.slot : 0);
  me.id = opts.uid;
  me.name = mine ? mine.name : 'YOU';
  players.push(me);
  for (const r of roster) {
    if (r.id === opts.uid) continue;
    const spawn = spawnAt(r.team, r.slot);
    if (opts.isHost && r.kind === 'b') {
      const bot = new Bot(r.team, spawn, r.role, opts.level, world);
      bot.id = r.id;
      bot.items = botItems(bot);
      bots.push(bot);
      players.push(bot);
    } else {
      const rp = new RemotePlayer(r.id, r.team, spawn, r.name, r.kind);
      // ホスト: ほかの人の投げた爆弾は、ホストが動かす
      if (opts.isHost) rp.items = botItems(rp);
      players.push(rp);
    }
  }
  match.reset();
  for (const p of players) p.respawn();
  me.items.reset();
  sync = new Sync({
    db: opts.db, base: opts.base, uid: opts.uid, isHost: opts.isHost, world, me, renderer,
    hooks: {
      meHurt: hurtFlash,
      respawned: () => renderer.updateCamera(0, me, true),
      coreBroken: (c) => match.hooks.coreBroken(c),
      result: (r) => setTimeout(() => showResult(r), r.reason === 'core' ? 1400 : 300),
      // 回線が切れた人の代わりのAI(ホスト)
      botFor(old) {
        const bot = new Bot(old.team, old.spawn, 'attack', opts.level, world);
        bot.id = old.id;
        bot.name = ROLE_LABEL.attack;
        bot.x = old.x; bot.y = old.y; bot.hp = old.hp; bot.dead = old.dead; bot.respawnT = old.respawnT;
        bot.items = old.items || botItems(bot);
        bots.push(bot);
        return bot;
      },
    },
  });
  if (opts.isHost) {
    world.knock = (p, vx, vy) => sync.knock(p, vx, vy);
    world.onBoom = (b) => sync.onBoom(b);
  } else {
    match.remote = sync;
    me.items.remote = sync;
  }
  sync.start();
  renderer.redrawMiniTerrain();
  renderer.updateCamera(0, me, true);
  showScreen(null);
}

// ---- 試合の前の画面 ----
function showSetup() {
  mode = 'solo';
  for (const b of document.querySelectorAll('[data-size]')) {
    b.classList.toggle('on', Number(b.dataset.size) === settings.size);
  }
  for (const b of document.querySelectorAll('[data-level]')) {
    b.classList.toggle('on', b.dataset.level === settings.level);
  }
  showScreen('setup');
}
for (const b of document.querySelectorAll('[data-size]')) {
  b.addEventListener('click', () => { settings.size = Number(b.dataset.size); showSetup(); });
}
for (const b of document.querySelectorAll('[data-level]')) {
  b.addEventListener('click', () => { settings.level = b.dataset.level; showSetup(); });
}
$('start').addEventListener('click', () => {
  try { localStorage.setItem('cb-settings', JSON.stringify(settings)); } catch (_) { /* 保存できなくても遊べる */ }
  newMatch();
});
$('again').addEventListener('click', () => newMatch());
$('change').addEventListener('click', showSetup);
$('setup-back').addEventListener('click', () => showScreen('title'));
$('go-solo').addEventListener('click', showSetup);

// みんなで遊ぶ(部屋・ロビー)
const online = initOnline({
  $,
  showScreen,
  setMode(m) { mode = m; },
  startOnline,
  stopMatch,
  matchState: () => match.state,
  get sync() { return sync; },
  playerLeft(id) { if (sync && sync.isHost) sync.replaceWithBot(id); },
  isPlaying: () => match.state === 'play',
});

// ---- 操作 ----
for (const b of itemButtons) {
  b.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    me.items.select(b.dataset.item);
  });
}

window.addEventListener('resize', () => renderer.resize());
// 画面の長押しメニューやダブルタップの拡大を止める
document.addEventListener('contextmenu', (e) => e.preventDefault());
document.addEventListener('gesturestart', (e) => e.preventDefault());
document.addEventListener('gesturechange', (e) => e.preventDefault());
document.addEventListener('dblclick', (e) => e.preventDefault(), { passive: false });
// iPhone: 同じ場所をすばやく2回タップしたときに拡大が始まるのを止める
// (ちがう場所のタップや、名前などの入力欄は、ふつうに使える)
let lastTap = { t: 0, x: -99, y: -99 };
document.addEventListener('touchend', (e) => {
  const touch = e.changedTouches && e.changedTouches[0];
  if (!touch) return;
  const now = Date.now();
  const typing = e.target.closest && e.target.closest('input, textarea');
  const near = Math.hypot(touch.clientX - lastTap.x, touch.clientY - lastTap.y) < 40;
  if (!typing && near && now - lastTap.t < 300) e.preventDefault();
  lastTap = { t: now, x: touch.clientX, y: touch.clientY };
}, { passive: false });

// 画面タップで掘る・置く(v0.2からの操作。持ち物に関係なく使える)
canvas.addEventListener('pointerdown', (e) => {
  e.preventDefault();
  const { tx, ty } = renderer.screenToTile(e.clientX, e.clientY);
  me.items.tapAt(me, tx, ty, REACH);
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

// ---- 計算 ----
const TERRAIN_STEP = 1 / TERRAIN_HZ;
const NO_INPUT = { x: 0, y: 0, jumpHeld: false, aimHeld: false, aim: null, release: null };
let terrainAcc = 0;
let time = 0;

// 1回分(1/60秒)の計算
function step() {
  // みんなで遊ぶでホストでない人は、地形の計算をしない(ホストから届く)
  const client = sync && !sync.isHost;
  terrainAcc += STEP;
  // ブロックの物理(1秒に10回)
  if (terrainAcc >= TERRAIN_STEP && !client) {
    terrainAcc -= TERRAIN_STEP;
    terrain.tick();
    // 落ちてきた物に埋まったら押し出す
    for (const p of players) if (!p.dead && !p.remote) p.unstick(map);
    // 地形が変わったらミニマップを描き直す。ホストは、変わったブロックを送る
    const changes = terrain.takeChanges();
    if (changes.length > 0) {
      renderer.redrawMiniTerrain();
      if (sync) sync.addTiles(changes);
    }
  }
  if (client) { terrain.changed.clear(); terrainAcc = 0; }

  // 動き・持ち物・試合
  const playing = match.state === 'play';
  const inp = playing ? input.read() : (input.read(), NO_INPUT);
  const wasDead = me.dead;
  if (!me.dead) me.update(STEP, inp, map);
  me.items.update(STEP, me, me.dead ? NO_INPUT : inp);
  for (const b of bots) {
    if (!b.dead) b.update(STEP, playing ? b.think(STEP) : NO_INPUT, map);
    b.items.update(STEP, b, NO_INPUT);
  }
  // ホスト: ほかの人の投げた爆弾を動かす
  if (sync && sync.isHost) {
    for (const p of players) if (p.remote && p.items) p.items.update(STEP, p, NO_INPUT);
  }
  match.update(STEP);
  if (sync) sync.tick(STEP);
  if (wasDead && !me.dead) renderer.updateCamera(0, me, true); // 復活したらカメラを自分へ
  time += STEP;
}

// ---- 毎フレームの計算と描画 ----
let last = performance.now();
let acc = 0;
function frame(now) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  acc += dt;
  while (acc >= STEP) {
    step();
    acc -= STEP;
  }
  effects.update(dt);
  renderer.updateCamera(dt, me);
  renderer.draw(players, me, time, me.items, effects, sync ? [sync.ghost] : []);
  updateHud();
  requestAnimationFrame(frame);
}

updateItemsUI();
renderer.updateCamera(0, me, true);
showScreen('title');
requestAnimationFrame(frame);

// テスト用(画面の確認に使う)。sim(秒) で早送りできる
window.__cb = {
  map, me, bots, players, input, renderer, terrain, effects, match, settings, hitsSolid, BOMB, newMatch, online,
  get sync() { return sync; },
  sim(sec) { for (let i = 0; i < sec / STEP; i++) { step(); effects.update(STEP); } },
};
