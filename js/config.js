// ゲーム全体で使う決まった値(数字はあとで調整する)

// ブロックの種類
export const T = {
  AIR: 0,
  DIRT: 1,     // 通常ブロック
  HARD: 2,     // 硬いブロック
  BEDROCK: 3,  // 岩盤(壊れない)
  SAND: 4,
  WATER: 5,
  LADDER: 6,
  CORE_C: 7,   // シアンのコア
  CORE_P: 8,   // ピンクのコア
};

// ぶつかる(通り抜けられない)ブロック
export const SOLID = new Uint8Array(16);
for (const t of [T.DIRT, T.HARD, T.BEDROCK, T.SAND, T.CORE_C, T.CORE_P]) SOLID[t] = 1;

// マップの大きさ(ブロック数)
export const MAP_W = 160;
export const MAP_H = 48;

// 動きの値(単位: ブロック/秒)
export const PHYS = {
  gravity: 60,
  move: 8.5,
  jump: 19.6,     // 約3ブロックの高さまで跳べる
  maxFall: 28,
  climb: 7,
  waterMove: 0.55, // 水の中では移動が遅くなる倍率
  waterGravity: 0.35,
  waterMaxFall: 5,
  swimUp: 6,
};

// 画面に横何ブロック分を映すか
export const VIEW_TILES_X = 20;

// 1回の計算の時間(1秒に60回)
export const STEP = 1 / 60;

export const COLORS = {
  sky: '#0b1020',
  backWall: '#0a0e1a',
  backGrid: '#111832',
  dirt: '#1a2238',
  dirtLine: '#2c3a5c',
  hard: '#272d44',
  hardLine: '#46507a',
  bedrock: '#0d111d',
  bedrockLine: '#1a2034',
  sand: '#c9a24a',
  sandDot: '#e5c573',
  water: 'rgba(30, 111, 217, 0.55)',
  waterTop: '#5fb0ff',
  ladder: '#8a9ba8',
  edge: 'rgba(0, 243, 255, 0.35)',
  cyan: '#00f3ff',
  pink: '#ff3366',
  yellow: '#ffcc00',
};
