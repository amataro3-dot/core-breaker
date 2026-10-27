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
    update: (path, v) => db.update(r(path), v),
    remove: (path) => db.remove(r(path)),
    onValue(path, cb) { return db.onValue(r(path), (s) => cb(s.val())); },
    onDisconnectRemove(path) { return db.onDisconnect(r(path)).remove(); },
    cancelOnDisconnect(path) { return db.onDisconnect(r(path)).cancel(); },
    now: () => Date.now() + offset,
  };
}

// ---- テスト用のにせもののデータベース(メモリの中だけ) ----
// 何人ぶんでも作れて、同じ store を共有すれば「同じデータベース」を見る。
export function createFakeStore() {
  return { root: {}, listeners: new Set() };
}

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

export function fakeDb(store, uid) {
  const read = (path) => {
    let n = store.root;
    for (const k of parts(path)) {
      if (n === null || typeof n !== 'object' || !(k in n)) return null;
      n = n[k];
    }
    return clone(n);
  };
  const write = (path, v) => {
    const ks = parts(path);
    let n = store.root;
    for (let i = 0; i < ks.length - 1; i++) {
      if (typeof n[ks[i]] !== 'object' || n[ks[i]] === null) n[ks[i]] = {};
      n = n[ks[i]];
    }
    if (v === null || v === undefined) delete n[ks[ks.length - 1]];
    else n[ks[ks.length - 1]] = clone(v);
    prune(store.root);
  };
  const notify = () => {
    for (const l of [...store.listeners]) {
      const v = read(l.path);
      const s = JSON.stringify(v);
      if (s !== l.last) { l.last = s; l.cb(v); }
    }
  };
  const disconnects = [];
  const db = {
    uid,
    async get(path) { return read(path); },
    async set(path, v) { write(path, v); notify(); },
    async update(path, obj) {
      for (const [k, v] of Object.entries(obj)) write(`${path}/${k}`, v);
      notify();
    },
    async remove(path) { write(path, null); notify(); },
    onValue(path, cb) {
      const l = { path, cb, last: undefined };
      store.listeners.add(l);
      const v = read(path);
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
      for (const p of disconnects) write(p, null);
      disconnects.length = 0;
      notify();
    },
  };
  // だれの見張りか覚えておく(切断のテスト用)
  const orig = db.onValue;
  db.onValue = (path, cb) => {
    const off = orig(path, cb);
    const l = [...store.listeners].pop();
    if (l) l.owner = uid;
    return off;
  };
  return db;
}
