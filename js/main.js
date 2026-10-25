// 入口: マップを作って、1人で動ける状態にする(ステップ1)
import { STEP } from './config.js';
import { buildMap } from './map.js';
import { Player } from './player.js';
import { Stick, Input } from './input.js';
import { Renderer } from './render.js';

// 古い端末向け: 角の丸い四角が描けないときの代わり
if (!CanvasRenderingContext2D.prototype.roundRect) {
  CanvasRenderingContext2D.prototype.roundRect = function (x, y, w, h) { this.rect(x, y, w, h); };
}

const map = buildMap();
const me = new Player('cyan', map.spawns.cyan);
const players = [me];

const input = new Input(new Stick(document.getElementById('stick-left')));
const renderer = new Renderer(
  document.getElementById('game'),
  document.getElementById('minimap'),
  map,
);

window.addEventListener('resize', () => renderer.resize());
// 画面の長押しメニューやダブルタップの拡大を止める
document.addEventListener('contextmenu', (e) => e.preventDefault());
document.addEventListener('gesturestart', (e) => e.preventDefault());

let last = performance.now();
let acc = 0;
let time = 0;

function frame(now) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  acc += dt;
  while (acc >= STEP) {
    me.update(STEP, input.read(), map);
    acc -= STEP;
    time += STEP;
  }
  renderer.updateCamera(dt, me);
  renderer.draw(players, me, time);
  requestAnimationFrame(frame);
}

renderer.updateCamera(0, me, true);
requestAnimationFrame(frame);

// テスト用(画面の確認に使う)
window.__cb = { map, me, input, renderer };
