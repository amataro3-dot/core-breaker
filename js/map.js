// 固定マップを作る。左右対称(左がシアン、右がピンク)。
// 横幅120ブロック(v0.4.1で160から縮めた)。d は端からの距離
import { T, MAP_W as W, MAP_H as H } from './config.js?v=0.6.2';

const BASE_SURF = 18; // 陣地の地面の高さ(上から何段目か)

// 左右対称にするため、端からの距離 d で形を決める
const dOf = (x) => Math.min(x, W - 1 - x);

// 決まった乱数(毎回同じマップになる)
function hash(a, b) {
  const s = Math.sin(a * 12.9898 + b * 78.233) * 43758.5453;
  return s - Math.floor(s);
}

// 地面の高さ
function surfAt(d) {
  const k = Math.min(1, Math.max(0, (d - 14) / 10));
  const t = d - 14;
  return BASE_SURF + Math.round(k * (1.3 * Math.sin(t * 0.13) + 0.9 * Math.sin(t * 0.07)));
}

// 地下トンネルの天井と床
function tunnelTop(d) { return d < 14 ? 25 : 25 + Math.round(0.7 * Math.sin(d * 0.21)); }
function tunnelBottom(d) { return d < 14 ? 31 : 31 + Math.round(0.7 * Math.sin(d * 0.17 + 2)); }

export function buildMap() {
  const tiles = new Uint8Array(W * H);
  const surf = new Int16Array(W);

  const get = (x, y) => {
    if (x < 0 || x >= W || y >= H) return T.BEDROCK;
    if (y < 0) return T.AIR;
    return tiles[y * W + x];
  };
  const set = (x, y, t) => {
    if (x >= 0 && x < W && y >= 0 && y < H) tiles[y * W + x] = t;
  };
  // 左右両方に同じものを置く
  const setBoth = (d, y, t) => { set(d, y, t); set(W - 1 - d, y, t); };

  // 1. 地面
  for (let x = 0; x < W; x++) {
    const d = dOf(x);
    surf[x] = surfAt(d);
    for (let y = surf[x]; y < H; y++) set(x, y, T.DIRT);
  }

  // 2. 地下の硬いブロック(ところどころ)
  for (let d = 0; d <= (W - 1) / 2; d++) {
    for (let y = 32; y < H - 3; y++) {
      if (hash(d, y) < 0.12) setBoth(d, y, T.HARD);
    }
  }

  // 3. 地下トンネル(陣地の地下空間もつなげる)
  for (let d = 3; d <= (W - 1) / 2; d++) {
    for (let y = tunnelTop(d); y < tunnelBottom(d); y++) setBoth(d, y, T.AIR);
  }

  // 4. 水たまり(トンネルの床を2段掘って水を入れる)
  for (let d = 45; d <= 50; d++) {
    const b = tunnelBottom(d);
    setBoth(d, b, T.WATER);
    setBoth(d, b + 1, T.WATER);
  }

  // 5. 砂(地面の中と、トンネルの天井の上)。
  //    砂の下には通常ブロックを1段残す(そこを掘ると砂が落ちてくる)
  for (let d = 19; d <= 22; d++) {
    const s = surfAt(d);
    const bottom = Math.min(s + 3, tunnelTop(d) - 2);
    for (let y = bottom - 1; y <= bottom; y++) setBoth(d, y, T.SAND);
  }
  for (let d = 38; d <= 41; d++) {
    const top = tunnelTop(d);
    for (let y = top - 3; y <= top - 2; y++) setBoth(d, y, T.SAND);
  }

  // 6. コアと、まわりの硬い壁
  for (let d = 3; d <= 7; d++) {
    for (let y = 20; y <= 24; y++) {
      const inner = d >= 4 && d <= 6 && y >= 21 && y <= 23;
      if (inner) { set(d, y, T.CORE_C); set(W - 1 - d, y, T.CORE_P); }
      else setBoth(d, y, T.HARD);
    }
  }

  // 7. ハシゴ(地上と地下をつなぐ)
  const ladder = (d) => {
    const top = surfAt(d);
    const bottom = tunnelBottom(d) - 1;
    for (let y = top; y <= bottom; y++) setBoth(d, y, T.LADDER);
  };
  ladder(11); // 陣地の中
  ladder(30);
  ladder(59); // 真ん中(2本)

  // 8. 地上の物陰と建物
  {
    const s = surfAt(24);
    setBoth(24, s - 1, T.DIRT);
    setBoth(24, s - 2, T.DIRT);
  }
  for (let d = 36; d <= 37; d++) {
    const s = surfAt(d);
    for (let y = s - 2; y < s; y++) setBoth(d, y, T.HARD);
  }
  {
    // 真ん中の見張り台(硬いブロックは崩れない予定)。地面から3段、足場から2段跳んで登れる
    const s = surfAt(59);
    for (let d = 49; d <= 52; d++) setBoth(d, s - 3, T.HARD);
    for (let d = 55; d <= 59; d++) setBoth(d, s - 5, T.HARD);
  }

  // 9. 岩盤(一番下と左右の端)
  for (let x = 0; x < W; x++) for (let y = H - 3; y < H; y++) set(x, y, T.BEDROCK);
  for (let y = 0; y < H; y++) { set(0, y, T.BEDROCK); set(W - 1, y, T.BEDROCK); }

  return {
    W, H, tiles, surf, get, set,
    cores: [
      { team: 'cyan', x: 4, y: 21, w: 3, h: 3 },
      { team: 'pink', x: W - 7, y: 21, w: 3, h: 3 },
    ],
    // 足もとの位置(ブロック単位)
    spawns: {
      cyan: { x: 8.5, y: BASE_SURF },
      pink: { x: W - 8.5, y: BASE_SURF },
    },
  };
}
