// データベースとのつなぎ。本物(Firebase)と、テスト用のにせもの(同じ形で使える)。
// どちらも、場所は 'rooms/1234/players/abc' のような文字列で指定する。
//   get(path) / set(path, value) / update(path, obj) / remove(path)
//   onValue(path, cb) → やめる関数 / onDisconnectRemove(path) / now() / uid

export const FIREBASE_CONFIG = {
  apiKey: 'AIzaSyAf6G1aYL8QDhQHnaJS9xXlaDPTkWinuig',
  authDomain: 'core-breaker-ed593.firebaseapp.com',
  databaseURL: 'https://core-breaker-ed593-default-rtdb.asia-southeast1.firebasedatabase.app',
  projectId: 'core-breaker-ed593',
  storageBucket: 'core-breaker-ed593.firebasestorage.app',
  messagingSenderId: '623787285512',
  appId: '1:623787285512:web:ea774e04973834b58705bd',
};

const SDK = 'https://www.gstatic.com/firebasejs/10.12.2';

// 本物: Firebaseにつないで、名前なしでログインする(「みんなで遊ぶ」を押したときだけ読みこむ)
export async function connectFirebase() {
  const [{ initializeApp }, auth, db] = await Promise.all([
    import(`${SDK}/firebase-app.js`),
    import(`${SDK}/firebase-auth.js`),
    import(`${SDK}/firebase-database.js`),
  ]);
  const app = initializeApp(FIREBASE_CONFIG);
  const a = auth.getAuth(app);
  const cred = await auth.signInAnonymously(a);
  const d = db.getDatabase(app);
  const r = (path) => db.ref(d, path);
  // サーバーとの時計のずれ
  let offset = 0;
  db.onValue(r('.info/serverTimeOffset'), (s) => { offset = s.val() || 0; });
  return {
    uid: cred.user.uid,
    async get(path) { return (await db.get(r(path))).val(); },
    set: (path, v) => db.set(r(path), v),
    push: (path, v) => db.push(r(path), v),
    update: (path, v) => db.update(r(path), v),
    remove: (path) => db.remove(r(path)),
    onValue(path, cb) { return db.onValue(r(path), (s) => cb(s.val())); },
    onDisconnectRemove(path) { return db.onDisconnect(r(path)).remove(); },
    cancelOnDisconnect(path) { return db.onDisconnect(r(path)).cancel(); },
    now: () => Date.now() + offset,
  };
}

// ---- テスト用のにせもののデータベース(メモリの中だけ) ----
// 同じ store を共有すれば「同じデータベース」を見る。
// channel を指定すると、同じブラウザのほかのタブとも共有する(何台ぶんも同時に試すため)。
const parts = (path) => path.split('/').filter(Boolean);
const clone = (v) => (v === undefined || v === null ? null : JSON.parse(JSON.stringify(v)));

// 中身が空のもの(null や {})を消す(Firebaseと同じように)
function prune(obj) {
  if (obj === null || typeof obj !== 'object') return obj;
  for (const k of Object.keys(obj)) {
    obj[k] = prune(obj[k]);
    if (obj[k] === null || obj[k] === undefined ||
        (typeof obj[k] === 'object' && Object.keys(obj[k]).length === 0)) delete obj[k];
  }
  return obj;
}

function readAt(store, path) {
  let n = store.root;
  for (const k of parts(path)) {
    if (n === null || typeof n !== 'object' || !(k in n)) return null;
    n = n[k];
  }
  return clone(n);
}

function writeAt(store, path, v) {
  const ks = parts(path);
  let n = store.root;
  for (let i = 0; i < ks.length - 1; i++) {
    if (typeof n[ks[i]] !== 'object' || n[ks[i]] === null) n[ks[i]] = {};
    n = n[ks[i]];
  }
  if (v === null || v === undefined) delete n[ks[ks.length - 1]];
  else n[ks[ks.length - 1]] = clone(v);
  prune(store.root);
}

function notifyAll(store) {
  for (const l of [...store.listeners]) {
    const v = readAt(store, l.path);
    const s = JSON.stringify(v);
    if (s !== l.last) { l.last = s; l.cb(v); }
  }
}

export function createFakeStore(channel) {
  const store = { root: {}, listeners: new Set(), chan: null, ready: Promise.resolve() };
  if (channel && typeof BroadcastChannel !== 'undefined') {
    const chan = new BroadcastChannel(channel);
    store.chan = chan;
    let synced = false;
    store.ready = new Promise((res) => {
      setTimeout(res, 250); // ほかのタブがなければ、そのまま始める
      chan.onmessage = (m) => {
        const d = m.data;
        if (d.op === 'w') { for (const [p, v] of d.w) writeAt(store, p, v); notifyAll(store); }
        else if (d.op === 'hello') chan.postMessage({ op: 'full', root: store.root });
        else if (d.op === 'full' && !synced) { synced = true; store.root = clone(d.root) || {}; notifyAll(store); res(); }
      };
    });
    chan.postMessage({ op: 'hello' });
  }
  return store;
}

export function fakeDb(store, uid) {
  const disconnects = [];
  const write = (list) => {
    for (const [p, v] of list) writeAt(store, p, v);
    if (store.chan) store.chan.postMessage({ op: 'w', w: list });
    notifyAll(store);
  };
  let pushN = 0;
  const db = {
    uid,
    async get(path) { return readAt(store, path); },
    async set(path, v) { write([[path, clone(v)]]); },
    async update(path, obj) { write(Object.entries(obj).map(([k, v]) => [`${path}/${k}`, clone(v)])); },
    async remove(path) { write([[path, null]]); },
    async push(path, v) {
      const key = `${Date.now().toString(36)}${(pushN++).toString(36).padStart(3, '0')}${uid.slice(-3)}`;
      write([[`${path}/${key}`, clone(v)]]);
      return { key };
    },
    onValue(path, cb) {
      const l = { path, cb, last: undefined, owner: uid };
      store.listeners.add(l);
      const v = readAt(store, path);
      l.last = JSON.stringify(v);
      cb(v);
      return () => store.listeners.delete(l);
    },
    async onDisconnectRemove(path) { disconnects.push(path); },
    async cancelOnDisconnect(path) {
      const i = disconnects.indexOf(path);
      if (i >= 0) disconnects.splice(i, 1);
    },
    now: () => Date.now(),
    // テスト用: 回線が切れたことにする
    disconnect() {
      for (const l of [...store.listeners]) if (l.owner === uid) store.listeners.delete(l);
      write(disconnects.map((p) => [p, null]));
      disconnects.length = 0;
    },
  };
  return db;
}
